//! 视频渠道的 HTTP 入口（G-P4）
//! =================================================================
//! 把 new-api 契约端点接到 `VideoGenerationService`：
//!
//! ```text
//! POST /v1/video/generations            提交 → 201 { id, object, model, created_at, task_id, status }
//! GET  /v1/video/generations/{task_id}  查询 → 200 { task_id, status, url, format, metadata, error }
//! ```
//!
//! **平台从哪来。** 与 `/v1/images/generations` 不同，视频的方言选择不可能从
//! 请求体推出来（同一个 `model` 名在各家都可能存在），所以必须由调用方指明渠道。
//! 取值优先级与 `route_proxy_service::resolve_platform` **保持一致**：
//!   1. 入站 API key（`Authorization: Bearer sk-ai-switch-…`）—— 外部 OpenAI 兼容
//!      客户端唯一会带的东西，也是设计前提「插件只认一个 baseUrl + 一个 token」；
//!   2. `x-ai-switch-platform` 请求头（特权本地覆盖，桌面端与 SaaS 代理内部用）；
//!   3. 请求体旁的 `platform` 字段（`/v1/video/generations` 的私有扩展，
//!      方便 curl 调试时不必设置请求头）。
//!
//! key 必须排在第一位：它同时是**鉴权凭据**与**渠道选择**，就像文本平台
//! （`sk-ai-switch-codex` 等）一样。把自定义头当主路径会让本端点对 OpenAI
//! 兼容客户端不可用。
//!
//! 平台必须形如 `video:kling`（`Provider.kind` 的「模态:协议」语义，G-P1）。
//!
//! **鉴权。** 本模块不自己鉴权：所有请求先经 `shared_fallback`（它已经完成了
//! API key / 本地 token 校验与 SaaS 分流），到这里时身份已经确定。

use axum::body::Body;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::app_state::AppState;
use crate::database::repositories::route_proxy_key_repository::RouteProxyKeyRepository;
use crate::videogen::protocol::VideoGenerationRequest;
use crate::videogen::service::{SubmitVideoInput, VideoGenerationService};

/// 平台可能放在请求体里的字段名（curl 友好；请求头与入站 key 都优先）。
const PLATFORM_BODY_FIELD: &str = "platform";
/// 平台特权覆盖头（与 `route_proxy_service::ROUTE_PROXY_PLATFORM_HEADER` 同值）。
const PLATFORM_HEADER: &str = "x-ai-switch-platform";
/// new-api 契约里 `metadata` 的字段名。
const METADATA_FIELD: &str = "metadata";

/// `/v1/video/generations` 是否为「提交」路径（与状态查询区分）。
pub(crate) fn is_video_submit_path(path: &str) -> bool {
    matches!(
        path.trim().trim_end_matches('/'),
        "/v1/video/generations" | "/video/generations"
    )
}

/// 从 `/v1/video/generations/{task_id}` 里取出 task_id。
pub(crate) fn video_task_id_from_path(path: &str) -> Option<String> {
    let normalized = path.trim().trim_end_matches('/');
    let rest = normalized
        .strip_prefix("/v1/video/generations/")
        .or_else(|| normalized.strip_prefix("/video/generations/"))?;
    let task_id = rest.trim();
    (!task_id.is_empty() && !task_id.contains('/')).then(|| task_id.to_string())
}

