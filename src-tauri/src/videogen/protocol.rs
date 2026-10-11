//! 视频生成协议层（G-P2c）
//! =================================================================
//! 网关对外暴露**两条**契约，指向同一套任务与同一套上游方言：
//!
//! **① new-api 对齐（G-P2c）**
//!   POST `/v1/video/generations`  → 201 `{ id, object:"video", model, created_at, task_id, status:"processing" }`
//!   GET  `/v1/video/generations/{task_id}` → 200 `{ task_id, status, url, format, metadata, error }`
//!
//! **② OpenAI 原生（`/v1/videos`）**
//!   POST `/v1/videos`              → 201 `{ id, object:"video", model, created_at, status:"queued", progress, seconds, size }`
//!   GET  `/v1/videos/{id}`         → 200 `{ id, object:"video", model, created_at, status, progress, seconds, size, url, error }`
//!   GET  `/v1/videos/{id}/content` → 200 视频字节流（`video/mp4`）
//!
//! 两者的字段形状差异（`seconds` vs `duration`、`size` vs `width`/`height`、
//! `input_reference` vs `image`、以及**两套不同的状态词表**）全部在本文件内吃掉。
//!
//! 上游各家（可灵 / 方舟 Seedance / MiniMax / 智谱 / Sora）差异同样在本文件内：
//! 请求体构造、提交响应取 taskId、状态响应取 status/url、状态枚举统一。
//!
//! 纯函数 + serde_json，便于单测（对齐 `imagegen/protocol.rs` 的写法）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// 上游视频方言（对齐 new-api 的渠道类型；由 `Provider.kind` 的协议段决定）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoDialect {
    Kling,
    Ark,
    MiniMax,
    Zhipu,
    Sora,
}

impl VideoDialect {
    pub fn as_str(&self) -> &'static str {
        match self {
            VideoDialect::Kling => "kling",
            VideoDialect::Ark => "ark",
            VideoDialect::MiniMax => "minimax",
            VideoDialect::Zhipu => "zhipu",
            VideoDialect::Sora => "sora",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "kling" | "klingai" | "可灵" => Some(VideoDialect::Kling),
            "ark" | "seedance" | "volcengine" | "doubao" => Some(VideoDialect::Ark),
            "minimax" | "hailuo" => Some(VideoDialect::MiniMax),
            "zhipu" | "cogvideo" | "bigmodel" => Some(VideoDialect::Zhipu),
            // 刻意**不**接受 `openai`：那是文本的 `ApiDialect` 名字，视频侧收了
            // 它会让 `interface_format: "openai"` 变成「Sora」这种惊悚的巧合。
            "sora" => Some(VideoDialect::Sora),
            _ => None,
        }
    }
}

/// 账号的 `config_json.interface_format` → 上游方言。
///
/// **供应商就住在这里**，不在 `platform` 里：`platform` 只有 `video` 一个值
/// （池身份：一张 key、一个 SaaS 组），可灵 / 方舟 / MiniMax / 智谱 / Sora 之间的
/// 差别是线协议，所以由账号自己的 `interface_format` 承载——与文本平台同构
/// （`platform = codex` 的账号可以挂 `interface_format: anthropic`）。
///
/// 别名（`seedance` / `hailuo` / `cogvideo` …）由 `VideoDialect::parse` 兜住，
/// 所以手工填 `seedance` 也能工作，落库前会归一成 `ark`。
pub fn dialect_from_interface_format(value: &str) -> Option<VideoDialect> {
    VideoDialect::parse(value)
}

/// 统一任务状态（new-api 契约的三种取值）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoTaskStatus {
    Processing,
    Succeeded,
    Failed,
}

impl VideoTaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            VideoTaskStatus::Processing => "processing",
            VideoTaskStatus::Succeeded => "succeeded",
            VideoTaskStatus::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "processing" | "queued" | "running" | "pending" | "submitted" | "preparing"
            | "queueing" | "in_progress" | "waiting" => Some(VideoTaskStatus::Processing),
            "succeeded" | "success" | "succeed" | "completed" | "complete" | "done" => {
                Some(VideoTaskStatus::Succeeded)
            }
            "failed" | "fail" | "error" | "cancelled" | "canceled" => Some(VideoTaskStatus::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        !matches!(self, VideoTaskStatus::Processing)
    }
}

/// 上游状态解析结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpstreamStatus {
    pub status: VideoTaskStatus,
    pub url: Option<String>,
    pub error: Option<String>,
}

/// 入站请求（new-api `/v1/video/generations`）
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct VideoGenerationRequest {
    pub model: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub fps: Option<u32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// 首帧图（new-api 字段名 `image`）
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub seed: Option<i64>,
    #[serde(default)]
    pub n: Option<u32>,
    /// 逃逸口：各家私有参数（negative_prompt / aspect_ratio / resolution / callback_url …）
    #[serde(default)]
    pub metadata: Option<Value>,
}

impl VideoGenerationRequest {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let request: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("Invalid video generation request: {error}"))?;
        if request.model.trim().is_empty() {
            return Err("Video generation request is missing model".to_string());
        }
        Ok(request)
    }

    pub fn metadata_str(&self, key: &str) -> Option<&str> {
        self.metadata
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
    }

    pub fn metadata_f64(&self, key: &str) -> Option<f64> {
        self.metadata
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(Value::as_f64)
    }

    /// 画面比例：优先 metadata.aspect_ratio，其次由 width/height 推导
    pub fn aspect_ratio(&self) -> String {
        if let Some(value) = self.metadata_str("aspect_ratio") {
            return value.to_string();
        }
        match (self.width, self.height) {
            (Some(width), Some(height)) if height > 0 => simplify_ratio(width, height),
            _ => "16:9".to_string(),
        }
    }

    pub fn callback_url(&self) -> Option<&str> {
        self.metadata_str("callback_url")
    }
}

/// 回调地址的放行口径。两个部署模式的威胁模型不同，所以策略是参数而不是常量
/// （这样才能在一个测试二进制里把两种口径都覆盖到）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallbackTargetPolicy {
    /// 本地优先模式（桌面 app）：操作者就是使用者，回调打到本机是正当用法。
    /// 仍然挡掉链路本地/元数据地址——那些任何模式下都不是回调。
    Local,
    /// 服务端模式（`standalone-server`，即 SaaS）：网关是运营方的机器，
    /// 任意租户给的地址都可能是在探内网，所以连私网段与回环一起挡。
    Server,
}

