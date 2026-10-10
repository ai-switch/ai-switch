mod usage;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::models::platform::PlatformId;
use crate::saas::{billing, domain::groups, logs::LogRecord, repository, SaasRuntime};
use crate::services::route_model_capability::ModelMatchMode;
use crate::services::route_proxy_service::{
    build_proxy_state, extract_inbound_api_key, proxy_handler, ProxyAppState,
};
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::time::{Duration, Instant};
use usage::UsageObserver;

pub(crate) async fn handle(
    state: &AppState,
    method: Method,
    headers: HeaderMap,
    uri: Uri,
    body: Body,
) -> Response {
    let proxy = build_proxy_state(state.pool.clone(), &state.route_proxy);
    let mut response =
        match execute(state, &state.saas, proxy, method, headers, uri, body).await {
            Ok(response) => response,
            Err(error) => crate::saas::transport::error_response(error),
        };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

async fn execute(
    app_state: &AppState,
    runtime: &SaasRuntime,
    proxy: ProxyAppState,
    method: Method,
    mut headers: HeaderMap,
    uri: Uri,
    body: Body,
) -> Result<Response, AppError> {
    let pool = &app_state.pool;
    runtime.initialize(pool).await?;
    let key = extract_inbound_api_key(&headers, None)
        .ok_or_else(|| repository::invalid("saas.invalid_key", "An API key is required"))?;
    let principal = billing::authenticate_key(pool, &key).await?;
    runtime
        .allow(format!("inference:{}", principal.user_id), 600)
        .await?;
    let path = uri.path().trim_end_matches('/').to_string();
    if matches!(path.as_str(), "/v1/models" | "/models") && method == Method::GET {
        crate::saas::domain::model_sync::ensure_group_current(pool, &principal.group_id).await?;
        let models: Vec<String> = sqlx::query_scalar(
            "SELECT model FROM saas_group_models
             WHERE group_id=? AND sync_state='active' AND enabled=1 ORDER BY model",
        )
        .bind(&principal.group_id)
        .fetch_all(pool)
        .await
        .map_err(repository::db_error)?;
        let mut available = Vec::new();
        for model in models {
            if !groups::permitted_accounts_for_model(pool, &principal.group_id, &model)
                .await?
                .is_empty()
            {
                available.push(json!({"id":model,"object":"model","owned_by":"ai-switch"}));
            }
        }
        return Ok(Json(json!({"object":"list","data":available})).into_response());
    }
    let anthropic = matches!(path.as_str(), "/v1/messages" | "/messages");
    let responses = matches!(path.as_str(), "/v1/responses" | "/responses");
    let chat = matches!(path.as_str(), "/v1/chat/completions" | "/chat/completions");
    let images = matches!(
        path.as_str(),
        "/v1/images/generations" | "/images/generations"
    );
    // 视频渠道（G-P4）。平台值由组决定（`video:kling` …），所以这里只判断路径。
    let videos = crate::services::route_proxy_service::is_video_generation_path(&path);
    // 视频是**异步任务** API：提交是 POST，查询是 GET，两者都算 `videos`。
    // 复审前这里写的是 `method != Method::POST`，于是一个 `sk-saas-` key 查
    // `/v1/video/generations/{task_id}` 只会拿到 `saas.endpoint_not_allowed`
    // —— 提交能用、轮询不能用，异步契约断了一半。其余端点仍然只接受 POST。
    let video_status =
        videos && method == Method::GET && crate::web::video_routes::video_task_id_from_path(&path).is_some();
    if (!video_status && method != Method::POST)
        || !(anthropic || responses || chat || images || videos)
        || (principal.platform == "claude" && !(anthropic || responses))
        || (principal.platform == "gemini" && !images)
        || (principal.platform == "codex" && anthropic)
        // 视频 key 只能打视频端点。不加这条的话它会一路走到文本预留，
        // 由 `reserve` 的 `groups.platform IN (...)` 挡下，报出来的是
        // `saas.invalid_key`（「key 无效」）——而真正的原因是端点不对。
        || (principal.platform.starts_with("video:") && !videos)
    {
        return Err(repository::invalid(
            "saas.endpoint_not_allowed",
            "This endpoint is unavailable for the API key",
        ));
    }
    let status = runtime
        .logs
        .status()
        .await
        .map_err(crate::saas::log_error)?;
    if !status.accepting {
        return Err(repository::invalid(
            "saas.logs_unavailable",
            "Request logging is unavailable; try again later",
        ));
    }
    // 状态查询没有请求体，必须在下面「读 body 并解析 JSON」之前分派，
    // 否则空体会先撞上 `saas.validation`。
    if video_status {
        return execute_video_status(app_state, pool, principal, &path, uri.query()).await;
    }
    let body = axum::body::to_bytes(body, 2 * 1024 * 1024)
        .await
        .map_err(|_| {
            repository::invalid("saas.request_limits", "Request body exceeds the limit")
        })?;
    let mut payload: Value = serde_json::from_slice(&body).map_err(|_| {
        repository::invalid("saas.validation", "Request must contain a JSON object")
    })?;
    let object = payload.as_object_mut().ok_or_else(|| {
        repository::invalid("saas.validation", "Request must contain a JSON object")
    })?;
    let model = object
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.is_empty())
        .ok_or_else(|| repository::invalid("saas.model_not_allowed", "A model is required"))?
        .to_string();
    if images {
        return execute_image_request(
            pool, runtime, proxy, principal, headers, uri, payload, model, &path,
        )
        .await;
    }
    if videos {
        return execute_video_request(
            app_state, pool, runtime, principal, payload, &path,
        )
        .await;
    }
    let default_output: i64 =
        sqlx::query_scalar("SELECT max_output_tokens FROM saas_group_settings WHERE group_id=?")
            .bind(&principal.group_id)
            .fetch_optional(pool)
            .await
            .map_err(repository::db_error)?
            .ok_or_else(|| {
                repository::invalid("saas.group_unavailable", "Group pricing is not configured")
            })?;
    let output_field = if responses {
        "max_output_tokens"
    } else if chat && object.contains_key("max_completion_tokens") {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    let output_limit = match object.get(output_field) {
        Some(value) => value.as_i64().ok_or_else(|| {
            repository::invalid("saas.request_limits", "Output limit must be an integer")
        })?,
        None => default_output,
    };
    let streaming = object
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    for field in ["max_output_tokens", "max_completion_tokens", "max_tokens"] {
        object.remove(field);
    }
    object.insert(output_field.into(), json!(output_limit));
    if streaming && chat {
        object.insert("stream_options".into(), json!({"include_usage":true}));
    }
    let reservation = billing::reserve(
        pool,
        &principal,
        &model,
        body.len() as i64 + 64,
        output_limit,
    )
    .await?;
    object.insert("model".into(), json!(reservation.upstream_model));
    let deadline =
        tokio::time::Instant::now() + Duration::from_secs(reservation.timeout_seconds as u64);
    let mut completion = Completion {
        pool: pool.clone(),
        runtime: runtime.clone(),
        request_id: Some(reservation.request_id.clone()),
        user_id: reservation.user_id.clone(),
        key_id: reservation.key_id.clone(),
        group_id: reservation.group_id.clone(),
        platform: reservation.platform.clone(),
        model,
        path: path.clone(),
        started: Instant::now(),
        created_at: chrono::Utc::now(),
        status: StatusCode::BAD_GATEWAY.as_u16(),
        observer: UsageObserver::new(streaming, anthropic),
    };
    let proxy = proxy
        .with_access_scope(
            PlatformId::parse(&reservation.platform)?,
            reservation.credential_ids.into_iter().collect(),
        )
        .with_model_match_mode(ModelMatchMode::SaasUpstream);
    headers.remove(header::COOKIE);
    headers.remove("x-saas-csrf");
    headers.remove("x-ai-switch-test-trace-id");
    headers.remove(header::CONTENT_LENGTH);
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    let upstream = tokio::time::timeout_at(
        deadline,
        proxy_handler(
            State(proxy),
            method,
            headers,
            uri,
            Body::from(payload.to_string()),
        ),
    )
    .await;
    let response = match upstream {
        Ok(response) => response,
        Err(_) => {
            completion.status = 504;
            completion.complete(false).await;
            return Ok((StatusCode::GATEWAY_TIMEOUT,Json(json!({"error":{"code":"saas.upstream_timeout","message":"Upstream request timed out"}}))).into_response());
        }
    };
    completion.status = response.status().as_u16();
    let (mut parts, body) = response.into_parts();
    parts.headers.remove(header::SET_COOKIE);
    parts
        .headers
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    parts
        .headers
        .insert("x-saas-request-id", reservation.request_id.parse().unwrap());
    let stream = futures_util::stream::unfold(
        (body.into_data_stream(), completion, deadline),
        |(mut source, mut completion, deadline)| async move {
            if completion.request_id.is_none() {
                return None;
            }
            match tokio::time::timeout_at(deadline, source.next()).await {
                Ok(Some(Ok(bytes))) => {
                    completion.observer.observe(&bytes);
                    Some((
                        Ok::<_, std::io::Error>(bytes),
                        (source, completion, deadline),
                    ))
                }
                Ok(None) => {
                    completion.complete(true).await;
                    None
                }
                Ok(Some(Err(_))) | Err(_) => {
                    completion.complete(false).await;
                    Some((
                        Err(std::io::Error::other("Upstream response interrupted")),
                        (source, completion, deadline),
                    ))
                }
            }
        },
    );
    Ok(Response::from_parts(parts, Body::from_stream(stream)))
}

async fn execute_image_request(
    pool: &SqlitePool,
    runtime: &SaasRuntime,
    proxy: ProxyAppState,
    principal: billing::ApiPrincipal,
    mut headers: HeaderMap,
    uri: Uri,
    mut payload: Value,
    model: String,
    path: &str,
) -> Result<Response, AppError> {
    let object = payload.as_object_mut().ok_or_else(|| {
        repository::invalid("saas.validation", "Request must contain a JSON object")
    })?;
    let count = object
        .get("n")
        .map(|value| {
            value.as_i64().ok_or_else(|| {
                repository::invalid("saas.request_limits", "Image count must be an integer")
            })
        })
        .transpose()?
        .unwrap_or(1);
    let reservation = billing::reserve_image(pool, &principal, &model, count).await?;
    object.insert("model".into(), json!(reservation.upstream_model));
    let request_id = reservation.request_id.clone();
    let deadline =
        tokio::time::Instant::now() + Duration::from_secs(reservation.timeout_seconds as u64);
    let proxy = proxy
        .with_access_scope(
            PlatformId::parse(&reservation.platform)?,
            reservation.credential_ids.into_iter().collect(),
        )
        .with_model_match_mode(ModelMatchMode::SaasUpstream);
    headers.remove(header::COOKIE);
    headers.remove("x-saas-csrf");
    headers.remove("x-ai-switch-test-trace-id");
    headers.remove(header::CONTENT_LENGTH);
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    let started = Instant::now();
    let created_at = chrono::Utc::now();
    let upstream = tokio::time::timeout_at(
        deadline,
        proxy_handler(
            State(proxy),
            Method::POST,
            headers,
            uri,
            Body::from(payload.to_string()),
        ),
    )
    .await;
    let response = match upstream {
        Ok(response) => response,
        Err(_) => {
            let _ = billing::settle_image(pool, &request_id, None, true).await;
            return Ok((StatusCode::GATEWAY_TIMEOUT, Json(json!({"error":{"code":"saas.upstream_timeout","message":"Upstream request timed out"}}))).into_response());
        }
    };
    let status = response.status();
    let (mut parts, body) = response.into_parts();
    let bytes = axum::body::to_bytes(body, 128 * 1024 * 1024)
        .await
        .map_err(|_| repository::invalid("saas.upstream_body", "Could not read image response"))?;
    let success_count = if status.is_success() {
        serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("data")
                    .and_then(Value::as_array)
                    .map(|items| items.len() as i64)
            })
    } else {
        Some(0)
    };
    let settlement =
        billing::settle_image(pool, &request_id, success_count, status.is_success()).await?;
    let record = LogRecord {
        request_id: request_id.clone(),
        user_id: reservation.user_id,
        key_id: reservation.key_id,
        group_id: reservation.group_id,
        platform: reservation.platform,
        model,
        endpoint: path.to_string(),
        created_at,
        utc_offset_minutes: chrono::Local::now().offset().local_minus_utc() / 60,
        duration_ms: started.elapsed().as_millis().min(i64::MAX as u128) as i64,
        status: status.as_u16(),
        amount_usd_micros: settlement.price_usd_micros.unwrap_or(0),
        settlement_status: settlement.status,
        error_code: if status.is_success() {
            None
        } else {
            Some("upstream_rejected".into())
        },
        ..Default::default()
    };
    if runtime.logs.enqueue(record).await.is_err() {
        eprintln!("SaaS request log queue rejected a completed image request");
    }
    parts.headers.remove(header::SET_COOKIE);
    parts
        .headers
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    parts
        .headers
        .insert("x-saas-request-id", request_id.parse().unwrap());
    Ok(Response::from_parts(parts, Body::from(bytes)))
}

