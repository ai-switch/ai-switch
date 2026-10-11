use crate::{
    error::AppError,
    models::platform::{
        CapabilityAvailability, CapabilityRule, PlatformCapability, PlatformId, PlatformOperation,
        PlatformOperations, SupportLevel,
    },
};

const API_CREDENTIALS_ONLY: &str = "capability.api_credentials_only";
const OFFICIAL_ACCOUNT_UNAVAILABLE: &str = "capability.official_account_unavailable";
const DEEPLINK_UNAVAILABLE: &str = "capability.deeplink_unavailable";
const QUOTA_UNAVAILABLE: &str = "capability.quota_unavailable";
/// 视频渠道专用：不写任何 CLI 配置。
const CONFIG_WRITE_UNAVAILABLE: &str = "capability.video_no_config_write";
/// 视频渠道专用：模型测试走 videogen 自己的提交链路，不在这里。
const VIDEO_MODEL_TEST_UNAVAILABLE: &str = "capability.video_model_test_separate";
/// 视频渠道专用：没有终端/会话概念。
const VIDEO_AGENT_ONLY: &str = "capability.video_not_an_agent";
/// 音频渠道专用：不写任何 CLI 配置。
const AUDIO_CONFIG_WRITE_UNAVAILABLE: &str = "capability.audio_no_config_write";
/// 音频渠道专用：模型测试走 TTS 自己的链路，不在这里。
const AUDIO_MODEL_TEST_UNAVAILABLE: &str = "capability.audio_model_test_separate";
/// 音频渠道专用：没有终端/会话概念。
const AUDIO_AGENT_ONLY: &str = "capability.audio_not_an_agent";

pub struct PlatformCapabilityService;

impl PlatformCapabilityService {
    pub fn list() -> Vec<PlatformCapability> {
        PlatformId::ALL.into_iter().map(capability_for).collect()
    }

    pub fn get(platform: PlatformId) -> PlatformCapability {
        capability_for(platform)
    }

    pub fn require(
        platform: PlatformId,
        operation: PlatformOperation,
    ) -> Result<CapabilityRule, AppError> {
        let capability = Self::get(platform);
        let rule = capability.operations.get(operation).clone();
        if rule.availability == CapabilityAvailability::Unavailable {
            return Err(AppError::Validation {
                code: "capability.unavailable",
                message: format!(
                    "{} does not support {}",
                    platform.display_name(),
                    operation.as_str()
                ),
                details: rule.reason_code.clone(),
                recoverable: true,
            });
        }
        Ok(rule)
    }
}

fn capability_for(platform: PlatformId) -> PlatformCapability {
    // 视频渠道（G-P1）。它和文本平台的能力集**完全不同**：
    //   - 有账号池（route_credentials）、走通用 API 路由（generic_api_routing）
    //     ——这正是 `forward_request` 需要的那两项；
    //   - 没有任何「官方账号」概念：视频上游都是 API key 渠道；
    //   - 不写 CLI 配置（视频不是 CLI 的 provider）、不支持 deeplink 导入、
    //     不支持终端启动/会话续跑（那是 Agent 才有的东西）；
    //   - 模型测试走 `videogen` 自己的提交链路，不进 `route_model_test_service`。
    if platform.is_video() {
        return PlatformCapability {
            platform,
            display_name: platform.display_name().to_string(),
            support_level: SupportLevel::Partial,
            operations: PlatformOperations {
                route_credentials: api_credentials_only(),
                generic_api_routing: api_credentials_only(),
                config_write: unavailable(CONFIG_WRITE_UNAVAILABLE),
                official_import: unavailable(OFFICIAL_ACCOUNT_UNAVAILABLE),
                official_account_routing: unavailable(OFFICIAL_ACCOUNT_UNAVAILABLE),
                deeplink_import: unavailable(DEEPLINK_UNAVAILABLE),
                official_quota: unavailable(QUOTA_UNAVAILABLE),
                model_test: unavailable(VIDEO_MODEL_TEST_UNAVAILABLE),
                terminal_launch: unavailable(VIDEO_AGENT_ONLY),
                session_resume: unavailable(VIDEO_AGENT_ONLY),
            },
        };
    }

    // 音频渠道（TTS）。能力集与视频**完全一致**，理由也一样：它走通用 API 路由
    // （`forward_request` 需要 route_credentials + generic_api_routing 这两项），
    // 但不是一个 CLI provider、没有官方账号、也没有终端/会话。
    //
    // 刻意与视频分成两个分支而不是合成一个 `is_media()`：reason code 是给用户
    // 看的文案，把「视频渠道不是 CLI 的 provider」原样丢给音频用户是错的。
    if platform.is_audio() {
        return PlatformCapability {
            platform,
            display_name: platform.display_name().to_string(),
            support_level: SupportLevel::Partial,
            operations: PlatformOperations {
                route_credentials: api_credentials_only(),
                generic_api_routing: api_credentials_only(),
                config_write: unavailable(AUDIO_CONFIG_WRITE_UNAVAILABLE),
                official_import: unavailable(OFFICIAL_ACCOUNT_UNAVAILABLE),
                official_account_routing: unavailable(OFFICIAL_ACCOUNT_UNAVAILABLE),
                deeplink_import: unavailable(DEEPLINK_UNAVAILABLE),
                official_quota: unavailable(QUOTA_UNAVAILABLE),
                model_test: unavailable(AUDIO_MODEL_TEST_UNAVAILABLE),
                terminal_launch: unavailable(AUDIO_AGENT_ONLY),
                session_resume: unavailable(AUDIO_AGENT_ONLY),
            },
        };
    }

    let partial = matches!(
        platform,
        PlatformId::OpenCode | PlatformId::OpenClaw | PlatformId::Hermes
    );
    let official_quota = if platform == PlatformId::Gemini || partial {
        unavailable(QUOTA_UNAVAILABLE)
    } else {
        supported()
    };
    let operations = if partial {
        PlatformOperations {
            route_credentials: supported(),
            generic_api_routing: api_credentials_only(),
            // Native config writing is real for these three: each has its own
            // verified adapter. What they still lack is anything to do with an
            // official vendor account, because they are agent harnesses rather
            // than a vendor — they have no login of their own to import, route,
            // or read quota from.
            config_write: supported(),
            official_import: unavailable(OFFICIAL_ACCOUNT_UNAVAILABLE),
            official_account_routing: unavailable(OFFICIAL_ACCOUNT_UNAVAILABLE),
            deeplink_import: unavailable(DEEPLINK_UNAVAILABLE),
            official_quota,
            model_test: api_credentials_only(),
            terminal_launch: supported(),
            session_resume: supported(),
        }
    } else {
        PlatformOperations {
            route_credentials: supported(),
            generic_api_routing: supported(),
            config_write: supported(),
            official_import: supported(),
            official_account_routing: supported(),
            deeplink_import: supported(),
            official_quota,
            model_test: supported(),
            terminal_launch: supported(),
            session_resume: supported(),
        }
    };

    PlatformCapability {
        platform,
        display_name: platform.display_name().to_string(),
        support_level: if partial {
            SupportLevel::Partial
        } else {
            SupportLevel::Supported
        },
        operations,
    }
}

