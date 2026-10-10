use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// 视频渠道方言。与 `videogen::protocol::VideoDialect` 是同一套取值，但放在这里
/// 是为了让 `PlatformId::Video` 能携带协议段而**不产生循环依赖**
/// （`videogen` 依赖 `models`，不能反过来）。
///
/// 两边靠 `parse`/`as_str` 的字面量保持一致；`videogen` 侧有 `From` 互转测试
/// 兜住这个约束。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum VideoProtocol {
    Kling,
    Ark,
    MiniMax,
    Zhipu,
    Sora,
}

impl VideoProtocol {
    pub const ALL: [Self; 5] = [
        Self::Kling,
        Self::Ark,
        Self::MiniMax,
        Self::Zhipu,
        Self::Sora,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        match normalize_identifier(value).as_str() {
            "kling" | "klingai" | "可灵" => Some(Self::Kling),
            "ark" | "seedance" | "volcengine" | "doubao" => Some(Self::Ark),
            "minimax" | "hailuo" => Some(Self::MiniMax),
            "zhipu" | "cogvideo" | "bigmodel" => Some(Self::Zhipu),
            "sora" | "openai" => Some(Self::Sora),
            _ => None,
        }
    }
}

/// 视频平台的统一前缀（`Provider.kind` 的模态段，G-P1）。
pub const VIDEO_PLATFORM_MODALITY: &str = "video";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum PlatformId {
    Codex,
    Claude,
    Gemini,
    Grok,
    OpenCode,
    OpenClaw,
    Hermes,
    /// 视频渠道（G-P1）。**携带协议段**：`video:kling` / `video:seedance` …
    ///
    /// 之所以不是无载荷的 `Video`：`Provider.kind` 的语义就是「模态:协议」，
    /// 协议段（决定了上游路径、请求体、状态解析）必须跟着平台一路走到
    /// `forward_request`，否则半路还得回头去查一次账号的 `kind`。
    Video(VideoProtocol),
}

impl PlatformId {
    /// 文本/Agent 平台（无载荷）。视频不在其中——它有 5 个协议变体。
    pub const ALL: [Self; 7] = [
        Self::Codex,
        Self::Claude,
        Self::Gemini,
        Self::Grok,
        Self::OpenCode,
        Self::OpenClaw,
        Self::Hermes,
    ];

    /// 所有已知平台，含视频的全部协议（用于遍历/导入导出）。
    pub fn all_with_video() -> Vec<Self> {
        let mut platforms = Self::ALL.to_vec();
        platforms.extend(
            VideoProtocol::ALL
                .iter()
                .copied()
                .map(PlatformId::Video),
        );
        platforms
    }

    /// 解析 `Provider.kind`：先认「模态:协议」（`video:kling`），再退化到纯文本平台别名。
    pub fn parse(value: &str) -> Result<Self, AppError> {
        let normalized = normalize_identifier(value);
        // 先看「模态:协议」形式，再退化到纯文本平台别名。
        if let Some((modality, protocol)) = normalized.split_once(':') {
            if modality == VIDEO_PLATFORM_MODALITY {
                return VideoProtocol::parse(protocol)
                    .map(PlatformId::Video)
                    .ok_or_else(|| unknown_platform(value));
            }
            return Err(unknown_platform(value));
        }
        match normalized.as_str() {
            "codex" | "openai" | "chatgpt" => Ok(Self::Codex),
            "claude" | "anthropic" | "claude_code" | "claude_desktop" => Ok(Self::Claude),
            "gemini" | "google" | "gemini_cli" => Ok(Self::Gemini),
            "grok" | "xai" | "x_ai" | "x.ai" => Ok(Self::Grok),
            "opencode" | "open_code" => Ok(Self::OpenCode),
            "openclaw" | "open_claw" => Ok(Self::OpenClaw),
            "hermes" => Ok(Self::Hermes),
            _ => Err(unknown_platform(value)),
        }
    }