impl CallbackTargetPolicy {
    /// 当前构建实际使用的口径。
    pub const fn current() -> Self {
        if cfg!(feature = "standalone-server") {
            Self::Server
        } else {
            Self::Local
        }
    }
}

/// 校验 `metadata.callback_url`（SSRF 兜底）。
///
/// 回调是**网关主动发出的出站请求**，目标地址完全由调用方给。不校验的话，
/// 任何能提交视频的人（SaaS 场景下是任意租户）都能让网关去打内网：
/// `http://169.254.169.254/latest/meta-data/…` 这类云元数据端点是最典型的靶子。
///
/// 挡掉的四类：
///   1. 非 `http`/`https`（`file:` / `gopher:` / `ftp:` … 都不是回调协议）；
///   2. 带 userinfo（`http://user:pass@host/` 用来把真实主机藏在 `@` 之后）；
///   3. 链路本地（`169.254.0.0/16`，含元数据地址）、`0.0.0.0`、`::`；
///   4. 云元数据的常见主机名（`metadata.google.internal` 等）。
///
/// 第 5 类（回环与 RFC1918 私网段）只在 [`CallbackTargetPolicy::Server`] 下挡：
/// 本地优先模式下「回调打到本机」是正当用法，一刀切会把功能砍掉。
///
/// **已知不覆盖**：DNS 重绑定（校验时解析到公网、请求时解析到内网）。
/// 要彻底封住需要在连接建立后核对对端 IP，属于连接层改造，见计划文档遗留。
pub fn validate_callback_url(
    raw: &str,
    policy: CallbackTargetPolicy,
) -> Result<(), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("callback_url must not be empty".to_string());
    }
    let parsed = url::Url::parse(trimmed)
        .map_err(|error| format!("callback_url is not a valid URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "callback_url must use http or https, got '{}'",
            parsed.scheme()
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("callback_url must not carry credentials".to_string());
    }
    // 必须走 `Url::host()` 而不是 `host_str()`：后者对 IPv6 返回带方括号的形式
    // （`[::1]`），`parse::<IpAddr>()` 会失败，于是整个 IPv6 分支被静默跳过。
    let host = parsed
        .host()
        .ok_or_else(|| "callback_url has no host".to_string())?;

    /// 云元数据的常见主机名（`169.254.169.254` 的域名版本）。
    const METADATA_HOSTS: [&str; 4] = [
        "metadata.google.internal",
        "metadata.goog",
        "metadata.azure.com",
        "instance-data",
    ];

    match host {
        url::Host::Ipv4(v4) => {
            let octets = v4.octets();
            let link_local = octets[0] == 169 && octets[1] == 254;
            let blocked = link_local
                || v4.is_unspecified()
                || (policy == CallbackTargetPolicy::Server
                    && (v4.is_loopback() || v4.is_private()));
            if blocked {
                return Err(format!(
                    "callback_url host '{v4}' is not a permitted callback target"
                ));
            }
        }
        url::Host::Ipv6(v6) => {
            let unique_local = (v6.segments()[0] & 0xfe00) == 0xfc00;
            let link_local = (v6.segments()[0] & 0xffc0) == 0xfe80;
            // `::ffff:a.b.c.d`：回环/私网/链路本地都要按内嵌的 v4 判
            let mapped = v6
                .to_ipv4_mapped()
                .map(|v4| {
                    v4.is_loopback()
                        || v4.is_private()
                        || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
                })
                .unwrap_or(false);
            let blocked = link_local
                || mapped
                || v6.is_unspecified()
                || (policy == CallbackTargetPolicy::Server
                    && (v6.is_loopback() || unique_local));
            if blocked {
                return Err(format!(
                    "callback_url host '{v6}' is not a permitted callback target"
                ));
            }
        }
        url::Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if METADATA_HOSTS.contains(&name.as_str()) {
                return Err("callback_url points at a cloud metadata endpoint".to_string());
            }
            if policy == CallbackTargetPolicy::Server
                && matches!(name.as_str(), "localhost" | "localhost.localdomain")
            {
                return Err("callback_url points at the local host".to_string());
            }
        }
    }

    Ok(())
}

fn simplify_ratio(width: u32, height: u32) -> String {
    fn gcd(a: u32, b: u32) -> u32 {
        if b == 0 {
            a
        } else {
            gcd(b, a % b)
        }
    }
    let divisor = gcd(width, height).max(1);
    format!("{}:{}", width / divisor, height / divisor)
}

/// `Provider.kind` 形如 `video:kling`（G-P1：模态:协议）→ 方言
pub fn dialect_from_provider_kind(kind: &str) -> Option<VideoDialect> {
    let (modality, protocol) = kind.split_once(':')?;
    if !modality.trim().eq_ignore_ascii_case("video") {
        return None;
    }
    VideoDialect::parse(protocol)
}

// ─────────────── 对外（new-api 契约）响应 ───────────────

/// new-api 契约里 `id` 的前缀：`id` 是 `video-{task_id}`，而 `task_id` 是裸的。
///
/// 单独抽成常量是因为 `web::video_routes` 要反向摘掉它 —— OpenAI 原生契约的
/// `id` 就是裸 task_id，客户端可能把这条契约的 `id` 拿去查另一条，反之亦然。
/// 两边共用同一个字面量才不会漂。
pub const VIDEO_TASK_ID_PREFIX: &str = "video-";

/// 提交成功响应体（HTTP 201）
pub fn submit_response(model: &str, task_id: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "id": format!("{VIDEO_TASK_ID_PREFIX}{task_id}"),
        "object": "video",
        "model": model,
        "created_at": chrono::Utc::now().timestamp(),
        "task_id": task_id,
        "status": VideoTaskStatus::Processing.as_str(),
    }))
    .expect("static video submit response serializes")
}

/// 状态查询响应体（HTTP 200）
pub fn status_response(
    task_id: &str,
    status: VideoTaskStatus,
    url: Option<&str>,
    error: Option<&str>,
) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "task_id": task_id,
        "status": status.as_str(),
        "url": url,
        "format": "mp4",
        "metadata": Value::Null,
        "error": error,
    }))
    .expect("static video status response serializes")
}

