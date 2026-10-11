//! 视频生成服务层（G-P3）
//! =================================================================
//! 一次视频生成 = 三个动作：
//!   1. **提交**：把 new-api 契约请求转成上游方言体 → 经 `forward_request` 打到上游
//!      → 取回上游 task_id → 以本网关 `task_id` 落库（`videogen_tasks`）。
//!   2. **推进**：轮询上游状态（`poll_once` / `advance_all`），把 status/url/error
//!      写回任务表；终态同步落 message。
//!   3. **回调**：终态且带 `callback_url` 时投递一次，成功后 `mark_callback_delivered`。
//!
//! 与 `imagegen::ImageGenerationService` 的关键差异：图像是一次性同步结果，
//! 视频是异步任务，所以本模块**必须**有任务表和轮询循环。
//!
//! 上游调用统一走 `forward_request`（而不是自己建 reqwest client），这样
//! 账号池选择、冷却、并发闸门、失败记分、请求日志、SaaS 访问域全部复用，
//! 与图像链路完全一致。方言转换（`protocol.rs`）在进 `forward_request` 之前完成。

use super::models::*;
use super::protocol::{
    dialect_from_interface_format, effective_duration_seconds, effective_size,
    parse_upstream_status, parse_upstream_submit, status_response, submit_response, upstream_body,
    upstream_status_path, upstream_submit_path, validate_callback_url, CallbackTargetPolicy,
    UpstreamStatus, VideoDialect, VideoGenerationRequest, VideoTaskStatus,
};
use super::repository::VideoGenerationRepository;
use crate::app_state::AppState;
use crate::database::repositories::route_pool_repository::RoutePoolRepository;
use crate::error::AppError;
use crate::models::platform::{PlatformId, VIDEO_PLATFORM};
use crate::services::route_proxy_service::{
    build_proxy_state, classify_proxy_failure, forward_request, video_route_plan, ProxyAppState,
    ProxyFailureKind,
};
use axum::body::{to_bytes, Body};
use axum::http::{HeaderMap, HeaderValue, Method, Uri};
use serde::Deserialize;
use std::time::Duration;
use uuid::Uuid;

/// 一次提交可接受的 `n`（一个请求生成几段视频）。
///
/// **固定为 1。** new-api 的视频契约里 `url` 是单值，网关也只能回一个地址；
/// 而 `upstream_body` 压根不把 `n` 发给上游（复审抓到的真 bug：允许 `n>1`
/// 就是「按 4 条收钱、只发 1 条」）。要支持多条得先让 `status_response`
/// 能表达多个地址（`urls`），那是契约层的事，不在网关里糊。
const MAX_VIDEO_COUNT: u32 = 1;
/// 回调投递的尝试预算。超了就不再重试，免得一个死地址变成常驻噪声。
const MAX_CALLBACK_ATTEMPTS: i64 = 8;
/// 上游响应体上限（视频接口的响应只有 task_id / 状态和 url，不需要很大）
const UPSTREAM_RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
/// 单轮轮询最多处理多少个任务，避免一次 tick 打爆上游
pub const POLL_BATCH_LIMIT: i64 = 32;
/// 轮询间隔（秒）。视频任务以分钟计，轮询过密只是白花上游配额。
const POLL_INTERVAL_SECONDS: u64 = 10;
/// 超过这个次数仍未终态的任务放弃轮询，标记为失败（超时兜底）
const MAX_POLL_ATTEMPTS: i64 = 240;

/// 入站提交输入（HTTP 层的 `POST /v1/video/generations` 直传）
#[derive(Debug, Clone, Deserialize)]
pub struct SubmitVideoInput {
    /// 渠道平台 id。**只有 `video` 一个值**；供应商由请求里的 `model` 名决定。
    pub platform: String,
    pub request: VideoGenerationRequest,
    /// 可选：挂在某个会话/消息下（工作台调用）；网关直连时为空
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    /// 可选：把账号池收窄到给定账号集合。
    ///
    /// SaaS 计费必须用这个：`reserve_video` 已经按「组 → 支持 `video.generate`
    /// 的账号」算出了本次请求**只能用**的账号，若不收窄，一个 `sk-saas-` key
    /// 就能被路由到池里任意账号，计费与权限同时失效。
    #[serde(default, skip)]
    pub credential_ids: Option<Vec<String>>,
    /// 可选：上游真正的模型名。
    ///
    /// 直连网关时不设——上游名靠账号的 `model_mappings` 或客户端直接给对。
    /// SaaS 必须设：组定价那一行的 `upstream_model` 才是上游认的名字，而
    /// **不能**靠 `forward_request` 的 model_mappings 兜：那套改写只认
    /// OpenAI 风格的 `model` 字段，可灵的上游体用的是 `model_name`，
    /// 根本改写不到。所以这里显式区分「客户端看到的名字」与「上游的名字」。
    #[serde(default, skip)]
    pub upstream_model: Option<String>,
    /// 可选：任务归属的 SaaS 用户。直连网关不设。
    ///
    /// 存下来只为一件事：`GET /v1/video/generations/{task_id}` 得能回答
    /// 「这个 task_id 是不是你的」。没有它，SaaS 侧只能不做校验（越权读
    /// 别人的任务和出片地址）或干脆不支持查询（异步契约断一半）。
    #[serde(default, skip)]
    pub owner_user_id: Option<String>,
}

