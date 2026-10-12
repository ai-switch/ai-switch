use crate::error::AppError;
use serde::{Deserialize, Serialize};

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
}

impl PlatformId {
    /// 全部平台 —— 也就是全部**池身份**。
    ///
    /// **多模态渠道不在这里。** 视频 / 音频 / 生图不是平台，而是账号的**模态分类**，
    /// 住在账号的 `model_mappings[*].capabilities` 里（`video.generate` /
    /// `audio.generate` / `image.generate`）；账号本身落在某个池身份下（视频 / 音频
    /// 通常落在 `codex`）。
    ///
    /// 这是「**供应商不是平台**」那条原则的延伸：**模态也不是平台**。
    ///
    /// 平台承担的是**池身份**——给哪个 CLI 用、哪张 key、哪个 SaaS 组；而模态由
    /// **端点路径**唯一确定（`/v1/videos` 一定是视频，`/v1/audio/speech` 一定是
    /// TTS）。把模态塞进平台，代价是每加一个模态就多一个平台、多一个导航项、
    /// 多一张 key，而且 `platform` 一列同时在表达两件正交的事。
    ///
    /// 这个数组是遍历 / 导入导出去重 / SaaS 平台白名单推导的**唯一来源** —— 那几处
    /// 漏掉一个平台的症状都是「静默不可用」，所以不允许有第二份清单。
    pub const ALL: [Self; 7] = [
        Self::Codex,
        Self::Claude,
        Self::Gemini,
        Self::Grok,
        Self::OpenCode,
        Self::OpenClaw,
        Self::Hermes,
    ];

    pub fn parse(value: &str) -> Result<Self, AppError> {
        let normalized = normalize_identifier(value);
        // 两种旧写法都必须**明确拒绝**并给出可照做的提示 —— 静默接受会更糟：
        // 账号会落到一个永远不会被选中的值上。
        //   `video` / `audio`   —— 曾经是平台值，现在是账号的模态分类
        //   `video:kling`       —— 更早的模型，供应商当平台
        if let Some((modality, protocol)) = normalized.split_once(':') {
            if matches!(modality, "video" | "audio" | "tts" | "speech") {
                return Err(AppError::Validation {
                    code: "platform.modality_is_not_a_platform",
                    message: format!(
                        "'{value}' is not a platform: modalities live on the account, not on the pool. \
                         Use platform 'codex' and declare capability '{modality}.generate' on the account's model mapping"
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
            "video" | "audio" | "tts" | "speech" => Err(media_is_not_a_platform(value)),
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
        }
    }

    pub fn default_api_credential_dialect(self) -> Option<ApiDialect> {
        match self {
            Self::Codex | Self::Grok => Some(ApiDialect::OpenAi),
            Self::Claude => Some(ApiDialect::Anthropic),
            Self::Gemini => Some(ApiDialect::Gemini),
            // 这三个没有「默认线协议」：账号的 `interface_format` 由用户按上游给。
            // 多模态账号同理 —— 但它们的方言是**模态方言**（`kling` / `ark` / …），
            // 不住在这个枚举里，见 `videogen::protocol` / `audiogen::protocol`。
            Self::OpenCode | Self::OpenClaw | Self::Hermes => None,
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

/// 曾经的平台值（`video` / `audio`）现在住在**账号**上。
///
/// 这跟「无法识别」不是一回事 —— 它是**认得出来但位置错了**，所以必须说清该改成
/// 什么。否则用户只会看到「平台无效」，然后把它当成拼写问题重试。
fn media_is_not_a_platform(value: &str) -> AppError {
    AppError::Validation {
        code: "platform.modality_is_not_a_platform",
        message: format!(
            "'{value}' is not a platform: video / audio / image are account-level modalities, \
             not pools. Create the account under platform 'codex' and tick the matching capability \
             (video.generate / audio.generate / image.generate) on its model mapping"
        ),
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
    use super::{ApiDialect, PlatformId};

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

    /// 多模态渠道**不是平台**。这是本轮架构变更的锚点。
    ///
    /// `video` / `audio` 曾经是平台值，现在住在账号的
    /// `model_mappings[*].capabilities` 里。必须**明确拒绝**而不是笼统的「无法识别」
    /// —— 后者会让用户以为是自己拼错了，然后换个拼法重试。
    #[test]
    fn modalities_are_rejected_as_platforms_with_a_pointer_to_the_account() {
        for value in ["video", "audio", "tts", "speech", "VIDEO"] {
            let error = PlatformId::parse(value).expect_err("modality must not parse as a platform");
            assert_eq!(error.code(), "platform.modality_is_not_a_platform", "{value}");
            let message = error.to_string();
            assert!(message.contains("codex"), "{message}");
            assert!(message.contains(".generate"), "{message}");
        }
        // 更早的「供应商当平台」写法（`video:kling`）走同一条路 —— 它也是模态写错了位置
        let error = PlatformId::parse("video:kling").expect_err("vendor suffix must be rejected");
        assert_eq!(error.code(), "platform.modality_is_not_a_platform");
        assert!(PlatformId::parse("text:kling").is_err());
    }

    /// 平台清单只剩池身份，且 `ALL` 就是全部 —— 不再有「文本平台 / 媒体平台」之分。
    #[test]
    fn platform_list_is_pool_identities_only() {
        assert_eq!(PlatformId::ALL.len(), 7);
        for platform in PlatformId::ALL {
            assert_eq!(PlatformId::parse(platform.as_str()).unwrap(), platform);
        }
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