/// 视频任务的 SaaS 查询（G-P4 复审补）。
///
/// 存在两个理由，都是复审抓出来的：
///   1. 复审前这里是**不可达**的 —— 上面的守卫写的是 `method != Method::POST`，
///      所以 `sk-saas-` key 查 `/v1/video/generations/{task_id}` 只会拿到
///      `saas.endpoint_not_allowed`。提交能用、轮询不能用，异步契约断了一半。
///   2. 任务表原本没有任何「属于谁」的列，不做归属校验就等于任何 key 都能按
///      task_id 读到别人的出片地址（task_id 是 UUIDv4，猜不到，但地址本身
///      是可用的签名 CDN 链接，不该靠「猜不到」当访问控制）。
async fn execute_video_status(
    app_state: &AppState,
    pool: &SqlitePool,
    principal: billing::ApiPrincipal,
    path: &str,
    query: Option<&str>,
) -> Result<Response, AppError> {
    let task_id = crate::web::video_routes::video_task_id_from_path(path).ok_or_else(|| {
        repository::invalid("saas.validation", "A video task id is required")
    })?;
    let task =
        crate::videogen::repository::VideoGenerationRepository::get_task(pool, &task_id)
            .await
            .map_err(|_| {
                repository::invalid("videogen.task_not_found", "Video task was not found")
            })?;
    if task.owner_user_id.as_deref() != Some(principal.user_id.as_str()) {
        // 别人的任务回答「不存在」，而不是「无权访问」：后者会泄漏 task_id 是否存在。
        return Err(repository::invalid(
            "videogen.task_not_found",
            "Video task was not found",
        ));
    }
    let refresh = query.is_some_and(|query| {
        query
            .split('&')
            .any(|pair| pair == "refresh=1" || pair == "refresh=true")
    });
    let body = crate::videogen::VideoGenerationService::status(app_state, &task_id, refresh).await?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|error| repository::invalid("saas.response", &error.to_string()))?)
}