/// 这次请求的路由目标：**方言 + 可尝试的账号**（已按优先级/游标排好序）。
///
/// 视频只有一个平台 `video`，供应商住在账号的 `interface_format` 里，而上游请求体
/// 的形状取决于方言 —— 所以「选账号」必须发生在「建体」之前。这个结构就是那个中间产物。
struct SelectedRouteGroup {
    dialect: VideoDialect,
    credential_ids: Vec<String>,
    /// 候选总数与本次游标，成功后用来推进轮转
    ready_len: usize,
    cursor: i64,
}

/// 提交结果：对外 201 体 + 本网关的 `task_id`。
///
/// `task_id` 单独给出来，是因为**两条对外契约的 201 体形状不同**：
/// new-api 契约里 `id` 是 `video-{task_id}`、另有 `task_id` 字段；OpenAI 原生
/// 契约（`/v1/videos`）里 `id` 就是裸 task_id、根本没有 `task_id` 字段。
/// 让调用方去解析 `body` 里的 JSON 取 id 太脆，所以由服务层直接给。
pub struct SubmitVideoOutcome {
    pub task_id: String,
    pub body: Vec<u8>,
}

pub struct VideoGenerationService;

impl VideoGenerationService {
    /// 提交一次视频生成，返回本网关的 `task_id` 与 new-api 契约的 201 响应体。
    ///
    /// **平台只有一个 `video`；供应商由请求里的 `model` 名决定。** 可灵 / 方舟 /
    /// MiniMax / 智谱 / Sora 的差别是线协议，住在账号的 `config_json.interface_format`
    /// 里，所以流程是：按 model 选账号 → 从选中账号读出方言 → 用那个方言建体 →
    /// 把请求钉到那个账号。这就是「跨供应商路由」，不需要额外的模式开关。
    ///
    /// **两个模型名要分清**：
    ///   - `request.model` 是客户端看到的名字，进 201 响应体与任务表的 `model` 列；
    ///   - `input.upstream_model`（SaaS 才给）是上游认的名字，进上游请求体与
    ///     任务表的 `upstream_model` 列。
    ///
    /// 不设 `upstream_model` 时两者相同，行为与直连网关一致。**不能**只靠
    /// `forward_request` 的 model_mappings 去改写：那套改写只认 OpenAI 风格的
    /// `model` 字段，可灵的上游体用的是 `model_name`，改写不到。
    ///
    /// 任务的生命周期由轮询循环接管，调用方拿着任务行也没有可做的事——
    /// 但 `task_id` 要给出去，见 [`SubmitVideoOutcome`]。
    pub async fn submit(
        state: &AppState,
        input: SubmitVideoInput,
    ) -> Result<SubmitVideoOutcome, AppError> {
        let platform = input.platform.trim();
        if PlatformId::parse(platform).ok() != Some(PlatformId::Video) {
            return Err(validation(
                "validation.video_platform",
                &format!(
                    "Video generation requires the '{VIDEO_PLATFORM}' platform; the vendor is the account's interface_format"
                ),
            ));
        }
        let request = input.request;
        let model = request.model.trim().to_string();
        if model.is_empty() {
            return Err(validation(
                "validation.video_request",
                "A model is required",
            ));
        }
        let upstream_model = input
            .upstream_model
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(&model)
            .to_string();
        if request.prompt.trim().is_empty() && request.image.is_none() {
            return Err(validation(
                "validation.video_request",
                "A prompt or a first-frame image is required",
            ));
        }
        // 契约里的 `url` 是单值，所以一次提交只能生成一条。`n>1` 必须显式报错：
        // 静默按 n 条计费而只发 1 条，比拒绝更糟。
        if request.n.unwrap_or(1) > MAX_VIDEO_COUNT {
            return Err(validation(
                "validation.video_request",
                "A video request generates exactly one clip; the contract cannot return more than one URL",
            ));
        }
        if let Some(callback) = request.callback_url() {
            validate_callback_url(callback, CallbackTargetPolicy::current())
                .map_err(|error| validation("validation.video_callback", &error))?;
        }

        // 选号（含方言）：必须早于建体，因为上游请求体的形状由方言决定。
        let group =
            Self::select_route_group(state, &model, input.credential_ids.as_deref()).await?;

        let has_image = request.image.is_some();
        let body = upstream_body(group.dialect, &upstream_model, &request)
            .map_err(|error| validation("videogen.upstream_body", &error))?;
        let path = upstream_submit_path(group.dialect, has_image);
        let (upstream_task_id, credential_id) =
            Self::forward_submit(state, platform, group.dialect, &path, body, &group.credential_ids)
                .await?;

        // 轮转：`forward_request` 只看到一个账号，它的推进是 `(0+1)%1=0`，
        // 会把游标按回 0，所以这里按整个候选列表推进一格。
        Self::advance_route_cursor(state, group.cursor, group.ready_len).await;

        let task_id = Uuid::new_v4().to_string();
        VideoGenerationRepository::create_task(
            &state.pool,
            NewVideoTask {
                task_id: task_id.clone(),
                session_id: input.session_id,
                message_id: input.message_id,
                model: model.clone(),
                upstream_model: Some(upstream_model),
                dialect: group.dialect.as_str().to_string(),
                // **必须记住提交者**：上游的任务按账号隔离，轮询用别的账号查会 404。
                credential_id: Some(credential_id),
                upstream_task_id: Some(upstream_task_id),
                // 输出形状落库：OpenAI 原生契约（`/v1/videos`）的响应要回显
                // `seconds` 与 `size`，而提交之后再无从推导（上游响应里没有）。
                duration_seconds: Some(effective_duration_seconds(&request)),
                size: effective_size(&request),
                callback_url: request.callback_url().map(str::to_string),
                owner_user_id: input.owner_user_id,
            },
        )
        .await?;

        Ok(SubmitVideoOutcome {
            body: submit_response(&model, &task_id),
            task_id,
        })
    }

