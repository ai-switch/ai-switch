use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// 视频渠道的平台标识。
///
/// **供应商不是平台。** 可灵 / 方舟(Seedance) / MiniMax / 智谱 / Sora 之间差的是
/// **线协议**——请求体形状、上游路径、状态解析——而线协议属于账号的
/// `config_json.interface_format`，不属于 `platform`。这与文本平台同构：
/// 一个 `platform = codex` 的账号完全可以挂 `interface_format: anthropic`。
///
/// 视频又没有「给哪个 CLI 用」这回事（codex/claude 的池身份意义在这里不存在），
/// 所以池身份只有一个 `video`：**一张 key、一个 SaaS 组**，落到哪家由请求里的
/// `model` 名决定（账号的 `model_mappings` 命中谁就是谁）。
///
/// 这也正是「跨供应商路由」不需要任何特殊机制的原因——它本来就是普通的
/// 「按 model 过滤候选 + 选中的账号自带方言」。
pub const VIDEO_PLATFORM: &str = "video";

/// 音频渠道的平台标识（TTS；STT 与它是同一个池）。
///
/// 与 [`VIDEO_PLATFORM`] 同构：**供应商不是平台**。OpenAI / MiniMax / 火山 /
/// Azure / ElevenLabs 之间差的是线协议（上游路径、鉴权头、回程是原始字节还是
/// JSON+base64），而线协议属于账号的 `config_json.interface_format`。
///
/// 音频也没有「给哪个 CLI 用」这回事，所以池身份只有一个 `audio`：**一张 key**，
/// 落到哪家由请求里的 `model` 名决定。
pub const AUDIO_PLATFORM: &str = "audio";

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
    /// 视频渠道。**无载荷**：供应商在账号的 `interface_format` 里，不在平台里
    /// （见 [`VIDEO_PLATFORM`]）。
    Video,
    /// 音频渠道（TTS）。同样**无载荷**：供应商在 `interface_format` 里
    /// （见 [`AUDIO_PLATFORM`]）。
    Audio,
}

impl PlatformId {
    /// 文本/Agent 平台。**不含视频与音频**：`agent_launch` 这类按平台遍历的逻辑
    /// 不该把它们当成 agent。需要含媒体的遍历用 [`Self::all_with_media`]。
    pub const ALL: [Self; 7] = [
        Self::Codex,
        Self::Claude,
        Self::Gemini,
        Self::Grok,
        Self::OpenCode,
        Self::OpenClaw,
        Self::Hermes,
    ];

    /// 所有已知平台，含媒体渠道（视频 + 音频）。
    ///
    /// 用于遍历 / 导入导出去重 / SaaS 的平台白名单推导 —— 这几处漏掉一个平台
    /// 的症状都是「静默不可用」，所以必须只有一个来源。
    pub fn all_with_media() -> Vec<Self> {
        let mut platforms = Self::ALL.to_vec();
        platforms.push(Self::Video);
        platforms.push(Self::Audio);
        platforms
    }

