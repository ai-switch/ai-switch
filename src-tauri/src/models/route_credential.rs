use crate::models::route_credential_model::RouteCredentialModelState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

pub const ANTHROPIC_API_KEY_FIELD: &str = "ANTHROPIC_API_KEY";
pub const ANTHROPIC_AUTH_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
pub const DEFAULT_ROUTE_CREDENTIAL_RETRY_COUNT: u32 = 2;
pub const DEFAULT_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS: u32 = 200;
pub const DEFAULT_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD: u32 = 10;
/// Transient-failure backoff is opt-in: a failing account stays immediately
/// selectable unless the user turns cooldown on for it.
pub const DEFAULT_ROUTE_CREDENTIAL_COOLDOWN_ENABLED: bool = false;
/// How long a failing account waits before it may be selected again. Kept
/// short on purpose: a single hiccup should cost seconds, not minutes, and
/// accounts that are really down keep re-triggering the same short window.
pub const DEFAULT_ROUTE_CREDENTIAL_COOLDOWN_SECONDS: u32 = 10;
/// Flipping an account to `error` stays on by default — the streak conditions
/// are strict enough that reaching them usually means the account is dead.
pub const DEFAULT_ROUTE_CREDENTIAL_ERROR_STATUS_ENABLED: bool = true;
/// Concurrency ceiling given to a freshly created account.
///
/// The column default is still 1 (changing it would mean rebuilding the table),
/// so every insert path binds this value explicitly.
pub const DEFAULT_ROUTE_CREDENTIAL_MAX_CONCURRENCY: i64 = 5;
pub const DEFAULT_ROUTE_CREDENTIAL_PRIORITY: i64 = 3;
pub const MAX_ROUTE_CREDENTIAL_RETRY_COUNT: u32 = 10;
pub const MAX_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS: u32 = 60_000;
pub const MAX_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD: u32 = 1_000;
pub const MAX_ROUTE_CREDENTIAL_COOLDOWN_SECONDS: u32 = 86_400;
/// Whether the gateway re-asks the upstream after a stream that delivered data
/// but never terminated.
///
/// Off by default. Continuing costs a second, fully billed upstream call and
/// hands the client an answer the model never wrote in one piece; the alternative
/// is a visible truncation the user can react to. Making it opt-in keeps that
/// spend and that seam a decision the account owner makes per channel, which is
/// where the difference actually lives — relays disconnect often, first-party
/// endpoints almost never.
pub const DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_ENABLED: bool = false;
/// How many continuation rounds one account may spend on a single client
/// request. Every round is a real, billed upstream call, so the ceiling is kept
/// in the same 0–10 band as `retry_count`.
pub const DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX: u32 = 10;
pub const MAX_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX: u32 = 10;
/// Whether a failure may move the request to another account in the pool. On by
/// default — it is what makes a pool worth having — but some setups would
/// rather surface the failing account's own error than answer from a different
/// credential (a pooled conversation whose reasoning was minted elsewhere is
/// refused outright, and cost is easier to attribute per account).
pub const DEFAULT_ROUTE_CREDENTIAL_FAILOVER_ENABLED: bool = true;
/// Per-class retry ceilings are deliberately allowed to be far larger than the
/// global one. A drained upstream pool ("no_capacity" / high demand) is not an
/// account fault: the user may want to keep the task alive through a hundred
/// retries, while ordinary errors must still stop after a handful.
pub const MAX_ROUTE_CREDENTIAL_CLASS_RETRY_COUNT: u32 = 1_000;
/// `0` means "use the global `retry_interval_ms`". A high capacity retry count
/// with a 200 ms interval would hammer the upstream, so the UI exposes this.
pub const DEFAULT_ROUTE_CREDENTIAL_CAPACITY_RETRY_INTERVAL_MS: u32 = 0;
pub const MAX_ROUTE_CREDENTIAL_CAPACITY_RETRY_INTERVAL_MS: u32 = 60_000;
/// Wall-clock guard for long retry loops. `0` means no time limit.
pub const DEFAULT_ROUTE_CREDENTIAL_MAX_RETRY_ELAPSED_SECONDS: u32 = 0;
pub const MAX_ROUTE_CREDENTIAL_MAX_RETRY_ELAPSED_SECONDS: u32 = 86_400;
/// How long a zero-output Responses opening frame (`response.created` /
/// `response.in_progress`) may be held back before the 200 is committed.
///
/// Upstreams that are about to refuse a turn for capacity reasons often emit
/// `response.created` first and only report the `error` / `response.failed`
/// frames many seconds later (a real Azure "token rate limit" refusal took 14s).
/// The old hard-coded 3s grace committed the stream before that verdict arrived,
/// which made the failure unretryable. `0` disables the hold-back entirely.
pub const DEFAULT_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS: u32 = 60_000;
pub const MAX_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS: u32 = 600_000;
/// Default for "salvage an in-stream refusal by continuing the same response".
/// Off by default: continuing spends another billed request and the client
/// receives an answer the model did not write in one pass.
pub const DEFAULT_ROUTE_CREDENTIAL_STREAM_SALVAGE_ENABLED: bool = false;