    /// 选出这次请求要用的方言与账号集合。
    ///
    /// 落到哪家完全由 `model` 名决定：谁映射了这个 model（且该映射声明
    /// `video.generate`）就是谁。同名模型映射在多家时，按账号的
    /// `route_priority` + 游标顺序取第一组——也就是跨供应商的轮转。
    async fn select_route_group(
        state: &AppState,
        model: &str,
        credential_ids: Option<&[String]>,
    ) -> Result<SelectedRouteGroup, AppError> {
        // SaaS 的组白名单：`Some(空集)` 的语义是「一个都不允许」（fail closed），
        // 所以这里不能把空集归一成 `None`。
        let scope = credential_ids.map(|ids| ids.iter().cloned().collect::<std::collections::HashSet<_>>());
        let plan = video_route_plan(&state.pool, model, scope.as_ref()).await?;
        let Some(group) = plan.groups.into_iter().next() else {
            return Err(validation(
                "route_pool.model_unmatched",
                &format!("No enabled video channel supports model '{model}'"),
            ));
        };
        let dialect = dialect_from_interface_format(&group.interface_format).ok_or_else(|| {
            validation(
                "validation.video_interface_format",
                &format!(
                    "Video channel has an unsupported interface_format '{}'; expected kling / ark / minimax / zhipu / sora",
                    group.interface_format
                ),
            )
        })?;
        Ok(SelectedRouteGroup {
            dialect,
            credential_ids: group.credential_ids,
            ready_len: plan.ready_len,
            cursor: plan.cursor,
        })
    }

    /// 成功后把跨供应商游标推进一格（见 `VideoRoutePlan` 的说明）。
    async fn advance_route_cursor(state: &AppState, cursor: i64, ready_len: usize) {
        if ready_len == 0 {
            return;
        }
        let next = (cursor + 1) % ready_len as i64;
        let _ = RoutePoolRepository::save_cursor_index(&state.pool, VIDEO_PLATFORM, next).await;
    }

    /// 查询任务状态（new-api 契约响应体）。
    ///
    /// 默认只读本地状态；`refresh=true` 时先向上游拉一次再返回，让客户端不必
    /// 等轮询 tick。
    pub async fn status(
        state: &AppState,
        task_id: &str,
        refresh: bool,
    ) -> Result<Vec<u8>, AppError> {
        let task = if refresh {
            Self::poll_once(state, task_id).await?
        } else {
            VideoGenerationRepository::get_task(&state.pool, task_id).await?
        };
        let status = VideoTaskStatus::parse(&task.status).unwrap_or(VideoTaskStatus::Processing);
        Ok(status_response(
            &task.task_id,
            status,
            task.url.as_deref(),
            task.error_message.as_deref(),
        ))
    }