    /// 平台标识字符串。视频还原成 `video:<协议>`。
    ///
    /// 返回 `&'static str` 而不是 `String`：这是全仓使用最广的一个方法
    /// （近百处调用把它当 `&str` 传下去），一旦改成 `String`，每个调用点都得加
    /// `.as_str()`。视频的 5 个协议段用静态字面量表达，代价只是多一张 5 行的表。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Grok => "grok",
            Self::OpenCode => "opencode",
            Self::OpenClaw => "openclaw",
            Self::Hermes => "hermes",
            Self::Video(VideoProtocol::Kling) => "video:kling",
            Self::Video(VideoProtocol::Ark) => "video:ark",
            Self::Video(VideoProtocol::MiniMax) => "video:minimax",
            Self::Video(VideoProtocol::Zhipu) => "video:zhipu",
            Self::Video(VideoProtocol::Sora) => "video:sora",
        }
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude",
            Self::Gemini => "Gemini",
            Self::Grok => "Grok",
            Self::OpenCode => "OpenCode",
            Self::OpenClaw => "OpenClaw",
            Self::Hermes => "Hermes",
            Self::Video(VideoProtocol::Kling) => "视频 · Kling",
            Self::Video(VideoProtocol::Ark) => "视频 · Seedance",
            Self::Video(VideoProtocol::MiniMax) => "视频 · MiniMax",
            Self::Video(VideoProtocol::Zhipu) => "视频 · Zhipu",
            Self::Video(VideoProtocol::Sora) => "视频 · Sora",
        }
    }

    /// 是否为视频渠道。
    pub fn is_video(self) -> bool {
        matches!(self, Self::Video(_))
    }

    /// 视频协议段（仅视频平台有值）。
    pub fn video_protocol(self) -> Option<VideoProtocol> {
        match self {
            Self::Video(protocol) => Some(protocol),
            _ => None,
        }
    }

    pub fn default_api_credential_dialect(self) -> Option<ApiDialect> {
        match self {
            Self::Codex | Self::Grok => Some(ApiDialect::OpenAi),
            Self::Claude => Some(ApiDialect::Anthropic),
            Self::Gemini => Some(ApiDialect::Gemini),
            // 视频方言不走 `ApiDialect`（那是文本协议）：上游请求体由
            // `videogen::protocol::upstream_body` 自己构造。
            Self::OpenCode | Self::OpenClaw | Self::Hermes | Self::Video(_) => None,
        }
    }
}

fn unknown_platform(value: &str) -> AppError {
    AppError::Validation {
        code: "platform.unknown",
        message: "Platform is not recognized".to_string(),
        details: Some(value.trim().to_string()),
        recoverable: true,
    }
}

impl std::fmt::Display for PlatformId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for PlatformId {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ApiDialect {
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "openai-responses")]
    OpenAiResponses,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "gemini")]
    Gemini,
}

impl ApiDialect {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match normalize_identifier(value).as_str() {
            "openai" => Ok(Self::OpenAi),
            "openai_responses" => Ok(Self::OpenAiResponses),
            "anthropic" => Ok(Self::Anthropic),
            "gemini" => Ok(Self::Gemini),
            _ => Err(AppError::Validation {
                code: "validation.api_dialect",
                message: "API dialect is not recognized".to_string(),
                details: Some(value.trim().to_string()),
                recoverable: true,
            }),
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::OpenAiResponses => "openai-responses",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }
}