// ─────────────── 对外（OpenAI 原生契约：`/v1/videos`） ───────────────
//
// 除了 new-api 那条契约，还对外提供 OpenAI 原生视频契约的三个端点
// （`POST /v1/videos`、`GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`）。
// 两条契约指向**同一套任务与同一套上游方言**，差别只在请求体与响应体的形状：
//
//   | | new-api 契约 | OpenAI 原生契约 |
//   | --- | --- | --- |
//   | 提交 | `POST /v1/video/generations` | `POST /v1/videos` |
//   | 时长字段 | `duration: 5`（数字） | `seconds: "5"`（字符串） |
//   | 画幅 | `width`/`height` 两个整数 | `size: "1280x720"` 一个字符串 |
//   | 首帧图 | `image` | `input_reference` |
//   | 状态词表 | `processing`/`succeeded`/`failed` | `queued`/`in_progress`/`completed`/`failed` |
//
// **状态词表不同是刻意的**，不是笔误：客户端按哪条契约写的就按哪套词表读。

/// 内部三态 → OpenAI 原生契约的状态词表。
///
/// OpenAI 有四个值，我们只有三个（没有「已排队但还没提交给上游」这个状态，
/// 我们提交时就已经打到上游了）。所以：
///   - `Processing` → `in_progress`（说 in_progress 是诚实的：上游确实在跑）；
///   - `Succeeded` → `completed`（**不是 `succeeded`** —— 那是 new-api 契约的词）；
///   - `Failed` → `failed`。
pub fn openai_video_status(status: VideoTaskStatus) -> &'static str {
    match status {
        VideoTaskStatus::Processing => "in_progress",
        VideoTaskStatus::Succeeded => "completed",
        VideoTaskStatus::Failed => "failed",
    }
}

/// OpenAI 原生契约（`POST /v1/videos`）的请求体 → 内部契约体。
///
/// 三处形状差异全在这里吃掉（见上面那张表）。另外把 `size` 原串**同时**
/// 写进 `metadata.size`：Sora 方言的 `upstream_body` 读的就是 `metadata.size`，
/// 若只写 `width`/`height`，它会被重新拼成另一个值。
///
/// **不支持 multipart。** OpenAI 的 `input_reference` 是文件上传，这里只收
/// 字符串（URL 或 data URI）。传了文件会被当成非字符串而忽略，随后因为
/// 「既没有 prompt 也没有首帧图」在 `submit` 里被拒 —— 不会静默出错片。
///
/// `duration` 也接受（new-api 契约用这个名字），`seconds` 优先。
pub fn video_request_from_openai(bytes: &[u8]) -> Result<VideoGenerationRequest, String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("Invalid video generation request: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Video generation request must be a JSON object".to_string())?;

    let mut internal = serde_json::Map::new();

    let model = object
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if model.is_empty() {
        return Err("Video generation request is missing model".to_string());
    }
    internal.insert("model".into(), json!(model));

    if let Some(prompt) = object.get("prompt").and_then(Value::as_str) {
        internal.insert("prompt".into(), json!(prompt));
    }

    // `seconds` 是字符串（`"4"`）或数字，`duration` 是数字；前者优先。
    let seconds = object
        .get("seconds")
        .and_then(number_like)
        .or_else(|| object.get("duration").and_then(number_like));
    if let Some(seconds) = seconds {
        internal.insert("duration".into(), json!(seconds));
    }

    // `metadata` 是本地扩展（new-api 契约里有），先搬进来，稍后补 `size`。
    let mut metadata = object
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    if let Some(size) = object
        .get("size")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|size| !size.is_empty())
    {
        if let Some((width, height)) = parse_size(size) {
            internal.insert("width".into(), json!(width));
            internal.insert("height".into(), json!(height));
        }
        metadata.insert("size".into(), json!(size));
    }

    let image = object
        .get("input_reference")
        .and_then(Value::as_str)
        .or_else(|| object.get("image").and_then(Value::as_str))
        .map(str::trim)
        .filter(|image| !image.is_empty());
    if let Some(image) = image {
        internal.insert("image".into(), json!(image));
    }

    if let Some(seed) = object.get("seed").and_then(Value::as_i64) {
        internal.insert("seed".into(), json!(seed));
    }
    if !metadata.is_empty() {
        internal.insert("metadata".into(), Value::Object(metadata));
    }

    serde_json::from_value(Value::Object(internal))
        .map_err(|error| format!("Invalid video generation request: {error}"))
}

/// `POST /v1/videos` 的 201 响应体。
///
/// `seconds` 与 `size` 都是**字符串**（OpenAI 的规定），`progress` 是 0–100。
/// 刚提交时进度必然是 0、状态用 `queued` —— 与 OpenAI 一致。
pub fn openai_video_create_response(
    task_id: &str,
    model: &str,
    duration_seconds: i64,
    size: Option<&str>,
) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "id": task_id,
        "object": "video",
        "model": model,
        "created_at": chrono::Utc::now().timestamp(),
        "status": "queued",
        "progress": 0,
        "seconds": duration_seconds.to_string(),
        "size": size,
    }))
    .expect("static openai video create response serializes")
}

/// `GET /v1/videos/{video_id}` 的 200 响应体。
///
/// 参数多是为了保持本文件「纯函数、不认识 `models::VideoTask`」的性质——
/// 这样它能在不知道数据库形状的情况下被单测钉住。
#[allow(clippy::too_many_arguments)]
pub fn openai_video_retrieve_response(
    task_id: &str,
    model: &str,
    created_at: &str,
    status: VideoTaskStatus,
    url: Option<&str>,
    error: Option<&str>,
    duration_seconds: Option<i64>,
    size: Option<&str>,
) -> Vec<u8> {
    // 我们只有一个粗粒度的状态，没有真实百分比；用「完成即 100、否则 0」
    // 表达，而不是编一个假进度。
    let progress = match status {
        VideoTaskStatus::Succeeded => 100,
        _ => 0,
    };
    serde_json::to_vec(&json!({
        "id": task_id,
        "object": "video",
        "model": model,
        "created_at": rfc3339_to_unix(created_at),
        "status": openai_video_status(status),
        "progress": progress,
        "seconds": duration_seconds.map(|seconds| seconds.to_string()),
        "size": size,
        "url": url,
        "error": error.map(|message| json!({
            "code": "video_generation_failed",
            "message": message,
        })),
    }))
    .expect("static openai video retrieve response serializes")
}