/// 视频渠道的 SaaS 执行（G-P4）。
///
/// 与 `execute_image_request` 的**根本差异**：视频是异步任务 API，一次
/// `POST /v1/video/generations` 只换来一个 task_id，真正出片在若干分钟之后。
/// 因此这里：
///   - 只做「预留 → 提交 → 结算（按已受理计费）→ 写日志 → 原样回 201」；
///   - 后续的轮询与回调**不在本请求的生命周期里**，由 `videogen` 的常驻
///     轮询器（`VideoGenerationService::run_loop`）推进。这是**有意为之**：
///     若把轮询挂在这个 HTTP 请求上，客户端一断开进程就被取消，任务永远
///     停在 processing。
///
/// 计费口径：上游 2xx 即视为「已受理、开始烧算」。这一单就按提交的视频条数
/// 收款；若任务最终失败，由轮询器把 message 标 failed，但**不自动退款**——
/// 上游确实消耗了算力，是否退款需要人工判（与「上游 4xx 直接退」的图像路径
/// 不同）。
async fn execute_video_request(
    state: &AppState,
    pool: &SqlitePool,
    runtime: &SaasRuntime,
    principal: billing::ApiPrincipal,
    payload: Value,
    path: &str,
) -> Result<Response, AppError> {
    let object = payload.as_object().ok_or_else(|| {
        repository::invalid("saas.validation", "Request must contain a JSON object")
    })?;
    let model = object
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.is_empty())
        .ok_or_else(|| repository::invalid("saas.model_not_allowed", "A model is required"))?
        .to_string();
    let count = object
        .get("n")
        .map(|value| {
            value.as_i64().ok_or_else(|| {
                repository::invalid("saas.request_limits", "Video count must be an integer")
            })
        })
        .transpose()?
        .unwrap_or(1);

    // 先解析契约体再预留，这样计价用的时长与真正发到上游的时长是**同一个来源**
    // （`request.duration`，缺省值与 `upstream_body` 共用常量），不会各算一套。
    // 顺带：解析失败时还没预留，也就不需要退款那一支了。
    let request = serde_json::from_value::<crate::videogen::protocol::VideoGenerationRequest>(
        payload.clone(),
    )
    .map_err(|error| {
        repository::invalid("saas.validation", &format!("Invalid video request: {error}"))
    })?;
    let duration_seconds = crate::videogen::protocol::effective_duration_seconds(&request);

    let reservation =
        billing::reserve_video(pool, &principal, &model, count, duration_seconds).await?;
    let request_id = reservation.request_id.clone();
    let started = Instant::now();
    let created_at = chrono::Utc::now();

    let outcome = crate::videogen::VideoGenerationService::submit(
        state,
        crate::videogen::SubmitVideoInput {
            platform: principal.platform.clone(),
            request,
            session_id: None,
            message_id: None,
            // 关键：把账号池收窄到 `reserve_video` 算出的白名单，否则 SaaS key
            // 会被路由到组外的账号。
            credential_ids: Some(reservation.credential_ids.clone()),
            // 组定价那一行的上游模型名：客户端看到的是 `model`，上游要的是这个。
            upstream_model: Some(reservation.upstream_model.clone()),
            // 任务归属：状态查询靠它做越权校验（`execute_video_status`）。
            owner_user_id: Some(principal.user_id.clone()),
        },
    )
    .await;

    let (status, body, success) = match outcome {
        Ok(body) => (StatusCode::CREATED, body, true),
        Err(error) => {
            let status = match error.code() {
                "validation.video_platform" | "validation.video_request" => {
                    StatusCode::BAD_REQUEST
                }
                _ => StatusCode::BAD_GATEWAY,
            };
            let body = json!({"error":{"code":error.code(),"message":error.to_string()}})
                .to_string()
                .into_bytes();
            (status, body, false)
        }
    };
    // 提交失败（上游拒了 / 建体失败）时条数为 0，`settle_video` 会走退款。
    let settled_count = if success { Some(count) } else { Some(0) };
    let settlement = billing::settle_video(pool, &request_id, settled_count, success).await?;

    let record = LogRecord {
        request_id: request_id.clone(),
        user_id: reservation.user_id,
        key_id: reservation.key_id,
        group_id: reservation.group_id,
        platform: reservation.platform,
        model,
        endpoint: path.to_string(),
        created_at,
        utc_offset_minutes: chrono::Local::now().offset().local_minus_utc() / 60,
        duration_ms: started.elapsed().as_millis().min(i64::MAX as u128) as i64,
        status: status.as_u16(),
        amount_usd_micros: settlement.price_usd_micros.unwrap_or(0),
        settlement_status: settlement.status,
        error_code: if success {
            None
        } else {
            Some("upstream_rejected".into())
        },
        ..Default::default()
    };
    if runtime.logs.enqueue(record).await.is_err() {
        eprintln!("SaaS request log queue rejected a completed video request");
    }

    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .map_err(|_| repository::invalid("saas.response", "Could not build video response"))?;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-store".parse().expect("static header"),
    );
    if let Ok(value) = request_id.parse() {
        response
            .headers_mut()
            .insert("x-saas-request-id", value);
    }
    Ok(response)
}