    /// 向 `forward_request` 打一次上游提交，返回 `(上游 task_id, 实际用的账号 id)`。
    ///
    /// **每次只钉一个账号。** 轮询必须回到提交它的那一个（上游的任务按账号隔离，
    /// 换个账号查会 404/403），所以「用了谁」必须是确定的、能记下来的。代价是
    /// `forward_request` 内部的多账号 failover 用不上，改由这里自己轮：一个账号
    /// 失败时按 `classify_proxy_failure` 判断值不值得换下一个——方言不变（同一组），
    /// 所以请求体可以直接复用。
    async fn forward_submit(
        state: &AppState,
        platform: &str,
        dialect: VideoDialect,
        path: &str,
        body: Vec<u8>,
        account_ids: &[String],
    ) -> Result<(String, String), AppError> {
        let mut last_error: Option<AppError> = None;
        for account_id in account_ids {
            let single = [account_id.clone()];
            let proxy = Self::proxy_state(state, platform, Some(&single))?;
            let mut headers = HeaderMap::new();
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            let uri = Uri::from_str_checked(path)?;
            let response =
                match forward_request(&proxy, Method::POST, headers, uri, Body::from(body.clone()))
                    .await
                {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = Some(validation("videogen.submit_failed", &error));
                        continue;
                    }
                };
            let status = response.status();
            let bytes = to_bytes(response.into_body(), UPSTREAM_RESPONSE_LIMIT)
                .await
                .map_err(|error| validation("videogen.upstream_body", &error.to_string()))?;
            if status.is_success() {
                let upstream_task_id = parse_upstream_submit(dialect, &bytes)
                    .map_err(|error| validation("videogen.upstream_response", &error))?;
                return Ok((upstream_task_id, account_id.clone()));
            }
            let kind = classify_proxy_failure(Some(status), None);
            last_error = Some(validation(
                "videogen.submit_failed",
                &format!(
                    "Video upstream returned {}: {}",
                    status.as_u16(),
                    preview(&bytes)
                ),
            ));
            // 只有瞬时失败才值得换账号：4xx 换谁都一样，白烧配额。
            if kind != ProxyFailureKind::Transient {
                break;
            }
        }
        Err(last_error.unwrap_or_else(|| {
            validation(
                "videogen.submit_failed",
                "No video channel account was available for this request",
            )
        }))
    }

    /// 构造一个把请求钉死在视频平台（可再钉到具体账号）的代理状态。
    ///
    /// **必须固定平台。** `forward_request` 里 `resolve_platform` 的取值顺序是
    /// 「入站 key → `x-ai-switch-platform` 请求头」；不设 `access_scope` 时，一个
    /// 恰好带了别的平台的请求头（或什么都不带）就会把视频请求路由到文本池。
    /// 用 `with_access_scope` 同时钉死平台与（可选的）账号子集，是这里唯一
    /// 不依赖调用方自觉的做法。
    fn proxy_state(
        state: &AppState,
        platform: &str,
        credential_ids: Option<&[String]>,
    ) -> Result<ProxyAppState, AppError> {
        let platform_id = PlatformId::parse(platform).map_err(|error| {
            validation("validation.video_platform", &error.to_string())
        })?;
        let proxy = build_proxy_state(state.pool.clone(), &state.route_proxy);
        // 两种收窄方式不能混：直连网关是「钉平台、不限制账号」，SaaS 是
        // 「钉平台 + 只允许预留算出的账号」。把前者写成空集合会让候选被全部过滤掉。
        let proxy = match credential_ids {
            Some(ids) => proxy.with_access_scope(
                platform_id,
                ids.iter().cloned().collect::<std::collections::HashSet<_>>(),
            ),
            None => proxy.with_platform_scope(platform_id),
        };
        Ok(proxy)
    }

    /// 向 `forward_request` 打一次上游状态查询，返回统一化的状态。
    async fn forward_poll(
        state: &AppState,
        task: &VideoTask,
    ) -> Result<UpstreamStatus, AppError> {
        let dialect = VideoDialect::parse(&task.dialect).ok_or_else(|| {
            validation(
                "videogen.dialect",
                &format!("Unknown stored video dialect: {}", task.dialect),
            )
        })?;
        let upstream_task_id = task.upstream_task_id.as_deref().ok_or_else(|| {
            validation(
                "videogen.upstream_task",
                "Task has no upstream task id and cannot be polled",
            )
        })?;
        let path = upstream_status_path(dialect, upstream_task_id);
        // **必须回到提交时那个账号**：上游的任务是按账号隔离的，用别的账号的 key
        // 查会拿到 404/403。平台统一成 `video` 之后账号变多，靠「按平台重选一个」
        // 几乎必然选错，所以提交时就把 `credential_id` 记在了任务行上。
        // 老行（迁移前）没有这个值，退回「只钉平台」。
        let pinned = task.credential_id.as_deref().map(|id| vec![id.to_string()]);
        let proxy = Self::proxy_state(state, VIDEO_PLATFORM, pinned.as_deref())?;
        let headers = HeaderMap::new();
        let uri = Uri::from_str_checked(&query_path(dialect, &path, upstream_task_id))?;
        let response = forward_request(&proxy, Method::GET, headers, uri, Body::empty())
            .await
            .map_err(|error| validation("videogen.poll_failed", &error))?;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), UPSTREAM_RESPONSE_LIMIT)
            .await
            .map_err(|error| validation("videogen.upstream_body", &error.to_string()))?;
        if !status.is_success() {
            return Err(validation(
                "videogen.poll_failed",
                &format!(
                    "Video upstream returned {} while polling: {}",
                    status.as_u16(),
                    preview(&bytes)
                ),
            ));
        }
        parse_upstream_status(dialect, &bytes)
            .map_err(|error| validation("videogen.upstream_response", &error))
    }

    /// 轮询单个任务并推进落库。返回推进后的任务。
    pub async fn poll_once(state: &AppState, task_id: &str) -> Result<VideoTask, AppError> {
        let task = VideoGenerationRepository::get_task(&state.pool, task_id).await?;
        if VideoTaskStatus::parse(&task.status).is_some_and(|status| status.is_terminal()) {
            return Ok(task);
        }
        let upstream = match Self::forward_poll(state, &task).await {
            Ok(upstream) => upstream,
            Err(error) => {
                // 上游一次查询失败不代表任务失败：记一次尝试，留在 processing
                // 让下一轮重试。超出预算才算超时失败。
                let attempts = task.attempt_count + 1;
                if attempts >= MAX_POLL_ATTEMPTS {
                    let message = format!("Gave up polling after {attempts} attempts: {error}");
                    return Self::settle(
                        state,
                        &task,
                        VideoTaskStatus::Failed,
                        None,
                        Some(&message),
                    )
                    .await;
                }
                return VideoGenerationRepository::progress_task(
                    &state.pool,
                    &task.task_id,
                    VideoTaskProgress {
                        status: VideoTaskStatus::Processing.as_str().to_string(),
                        url: None,
                        error_message: None,
                    },
                )
                .await;
            }
        };

        let error = match upstream.status {
            VideoTaskStatus::Succeeded => {
                // 上游说成功却没有 url：当作失败，否则客户端拿到一个空结果。
                if upstream.url.is_none() {
                    Some("Upstream reported success without a video URL".to_string())
                } else {
                    None
                }
            }
            VideoTaskStatus::Failed => Some(
                upstream
                    .error
                    .clone()
                    .unwrap_or_else(|| "Upstream reported the task as failed".to_string()),
            ),
            VideoTaskStatus::Processing => None,
        };
        let status = if error.is_some() {
            VideoTaskStatus::Failed
        } else {
            upstream.status
        };
        Self::settle(
            state,
            &task,
            status,
            upstream.url.as_deref(),
            error.as_deref(),
        )
        .await
    }

    /// 推进一个任务到给定状态，并把终态同步到 message、投递回调。
    async fn settle(
        state: &AppState,
        task: &VideoTask,
        status: VideoTaskStatus,
        url: Option<&str>,
        error: Option<&str>,
    ) -> Result<VideoTask, AppError> {
        let task = VideoGenerationRepository::progress_task(
            &state.pool,
            &task.task_id,
            VideoTaskProgress {
                status: status.as_str().to_string(),
                url: url.map(str::to_string),
                error_message: error.map(str::to_string),
            },
        )
        .await?;
        if !status.is_terminal() {
            return Ok(task);
        }
        if let Some(message_id) = task.message_id.as_deref() {
            let video_count = if status == VideoTaskStatus::Succeeded {
                1
            } else {
                0
            };
            let _ = VideoGenerationRepository::finish_message(
                &state.pool,
                message_id,
                status.as_str(),
                Some(&task.task_id),
                task.upstream_model.as_deref(),
                error,
                video_count,
            )
            .await;
        }
        if task.callback_url.is_some() && !task.callback_delivered {
            if Self::deliver_callback(&task).await.is_ok() {
                return VideoGenerationRepository::mark_callback_delivered(
                    &state.pool,
                    &task.task_id,
                )
                .await;
            }
            // 投失败要记一次尝试：重投由 `retry_pending_callbacks` 负责，
            // 没有计数的话一个死地址会被无限重投。
            let _ = VideoGenerationRepository::bump_callback_attempt(&state.pool, &task.task_id)
                .await;
        }
        Ok(task)
    }

    /// 把终态结果 POST 到任务登记的 `callback_url`。
    ///
    /// 投递失败**不会**丢：`retry_pending_callbacks` 在后续 tick 重投，
    /// 直到成功或用完 `MAX_CALLBACK_ATTEMPTS` 的预算。
    ///
    /// 这里不经过路由池：回调是网关自己发出的出站请求，与上游渠道的选账号、
    /// 计费、日志都无关（计费在提交那一刀已经切完了）。
    async fn deliver_callback(task: &VideoTask) -> Result<(), AppError> {
        let url = task.callback_url.as_deref().ok_or_else(|| {
            validation("videogen.callback", "Task has no callback URL registered")
        })?;
        // 提交时已经校验过；这里再校验一次，兜住「校验上线之前落库的行」
        // 和直接改库的情况。SSRF 的代价不对称，重复校验很便宜。
        validate_callback_url(url, CallbackTargetPolicy::current())
            .map_err(|error| validation("videogen.callback", &error))?;
        let status = VideoTaskStatus::parse(&task.status).unwrap_or(VideoTaskStatus::Processing);
        let payload = String::from_utf8_lossy(&status_response(
            &task.task_id,
            status,
            task.url.as_deref(),
            task.error_message.as_deref(),
        ))
        .into_owned();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| validation("videogen.callback", &error.to_string()))?;
        let response = client
            .post(url)
            .header("content-type", "application/json")
            .body(payload)
            .send()
            .await
            .map_err(|error| validation("videogen.callback", &error.to_string()))?;
        if !response.status().is_success() {
            return Err(validation(
                "videogen.callback",
                &format!("Callback endpoint returned {}", response.status().as_u16()),
            ));
        }
        Ok(())
    }

    /// 重投「已到终态但回调没投出去」的任务。
    ///
    /// 复审前这条路径**不存在**：`list_active_tasks` 只取 `status='processing'`，
    /// 而终态任务的 `poll_once` 又直接早返回，于是投失败的回调永远不会被重试
    /// —— `deliver_callback` 上那句「失败留给下一轮重投」是空话。
    async fn retry_pending_callbacks(state: &AppState, limit: i64) {
        let pending = match VideoGenerationRepository::list_pending_callbacks(
            &state.pool,
            limit,
            MAX_CALLBACK_ATTEMPTS,
        )
        .await
        {
            Ok(tasks) => tasks,
            Err(_) => return,
        };
        for task in pending {
            if Self::deliver_callback(&task).await.is_ok() {
                let _ = VideoGenerationRepository::mark_callback_delivered(
                    &state.pool,
                    &task.task_id,
                )
                .await;
            } else {
                let _ =
                    VideoGenerationRepository::bump_callback_attempt(&state.pool, &task.task_id)
                        .await;
            }
        }
    }

    /// 推进所有在途任务（轮询循环的 tick 体），返回本轮推进过的任务。
    pub async fn advance_all(state: &AppState, limit: i64) -> Result<Vec<VideoTask>, AppError> {
        Self::retry_pending_callbacks(state, limit).await;
        let tasks = VideoGenerationRepository::list_active_tasks(&state.pool, limit).await?;
        let mut advanced = Vec::with_capacity(tasks.len());
        for task in tasks {
            match Self::poll_once(state, &task.task_id).await {
                Ok(progressed) => advanced.push(progressed),
                Err(_) => {
                    // 单个任务失败不影响其余任务；下一轮再试。
                    advanced.push(task);
                }
            }
        }
        Ok(advanced)
    }

    /// 轮询调度器：常驻循环，每个 tick 推进一批在途任务。
    ///
    /// 与 `RouteRecoveryService::run_loop` 同构（每个调用方在自己的 runtime 上
    /// spawn 它）。间隔取 `POLL_INTERVAL_SECONDS`：视频任务动辄几十秒到几分钟，
    /// 更密的轮询只是白打上游配额。
    pub async fn run_loop(state: AppState) {
        let mut ticker = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECONDS));
        // `interval` 的第一次 tick 立即返回；消费掉它作为基线，避免进程刚起来
        // 时把上一轮已经在跑的任务重复推进一遍。
        ticker.tick().await;
        loop {
            ticker.tick().await;
            // 空闲判定必须把「待重投的回调」也算进来：否则一个终态但回调
            // 没投出去的任务会让循环直接 continue，回调永远等不到重投。
            let active = VideoGenerationRepository::list_active_tasks(&state.pool, 1)
                .await
                .map(|tasks| !tasks.is_empty())
                .unwrap_or(false);
            let pending_callback = VideoGenerationRepository::list_pending_callbacks(
                &state.pool,
                1,
                MAX_CALLBACK_ATTEMPTS,
            )
            .await
            .map(|tasks| !tasks.is_empty())
            .unwrap_or(false);
            if !active && !pending_callback {
                // 没有在途任务、也没有待重投回调时完全不碰上游，空闲成本为零。
                continue;
            }
            let _ = Self::advance_all(&state, POLL_BATCH_LIMIT).await;
        }
    }

}