/// JSON 里的「数字」也可能是字符串（OpenAI 的 `seconds` 就是 `"4"`）。
fn number_like(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// `"1280x720"` / `"1280×720"` → `(1280, 720)`。
///
/// 解析不出来返回 `None`：原串已经进了 `metadata.size`，会原样透传给上游，
/// 不在这里猜一个值出来。
fn parse_size(raw: &str) -> Option<(u32, u32)> {
    let (width, height) = raw.split_once(|c: char| matches!(c, 'x' | 'X' | '×' | '*'))?;
    let width = width.trim().parse::<u32>().ok()?;
    let height = height.trim().parse::<u32>().ok()?;
    (width > 0 && height > 0).then_some((width, height))
}

/// OpenAI 的 `seconds` 是字符串（`"4"`，不是 `4`）。
///
/// 时长永远是整秒（`effective_duration_seconds` 已经取整并 clamp 到 ≥1），
/// 所以直接 `to_string` 就够，不需要处理小数。
///
/// 任务表的 `created_at` 是 RFC3339，OpenAI 契约要 Unix 秒。
///
/// 解析不了就退回「现在」——比回 `null` 好：客户端普遍当这个字段必有，
/// 而一个解析不了的 `created_at` 只可能是脏数据，此时「现在」是最接近的答案。
fn rfc3339_to_unix(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.timestamp())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp())
}

// ─────────────── 上游路径 ───────────────

/// 上游提交路径（可灵按有无首帧图分 text2video / image2video）
pub fn upstream_submit_path(dialect: VideoDialect, has_image: bool) -> String {
    match dialect {
        VideoDialect::Kling => {
            if has_image {
                "/v1/videos/image2video".to_string()
            } else {
                "/v1/videos/text2video".to_string()
            }
        }
        VideoDialect::Ark => "/api/v3/contents/generations/tasks".to_string(),
        VideoDialect::MiniMax => "/v1/video_generation".to_string(),
        VideoDialect::Zhipu => "/v4/videos/generations".to_string(),
        VideoDialect::Sora => "/v1/videos".to_string(),
    }
}

/// 上游状态查询路径（`{task_id}` 占位替换）
pub fn upstream_status_path(dialect: VideoDialect, upstream_task_id: &str) -> String {
    match dialect {
        VideoDialect::Kling => format!("/v1/videos/text2video/{upstream_task_id}"),
        VideoDialect::Ark => format!("/api/v3/contents/generations/tasks/{upstream_task_id}"),
        // MiniMax 轮询走 query string，由调用方拼接（这里给出不带 task_id 的基路径）
        VideoDialect::MiniMax => "/v1/query/video_generation".to_string(),
        VideoDialect::Zhipu => format!("/v4/async-result/{upstream_task_id}"),
        VideoDialect::Sora => format!("/v1/videos/{upstream_task_id}"),
    }
}

// ─────────────── 上游请求体 ───────────────

/// 把统一的 new-api 请求体转成某方言的上游请求体
/// 客户端没给时长时的缺省值（秒）。
///
/// 计费与上游体**必须**共用这一个值：否则「按秒计价」收的秒数和实际发给
/// 上游的秒数会对不上（见迁移 0008 的计价口径）。
pub const DEFAULT_VIDEO_DURATION_SECONDS: f64 = 5.0;

/// 这次请求实际生效的时长（取整到秒），计价与上游体共用。
pub fn effective_duration_seconds(request: &VideoGenerationRequest) -> i64 {
    let seconds = request.duration.unwrap_or(DEFAULT_VIDEO_DURATION_SECONDS);
    if seconds.is_finite() {
        (seconds.round() as i64).max(1)
    } else {
        DEFAULT_VIDEO_DURATION_SECONDS as i64
    }
}

/// 这次请求的「画幅」字符串（OpenAI 契约的 `size`，形如 `1280x720`）。
///
/// 优先用客户端显式给的 `metadata.size` —— Sora 方言的上游体读的就是它，
/// 必须原样保留；否则由 `width`/`height` 拼出来。两者都没有时返回 `None`，
/// **不编造默认值**：`upstream_body` 自己会给上游补缺省，这里编一个会让
/// 「客户端没说要多大」和「客户端要 1280x720」变得无法区分。
pub fn effective_size(request: &VideoGenerationRequest) -> Option<String> {
    if let Some(size) = request.metadata_str("size") {
        return Some(size.to_string());
    }
    match (request.width, request.height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => Some(format!("{width}x{height}")),
        _ => None,
    }
}

pub fn upstream_body(
    dialect: VideoDialect,
    model: &str,
    request: &VideoGenerationRequest,
) -> Result<Vec<u8>, String> {
    let prompt = request.prompt.trim();
    let negative_prompt = request.metadata_str("negative_prompt");
    let duration = request.duration.unwrap_or(DEFAULT_VIDEO_DURATION_SECONDS);
    let ratio = request.aspect_ratio();

    let body = match dialect {
        VideoDialect::Kling => {
            let mut body = json!({
                "model_name": model,
                "prompt": prompt,
                "cfg_scale": request.metadata_f64("cfg_scale").unwrap_or(0.5),
                "mode": request.metadata_str("mode").unwrap_or("std"),
                "duration": duration.round() as i64,
                "aspect_ratio": ratio,
            });
            if let Some(negative) = negative_prompt {
                body["negative_prompt"] = json!(negative);
            }
            if let Some(image) = request.image.as_deref() {
                body["image"] = json!(image);
            }
            body
        }
        VideoDialect::Ark => {
            let mut content = vec![json!({"type": "text", "text": prompt})];
            if let Some(image) = request.image.as_deref() {
                content.push(json!({"type": "image_url", "image_url": {"url": image}}));
            }
            json!({
                "model": model,
                "content": content,
                "duration": duration.round() as i64,
                "ratio": ratio,
            })
        }
        VideoDialect::MiniMax => {
            let mut body = json!({
                "model": model,
                "prompt": prompt,
                "duration": duration.round() as i64,
                "resolution": request.metadata_str("resolution").unwrap_or("1080P"),
            });
            if let Some(image) = request.image.as_deref() {
                body["first_frame_image"] = json!(image);
            }
            if let Some(callback) = request.callback_url() {
                body["callback_url"] = json!(callback);
            }
            body
        }
        VideoDialect::Zhipu => {
            let mut body = json!({
                "model": model,
                "prompt": prompt,
                "with_audio": request.metadata.as_ref().and_then(|m| m.get("with_audio")).and_then(Value::as_bool).unwrap_or(false),
            });
            if let Some(image) = request.image.as_deref() {
                body["image_url"] = json!(image);
            }
            body
        }
        VideoDialect::Sora => {
            let mut body = json!({
                "model": model,
                "prompt": prompt,
                "seconds": duration.round().clamp(1.0, 20.0) as i64,
                "size": request.metadata_str("size").unwrap_or("1280x720"),
            });
            if let Some(image) = request.image.as_deref() {
                body["input_reference"] = json!(image);
            }
            body
        }
    };

    serde_json::to_vec(&body).map_err(|error| format!("Could not serialize upstream video body: {error}"))
}