/// Buckets a single failed attempt falls into. Only these five are retryable;
/// the hard verdicts (quota, permissions, content policy, oversized request,
/// invalid parameter, 401/403) are handled before the retry budget is consulted
/// and can never be configured into retrying.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteFailureClass {
    /// No HTTP response at all: connect failure, timeout, read failure.
    Transport,
    /// HTTP 408 / 5xx from the upstream.
    ServerError,
    /// HTTP 429 or an explicit rate-limit error envelope.
    RateLimit,
    /// Upstream capacity/overload, including a 200 SSE `response.failed` with
    /// `code: no_capacity` or a "high demand" message.
    Capacity,
    /// Any other in-body semantic failure (`response.failed`, `/error`, ...).
    Semantic,
    /// A retryable status that does not fit the buckets above.
    Other,
}

/// Optional per-class overrides for `retry_count`. `None` means "follow the
/// global `retry_count`", which keeps every existing account config valid and
/// unchanged when read back.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RouteRetryClassLimits {
    pub transport: Option<u32>,
    pub server_error: Option<u32>,
    pub rate_limit: Option<u32>,
    pub capacity: Option<u32>,
    pub semantic: Option<u32>,
}

impl RouteRetryClassLimits {
    pub fn for_class(self, class: RouteFailureClass) -> Option<u32> {
        match class {
            RouteFailureClass::Transport => self.transport,
            RouteFailureClass::ServerError => self.server_error,
            RouteFailureClass::RateLimit => self.rate_limit,
            RouteFailureClass::Capacity => self.capacity,
            RouteFailureClass::Semantic => self.semantic,
            RouteFailureClass::Other => None,
        }
    }