/// MiniMax 的轮询把 task_id 放在 query string 上，其余方言走路径参数。
fn query_path(dialect: VideoDialect, path: &str, upstream_task_id: &str) -> String {
    match dialect {
        VideoDialect::MiniMax => format!("{path}?task_id={upstream_task_id}"),
        _ => path.to_string(),
    }
}

fn preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(500)
        .collect::<String>()
}

fn validation(code: &'static str, message: &str) -> AppError {
    AppError::Validation {
        code,
        message: message.to_string(),
        details: None,
        recoverable: true,
    }
}

/// `Uri::from_str` 的包装：把解析失败也变成带 code 的 `AppError`。
trait FromStrChecked {
    fn from_str_checked(value: &str) -> Result<Uri, AppError>;
}

impl FromStrChecked for Uri {
    fn from_str_checked(value: &str) -> Result<Uri, AppError> {
        value.parse::<Uri>().map_err(|error| {
            validation(
                "validation.video_uri",
                &format!("Could not build video upstream URI '{value}': {error}"),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只填 `pool` 与 `route_proxy` 的 `AppState`：视频链路只读这两项，
    /// 其余字段是惰性默认值。
    fn test_app_state(
        pool: sqlx::SqlitePool,
        route_proxy: crate::services::route_proxy_service::RouteProxyRuntimeState,
    ) -> AppState {
        AppState {
            paths: crate::paths::AppPaths::from_data_dir(
                std::env::temp_dir().join(format!("ai-switch-videogen-test-{}", Uuid::new_v4())),
            ),
            pool,
            saas: Default::default(),
            config_writes: Default::default(),
            deeplink_protocols: Default::default(),
            close_to_tray: Default::default(),
            route_proxy,
            web_service: Default::default(),
            tailscale: Default::default(),
            terminals: Default::default(),
            terminal_hub: Default::default(),
            event_broadcaster: Default::default(),
        }
    }

    #[test]
    fn minimax_polls_through_query_string() {
        assert_eq!(
            query_path(VideoDialect::MiniMax, "/v1/query/video_generation", "t-1"),
            "/v1/query/video_generation?task_id=t-1"
        );
        assert_eq!(
            query_path(VideoDialect::Kling, "/v1/videos/text2video/t-1", "t-1"),
            "/v1/videos/text2video/t-1"
        );
    }

    /// 端到端：真起一个 mock 上游 + 真库，走「提交 → 轮询 → 终态 → 回调」。
    ///
    /// 这条链路只有集成测试能兜住：单测覆盖的是协议转换（`protocol.rs`），
    /// 而账号池选择、`x-ai-switch-platform` 平台钉死、上游 URL 拼接、
    /// `video.generate` 能力收窄、回调投递这些只在真跑一次时才暴露。
    #[tokio::test]
    async fn kling_submit_poll_and_callback_run_end_to_end() {
        use crate::database::{create_memory_pool, run_migrations};
        use crate::services::route_proxy_service::RouteProxyRuntimeState;
        use axum::http::StatusCode;
        use axum::response::IntoResponse;
        use axum::routing::{get, post};
        use axum::{Json, Router};
        use serde_json::{json, Value};
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};

        // ── mock 上游：可灵方言的提交 / 状态，外加一个回调接收点 ──
        let finished = Arc::new(AtomicBool::new(false));
        let status_hits = Arc::new(Mutex::new(Vec::<String>::new()));
        let callbacks = Arc::new(Mutex::new(Vec::<String>::new()));

        let submit_flag = finished.clone();
        let status_flag = finished.clone();
        let status_hits_upstream = status_hits.clone();
        let callback_sink = callbacks.clone();
        let upstream = Router::new()
            .route(
                "/v1/videos/text2video",
                post(move |Json(payload): Json<Value>| {
                    let finished = submit_flag.clone();
                    async move {
                        // 提交体必须是可灵方言：`model_name` 而不是 new-api 的 `model`
                        assert_eq!(payload["model_name"], "kling-v1");
                        assert_eq!(payload["prompt"], "a cat surfing");
                        assert_eq!(payload["duration"], 5);
                        assert_eq!(payload["aspect_ratio"], "16:9");
                        assert_eq!(payload["negative_prompt"], "blurry");
                        finished.store(false, Ordering::SeqCst);
                        Json(json!({"data": {"task_id": "upstream-kling-1"}})).into_response()
                    }
                }),
            )
            .route(
                // axum 0.7 的路径参数是 `:name`（0.8 才改成 `{name}`）
                "/v1/videos/text2video/:task_id",
                get(move |axum::extract::Path(task_id): axum::extract::Path<String>| {
                    let finished = status_flag.clone();
                    let hits = status_hits_upstream.clone();
                    async move {
                        hits.lock().unwrap().push(task_id.clone());
                        assert_eq!(task_id, "upstream-kling-1");
                        if finished.load(Ordering::SeqCst) {
                            Json(json!({"data": {
                                "task_id": task_id,
                                "task_status": "succeed",
                                "task_result": {"videos": [{"url": "https://cdn.example/v.mp4"}]}
                            }}))
                            .into_response()
                        } else {
                            Json(json!({"data": {"task_id": task_id, "task_status": "processing"}}))
                                .into_response()
                        }
                    }
                }),
            )
            .route(
                "/callback",
                post(move |body: axum::body::Bytes| {
                    let sink = callback_sink.clone();
                    async move {
                        sink.lock()
                            .unwrap()
                            .push(String::from_utf8_lossy(&body).into_owned());
                        StatusCode::NO_CONTENT
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let upstream_task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });

        // ── 真库 + 一个 video 平台、interface_format=kling 的账号（能力必须是 video.generate）──
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO route_pool_groups
               (id,platform,name,sort_order,is_internal,is_active,created_at,updated_at)
             VALUES('video-test','video','Video test',10,0,1,'2026-01-01','2026-01-01')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO route_credentials
               (id,platform,kind,display_name,status,secret_payload_json,config_json,created_at,updated_at)
             VALUES('kling-account','video','api','Kling','ok',?,?,'2026-01-01','2026-01-01')",
        )
        .bind(r#"{"api_key":"upstream-video-key"}"#)
        .bind(
            json!({
                // 「模态:协议」落在 `platform` 列（`kind` 只有 official/api 两种取值）。
                "base_url": format!("http://{address}/v1"),
                // 供应商住在账号的 interface_format 里，不在 platform 里
                "interface_format": "kling",
                "model_mappings": [{
                    "from": "kling-v1",
                    "to": "kling-v1",
                    "capabilities": ["video.generate"],
                }],
            })
            .to_string(),
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO route_pool_members
               (id,platform,route_credential_id,enabled,group_id,created_at,updated_at)
             VALUES('video-member','video','kling-account',1,'video-test','2026-01-01','2026-01-01')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let state = test_app_state(pool.clone(), RouteProxyRuntimeState::default());

        // ── 1) 提交 ──
        let outcome = VideoGenerationService::submit(
            &state,
            SubmitVideoInput {
                platform: "video".into(),
                request: VideoGenerationRequest::parse(
                    json!({
                        "model": "kling-v1",
                        "prompt": "a cat surfing",
                        "duration": 5,
                        "width": 1920,
                        "height": 1080,
                        "metadata": {
                            "negative_prompt": "blurry",
                            // 终态后网关要把结果 POST 回这里
                            "callback_url": format!("http://{address}/callback"),
                        },
                    })
                    .to_string()
                    .as_bytes(),
                )
                .expect("request parses"),
                session_id: None,
                message_id: None,
                credential_ids: None,
                // 直连：客户端给的名字就是上游认的名字
                upstream_model: None,
                owner_user_id: None,
            },
        )
        .await
        .expect("submit succeeds against the mock upstream");

        let submitted_task_id = outcome.task_id.clone();
        let submitted: Value = serde_json::from_slice(&outcome.body).unwrap();
        assert_eq!(submitted["object"], "video");
        assert_eq!(submitted["status"], "processing");
        assert_eq!(submitted["model"], "kling-v1");
        // 服务层给出的 task_id 必须与契约体里的一致（两条契约共用同一个 id）
        assert_eq!(
            submitted["task_id"].as_str(),
            Some(submitted_task_id.as_str())
        );
        let task_id = submitted_task_id;
        assert!(!task_id.is_empty());

        // 落库的上游 task_id / 方言必须是可灵那套
        let stored: (String, String) = sqlx::query_as(
            "SELECT upstream_task_id,dialect FROM videogen_tasks WHERE task_id=?",
        )
        .bind(&task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored, ("upstream-kling-1".to_string(), "kling".to_string()));

        // ── 2) 状态查询（refresh=1 直接打上游）──
        let refreshed: Value =
            serde_json::from_slice(&VideoGenerationService::status(&state, &task_id, true).await.unwrap())
                .unwrap();
        assert_eq!(refreshed["status"], "processing");
        assert_eq!(refreshed["task_id"], task_id);

        // ── 3) 轮询推进到终态 ──
        finished.store(true, Ordering::SeqCst);
        let advanced = VideoGenerationService::advance_all(&state, POLL_BATCH_LIMIT)
            .await
            .unwrap();
        assert_eq!(advanced.len(), 1);
        if advanced[0].status != "succeeded" {
            // 轮询失败会被 `poll_once` 吞掉（留在 processing 等重试），所以失败时
            // 把落库的线索打出来，免得只看到一个「没推进」。
            let stored: (String, Option<String>, i64) = sqlx::query_as(
                "SELECT status,error_message,attempt_count FROM videogen_tasks WHERE task_id=?",
            )
            .bind(&task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            panic!(
                "poll did not settle: status={:?} error={:?} attempts={} upstream_status_hits={:?}",
                stored.0,
                stored.1,
                stored.2,
                status_hits.lock().unwrap()
            );
        }
        assert_eq!(advanced[0].status, "succeeded");
        assert_eq!(advanced[0].url.as_deref(), Some("https://cdn.example/v.mp4"));

        let settled: Value =
            serde_json::from_slice(&VideoGenerationService::status(&state, &task_id, false).await.unwrap())
                .unwrap();
        assert_eq!(settled["status"], "succeeded");
        assert_eq!(settled["url"], "https://cdn.example/v.mp4");
        assert_eq!(settled["format"], "mp4");

        // 上游确实被查过、且查的是可灵那条路径：说明平台钉死把请求留在了视频渠道，
        // 没有被别的平台头带去文本池。两次 = 一次 `refresh=1` + 一次轮询。
        let hits = status_hits.lock().unwrap().clone();
        assert!(!hits.is_empty(), "upstream status endpoint was never polled");
        assert!(
            hits.iter().all(|hit| hit == "upstream-kling-1"),
            "unexpected upstream task ids: {hits:?}"
        );

        // ── 4) 回调投递 ──
        let delivered = callbacks.lock().unwrap().clone();
        assert_eq!(delivered.len(), 1, "expected exactly one callback delivery");
        let payload: Value = serde_json::from_str(&delivered[0]).unwrap();
        assert_eq!(payload["task_id"], task_id);
        assert_eq!(payload["status"], "succeeded");
        assert_eq!(payload["url"], "https://cdn.example/v.mp4");
        // 投递成功要落标记，否则下一轮 tick 会重复投递
        let callback_delivered: i64 =
            sqlx::query_scalar("SELECT callback_delivered FROM videogen_tasks WHERE task_id=?")
                .bind(&task_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(callback_delivered, 1);

        // 终态任务不该再被 `advance_all` 捡起来（回调也就不会重复投递）
        let again = VideoGenerationService::advance_all(&state, POLL_BATCH_LIMIT)
            .await
            .unwrap();
        assert!(again.is_empty(), "settled task was picked up again: {again:?}");
        assert_eq!(callbacks.lock().unwrap().len(), 1);

        upstream_task.abort();
    }
}