// ─────────────── 上游响应解析 ───────────────

/// 按点号路径取值（`data.task_id` → `/data/task_id`）。
///
/// 段名是数字时按**数组下标**取值：可灵 / 智谱 / Sora 的视频地址都在数组里
/// （`data.task_result.videos.0.url`、`video_result.0.url`、`output.0.url`）。
/// `Value::get(&str)` 只能索引对象，不处理这一层就会静默取不到 url。
fn dig<'a>(value: &'a Value, dotted: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in dotted.split('.') {
        current = match current {
            Value::Array(items) => items.get(segment.parse::<usize>().ok()?)?,
            _ => current.get(segment)?,
        };
    }
    Some(current)
}

fn dig_str<'a>(value: &'a Value, dotted: &str) -> Option<&'a str> {
    dig(value, dotted).and_then(Value::as_str)
}

fn parse_json(bytes: &[u8], what: &str) -> Result<Value, String> {
    serde_json::from_slice(bytes).map_err(|error| format!("Invalid {what}: {error}"))
}

/// 从上游「提交」响应里取出上游 task_id
pub fn parse_upstream_submit(dialect: VideoDialect, bytes: &[u8]) -> Result<String, String> {
    let value = parse_json(bytes, "upstream video submit response")?;
    let path = match dialect {
        VideoDialect::Kling => "data.task_id",
        VideoDialect::Ark => "id",
        VideoDialect::MiniMax => "task_id",
        VideoDialect::Zhipu => "id",
        VideoDialect::Sora => "id",
    };
    dig_str(&value, path)
        .map(str::to_string)
        .ok_or_else(|| format!("Upstream {} submit response is missing {path}", dialect.as_str()))
}