    pub fn parse(value: &str) -> Result<Self, AppError> {
        let normalized = normalize_identifier(value);
        // `video:kling` / `audio:minimax` 是旧模型（供应商当平台）。现在供应商在
        // `interface_format` 里、平台只有一个模态值，所以给一条能照着改的提示，
        // 而不是笼统的「无法识别」。
        if let Some((modality, protocol)) = normalized.split_once(':') {
            if modality == VIDEO_PLATFORM || modality == AUDIO_PLATFORM {
                return Err(AppError::Validation {
                    code: "platform.media_vendor_belongs_to_interface_format",
                    message: format!(
                        "'{value}' is not a platform: set platform to '{modality}' and interface_format to '{protocol}'"
                    ),
                    details: Some(value.trim().to_string()),
                    recoverable: true,
                });
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
            "video" => Ok(Self::Video),
            "audio" | "tts" | "speech" => Ok(Self::Audio),
            _ => Err(unknown_platform(value)),
        }
    }

    /// 平台标识字符串。
    ///
    /// 返回 `&'static str` 而不是 `String`：这是全仓使用最广的一个方法
    /// （近百处调用把它当 `&str` 传下去），一旦改成 `String`，每个调用点都得加
    /// `.as_str()`。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Grok => "grok",
            Self::OpenCode => "opencode",
            Self::OpenClaw => "openclaw",
            Self::Hermes => "hermes",
            Self::Video => VIDEO_PLATFORM,
            Self::Audio => AUDIO_PLATFORM,
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
            Self::Video => "视频",
            Self::Audio => "音频",
        }
    }

    /// 是否为视频渠道。
    pub fn is_video(self) -> bool {
        matches!(self, Self::Video)
    }

    /// 是否为音频渠道（TTS）。
    pub fn is_audio(self) -> bool {
        matches!(self, Self::Audio)
    }

    /// 是否为「媒体」渠道（视频 / 音频）。
    ///
    /// 两者的共同点：供应商住在 `interface_format` 里、上游请求体由各自的
    /// `protocol` 模块构造、响应体不是文本 JSON。文本那套
    /// 「协议桥接 / reasoning 清理 / 路径版本规范化」对它们一律不适用。
    pub fn is_media(self) -> bool {
        self.is_video() || self.is_audio()
    }

    pub fn default_api_credential_dialect(self) -> Option<ApiDialect> {
        match self {
            Self::Codex | Self::Grok => Some(ApiDialect::OpenAi),
            Self::Claude => Some(ApiDialect::Anthropic),
            Self::Gemini => Some(ApiDialect::Gemini),
            // 媒体渠道的线协议不走 `ApiDialect`（那是文本协议）：方言由账号的
            // `interface_format` 给出，上游请求体由 `videogen` / `audiogen`
            // 各自的 `protocol` 模块构造。
            Self::OpenCode | Self::OpenClaw | Self::Hermes | Self::Video | Self::Audio => None,
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
    use super::{ApiDialect, PlatformId, AUDIO_PLATFORM, VIDEO_PLATFORM};

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

    /// 视频只有一个平台 `video`；供应商在账号的 `interface_format` 里。
    #[test]
    fn video_is_a_single_platform_without_a_vendor_suffix() {
        assert_eq!(PlatformId::parse("video").unwrap(), PlatformId::Video);
        assert_eq!(PlatformId::parse("VIDEO").unwrap(), PlatformId::Video);
        assert_eq!(PlatformId::Video.as_str(), VIDEO_PLATFORM);
        assert!(PlatformId::Video.is_video());
        // 往返
        assert_eq!(
            PlatformId::parse(PlatformId::Video.as_str()).unwrap(),
            PlatformId::Video
        );
        // 视频不是文本平台，没有 API 方言
        assert_eq!(PlatformId::Video.default_api_credential_dialect(), None);
    }

    /// 音频与视频同构：一个平台 `audio`，供应商在 `interface_format` 里。
    #[test]
    fn audio_is_a_single_platform_without_a_vendor_suffix() {
        for alias in ["audio", "AUDIO", "tts", "speech"] {
            assert_eq!(PlatformId::parse(alias).unwrap(), PlatformId::Audio, "{alias}");
        }
        assert_eq!(PlatformId::Audio.as_str(), AUDIO_PLATFORM);
        assert!(PlatformId::Audio.is_audio());
        assert!(!PlatformId::Audio.is_video());
        // 媒体渠道：两者共享「供应商住 interface_format」这套语义
        assert!(PlatformId::Video.is_media() && PlatformId::Audio.is_media());
        assert!(!PlatformId::Codex.is_media());
        // 音频不是文本平台，没有 API 方言
        assert_eq!(PlatformId::Audio.default_api_credential_dialect(), None);
        // 往返
        assert_eq!(
            PlatformId::parse(PlatformId::Audio.as_str()).unwrap(),
            PlatformId::Audio
        );
    }

    /// 旧模型（`video:kling` / `audio:minimax`，供应商当平台）必须被**明确拒绝**，
    /// 并给出可照做的提示。
    ///
    /// 静默接受会更糟：账号会落到一个永远不会被选中的平台值上。
    #[test]
    fn media_vendor_suffix_is_rejected_with_a_migration_hint() {
        for (value, modality, vendor) in [
            ("video:kling", "video", "kling"),
            ("audio:minimax", "audio", "minimax"),
        ] {
            let error = PlatformId::parse(value).expect_err("old model must be rejected");
            assert_eq!(error.code(), "platform.media_vendor_belongs_to_interface_format");
            let message = error.to_string();
            assert!(message.contains(&format!("'{modality}'")), "{message}");
            assert!(message.contains(&format!("'{vendor}'")), "{message}");
        }
        // 模态不是已知媒体渠道的同样拒绝
        assert!(PlatformId::parse("text:kling").is_err());
    }

    #[test]
    fn all_with_media_adds_exactly_the_two_media_platforms() {
        let all = PlatformId::all_with_media();
        assert_eq!(all.len(), PlatformId::ALL.len() + 2);
        assert_eq!(all.iter().filter(|item| item.is_video()).count(), 1);
        assert_eq!(all.iter().filter(|item| item.is_audio()).count(), 1);
        // `ALL` 保持「不含媒体渠道」：agent_launch 这类按平台遍历的逻辑依赖这一点
        assert!(PlatformId::ALL.iter().all(|item| !item.is_media()));
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