/// 提交：转成上游方言体 → 落任务 → 回 201 契约体。
pub(crate) async fn submit_video_generation(
    state: &AppState,
    headers: &HeaderMap,
    uri: &Uri,
    body: axum::body::Bytes,
) -> Response {
    let body = match normalize_request_body(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let platform = match resolve_video_platform(&state.pool, headers, uri.query(), &body).await {
        Ok(platform) => platform,
        Err(response) => return response,
    };
    let request = match VideoGenerationRequest::parse(&body) {
        Ok(request) => request,
        Err(error) => {
            return error_response(StatusCode::BAD_REQUEST, "invalid_request", &error);
        }
    };
    match VideoGenerationService::submit(
        state,
        SubmitVideoInput {
            platform,
            request,
            session_id: None,
            message_id: None,
            // 直连网关（本地 token / 非 SaaS key）不限制账号子集：整个池都可选。
            // SaaS 走的是 `saas::proxy::execute_video_request`，那条路径会带上
            // 计费时算出的账号白名单。
            credential_ids: None,
            // 直连时客户端给的就是上游认的名字（上游名靠账号的 model_mappings 对齐）。
            upstream_model: None,
        },
    )
    .await
    {
        Ok(body) => (
            StatusCode::CREATED,
            [("content-type", "application/json")],
            body,
        )
            .into_response(),
        Err(error) => app_error_response(error),
    }
}

/// 查询：`refresh=1` 时先向上游拉一次，否则读本地状态。
pub(crate) async fn video_generation_status(
    state: &AppState,
    uri: &Uri,
    task_id: &str,
) -> Response {
    let refresh = uri
        .query()
        .is_some_and(|query| query.split('&').any(|pair| pair == "refresh=1" || pair == "refresh=true"));
    match VideoGenerationService::status(state, task_id, refresh).await {
        Ok(body) => (StatusCode::OK, [("content-type", "application/json")], body).into_response(),
        Err(error) => app_error_response(error),
    }
}

/// 平台解析，优先级与 `route_proxy_service::resolve_platform` **一致**：
///   1. 入站 API key（`Authorization: Bearer sk-ai-switch-…` / `x-api-key`）；
///   2. `x-ai-switch-platform` 请求头（特权本地覆盖）；
///   3. 请求体 `platform` 字段（curl 便利）。
///
/// **key 必须排第一。** 外部 OpenAI 兼容客户端只会带 `Authorization: Bearer`，
/// 不会带自定义头。早先只认头/体字段时，一个用合法 route proxy key 通过鉴权的
/// 请求会在这里被 400 挡回——本端点于是对 OpenAI 兼容客户端完全不可用，
/// 也违背了「插件只认一个 baseUrl + 一个 token」的设计前提。
async fn resolve_video_platform(
    pool: &SqlitePool,
    headers: &HeaderMap,
    query: Option<&str>,
    body: &[u8],
) -> Result<String, Response> {
    let from_key = match crate::services::route_proxy_service::extract_inbound_api_key(headers, query)
    {
        Some(key) => RouteProxyKeyRepository::get_platform_by_key(pool, &key)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    // key 命中就以它为准；没命中（本地 token、SaaS key、或压根没带）再退回头/体字段。
    let platform = match from_key.or_else(|| platform_from_request_fields(headers, body)) {
        Some(platform) => platform,
        None => {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "A video channel platform is required: authenticate with a video channel key \
                 (Authorization: Bearer sk-ai-switch-…), or send x-ai-switch-platform: video:kling",
            ))
        }
    };
    if crate::videogen::protocol::dialect_from_provider_kind(&platform).is_none() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            &format!(
                "Video channel platform '{platform}' is not supported; expected a form like video:kling"
            ),
        ));
    }
    Ok(platform)
}

/// 请求头优先、其次请求体 `platform` 字段。纯函数，便于单测。
fn platform_from_request_fields(headers: &HeaderMap, body: &[u8]) -> Option<String> {
    if let Some(platform) = headers
        .get(PLATFORM_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(platform.to_string());
    }
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get(PLATFORM_BODY_FIELD)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

/// 把 `platform` 字段从请求体里摘掉再交给契约解析。
///
/// `VideoGenerationRequest` 是 `#[derive(Deserialize)]` 且没有
/// `deny_unknown_fields`，多一个字段本不会报错；这里仍然显式移除，是为了让
/// 契约体保持「只有 new-api 字段」，不再往下游传递本地扩展。
fn normalize_request_body(body: &[u8]) -> Result<axum::body::Bytes, Response> {
    let Ok(mut value) = serde_json::from_slice::<Value>(body) else {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Request body must be a JSON object",
        ));
    };
    let Some(object) = value.as_object_mut() else {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Request body must be a JSON object",
        ));
    };
    object.remove(PLATFORM_BODY_FIELD);
    // `metadata` 已存在但不是对象时（例如被写成字符串）直接拒绝：
    // 各家私有参数都从它取，一个非对象值会让方言转换静默丢参数。
    if object
        .get(METADATA_FIELD)
        .is_some_and(|metadata| !metadata.is_object() && !metadata.is_null())
    {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "metadata must be a JSON object",
        ));
    }
    serde_json::to_vec(&value)
        .map(axum::body::Bytes::from)
        .map_err(|_| {
            error_response(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Request body could not be normalized",
            )
        })
}