/// 把上游「状态」响应统一成 `UpstreamStatus`
pub fn parse_upstream_status(dialect: VideoDialect, bytes: &[u8]) -> Result<UpstreamStatus, String> {
    let value = parse_json(bytes, "upstream video status response")?;

    let (status_path, url_path, error_path) = match dialect {
        VideoDialect::Kling => (
            "data.task_status",
            "data.task_result.videos.0.url",
            "data.task_status_msg",
        ),
        VideoDialect::Ark => ("status", "content.video_url", "error.message"),
        VideoDialect::MiniMax => ("status", "file.download_url", "base_resp.status_msg"),
        VideoDialect::Zhipu => ("task_status", "video_result.0.url", "error.message"),
        VideoDialect::Sora => ("status", "output.0.url", "error.message"),
    };

    let raw_status = dig_str(&value, status_path)
        .ok_or_else(|| format!("Upstream {} status response is missing {status_path}", dialect.as_str()))?;
    let status = VideoTaskStatus::parse(raw_status)
        .ok_or_else(|| format!("Unknown {} task status: {raw_status}", dialect.as_str()))?;

    // Sora 完成时视频在 `output[].url`；未完成时 url 为空即可
    let url = dig_str(&value, url_path).map(str::to_string);
    let error = dig_str(&value, error_path).map(str::to_string);

    Ok(UpstreamStatus { status, url, error })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialect_from_kind_and_status_mapping() {
        assert_eq!(
            dialect_from_provider_kind("video:kling"),
            Some(VideoDialect::Kling)
        );
        assert_eq!(
            dialect_from_provider_kind("video:seedance"),
            Some(VideoDialect::Ark)
        );
        assert_eq!(dialect_from_provider_kind("text:openai"), None);
        assert_eq!(dialect_from_provider_kind("video"), None);

        assert_eq!(
            VideoTaskStatus::parse("succeed"),
            Some(VideoTaskStatus::Succeeded)
        );
        assert_eq!(
            VideoTaskStatus::parse("in_progress"),
            Some(VideoTaskStatus::Processing)
        );
        assert_eq!(VideoTaskStatus::parse("Fail"), Some(VideoTaskStatus::Failed));
        assert!(VideoTaskStatus::Succeeded.is_terminal());
        assert!(!VideoTaskStatus::Processing.is_terminal());
    }

    #[test]
    fn builds_kling_and_ark_upstream_bodies() {
        let request = VideoGenerationRequest::parse(
            br#"{"model":"kling-v2-6","prompt":"a fox","duration":5,
                 "image":"https://img/1.png",
                 "metadata":{"negative_prompt":"blur","aspect_ratio":"9:16"}}"#,
        )
        .expect("request");

        let kling = upstream_body(VideoDialect::Kling, "kling-v2-6", &request).expect("kling");
        let kling: Value = serde_json::from_slice(&kling).expect("json");
        assert_eq!(kling["model_name"], "kling-v2-6");
        assert_eq!(kling["negative_prompt"], "blur");
        assert_eq!(kling["aspect_ratio"], "9:16");
        assert_eq!(kling["image"], "https://img/1.png");
        assert_eq!(upstream_submit_path(VideoDialect::Kling, true), "/v1/videos/image2video");

        let ark = upstream_body(VideoDialect::Ark, "doubao-seedance", &request).expect("ark");
        let ark: Value = serde_json::from_slice(&ark).expect("json");
        assert_eq!(ark["content"][0]["type"], "text");
        assert_eq!(ark["content"][1]["image_url"]["url"], "https://img/1.png");
    }

    /// MiniMax / 智谱 / Sora 的上游体、提交响应取值路径、提交与状态路径。
    ///
    /// 这三家的字段名与 Kling / Ark 完全不同（`first_frame_image` vs `image`、
    /// `seconds` vs `duration`、`id` vs `data.task_id`），而各家又各自有一个
    /// 不同的响应外壳——只有把五家都钉住，改一家时才不会静默带坏另一家。
    #[test]
    fn builds_the_remaining_three_dialects_and_their_paths() {
        let request = VideoGenerationRequest::parse(
            br#"{"model":"m","prompt":"a fox","duration":10,"image":"https://img/1.png",
                 "metadata":{"resolution":"720P","size":"1920x1080","with_audio":true,
                             "callback_url":"https://cb/hook"}}"#,
        )
        .expect("request");

        let minimax = upstream_body(VideoDialect::MiniMax, "minimax-hailuo", &request)
            .expect("minimax");
        let minimax: Value = serde_json::from_slice(&minimax).expect("json");
        assert_eq!(minimax["model"], "minimax-hailuo");
        assert_eq!(minimax["resolution"], "720P");
        assert_eq!(minimax["first_frame_image"], "https://img/1.png");
        assert_eq!(minimax["callback_url"], "https://cb/hook");

        let zhipu = upstream_body(VideoDialect::Zhipu, "cogvideo", &request).expect("zhipu");
        let zhipu: Value = serde_json::from_slice(&zhipu).expect("json");
        assert_eq!(zhipu["model"], "cogvideo");
        assert_eq!(zhipu["with_audio"], true);
        assert_eq!(zhipu["image_url"], "https://img/1.png");

        let sora = upstream_body(VideoDialect::Sora, "sora-2", &request).expect("sora");
        let sora: Value = serde_json::from_slice(&sora).expect("json");
        assert_eq!(sora["model"], "sora-2");
        // Sora 用的是 `seconds` / `size`，不是 `duration` / `aspect_ratio`
        assert_eq!(sora["seconds"], 10);
        assert_eq!(sora["size"], "1920x1080");
        assert_eq!(sora["input_reference"], "https://img/1.png");

        // 提交响应：五家的 task_id 路径各不相同
        for (dialect, body, expected) in [
            (VideoDialect::Kling, r#"{"data":{"task_id":"k"}}"#, "k"),
            (VideoDialect::Ark, r#"{"id":"a"}"#, "a"),
            (VideoDialect::MiniMax, r#"{"task_id":"m"}"#, "m"),
            (VideoDialect::Zhipu, r#"{"id":"z"}"#, "z"),
            (VideoDialect::Sora, r#"{"id":"s"}"#, "s"),
        ] {
            assert_eq!(
                parse_upstream_submit(dialect, body.as_bytes()).unwrap_or_else(|error| panic!(
                    "{} submit: {error}",
                    dialect.as_str()
                )),
                expected,
                "{dialect:?}"
            );
        }

        // 提交路径：可灵按有无首帧图分 text2video / image2video，其余固定
        assert_eq!(
            upstream_submit_path(VideoDialect::Kling, false),
            "/v1/videos/text2video"
        );
        assert_eq!(
            upstream_submit_path(VideoDialect::Ark, false),
            "/api/v3/contents/generations/tasks"
        );
        assert_eq!(upstream_submit_path(VideoDialect::MiniMax, false), "/v1/video_generation");
        assert_eq!(upstream_submit_path(VideoDialect::Zhipu, false), "/v4/videos/generations");
        assert_eq!(upstream_submit_path(VideoDialect::Sora, false), "/v1/videos");

        // 状态路径：MiniMax 不带 task_id（它走 query string，由 `query_path` 拼）
        assert_eq!(
            upstream_status_path(VideoDialect::Kling, "t"),
            "/v1/videos/text2video/t"
        );
        assert_eq!(
            upstream_status_path(VideoDialect::Ark, "t"),
            "/api/v3/contents/generations/tasks/t"
        );
        assert_eq!(
            upstream_status_path(VideoDialect::MiniMax, "t"),
            "/v1/query/video_generation"
        );
        assert_eq!(upstream_status_path(VideoDialect::Zhipu, "t"), "/v4/async-result/t");
        assert_eq!(upstream_status_path(VideoDialect::Sora, "t"), "/v1/videos/t");
    }

    #[test]
    fn parses_upstream_submit_and_status() {
        let kling_task = parse_upstream_submit(
            VideoDialect::Kling,
            br#"{"code":0,"data":{"task_id":"k-1","task_status":"submitted"}}"#,
        )
        .expect("kling submit");
        assert_eq!(kling_task, "k-1");

        let ark_status = parse_upstream_status(
            VideoDialect::Ark,
            br#"{"status":"succeeded","content":{"video_url":"https://cdn/v.mp4"}}"#,
        )
        .expect("ark status");
        assert_eq!(ark_status.status, VideoTaskStatus::Succeeded);
        assert_eq!(ark_status.url.as_deref(), Some("https://cdn/v.mp4"));

        let zhipu_failed = parse_upstream_status(
            VideoDialect::Zhipu,
            br#"{"task_status":"FAIL","error":{"message":"quota"}}"#,
        )
        .expect("zhipu status");
        assert_eq!(zhipu_failed.status, VideoTaskStatus::Failed);
        assert_eq!(zhipu_failed.error.as_deref(), Some("quota"));

        let sora_processing =
            parse_upstream_status(VideoDialect::Sora, br#"{"status":"in_progress"}"#)
                .expect("sora status");
        assert_eq!(sora_processing.status, VideoTaskStatus::Processing);
    }

    /// 五家方言的「成功」响应都必须能取到视频地址。
    ///
    /// 可灵 / 智谱 / Sora 把地址放在**数组**里（`…videos.0.url`），而
    /// `Value::get(&str)` 不能索引数组；这条测试专门盯住那一层，
    /// 因为取不到 url 时 `poll_once` 会把任务判成失败，症状离根因很远。
    #[test]
    fn every_dialect_extracts_the_video_url_from_a_success_response() {
        let cases: [(VideoDialect, &str, &str); 5] = [
            (
                VideoDialect::Kling,
                r#"{"code":0,"data":{"task_id":"k-1","task_status":"succeed","task_result":{"videos":[{"id":"v1","url":"https://cdn.example/kling.mp4"}]}}}"#,
                "https://cdn.example/kling.mp4",
            ),
            (
                VideoDialect::Ark,
                r#"{"id":"a-1","status":"succeeded","content":{"video_url":"https://cdn.example/ark.mp4"}}"#,
                "https://cdn.example/ark.mp4",
            ),
            (
                VideoDialect::MiniMax,
                r#"{"task_id":"m-1","status":"Success","file":{"download_url":"https://cdn.example/minimax.mp4"}}"#,
                "https://cdn.example/minimax.mp4",
            ),
            (
                VideoDialect::Zhipu,
                r#"{"task_status":"SUCCESS","video_result":[{"url":"https://cdn.example/zhipu.mp4"}]}"#,
                "https://cdn.example/zhipu.mp4",
            ),
            (
                VideoDialect::Sora,
                r#"{"id":"s-1","status":"completed","output":[{"url":"https://cdn.example/sora.mp4"}]}"#,
                "https://cdn.example/sora.mp4",
            ),
        ];
        for (dialect, body, expected) in cases {
            let status = parse_upstream_status(dialect, body.as_bytes())
                .unwrap_or_else(|error| panic!("{} status: {error}", dialect.as_str()));
            assert_eq!(status.status, VideoTaskStatus::Succeeded, "{dialect:?}");
            assert_eq!(status.url.as_deref(), Some(expected), "{dialect:?} url");
        }
    }

    #[test]
    fn emits_new_api_contract_responses() {
        let submit: Value = serde_json::from_slice(&submit_response("kling-v2-6", "t-1")).expect("json");
        assert_eq!(submit["object"], "video");
        assert_eq!(submit["task_id"], "t-1");
        assert_eq!(submit["status"], "processing");

        let status: Value = serde_json::from_slice(&status_response(
            "t-1",
            VideoTaskStatus::Succeeded,
            Some("https://cdn/v.mp4"),
            None,
        ))
        .expect("json");
        assert_eq!(status["task_id"], "t-1");
        assert_eq!(status["status"], "succeeded");
        assert_eq!(status["url"], "https://cdn/v.mp4");
        assert_eq!(status["format"], "mp4");
    }

    /// OpenAI 原生契约的字段名与内部契约不同的就三处（`seconds` / `size` /
    /// `input_reference`），全在 `video_request_from_openai` 里吃掉。逐个钉住。
    #[test]
    fn openai_video_requests_map_the_native_field_names() {
        let request = video_request_from_openai(
            br#"{
                "model": "sora-2",
                "prompt": "a fox",
                "seconds": "8",
                "size": "1280x720",
                "input_reference": "https://cdn/first.png",
                "metadata": {"negative_prompt": "blurry"}
            }"#,
        )
        .expect("request");
        assert_eq!(request.model, "sora-2");
        assert_eq!(request.prompt, "a fox");
        // `seconds` 是字符串，内部是 f64
        assert_eq!(request.duration, Some(8.0));
        // `size` 既拆成 width/height，也保留原串
        assert_eq!(request.width, Some(1280));
        assert_eq!(request.height, Some(720));
        assert_eq!(request.aspect_ratio(), "16:9");
        // `input_reference` → image
        assert_eq!(request.image.as_deref(), Some("https://cdn/first.png"));
        // metadata 里原有的字段没被覆盖
        assert_eq!(request.metadata_str("negative_prompt"), Some("blurry"));

        // **原串必须留在 metadata.size 里**：Sora 方言的上游体读的就是它，
        // 只写 width/height 的话上游会收到被重新拼出来的另一个值。
        assert_eq!(request.metadata_str("size"), Some("1280x720"));
        let body: Value =
            serde_json::from_slice(&upstream_body(VideoDialect::Sora, "sora-2", &request).unwrap())
                .unwrap();
        assert_eq!(body["size"], "1280x720");
        assert_eq!(body["seconds"], 8);

        // `seconds` 写成数字、或改用 `duration`（new-api 契约的名字），都收
        assert_eq!(
            video_request_from_openai(br#"{"model":"m","prompt":"p","seconds":4}"#)
                .unwrap()
                .duration,
            Some(4.0)
        );
        assert_eq!(
            video_request_from_openai(br#"{"model":"m","prompt":"p","duration":6}"#)
                .unwrap()
                .duration,
            Some(6.0)
        );
        // 画幅解析不出来时不猜：只把原串留给上游
        let odd = video_request_from_openai(br#"{"model":"m","prompt":"p","size":"portrait"}"#)
            .expect("request");
        assert_eq!(odd.width, None);
        assert_eq!(odd.height, None);
        assert_eq!(odd.metadata_str("size"), Some("portrait"));
    }

    #[test]
    fn openai_video_requests_require_a_model() {
        assert!(video_request_from_openai(br#"{"prompt":"p"}"#).is_err());
        assert!(video_request_from_openai(br#"{"model":"   "}"#).is_err());
        assert!(video_request_from_openai(b"[]").is_err());
        assert!(video_request_from_openai(b"not json").is_err());
    }

    /// **两套契约的状态词表不同**：new-api 用 `succeeded`，OpenAI 用 `completed`。
    ///
    /// 这是刻意的，不是笔误。钉住它，免得以后有人「统一」成一套而静默破坏
    /// 其中一个客户端 —— 客户端是按自己那套契约读的。
    #[test]
    fn openai_video_statuses_use_the_openai_vocabulary() {
        assert_eq!(openai_video_status(VideoTaskStatus::Processing), "in_progress");
        assert_eq!(openai_video_status(VideoTaskStatus::Succeeded), "completed");
        assert_eq!(openai_video_status(VideoTaskStatus::Failed), "failed");
        assert_ne!(
            openai_video_status(VideoTaskStatus::Succeeded),
            VideoTaskStatus::Succeeded.as_str(),
        );
    }

    #[test]
    fn emits_openai_video_contract_responses() {
        let create: Value = serde_json::from_slice(&openai_video_create_response(
            "t-1",
            "sora-2",
            8,
            Some("1280x720"),
        ))
        .expect("json");
        assert_eq!(create["id"], "t-1");
        assert_eq!(create["object"], "video");
        assert_eq!(create["model"], "sora-2");
        assert_eq!(create["status"], "queued");
        assert_eq!(create["progress"], 0);
        // `seconds` / `size` 都是字符串（OpenAI 的规定，不是数字）
        assert_eq!(create["seconds"], "8");
        assert_eq!(create["size"], "1280x720");

        let retrieve: Value = serde_json::from_slice(&openai_video_retrieve_response(
            "t-1",
            "sora-2",
            "2026-10-10T12:00:00+00:00",
            VideoTaskStatus::Succeeded,
            Some("https://cdn/v.mp4"),
            None,
            Some(8),
            Some("1280x720"),
        ))
        .expect("json");
        assert_eq!(retrieve["id"], "t-1");
        assert_eq!(retrieve["object"], "video");
        assert_eq!(retrieve["status"], "completed");
        assert_eq!(retrieve["progress"], 100);
        assert_eq!(retrieve["url"], "https://cdn/v.mp4");
        assert_eq!(retrieve["seconds"], "8");
        assert_eq!(retrieve["size"], "1280x720");
        assert_eq!(retrieve["error"], Value::Null);
        // RFC3339 → Unix 秒
        assert!(retrieve["created_at"].as_i64().is_some_and(|v| v > 1_700_000_000));

        // 失败：带 error 对象、进度归 0、拿不到的字段回 null 而不是编一个
        let failed: Value = serde_json::from_slice(&openai_video_retrieve_response(
            "t-2",
            "sora-2",
            "not-a-date",
            VideoTaskStatus::Failed,
            None,
            Some("upstream said no"),
            None,
            None,
        ))
        .expect("json");
        assert_eq!(failed["status"], "failed");
        assert_eq!(failed["progress"], 0);
        assert_eq!(failed["url"], Value::Null);
        assert_eq!(failed["seconds"], Value::Null);
        assert_eq!(failed["error"]["message"], "upstream said no");
        // 脏 created_at 退回「现在」，仍然是个可用的整数
        assert!(failed["created_at"].as_i64().is_some_and(|v| v > 1_700_000_000));
    }

    /// `effective_size` 的取值优先级：显式 `metadata.size` > width/height > 无。
    #[test]
    fn effective_size_prefers_the_explicit_size() {
        let explicit = VideoGenerationRequest::parse(
            br#"{"model":"m","prompt":"p","width":1920,"height":1080,"metadata":{"size":"720x1280"}}"#,
        )
        .unwrap();
        assert_eq!(effective_size(&explicit).as_deref(), Some("720x1280"));

        let derived =
            VideoGenerationRequest::parse(br#"{"model":"m","prompt":"p","width":1920,"height":1080}"#)
                .unwrap();
        assert_eq!(effective_size(&derived).as_deref(), Some("1920x1080"));

        let neither = VideoGenerationRequest::parse(br#"{"model":"m","prompt":"p"}"#).unwrap();
        assert_eq!(effective_size(&neither), None);
    }

    #[test]
    fn derives_aspect_ratio_from_dimensions() {
        let request =
            VideoGenerationRequest::parse(br#"{"model":"m","prompt":"p","width":1920,"height":1080}"#)
                .expect("request");
        assert_eq!(request.aspect_ratio(), "16:9");
        assert_eq!(request.callback_url(), None);
    }

    /// 方言名与 `interface_format` 的往返。
    ///
    /// 账号里存的就是 `as_str()` 的值，所以这条必须成立——改过名的账号会静默变成
    /// 「方言不认识」，然后在提交时以 `validation.video_interface_format` 报出来，
    /// 症状离根因很远。
    #[test]
    fn interface_format_round_trips_through_the_dialect_table() {
        for dialect in [
            VideoDialect::Kling,
            VideoDialect::Ark,
            VideoDialect::MiniMax,
            VideoDialect::Zhipu,
            VideoDialect::Sora,
        ] {
            assert_eq!(
                dialect_from_interface_format(dialect.as_str()),
                Some(dialect),
                "{} did not round-trip",
                dialect.as_str()
            );
        }
        // 别名要认（手工填 `seedance` 不该失败），落库前由 `as_str()` 归一
        assert_eq!(
            dialect_from_interface_format("seedance"),
            Some(VideoDialect::Ark)
        );
        assert_eq!(
            dialect_from_interface_format("hailuo"),
            Some(VideoDialect::MiniMax)
        );
        // **文本方言不是视频方言**：`openai` / `anthropic` 必须拒绝，否则
        // 文本账号的 `interface_format` 会被误当成某个视频方言。
        assert_eq!(dialect_from_interface_format("openai"), None);
        assert_eq!(dialect_from_interface_format("anthropic"), None);
        assert_eq!(dialect_from_interface_format("gemini"), None);
        assert_eq!(dialect_from_interface_format("openai-responses"), None);
    }

    /// 回调地址校验（SSRF 兜底）。两种部署口径都要覆盖——策略是参数而不是
    /// 常量，就是为了让这一个测试二进制能同时钉住两边。
    #[test]
    fn callback_targets_are_validated_per_policy() {
        use super::{validate_callback_url, CallbackTargetPolicy};
        use CallbackTargetPolicy::{Local, Server};

        for policy in [Local, Server] {
            // 正常公网地址：两种口径都放行
            assert!(validate_callback_url("https://cb.example/hook", policy).is_ok());
            assert!(validate_callback_url("http://203.0.113.7:8080/hook", policy).is_ok());
            assert!(validate_callback_url("https://cb.example./hook", policy).is_ok());

            // 非 http(s) / 根本不是 URL / 空
            for bad in [
                "file:///etc/passwd",
                "gopher://127.0.0.1:6379/_",
                "ftp://example.com/x",
                "not a url",
                "",
                "   ",
            ] {
                assert!(
                    validate_callback_url(bad, policy).is_err(),
                    "{bad:?} must be rejected under {policy:?}"
                );
            }

            // userinfo 把真实主机藏在 `@` 之后
            assert!(validate_callback_url("http://evil.com@169.254.169.254/", policy).is_err());

            // 链路本地 / 云元数据：**任何模式**都不是合法回调目标
            for bad in [
                "http://169.254.169.254/latest/meta-data/",
                "http://169.254.0.1/x",
                "http://metadata.google.internal/x",
                "http://metadata.azure.com/x",
                "http://0.0.0.0/x",
                "http://[::]/x",
                "http://[fe80::1]/x",
                "http://[::ffff:169.254.169.254]/x",
            ] {
                assert!(
                    validate_callback_url(bad, policy).is_err(),
                    "{bad:?} must be rejected under {policy:?}"
                );
            }
        }

        // 回环与私网：本地模式放行（「回调打到本机」是正当用法），服务端模式拒。
        for ok in [
            "http://127.0.0.1:9/hook",
            "http://[::1]:9/hook",
            "http://10.0.0.5/hook",
            "http://192.168.1.4/hook",
            "http://172.16.3.9/hook",
            "http://localhost:9/hook",
            "http://[fd00::1]/hook",
        ] {
            assert!(validate_callback_url(ok, Local).is_ok(), "{ok} must pass Local");
            assert!(
                validate_callback_url(ok, Server).is_err(),
                "{ok} must be rejected under Server"
            );
        }
        // `::ffff:127.0.0.1` 这类映射地址也要按内嵌 v4 判
        assert!(validate_callback_url("http://[::ffff:127.0.0.1]/x", Server).is_err());
        assert!(validate_callback_url("http://[::ffff:10.0.0.1]/x", Server).is_err());
    }
}