struct Completion {
    pool: SqlitePool,
    runtime: SaasRuntime,
    request_id: Option<String>,
    user_id: String,
    key_id: String,
    group_id: String,
    platform: String,
    model: String,
    path: String,
    started: Instant,
    created_at: chrono::DateTime<chrono::Utc>,
    status: u16,
    observer: UsageObserver,
}

impl Completion {
    async fn complete(&mut self, eof: bool) {
        let Some(request_id) = self.request_id.take() else {
            return;
        };
        let usage = self.observer.finish(eof);
        let definite_rejection = eof && (400..500).contains(&self.status) && usage.is_none();
        let result =
            billing::settle(&self.pool, &request_id, usage.clone(), !definite_rejection).await;
        let (amount, status) = match result {
            Ok(settlement) => (settlement.price_usd_micros.unwrap_or(0), settlement.status),
            Err(_) => {
                eprintln!("SaaS settlement requires reconciliation: {request_id}");
                (0, "pending_review".into())
            }
        };
        let usage = usage.unwrap_or_default();
        let record = LogRecord {
            request_id,
            user_id: self.user_id.clone(),
            key_id: self.key_id.clone(),
            group_id: self.group_id.clone(),
            platform: self.platform.clone(),
            model: self.model.clone(),
            endpoint: self.path.clone(),
            created_at: self.created_at,
            utc_offset_minutes: chrono::Local::now().offset().local_minus_utc() / 60,
            duration_ms: self.started.elapsed().as_millis().min(i64::MAX as u128) as i64,
            status: self.status,
            input_tokens: usage.input_tokens,
            cache_read_tokens: usage.cache_read_tokens,
            cache_write_tokens: usage.cache_write_tokens,
            output_tokens: usage.output_tokens,
            amount_usd_micros: amount,
            settlement_status: status,
            error_code: if !eof {
                Some("upstream_interrupted".into())
            } else if self.status >= 400 {
                Some("upstream_rejected".into())
            } else {
                None
            },
            ..Default::default()
        };
        if self.runtime.logs.enqueue(record).await.is_err() {
            eprintln!("SaaS request log queue rejected a completed request");
        }
    }
}

impl Drop for Completion {
    fn drop(&mut self) {
        if self.request_id.is_none() {
            return;
        }
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            self.request_id = None;
            return;
        };
        let pending = Self {
            pool: self.pool.clone(),
            runtime: self.runtime.clone(),
            request_id: self.request_id.take(),
            user_id: self.user_id.clone(),
            key_id: self.key_id.clone(),
            group_id: self.group_id.clone(),
            platform: self.platform.clone(),
            model: self.model.clone(),
            path: self.path.clone(),
            started: self.started,
            created_at: self.created_at,
            status: self.status,
            observer: std::mem::replace(&mut self.observer, UsageObserver::new(false, false)),
        };
        handle.spawn(async move {
            let mut pending = pending;
            pending.complete(false).await;
        });
    }
}

#[cfg(test)]
mod tests;