fn app_error_response(error: crate::error::AppError) -> Response {
    use crate::error::AppError;
    let status = match &error {
        AppError::Validation { code, .. } => match *code {
            "validation.video_platform" | "validation.video_request" => StatusCode::BAD_REQUEST,
            "videogen.task_not_found"
            | "videogen.session_not_found"
            | "videogen.message_not_found"
            | "videogen.asset_not_found" => StatusCode::NOT_FOUND,
            "videogen.submit_failed" | "videogen.poll_failed" => StatusCode::BAD_GATEWAY,
            _ => StatusCode::BAD_REQUEST,
        },
        AppError::Database { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    };
    let body = json!({
        "error": {
            "code": error.code(),
            "message": error.to_string(),
            "type": "video_error",
        }
    });
    (status, axum::Json(body)).into_response()
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        axum::Json(json!({
            "error": {
                "code": code,
                "message": message,
                "type": "video_error",
            }
        })),
    )
        .into_response()
}

/// 供 `shared_fallback` 调用：按路径把视频请求分派到提交或查询。
pub(crate) async fn handle_video_request(
    state: &AppState,
    method: axum::http::Method,
    headers: &HeaderMap,
    uri: &Uri,
    body: Body,
) -> Response {
    let path = uri.path();
    if is_video_submit_path(path) {
        if method != axum::http::Method::POST {
            return error_response(
                StatusCode::METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Use POST to submit a video generation",
            );
        }
        let body = match axum::body::to_bytes(body, 4 * 1024 * 1024).await {
            Ok(body) => body,
            Err(_) => {
                return error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "request_limits",
                    "Video request body exceeds the limit",
                )
            }
        };
        return submit_video_generation(state, headers, uri, body).await;
    }
    if let Some(task_id) = video_task_id_from_path(path) {
        if method != axum::http::Method::GET {
            return error_response(
                StatusCode::METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "Use GET to query a video generation task",
            );
        }
        return video_generation_status(state, uri, &task_id).await;
    }
    error_response(
        StatusCode::NOT_FOUND,
        "not_found",
        "Unknown video generation endpoint",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_submit_and_status_paths() {
        assert!(is_video_submit_path("/v1/video/generations"));
        assert!(is_video_submit_path("/video/generations/"));
        assert!(!is_video_submit_path("/v1/video/generations/t-1"));

        assert_eq!(
            video_task_id_from_path("/v1/video/generations/t-1").as_deref(),
            Some("t-1")
        );
        assert_eq!(video_task_id_from_path("/v1/video/generations").as_deref(), None);
        // 多余的分段不是合法的 task id
        assert_eq!(
            video_task_id_from_path("/v1/video/generations/t-1/extra").as_deref(),
            None
        );
    }

    #[test]
    fn resolves_platform_from_header_then_body() {
        let mut headers = HeaderMap::new();
        headers.insert(PLATFORM_HEADER, "video:kling".parse().unwrap());
        assert_eq!(
            platform_from_request_fields(&headers, b"{}").as_deref(),
            Some("video:kling")
        );

        let empty = HeaderMap::new();
        assert_eq!(
            platform_from_request_fields(&empty, br#"{"platform":"video:seedance"}"#).as_deref(),
            Some("video:seedance")
        );
        // 请求头优先于请求体字段
        assert_eq!(
            platform_from_request_fields(&headers, br#"{"platform":"video:seedance"}"#).as_deref(),
            Some("video:kling")
        );
        // 两者都没有 → 没有可用的平台
        assert_eq!(platform_from_request_fields(&empty, b"{}"), None);
    }

    /// 入站 API key 是外部 OpenAI 兼容客户端唯一会带的东西，必须能定出渠道。
    ///
    /// 这条曾经是坏的：key 通过了 `shared_fallback` 的鉴权，但平台解析只认
    /// 请求头/请求体字段，于是合法 key 换回一个 400 —— 端点对 OpenAI 兼容客户端
    /// 完全不可用。
    #[tokio::test]
    async fn resolves_the_platform_from_a_route_proxy_key() {
        use crate::database::repositories::route_proxy_key_repository::RouteProxyKeyRepository;
        use crate::database::{create_memory_pool, run_migrations};
        use axum::http::header::AUTHORIZATION;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let key = RouteProxyKeyRepository::ensure_platform_key(
            &pool,
            "video:kling",
            "sk-ai-switch-video-kling",
        )
        .await
        .expect("mint key");

        // 只带 Authorization，不带任何自定义头 —— 这就是 OpenAI 客户端的样子
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            format!("Bearer {key}").parse().unwrap(),
        );
        assert_eq!(
            resolve_video_platform(&pool, &headers, None, br#"{"model":"kling-v1"}"#)
                .await
                .ok()
                .as_deref(),
            Some("video:kling")
        );

        // 文本平台的 key 不该能用来调视频端点
        RouteProxyKeyRepository::ensure_platform_key(&pool, "codex", "sk-ai-switch-codex")
            .await
            .expect("mint codex key");
        let mut text_headers = HeaderMap::new();
        text_headers.insert(
            AUTHORIZATION,
            "Bearer sk-ai-switch-codex".parse().unwrap(),
        );
        assert!(
            resolve_video_platform(&pool, &text_headers, None, b"{}")
                .await
                .is_err()
        );

        // 无效 key 且没有头/体字段 → 拒绝
        let mut bogus = HeaderMap::new();
        bogus.insert(AUTHORIZATION, "Bearer sk-nope".parse().unwrap());
        assert!(resolve_video_platform(&pool, &bogus, None, b"{}").await.is_err());
    }

    #[test]
    fn strips_platform_field_and_rejects_bad_metadata() {
        let normalized = normalize_request_body(
            br#"{"platform":"video:kling","model":"kling-v2-6","prompt":"fox"}"#,
        )
        .expect("normalized");
        let value: Value = serde_json::from_slice(&normalized).expect("json");
        assert!(value.get("platform").is_none());
        assert_eq!(value["model"], "kling-v2-6");

        assert!(normalize_request_body(br#"{"metadata":"nope"}"#).is_err());
        assert!(normalize_request_body(br#"{"metadata":{"aspect_ratio":"9:16"}}"#).is_ok());
        assert!(normalize_request_body(b"[]").is_err());
    }

    /// HTTP 入口的分派与状态码映射。
    ///
    /// 这些分支都在碰到账号池之前就返回了（平台解析失败 / 方法不对 / 路径不匹配），
    /// 所以不需要迁移，也不需要 mock 上游。
    #[tokio::test]
    async fn dispatches_methods_and_maps_errors_to_status_codes() {
        use axum::body::Body;
        use axum::http::Method;

        let state = AppState {
            paths: crate::paths::AppPaths::from_data_dir(
                std::env::temp_dir().join("ai-switch-video-routes-test"),
            ),
            pool: crate::database::create_memory_pool().await.unwrap(),
            saas: Default::default(),
            config_writes: Default::default(),
            deeplink_protocols: Default::default(),
            close_to_tray: Default::default(),
            route_proxy: Default::default(),
            web_service: Default::default(),
            tailscale: Default::default(),
            terminals: Default::default(),
            terminal_hub: Default::default(),
            event_broadcaster: Default::default(),
        };

        let call = |method: Method, path: &str, body: &str| {
            let state = state.clone();
            let uri: Uri = path.parse().unwrap();
            let body = Body::from(body.to_string());
            async move {
                handle_video_request(&state, method, &HeaderMap::new(), &uri, body)
                    .await
                    .status()
            }
        };

        // 提交路径只接受 POST
        assert_eq!(
            call(Method::GET, "/v1/video/generations", "").await,
            StatusCode::METHOD_NOT_ALLOWED
        );
        // 状态路径只接受 GET
        assert_eq!(
            call(Method::POST, "/v1/video/generations/t-1", "{}").await,
            StatusCode::METHOD_NOT_ALLOWED
        );
        // 两条路径都不匹配
        assert_eq!(
            call(Method::POST, "/v1/video/generations/t-1/extra", "{}").await,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(Method::GET, "/v1/videos/text2video", "").await,
            StatusCode::NOT_FOUND
        );
        // 非 JSON 体
        assert_eq!(
            call(Method::POST, "/v1/video/generations", "not-json").await,
            StatusCode::BAD_REQUEST
        );
        // 缺平台（请求头与请求体都没有）
        assert_eq!(
            call(
                Method::POST,
                "/v1/video/generations",
                r#"{"model":"kling-v1","prompt":"fox"}"#
            )
            .await,
            StatusCode::BAD_REQUEST
        );
        // 平台不是视频渠道
        assert_eq!(
            call(
                Method::POST,
                "/v1/video/generations",
                r#"{"platform":"codex","model":"kling-v1","prompt":"fox"}"#
            )
            .await,
            StatusCode::BAD_REQUEST
        );
    }
}