fn supported() -> CapabilityRule {
    CapabilityRule {
        availability: CapabilityAvailability::Supported,
        reason_code: None,
        credential_kinds: Vec::new(),
        requires_base_url: false,
        requires_api_dialect: false,
    }
}

fn api_credentials_only() -> CapabilityRule {
    CapabilityRule {
        availability: CapabilityAvailability::Partial,
        reason_code: Some(API_CREDENTIALS_ONLY.to_string()),
        credential_kinds: vec!["api".to_string()],
        requires_base_url: true,
        requires_api_dialect: true,
    }
}

fn unavailable(reason_code: &str) -> CapabilityRule {
    CapabilityRule {
        availability: CapabilityAvailability::Unavailable,
        reason_code: Some(reason_code.to_string()),
        credential_kinds: Vec::new(),
        requires_base_url: false,
        requires_api_dialect: false,
    }
}

#[cfg(test)]
mod tests {
    use super::PlatformCapabilityService;
    use crate::{
        error::AppError,
        models::platform::{CapabilityAvailability, PlatformId, PlatformOperation, SupportLevel},
    };

    #[test]
    fn capability_matrix_matches_phase_a_contract() {
        let matrix = PlatformCapabilityService::list();
        assert_eq!(matrix.len(), 7);

        let hermes = matrix
            .iter()
            .find(|item| item.platform == PlatformId::Hermes)
            .unwrap();
        assert_eq!(hermes.support_level, SupportLevel::Partial);
        // "Partial" is now only about the official-account half of the matrix.
        // Config writing is a verified adapter like any native CLI's.
        assert_eq!(
            hermes.operations.config_write.availability,
            CapabilityAvailability::Supported
        );
        assert_eq!(
            hermes.operations.generic_api_routing.availability,
            CapabilityAvailability::Partial
        );
        assert_eq!(
            hermes.operations.official_account_routing.availability,
            CapabilityAvailability::Unavailable
        );

        let gemini = matrix
            .iter()
            .find(|item| item.platform == PlatformId::Gemini)
            .unwrap();
        assert_eq!(
            gemini.operations.config_write.availability,
            CapabilityAvailability::Supported
        );
        assert_eq!(
            gemini.operations.official_quota.availability,
            CapabilityAvailability::Unavailable
        );
    }

    #[test]
    fn require_rejects_only_unavailable_operations() {
        let partial = PlatformCapabilityService::require(
            PlatformId::Hermes,
            PlatformOperation::GenericApiRouting,
        )
        .expect("partial capability remains callable");
        assert_eq!(partial.availability, CapabilityAvailability::Partial);

        let error = PlatformCapabilityService::require(
            PlatformId::Hermes,
            PlatformOperation::OfficialImport,
        )
        .expect_err("Hermes has no official vendor account to import");
        assert!(matches!(
            error,
            AppError::Validation {
                code: "capability.unavailable",
                ..
            }
        ));
    }
}