    fn validate(&self) -> Result<(), String> {
        for (name, limit) in [
            ("transport", self.transport),
            ("server_error", self.server_error),
            ("rate_limit", self.rate_limit),
            ("capacity", self.capacity),
            ("semantic", self.semantic),
        ] {
            if limit.is_some_and(|value| value > MAX_ROUTE_CREDENTIAL_CLASS_RETRY_COUNT) {
                return Err(format!(
                    "retry_class_limits.{name} must be between 0 and {MAX_ROUTE_CREDENTIAL_CLASS_RETRY_COUNT}"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct RouteCredentialFailurePolicy {
    pub retry_count: u32,
    pub retry_interval_ms: u32,
    pub semantic_error_threshold: u32,
    pub cooldown_enabled: bool,
    pub cooldown_seconds: u32,
    pub error_status_enabled: bool,
    /// 流式上游中途断掉时，是否由网关自动续写（把结果接回同一条 response）。
    /// 默认关闭：续写是一次完整的计费请求，且交给客户端的是模型并非一次写成的
    /// 答案，是否值得由每个账号自己定。
    pub stream_continue_enabled: bool,
    /// 该账号允许的最大续写轮次；0 等同于关闭。
    pub stream_continue_max: u32,
    /// 重试/续写都失败后，是否切到池内其它账号。仅聚合模式有意义——精确模式下
    /// 候选本来只有这一个账号。
    pub failover_enabled: bool,
    /// 按错误类别覆盖「额外重试次数」；字段为 null/缺失即沿用 retry_count。
    pub retry_class_limits: RouteRetryClassLimits,
    /// 容量不足类失败专用的重试间隔；0 表示沿用 retry_interval_ms。
    pub capacity_retry_interval_ms: u32,
    /// 整次请求的重试总时长上限（秒）；0 表示只按次数限制，不按时间。
    pub max_retry_elapsed_seconds: u32,
    /// 流式响应开头只有零输出的 Responses 建流帧时，最多扣住多久等后续帧。
    /// 0 表示不扣留（收到建流帧立刻提交），单位毫秒。
    pub stream_prelude_wait_ms: u32,
    /// 已经输出正文后上游才在流内报「容量不足 / 限流 / 5xx」时，是否扣住失败帧
    /// 并复用断流续写管线把这一轮接完。默认关闭：客户端拿到的是模型分多次写成
    /// 的答案，且每轮续写都是一次完整计费请求。额度、内容审核、上下文超长等
    /// 硬判决永远不进入这条路径。
    pub stream_salvage_enabled: bool,
}

impl Default for RouteCredentialFailurePolicy {
    fn default() -> Self {
        Self {
            retry_count: DEFAULT_ROUTE_CREDENTIAL_RETRY_COUNT,
            retry_interval_ms: DEFAULT_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS,
            semantic_error_threshold: DEFAULT_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD,
            cooldown_enabled: DEFAULT_ROUTE_CREDENTIAL_COOLDOWN_ENABLED,
            cooldown_seconds: DEFAULT_ROUTE_CREDENTIAL_COOLDOWN_SECONDS,
            error_status_enabled: DEFAULT_ROUTE_CREDENTIAL_ERROR_STATUS_ENABLED,
            stream_continue_enabled: DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_ENABLED,
            stream_continue_max: DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX,
            failover_enabled: DEFAULT_ROUTE_CREDENTIAL_FAILOVER_ENABLED,
            retry_class_limits: RouteRetryClassLimits::default(),
            capacity_retry_interval_ms: DEFAULT_ROUTE_CREDENTIAL_CAPACITY_RETRY_INTERVAL_MS,
            max_retry_elapsed_seconds: DEFAULT_ROUTE_CREDENTIAL_MAX_RETRY_ELAPSED_SECONDS,
            stream_prelude_wait_ms: DEFAULT_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS,
            stream_salvage_enabled: DEFAULT_ROUTE_CREDENTIAL_STREAM_SALVAGE_ENABLED,
        }
    }
}

impl RouteCredentialFailurePolicy {
    pub fn from_config_json(config_json: &str) -> Self {
        serde_json::from_str::<Value>(config_json)
            .ok()
            .and_then(|config| Self::from_config_value(&config).ok())
            .unwrap_or_default()
    }

    pub fn from_config_value(config: &Value) -> Result<Self, String> {
        let Some(raw_policy) = config.get("failure_policy") else {
            return Ok(Self::default());
        };
        let policy = serde_json::from_value::<Self>(raw_policy.clone())
            .map_err(|error| format!("failure_policy must contain integer values: {error}"))?;
        policy.validate()?;
        Ok(policy)
    }

    /// How many *additional* attempts the same account may spend on this class.
    /// A class without an explicit override inherits the global `retry_count`.
    pub fn retry_limit_for(&self, class: RouteFailureClass) -> u32 {
        self.retry_class_limits
            .for_class(class)
            .unwrap_or(self.retry_count)
    }

    /// Per-class backoff. Capacity has its own dial because a hundred retries
    /// at the global 200 ms interval would be a burst, not a wait.
    pub fn retry_interval_for(&self, class: RouteFailureClass) -> std::time::Duration {
        let millis = match class {
            RouteFailureClass::Capacity if self.capacity_retry_interval_ms > 0 => {
                self.capacity_retry_interval_ms
            }
            _ => self.retry_interval_ms,
        };
        std::time::Duration::from_millis(millis.into())
    }

    /// True once the whole request has been retrying longer than the configured
    /// wall-clock ceiling. Kept separate from the per-attempt count so a high
    /// class ceiling can never pin a client connection open indefinitely.
    pub fn retry_elapsed_exceeded(&self, elapsed: std::time::Duration) -> bool {
        self.max_retry_elapsed_seconds > 0
            && elapsed >= std::time::Duration::from_secs(self.max_retry_elapsed_seconds.into())
    }

    /// Total time the proxy may keep a zero-output Responses opening frame to
    /// itself while waiting for either the first output or a failure frame.
    /// `None` means the hold-back is switched off: commit the announcement at
    /// once, which restores the pre-hold-back behaviour for upstreams that
    /// legitimately sit on `response.created` for minutes.
    pub fn stream_prelude_wait(&self) -> Option<std::time::Duration> {
        (self.stream_prelude_wait_ms > 0)
            .then(|| std::time::Duration::from_millis(self.stream_prelude_wait_ms.into()))
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.retry_count > MAX_ROUTE_CREDENTIAL_RETRY_COUNT {
            return Err(format!(
                "retry_count must be between 0 and {MAX_ROUTE_CREDENTIAL_RETRY_COUNT}"
            ));
        }
        if self.retry_interval_ms > MAX_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS {
            return Err(format!(
                "retry_interval_ms must be between 0 and {MAX_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS}"
            ));
        }
        if self.cooldown_seconds == 0
            || self.cooldown_seconds > MAX_ROUTE_CREDENTIAL_COOLDOWN_SECONDS
        {
            return Err(format!(
                "cooldown_seconds must be between 1 and {MAX_ROUTE_CREDENTIAL_COOLDOWN_SECONDS}"
            ));
        }
        if self.semantic_error_threshold == 0
            || self.semantic_error_threshold > MAX_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD
        {
            return Err(format!(
                "semantic_error_threshold must be between 1 and {MAX_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD}"
            ));
        }
        if self.stream_continue_max > MAX_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX {
            return Err(format!(
                "stream_continue_max must be between 0 and {MAX_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX}"
            ));
        }
        if self.capacity_retry_interval_ms > MAX_ROUTE_CREDENTIAL_CAPACITY_RETRY_INTERVAL_MS {
            return Err(format!(
                "capacity_retry_interval_ms must be between 0 and {MAX_ROUTE_CREDENTIAL_CAPACITY_RETRY_INTERVAL_MS}"
            ));
        }
        if self.max_retry_elapsed_seconds > MAX_ROUTE_CREDENTIAL_MAX_RETRY_ELAPSED_SECONDS {
            return Err(format!(
                "max_retry_elapsed_seconds must be between 0 and {MAX_ROUTE_CREDENTIAL_MAX_RETRY_ELAPSED_SECONDS}"
            ));
        }
        if self.stream_prelude_wait_ms > MAX_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS {
            return Err(format!(
                "stream_prelude_wait_ms must be between 0 and {MAX_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS}"
            ));
        }
        self.retry_class_limits.validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountProvider {
    Custom,
    OpenRouter,
    PackyCode,
    AgentRouter,
    OpenAi,
    Claude,
    Gemini,
    Grok,
}

impl AccountProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Custom => "custom",
            Self::OpenRouter => "openrouter",
            Self::PackyCode => "packycode",
            Self::AgentRouter => "agentrouter",
            Self::OpenAi => "openai",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Grok => "grok",
        }
    }

    pub fn parse_api(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "custom" => Some(Self::Custom),
            "openrouter" => Some(Self::OpenRouter),
            "packycode" => Some(Self::PackyCode),
            "agentrouter" => Some(Self::AgentRouter),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
pub struct RouteCredential {
    pub id: String,
    pub platform: String,
    pub kind: String,
    /// 账号来源，与统一池身份和上游线协议分别存储。
    #[serde(default)]
    #[sqlx(default)]
    pub provider: String,
    pub display_name: String,
    pub email: Option<String>,
    pub status: String,
    pub sort_order: i64,
    pub route_priority: i64,
    pub max_concurrency: i64,
    pub batch_id: Option<String>,
    #[sqlx(default)]
    pub batch_name: Option<String>,
    pub secret_payload_json: String,
    pub config_json: String,
    pub preview_json: String,
    pub subscription_type: Option<String>,
    pub primary_remain: Option<i64>,
    pub weekly_remain: Option<i64>,
    pub reset_primary: Option<String>,
    pub reset_weekly: Option<String>,
    #[sqlx(default)]
    pub transient_failure_count: i64,
    #[sqlx(default)]
    pub next_retry_at: Option<String>,
    #[sqlx(default)]
    pub cooldown_until: Option<String>,
    #[sqlx(default)]
    pub last_failure_kind: Option<String>,
    #[sqlx(default)]
    pub last_failure_message: Option<String>,
    #[sqlx(default)]
    pub last_failure_response_json: Option<String>,
    #[sqlx(default)]
    pub active_request_count: i64,
    /// Per-model failure state, one entry per known model. Filled by the service
    /// layer from `route_credential_models` plus the account's mappings, so a
    /// healthy model the user may want to pause is listed too.
    #[sqlx(skip)]
    #[serde(default)]
    pub model_states: Vec<RouteCredentialModelState>,
    #[sqlx(default)]
    pub request_count: i64,
    #[sqlx(default)]
    pub success_count: i64,
    #[sqlx(default)]
    pub failure_count: i64,
    #[sqlx(default)]
    pub success_rate: Option<f64>,
    /// Duration in milliseconds of the most recent request (success or failure).
    #[sqlx(default)]
    pub last_duration_ms: Option<i64>,
    /// Average duration in milliseconds of the most recent 10 successful requests.
    #[sqlx(default)]
    pub avg_recent_duration_ms: Option<f64>,
    // Legacy single-window fields kept for existing DBs/migrations.
    pub quota_remaining: Option<i64>,
    pub quota_limit: Option<i64>,
    pub quota_used: Option<i64>,
    pub quota_updated_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight projection used by the auto-recovery scheduler to evaluate each
/// account's recovery rule without loading the full aggregate row.
#[derive(Debug, Clone, FromRow, PartialEq, Eq)]
pub struct RecoveryCandidate {
    pub id: String,
    pub platform: String,
    pub status: String,
    pub config_json: String,
    pub next_retry_at: Option<String>,
    pub cooldown_until: Option<String>,
    /// 1 when the account has non-paused model rows. An account can look healthy
    /// at the account level while one of its models is parked, and that case must
    /// still reach the scheduler.
    pub has_model_failures: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateApiRouteCredentialInput {
    pub platform: String,
    #[serde(default)]
    pub provider: Option<String>,
    pub display_name: String,
    pub api_key: String,
    pub base_url: String,
    pub interface_format: String,
    pub model_mappings_json: String, // JSON array
    #[serde(default)]
    pub fetched_models_json: Option<String>,
    #[serde(default)]
    pub api_key_field: Option<String>,
    pub preview_json: Option<String>,
    pub batch_id: Option<String>,
    #[serde(default)]
    pub responses_custom_tool_compat: Option<bool>,
    /// None/auto 跟随已验证的上游名单，off 优先于名单；仅影响出站明文推理。
    #[serde(default)]
    pub responses_plaintext_reasoning_compat: Option<String>,
    /// None/auto follows the verified site list; explicit off overrides it.
    #[serde(default)]
    pub request_brotli_compression: Option<String>,
    #[serde(default)]
    pub responses_encrypted_content_cleanup: Option<bool>,
    /// None/auto follows the verified site list; explicit off overrides it.
    /// Strips resource-bound Responses state (item ids, `encrypted*` fields,
    /// `previous_response_id`) so a multi-resource Azure relay can serve the
    /// replayed history from any resource.
    #[serde(default)]
    pub responses_cross_resource_strip: Option<String>,
    /// Sub-switch of `responses_encrypted_content_cleanup`: strip even
    /// well-formed reasoning ciphertext instead of only malformed values.
    #[serde(default)]
    pub responses_encrypted_content_aggressive_strip: Option<bool>,
    /// Always send `reasoning_content` on assistant turns of a Responses→Chat
    /// request instead of waiting to be told it is missing.治 11155.
    #[serde(default)]
    pub force_reasoning_content: Option<bool>,
    /// 账号级内容过滤兼容。只允许 `trim_old_tool_outputs`；缺失或 `off`
    /// 表示关闭，编辑时由客户端删除该键。
    #[serde(default)]
    pub content_rejection_compat: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    /// Which relay panel dialect the account's balance is read with. Only the
    /// provider name is settable at creation time; the custom variant's endpoint
    /// and paths are configured from the edit drawer afterwards.
    #[serde(default)]
    pub relay_balance_provider: Option<String>,
    /// The relay panel account's access token, for reading an account balance the
    /// key's own (uncapped) usage endpoint cannot report. Travels with creation
    /// rather than waiting for the edit drawer because a new-api account without it
    /// reports "余额 不限" — which is the reading it exists to replace.
    #[serde(default)]
    pub relay_balance_access_token: Option<String>,
    /// The numeric panel user id that goes with the access token, which New API's
    /// stable line requires as a `New-Api-User` header.
    #[serde(default)]
    pub relay_balance_access_token_user_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CopyRouteCredentialInput {
    #[serde(default)]
    pub target_platform: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

/// Placeholder that replaces `secret_payload_json` in responses to anything short
/// of the primary web token (see `web::auth::WebAuthLevel`).
///
/// `RouteCredentialService::update` treats an incoming payload still carrying the
/// marker as "keep what is stored", so a client that was shown the mask cannot
/// write it back over the real key.
pub const MASKED_SECRET_PAYLOAD: &str = r#"{"__masked":true}"#;

/// Marker key inside [`MASKED_SECRET_PAYLOAD`].
const MASKED_SECRET_MARKER: &str = "__masked";

/// Whether a payload is a masked placeholder rather than a real secret.
///
/// This deliberately matches on the marker key instead of comparing the whole
/// string: the edit drawer re-serializes what it loaded and merges the (empty)
/// api_key field back in, so the payload that comes back from a masked client is
/// `{"__masked":true,"api_key":""}` rather than the constant. Comparing strings
/// would let that shape through and blank out the stored key.
pub fn is_masked_secret_payload(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| {
            value
                .get(MASKED_SECRET_MARKER)
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(false)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateRouteCredentialInput {
    #[serde(default)]
    pub provider: Option<String>,
    pub display_name: String,
    pub email: Option<String>,
    pub status: String,
    pub route_priority: i64,
    pub max_concurrency: i64,
    pub secret_payload_json: String,
    pub config_json: String,
    pub preview_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportOfficialTextInput {
    pub platform: String,
    pub text: String,
    pub batch_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportOfficialFilesInput {
    pub platform: String,
    pub file_paths: Vec<String>,
    pub batch_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteCredentialImportFailure {
    pub label: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteCredentialImportResult {
    pub imported: Vec<RouteCredential>,
    pub failed: Vec<RouteCredentialImportFailure>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteCredentialPoolScope {
    InPool,
    OutOfPool,
    Archived,
}

impl Default for RouteCredentialPoolScope {
    fn default() -> Self {
        Self::OutOfPool
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteCredentialPageRequest {
    pub platform: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    pub page: i64,
    pub page_size: i64,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub pool_scope: RouteCredentialPoolScope,
    #[serde(default)]
    pub group_id: Option<String>,
    /// 只读多组合并视图：成员属于**任一**列出分组即命中。备份分组用——
    /// 与 `group_id` 互斥，显式空列表会被拒绝（不能静默退回全池）。
    /// 计数、条目与翻页边界共用同一谓词，分页语义与单组查询完全一致。
    #[serde(default)]
    pub group_ids: Option<Vec<String>>,
    /// 只保留「声明了该能力」的账号 —— 即 `config_json.model_mappings[*].capabilities`
    /// 里含它（大小写不敏感）。codex 页的模态分段器用它把**生图账号**从池里筛出来。
    ///
    /// 与 `filters`（批次）正交：那是「哪个批次」，这是「哪种模态」。两者是 AND。
    ///
    /// 为什么过滤放在服务端而不是前端：分页在服务端做（`page` / `total` / `page_count`
    /// 都是 SQL 算出来的），前端过滤会让总数与页数失真。
    #[serde(default)]
    pub capability: Option<String>,
}

impl RouteCredentialPageRequest {
    pub fn normalized_page_size(&self) -> Result<i64, String> {
        match self.page_size {
            20 | 50 | 100 => Ok(self.page_size),
            _ => Err("page_size must be 20, 50, or 100".to_string()),
        }
    }

    pub fn normalized_page(&self) -> i64 {
        self.page.max(1)
    }

    /// 多组与单组互斥；显式空列表不是「全池」，直接拒绝。
    pub fn validate_group_selection(&self) -> Result<(), String> {
        if self.group_ids.is_some() && self.group_id.is_some() {
            return Err("group_ids and group_id are mutually exclusive".to_string());
        }
        if self.group_ids.as_ref().is_some_and(|ids| ids.is_empty()) {
            return Err("group_ids must not be empty".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteCredentialFilterOption {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteCredentialPage {
    pub items: Vec<RouteCredential>,
    pub total: i64,
    pub page: i64,
    pub page_count: i64,
    pub page_size: i64,
    pub previous_page_account_id: Option<String>,
    pub next_page_account_id: Option<String>,
    pub filter_options: Vec<RouteCredentialFilterOption>,
    pub official_account_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReorderRouteCredentialInput {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub platform: String,
    pub moved_account_id: String,
    pub previous_account_id: Option<String>,
    pub next_account_id: Option<String>,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub pool_scope: RouteCredentialPoolScope,
    pub page_size: i64,
    /// 与 `RouteCredentialPageRequest::capability` 同义：拖拽排序后要回**同一批**
    /// 账号，少了它，模态段里拖一次就会跳回不带过滤的整页。
    #[serde(default)]
    pub capability: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelMapping {
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    /// `None` follows the shared built-in model table; `Some(true/false)` is the
    /// user's explicit override and must survive a reload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_image_input: Option<bool>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_1m: Option<bool>,
    /// Codex-only: the context window (in tokens) advertised for this alias.
    /// `None` means "use the platform default" — Claude declares its 1M tier
    /// through `supports_1m` instead, so the two never apply to one platform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    /// Codex-only: the reasoning efforts advertised for this alias. `None` means
    /// "use the baseline profile for this model id", which is what every mapping
    /// written before this field existed relies on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_levels: Option<Vec<String>>,
}

/// Catch-all `from` alias: the account accepts any requested model and rewrites
/// it to this entry's `to` when no specific mapping matched. Not a model id, so
/// it is never advertised. The routing code is platform-agnostic even though the
/// name reads Claude-specific — only the Claude editor offers the row.
///
/// It shares the `claude-` prefix with the real role aliases, which means
/// `claude_route_lookup_model` treats it as a Claude route model. That is inert
/// only because both `supports_requested_model` and `resolve_mapping_target`
/// test `is_fallback_mapping` before they ever reach `model_mapping_matches` —
/// drop either guard and the catch-all starts matching by name.
pub const FALLBACK_MODEL_ALIAS: &str = "claude-model";

/// Generic alias written into Claude Code's `CLAUDE_CODE_SUBAGENT_MODEL`. It is
/// a real routable alias — the pool rewrites it per account — so unlike the
/// fallback it *is* advertised.
pub const CLAUDE_SUBAGENT_MODEL_ALIAS: &str = "claude-subagent";

/// The four model slots Claude Code exposes in its `/model` menu. Each pins the
/// generic alias the client should request; the proxy then rewrites that alias
/// per account. Writing them makes the client→proxy contract explicit instead of
/// relying on Claude Code's built-in defaults happening to match our mapping
/// keys — a client-side version bump would otherwise strand every account.
pub const CLAUDE_MODEL_SLOTS: &[ClaudeModelSlot] = &[
    ClaudeModelSlot {
        alias: "claude-sonnet-alias",
        model_env_key: "ANTHROPIC_DEFAULT_SONNET_MODEL",
        name_env_key: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    },
    ClaudeModelSlot {
        alias: "claude-opus-alias",
        model_env_key: "ANTHROPIC_DEFAULT_OPUS_MODEL",
        name_env_key: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    },
    ClaudeModelSlot {
        alias: "claude-fable-alias",
        model_env_key: "ANTHROPIC_DEFAULT_FABLE_MODEL",
        name_env_key: "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
    },
    ClaudeModelSlot {
        alias: "claude-haiku-alias",
        model_env_key: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        name_env_key: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaudeModelSlot {
    pub alias: &'static str,
    pub model_env_key: &'static str,
    pub name_env_key: &'static str,
}

/// Suffix Claude Code appends to a model value to request the 1M context window.
pub const CLAUDE_ONE_M_SUFFIX: &str = "[1M]";

/// What to write for one `/model` slot. `None` for either field clears that key.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeSlotWrite {
    /// Alias plus the `[1M]` suffix when every pool account supports it.
    pub model: Option<String>,
    /// Display name shown in the `/model` menu, when the pool agrees on one.
    pub display_name: Option<String>,
}

pub fn is_fallback_mapping(mapping: &ModelMapping) -> bool {
    mapping.from.trim() == FALLBACK_MODEL_ALIAS
}

/// Aliases this app invents rather than receives from a vendor.
pub fn is_synthetic_route_alias(model: &str) -> bool {
    let model = model.trim();
    model == FALLBACK_MODEL_ALIAS || model == CLAUDE_SUBAGENT_MODEL_ALIAS
}

pub fn normalize_anthropic_api_key_field(value: Option<&str>) -> Result<&'static str, String> {
    match value.map(str::trim).filter(|item| !item.is_empty()) {
        None => Ok(ANTHROPIC_API_KEY_FIELD),
        Some(ANTHROPIC_API_KEY_FIELD) => Ok(ANTHROPIC_API_KEY_FIELD),
        Some(ANTHROPIC_AUTH_TOKEN_FIELD) => Ok(ANTHROPIC_AUTH_TOKEN_FIELD),
        Some(other) => Err(format!(
            "Unsupported Anthropic api_key_field: {other}. Expected {ANTHROPIC_API_KEY_FIELD} or {ANTHROPIC_AUTH_TOKEN_FIELD}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        RouteCredentialFailurePolicy, RouteFailureClass,
        DEFAULT_ROUTE_CREDENTIAL_COOLDOWN_SECONDS, DEFAULT_ROUTE_CREDENTIAL_RETRY_COUNT,
        DEFAULT_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS, DEFAULT_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD,
        DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX,
        DEFAULT_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS, MAX_ROUTE_CREDENTIAL_CLASS_RETRY_COUNT,
        MAX_ROUTE_CREDENTIAL_COOLDOWN_SECONDS, MAX_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX,
        MAX_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS,
    };
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn failure_policy_uses_defaults_for_existing_account_configs() {
        assert_eq!(
            RouteCredentialFailurePolicy::from_config_json(r#"{"base_url":"https://example.com"}"#),
            RouteCredentialFailurePolicy::default()
        );
    }

    #[test]
    fn failure_policy_supports_partial_account_overrides() {
        let policy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "retry_count": 4 }
        }))
        .expect("policy");

        assert_eq!(policy.retry_count, 4);
        assert_eq!(
            policy.retry_interval_ms,
            DEFAULT_ROUTE_CREDENTIAL_RETRY_INTERVAL_MS
        );
        assert_eq!(
            policy.semantic_error_threshold,
            DEFAULT_ROUTE_CREDENTIAL_SEMANTIC_ERROR_THRESHOLD
        );
        assert_ne!(policy.retry_count, DEFAULT_ROUTE_CREDENTIAL_RETRY_COUNT);
    }

    #[test]
    fn failure_policy_cooldown_seconds_defaults_to_ten_for_existing_configs() {
        let policy = RouteCredentialFailurePolicy::from_config_json(
            r#"{"failure_policy":{"retry_count":1}}"#,
        );

        assert_eq!(policy.cooldown_seconds, 10);
        assert_eq!(
            policy.cooldown_seconds,
            DEFAULT_ROUTE_CREDENTIAL_COOLDOWN_SECONDS
        );
    }

    #[test]
    fn failure_policy_keeps_configured_cooldown_seconds() {
        let policy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "cooldown_seconds": 45 }
        }))
        .expect("policy");

        assert_eq!(policy.cooldown_seconds, 45);
    }

    #[test]
    fn failure_policy_rejects_cooldown_seconds_outside_safe_bounds() {
        let zero = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "cooldown_seconds": 0 }
        }))
        .expect_err("zero cooldown");
        assert!(zero.contains("cooldown_seconds"));

        let too_long = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "cooldown_seconds": MAX_ROUTE_CREDENTIAL_COOLDOWN_SECONDS + 1 }
        }))
        .expect_err("cooldown above ceiling");
        assert!(too_long.contains("cooldown_seconds"));
    }

    #[test]
    fn failure_policy_rejects_values_outside_safe_bounds() {
        let error = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "semantic_error_threshold": 0 }
        }))
        .expect_err("invalid policy");

        assert!(error.contains("semantic_error_threshold"));
    }

    /// 老账号的 config_json 里没有这三个字段时的落点：续写默认关闭、预算沿用
    /// 10 轮、失败照旧允许切号。
    #[test]
    fn stream_continue_and_failover_defaults_cover_accounts_without_the_keys() {
        let policy =
            RouteCredentialFailurePolicy::from_config_json(r#"{"base_url":"https://example.com"}"#);
        assert!(!policy.stream_continue_enabled);
        assert_eq!(
            policy.stream_continue_max,
            DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX
        );
        assert!(policy.failover_enabled);

        let partial = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "retry_count": 4 }
        }))
        .expect("policy");
        assert!(!partial.stream_continue_enabled);
        assert_eq!(
            partial.stream_continue_max,
            DEFAULT_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX
        );
        assert!(partial.failover_enabled);
    }

    /// 关掉是默认值，所以「打开」必须能被显式写出来并被读到。
    #[test]
    fn an_account_can_opt_into_continuation_explicitly() {
        let policy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {
                "stream_continue_enabled": true,
                "stream_continue_max": 3,
                "failover_enabled": false,
            }
        }))
        .expect("policy");
        assert!(policy.stream_continue_enabled);
        assert_eq!(policy.stream_continue_max, 3);
        assert!(!policy.failover_enabled);
    }

    /// 续写是真实计费请求，超出上限必须拒绝，不能默默放大。
    #[test]
    fn stream_continue_max_rejects_values_above_the_ceiling() {
        let error = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": { "stream_continue_max": MAX_ROUTE_CREDENTIAL_STREAM_CONTINUE_MAX + 1 }
        }))
        .expect_err("above ceiling");
        assert!(error.contains("stream_continue_max"));

        assert!(
            RouteCredentialFailurePolicy::from_config_value(&json!({
                "failure_policy": { "stream_continue_max": 0 }
            }))
            .is_ok(),
            "0 must stay legal: it is how an account turns continuation off"
        );
    }

    /// Old accounts have none of the new keys; reading them must be a no-op.
    #[test]
    fn existing_failure_policies_inherit_global_retry_settings() {
        let policy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"retry_count": 4, "retry_interval_ms": 750}
        }))
        .expect("legacy policy");
        assert_eq!(policy.retry_limit_for(RouteFailureClass::Capacity), 4);
        assert_eq!(
            policy.retry_interval_for(RouteFailureClass::Capacity),
            Duration::from_millis(750)
        );
        assert!(!policy.retry_elapsed_exceeded(Duration::from_secs(86_400)));
    }

    #[test]
    fn a_class_can_outlive_the_global_ceiling_without_changing_other_classes() {
        let policy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {
                "retry_count": 2,
                "retry_interval_ms": 200,
                "retry_class_limits": {"capacity": 100, "transport": 0},
                "capacity_retry_interval_ms": 5_000,
                "max_retry_elapsed_seconds": 600
            }
        }))
        .expect("per-class policy");
        assert_eq!(policy.retry_count, 2);
        assert_eq!(policy.retry_limit_for(RouteFailureClass::Capacity), 100);
        assert_eq!(policy.retry_limit_for(RouteFailureClass::Transport), 0);
        assert_eq!(policy.retry_limit_for(RouteFailureClass::Semantic), 2);
        assert_eq!(policy.retry_limit_for(RouteFailureClass::RateLimit), 2);
        assert_eq!(policy.retry_limit_for(RouteFailureClass::ServerError), 2);
        assert_eq!(
            policy.retry_interval_for(RouteFailureClass::Capacity),
            Duration::from_millis(5_000)
        );
        assert_eq!(
            policy.retry_interval_for(RouteFailureClass::Semantic),
            Duration::from_millis(200)
        );
        assert!(policy.retry_elapsed_exceeded(Duration::from_secs(600)));
        assert!(!policy.retry_elapsed_exceeded(Duration::from_secs(599)));
    }

    #[test]
    fn per_class_limits_reject_values_above_the_safe_ceiling() {
        let too_high = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {
                "retry_class_limits": {"capacity": MAX_ROUTE_CREDENTIAL_CLASS_RETRY_COUNT + 1}
            }
        }))
        .expect_err("above ceiling");
        assert!(too_high.contains("retry_class_limits.capacity"));

        let bad_interval = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"capacity_retry_interval_ms": 60_001}
        }))
        .expect_err("above interval ceiling");
        assert!(bad_interval.contains("capacity_retry_interval_ms"));
    }

    /// A refusal that arrives 14s after `response.created` must still be
    /// retriable: the old hard-coded 3s grace committed the stream first.
    #[test]
    fn stream_prelude_wait_defaults_to_a_window_longer_than_slow_refusals() {
        let policy = RouteCredentialFailurePolicy::default();
        assert_eq!(
            policy.stream_prelude_wait(),
            Some(Duration::from_millis(
                DEFAULT_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS.into()
            ))
        );
        assert!(policy.stream_prelude_wait().unwrap() > Duration::from_secs(14));
        // Legacy configs stay valid and get the new default.
        let legacy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"retry_count": 3}
        }))
        .expect("legacy policy");
        assert_eq!(legacy.stream_prelude_wait(), policy.stream_prelude_wait());
    }

    #[test]
    fn stream_prelude_wait_is_configurable_and_can_be_disabled() {
        let tuned = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"stream_prelude_wait_ms": 1_500}
        }))
        .expect("tuned policy");
        assert_eq!(tuned.stream_prelude_wait(), Some(Duration::from_millis(1_500)));

        let disabled = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"stream_prelude_wait_ms": 0}
        }))
        .expect("disabled policy");
        assert_eq!(disabled.stream_prelude_wait(), None);

        let too_long = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {
                "stream_prelude_wait_ms": MAX_ROUTE_CREDENTIAL_STREAM_PRELUDE_WAIT_MS + 1
            }
        }))
        .expect_err("above ceiling");
        assert!(too_long.contains("stream_prelude_wait_ms"));
    }

    /// Salvaging an in-stream refusal is opt-in: upgrading from an older
    /// release must not silently start spending extra billed requests.
    #[test]
    fn stream_salvage_is_off_by_default_and_opt_in() {
        assert!(!RouteCredentialFailurePolicy::default().stream_salvage_enabled);
        let legacy = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"retry_count": 3}
        }))
        .expect("legacy policy");
        assert!(!legacy.stream_salvage_enabled);

        let enabled = RouteCredentialFailurePolicy::from_config_value(&json!({
            "failure_policy": {"stream_salvage_enabled": true}
        }))
        .expect("enabled policy");
        assert!(enabled.stream_salvage_enabled);
    }
}