impl std::fmt::Display for ApiDialect {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for ApiDialect {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PlatformOperation {
    RouteCredentials,
    GenericApiRouting,
    ConfigWrite,
    OfficialImport,
    OfficialAccountRouting,
    DeeplinkImport,
    OfficialQuota,
    ModelTest,
    TerminalLaunch,
    SessionResume,
}

impl PlatformOperation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RouteCredentials => "route_credentials",
            Self::GenericApiRouting => "generic_api_routing",
            Self::ConfigWrite => "config_write",
            Self::OfficialImport => "official_import",
            Self::OfficialAccountRouting => "official_account_routing",
            Self::DeeplinkImport => "deeplink_import",
            Self::OfficialQuota => "official_quota",
            Self::ModelTest => "model_test",
            Self::TerminalLaunch => "terminal_launch",
            Self::SessionResume => "session_resume",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityAvailability {
    Supported,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SupportLevel {
    Supported,
    Partial,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityRule {
    pub availability: CapabilityAvailability,
    pub reason_code: Option<String>,
    pub credential_kinds: Vec<String>,
    pub requires_base_url: bool,
    pub requires_api_dialect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformOperations {
    pub route_credentials: CapabilityRule,
    pub generic_api_routing: CapabilityRule,
    pub config_write: CapabilityRule,
    pub official_import: CapabilityRule,
    pub official_account_routing: CapabilityRule,
    pub deeplink_import: CapabilityRule,
    pub official_quota: CapabilityRule,
    pub model_test: CapabilityRule,
    pub terminal_launch: CapabilityRule,
    pub session_resume: CapabilityRule,
}

impl PlatformOperations {
    pub fn get(&self, operation: PlatformOperation) -> &CapabilityRule {
        match operation {
            PlatformOperation::RouteCredentials => &self.route_credentials,
            PlatformOperation::GenericApiRouting => &self.generic_api_routing,
            PlatformOperation::ConfigWrite => &self.config_write,
            PlatformOperation::OfficialImport => &self.official_import,
            PlatformOperation::OfficialAccountRouting => &self.official_account_routing,
            PlatformOperation::DeeplinkImport => &self.deeplink_import,
            PlatformOperation::OfficialQuota => &self.official_quota,
            PlatformOperation::ModelTest => &self.model_test,
            PlatformOperation::TerminalLaunch => &self.terminal_launch,
            PlatformOperation::SessionResume => &self.session_resume,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformCapability {
    pub platform: PlatformId,
    pub display_name: String,
    pub support_level: SupportLevel,
    pub operations: PlatformOperations,
}

fn normalize_identifier(value: &str) -> String {
    value.trim().to_lowercase().replace([' ', '-'], "_")
}

#[cfg(test)]
mod tests {
    use super::{ApiDialect, PlatformId, VideoProtocol};

    #[test]
    fn parses_only_explicit_platform_aliases() {
        assert_eq!(
            PlatformId::parse("claude-code").unwrap(),
            PlatformId::Claude
        );
        assert_eq!(PlatformId::parse("x.ai").unwrap(), PlatformId::Grok);
        assert_eq!(PlatformId::parse("OpenClaw").unwrap(), PlatformId::OpenClaw);
        assert!(PlatformId::parse("my-claude-wrapper").is_err());
        assert!(PlatformId::parse("unknown-provider").is_err());
    }

    #[test]
    fn video_channel_round_trips_through_its_protocol_suffix() {
        assert_eq!(
            PlatformId::parse("video:kling").unwrap(),
            PlatformId::Video(VideoProtocol::Kling)
        );
        assert_eq!(
            PlatformId::parse("video:seedance").unwrap(),
            PlatformId::Video(VideoProtocol::Ark)
        );
        // 别名与大小写都要能吃
        assert_eq!(
            PlatformId::parse("VIDEO:Hailuo").unwrap(),
            PlatformId::Video(VideoProtocol::MiniMax)
        );
        // 往返不能丢协议段
        for protocol in VideoProtocol::ALL {
            let platform = PlatformId::Video(protocol);
            assert_eq!(PlatformId::parse(platform.as_str()).unwrap(), platform);
            assert_eq!(platform.video_protocol(), Some(protocol));
            assert!(platform.is_video());
        }
        assert_eq!(PlatformId::Video(VideoProtocol::Ark).as_str(), "video:ark");
    }

    #[test]
    fn video_channel_rejects_unknown_or_mismatched_modality() {
        // 未知协议段
        assert!(PlatformId::parse("video:nope").is_err());
        // 已知协议段但模态不是 video
        assert!(PlatformId::parse("text:kling").is_err());
        assert!(PlatformId::parse("audio:kling").is_err());
        // 裸 `video` 没有协议段，无法确定方言
        assert!(PlatformId::parse("video").is_err());
        // 视频不是文本平台，不能带 API 方言
        assert_eq!(
            PlatformId::Video(VideoProtocol::Kling).default_api_credential_dialect(),
            None
        );
    }

    #[test]
    fn all_with_video_covers_every_protocol() {
        let all = PlatformId::all_with_video();
        assert_eq!(all.len(), PlatformId::ALL.len() + VideoProtocol::ALL.len());
        assert_eq!(all.iter().filter(|item| item.is_video()).count(), 5);
        // `ALL` 保持「不含视频」，能力矩阵与既有遍历依赖这一点
        assert!(PlatformId::ALL.iter().all(|item| !item.is_video()));
    }

    #[test]
    fn parses_supported_api_dialect_aliases() {
        assert_eq!(
            ApiDialect::parse("openai-responses").unwrap(),
            ApiDialect::OpenAiResponses
        );
        assert_eq!(
            ApiDialect::parse("anthropic").unwrap(),
            ApiDialect::Anthropic
        );
        let legacy_dash = ["anthropic", "messages"].join("-");
        let legacy_underscore = ["anthropic", "messages"].join("_");
        assert!(ApiDialect::parse(&legacy_dash).is_err());
        assert!(ApiDialect::parse(&legacy_underscore).is_err());
        assert!(ApiDialect::parse("automatic").is_err());
    }

    #[test]
    fn platform_serialization_uses_canonical_ids() {
        assert_eq!(
            serde_json::to_string(&PlatformId::OpenCode).unwrap(),
            "\"opencode\""
        );
        assert_eq!(
            serde_json::to_string(&ApiDialect::OpenAiResponses).unwrap(),
            "\"openai-responses\""
        );
    }

    #[test]
    fn partial_platforms_have_no_default_api_dialect() {
        assert_eq!(
            PlatformId::Codex.default_api_credential_dialect(),
            Some(ApiDialect::OpenAi)
        );
        assert_eq!(PlatformId::Hermes.default_api_credential_dialect(), None);
    }
}
