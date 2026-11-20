//! Reads provider and login entries out of Magpie's own configuration
//! (`~/.config/magpie/`).
//!
//! Clean-room: this reads Magpie's public on-disk formats only and shares no
//! code with it. Two files contribute entries, either alone is enough, both
//! missing means there is nothing to import:
//!
//! - `providers.json` — `{providers:[...]}`, API-key providers. A provider can
//!   serve several wire protocols at once (`chat` / `responses` / `anthropic` /
//!   `gemini` URL fields); AI Switch accounts are single-dialect, so each set
//!   URL becomes its own entry `provider:<id>:<protocol>`.
//! - `logins.json` — an array of saved subscription accounts whose `auth` blob
//!   is the agent's own native credential file (Codex `auth.json` / Claude's
//!   `claudeAiOauth` credentials). These import as official accounts; the
//!   snapshot is stored verbatim, never refreshed.

use crate::error::AppError;
use crate::models::external_client_import::{EXTERNAL_CLIENT_MAX_ITEMS, EXTERNAL_CLIENT_MAX_SOURCE_BYTES};
use crate::models::platform::{ApiDialect, PlatformId};
use crate::models::route_credential::ModelMapping;
use crate::services::cc_switch_import_service::ExtractedApiCredential;
use crate::services::cpa_import_service::{parse_cpa_text, ParsedOfficialCredential};
use crate::services::external_client_import_service::{
    PreparedBody, PreparedExternalEntry, SkipBucket,
};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

fn home_dir() -> PathBuf {
    directories::BaseDirs::new()
        .map(|base| base.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Magpie's config directory; the Go app uses `~/.config/magpie` on every
/// platform, honouring `XDG_CONFIG_HOME`. Portable and beside-the-executable
/// installs are left to the manual directory picker.
pub fn default_config_dir() -> PathBuf {
    match std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(value) => PathBuf::from(value).join("magpie"),
        None => home_dir().join(".config").join("magpie"),
    }
}

pub fn resolve_source_dir(source_path: Option<&str>) -> Result<PathBuf, AppError> {
    match source_path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_dir() {
                return Err(AppError::Validation {
                    code: "external_import.source_missing",
                    message: "The selected Magpie config directory does not exist".to_string(),
                    details: Some(path.display().to_string()),
                    recoverable: true,
                });
            }
            Ok(path)
        }
        None => Ok(default_config_dir()),
    }
}

async fn read_json_file(path: &Path) -> Result<Option<Value>, AppError> {
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(AppError::Filesystem {
                code: "external_import.source_read_failed",
                message: "Could not read the Magpie configuration file".to_string(),
                details: Some(format!("{}: {error}", path.display())),
                recoverable: true,
            });
        }
    };
    if bytes.len() > EXTERNAL_CLIENT_MAX_SOURCE_BYTES {
        return Err(AppError::Validation {
            code: "external_import.source_too_large",
            message: "The Magpie configuration file is too large to import".to_string(),
            details: Some(format!("{}: {} bytes", path.display(), bytes.len())),
            recoverable: true,
        });
    }
    let text = String::from_utf8_lossy(&bytes);
    serde_json::from_str::<Value>(&text)
        .map(Some)
        .map_err(|error| AppError::Validation {
            code: "external_import.source_invalid_json",
            message: "The Magpie configuration file is not valid JSON".to_string(),
            details: Some(format!("{}: {error}", path.display())),
            recoverable: true,
        })
}

pub async fn prepare_entries(dir: &Path) -> Result<Vec<PreparedExternalEntry>, AppError> {
    let providers_path = dir.join("providers.json");
    let logins_path = dir.join("logins.json");
    let providers = read_json_file(&providers_path).await?;
    let logins = read_json_file(&logins_path).await?;
    if providers.is_none() && logins.is_none() {
        return Err(AppError::Validation {
            code: "external_import.source_not_found",
            message: "Could not find a Magpie configuration on this machine".to_string(),
            details: Some(dir.display().to_string()),
            recoverable: true,
        });
    }

    prepare_values(providers.as_ref(), logins.as_ref())
}

pub(crate) fn prepare_values(
    providers: Option<&Value>,
    logins: Option<&Value>,
) -> Result<Vec<PreparedExternalEntry>, AppError> {
    let mut entries = Vec::new();
    if let Some(provider_list) = providers
        .as_ref()
        .and_then(|value| value.get("providers"))
        .and_then(Value::as_array)
    {
        for (index, provider) in provider_list.iter().enumerate() {
            if value_string_field(provider, "id").is_none() {
                push_invalid_entry("provider", index, "api", &mut entries);
                continue;
            }
            prepare_provider(provider, &mut entries);
        }
    }
    if let Some(login_list) = logins.and_then(Value::as_array) {
        for (index, login) in login_list.iter().enumerate() {
            if value_string_field(login, "agent").is_none() {
                push_invalid_entry("login", index, "official", &mut entries);
                continue;
            }
            prepare_login(login, &mut entries);
        }
    }

    if entries.len() > EXTERNAL_CLIENT_MAX_ITEMS {
        return Err(AppError::Validation {
            code: "external_import.too_many_items",
            message: "The Magpie configuration contains too many entries".to_string(),
            details: Some(entries.len().to_string()),
            recoverable: true,
        });
    }
    Ok(entries)
}

fn value_string_field(value: &Value, key: &str) -> Option<String> {
    value.as_object().and_then(|object| string_field(object, key))
}

fn push_invalid_entry(prefix: &str, index: usize, kind: &str, entries: &mut Vec<PreparedExternalEntry>) {
    entries.push(PreparedExternalEntry {
        source_id: format!("{prefix}-row:{}", index + 1),
        body: PreparedBody::Broken {
            kind: kind.to_string(),
            display_name: format!("{} {}", prefix, index + 1),
            issue_code: "external_import.entry_invalid",
            platform_hint: None,
        },
    });
}

/// A key as providers.json stores it: the value plus the one protocol it may
/// serve (no restriction = any protocol).
struct MagpieKey {
    value: String,
    protocol: Option<String>,
}

/// `key`/`keyProtocol` name the first key; `keys[]` holds the saved ones.
/// A `KeyAccount` spells its value `key` and can carry its own `protocol` and
/// an `off` switch.
fn provider_keys(provider: &Map<String, Value>) -> Vec<MagpieKey> {
    let mut keys = Vec::new();
    if let Some(first) = string_field(provider, "key") {
        keys.push(MagpieKey {
            value: first,
            protocol: string_field(provider, "keyProtocol"),
        });
    }
    if let Some(saved) = provider.get("keys").and_then(Value::as_array) {
        for key in saved {
            let Some(key_object) = key.as_object() else {
                continue;
            };
            let off = key_object.get("off").and_then(Value::as_bool) == Some(true);
            if off {
                continue;
            }
            if let Some(value) = string_field(key_object, "key") {
                keys.push(MagpieKey {
                    value,
                    protocol: string_field(key_object, "protocol"),
                });
            }
        }
    }
    keys
}

/// (URL field, dialect, platform) in providers.json's own order.
const MAGPIE_PROTOCOLS: &[(&str, ApiDialect, PlatformId)] = &[
    ("anthropic", ApiDialect::Anthropic, PlatformId::Claude),
    ("responses", ApiDialect::OpenAiResponses, PlatformId::Codex),
    ("chat", ApiDialect::OpenAi, PlatformId::Codex),
    ("gemini", ApiDialect::Gemini, PlatformId::Gemini),
];

fn prepare_provider(provider: &Value, entries: &mut Vec<PreparedExternalEntry>) {
    let object = match provider.as_object() {
        Some(object) => object,
        None => return,
    };
    let id = string_field(object, "id").unwrap_or_default();
    if id.is_empty() {
        return;
    }
    let preset = string_field(object, "preset").unwrap_or_default();
    if preset == "remote-magpie" {
        entries.push(PreparedExternalEntry {
            source_id: format!("provider:{id}:remote-magpie"),
            body: PreparedBody::Skipped(SkipBucket::Unsupported("remote-magpie".to_string())),
        });
        return;
    }
    let display_name = string_field(object, "name").unwrap_or_else(|| id.clone());

    let set_urls: Vec<(&str, String, ApiDialect, PlatformId)> = MAGPIE_PROTOCOLS
        .iter()
        .filter_map(|(field, dialect, platform)| {
            string_field(object, field).map(|url| (*field, url, *dialect, *platform))
        })
        .collect();
    if set_urls.is_empty() {
        entries.push(PreparedExternalEntry {
            source_id: format!("provider:{id}"),
            body: PreparedBody::Skipped(SkipBucket::Unsupported("无协议地址".to_string())),
        });
        return;
    }

    let keys = provider_keys(object);
    let headers: Vec<(String, String)> = object
        .get("headers")
        .and_then(Value::as_object)
        .map(|headers| {
            headers
                .iter()
                .filter_map(|(name, value)| {
                    value.as_str().map(|value| (name.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let model_mappings: Vec<ModelMapping> = object
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|model| !model.is_empty())
                .map(|model| ModelMapping {
                    from: model.to_string(),
                    to: model.to_string(),
                    ..Default::default()
                })
                .collect()
        })
        .unwrap_or_default();

    for (field, url, dialect, platform) in set_urls {
        let source_id = format!("provider:{id}:{field}");
        let key = keys
            .iter()
            .find(|key| key.protocol.as_deref().map(|p| p == field).unwrap_or(true))
            .map(|key| key.value.clone());
        let Some(api_key) = key else {
            entries.push(PreparedExternalEntry {
                source_id,
                body: PreparedBody::Broken {
                    kind: "api".to_string(),
                    display_name: display_name.clone(),
                    issue_code: "external_import.api_key_missing",
                    platform_hint: Some(platform),
                },
            });
            continue;
        };

        entries.push(PreparedExternalEntry {
            source_id,
            body: PreparedBody::Api(ExtractedApiCredential {
                platform,
                display_name: display_name.clone(),
                api_key,
                base_url: url,
                interface_format: dialect,
                api_key_field: None,
                model_mappings: model_mappings.clone(),
                user_agent: None,
                extra_headers: headers.clone(),
            }),
        });
    }
}

fn prepare_login(login: &Value, entries: &mut Vec<PreparedExternalEntry>) {
    let object = match login.as_object() {
        Some(object) => object,
        None => return,
    };
    let agent = string_field(object, "agent").unwrap_or_default();
    if agent.is_empty() {
        return;
    }
    let user = string_field(object, "user").unwrap_or_default();
    let login_id = string_field(object, "id");
    let source_id = match login_id {
        Some(id) => format!("login:{id}"),
        None => format!("login:{agent}:{user}"),
    };
    let Some(platform) = platform_for_agent(&agent) else {
        entries.push(PreparedExternalEntry {
            source_id,
            body: PreparedBody::Skipped(SkipBucket::Unsupported(agent)),
        });
        return;
    };

    let access_only = object.get("accessOnly").and_then(Value::as_bool) == Some(true);
    let display_name = match user.is_empty() {
        true => agent.clone(),
        false => user.clone(),
    } + if access_only { " (access-only)" } else { "" };

    match normalize_login_auth(object, &agent, &user, access_only) {
        Ok(credential) => entries.push(PreparedExternalEntry {
            source_id,
            body: PreparedBody::Official(ParsedOfficialCredential {
                display_name,
                ..credential
            }),
        }),
        Err(LoginAuthIssue::Invalid) => entries.push(PreparedExternalEntry {
            source_id,
            body: PreparedBody::Broken {
                kind: "official".to_string(),
                display_name,
                issue_code: "external_import.official_snapshot_invalid",
                platform_hint: Some(platform),
            },
        }),
    }
}

fn platform_for_agent(agent: &str) -> Option<PlatformId> {
    match agent.trim().to_ascii_lowercase().as_str() {
        "codex" => Some(PlatformId::Codex),
        "claude" => Some(PlatformId::Claude),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoginAuthIssue {
    Invalid,
}

/// Keep the native login JSON boundary explicit so readers preserve secrets
/// and refresh metadata without re-parsing a made-up placeholder format.
fn normalize_login_auth(
    login: &Map<String, Value>,
    agent: &str,
    user: &str,
    access_only: bool,
) -> Result<ParsedOfficialCredential, LoginAuthIssue> {
    let auth = login
        .get("auth")
        .and_then(Value::as_object)
        .ok_or(LoginAuthIssue::Invalid)?;
    match agent {
        "codex" => {
            let native = auth
                .get("tokens")
                .and_then(Value::as_object)
                .map(|tokens| json!({
                    "auth_mode": auth.get("auth_mode"),
                    "client_id": auth.get("client_id"),
                    "tokens": tokens,
                    "last_refresh": auth.get("last_refresh"),
                }).to_string())
                .or_else(|| Some(Value::Object(auth.clone()).to_string()))
                .ok_or(LoginAuthIssue::Invalid)?;
            let credential = if access_only {
                super::codex_oauth::credential::parse_auth_json_access_only(&native, None)
            } else {
                super::codex_oauth::credential::parse_auth_json(&native, None)
            }.map_err(|_| LoginAuthIssue::Invalid)?;
            let mut credential = credential;
            if !user.is_empty() {
                credential.email = Some(user.to_string());
                credential.display_name = user.to_string();
            }
            Ok(credential)
        }
        "claude" => {
            // Magpie 的 setupToken 是无刷新能力的 Claude 访问令牌：按 Task 6 的裁定，
            // 仍作为官方凭据快照导入（订阅徽标，不承诺刷新；到期后需重新导入），
            // 既不降级成 API 凭据，也不静默刷新。
            let source = match auth
                .get("setupToken")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|token| !token.is_empty())
            {
                Some(token) => json!({"type": "claude", "access_token": token}),
                None => {
                    let mut auth_object = auth.clone();
                    if let Some(user) = (!user.is_empty()).then(|| user.to_string()) {
                        let profile = auth_object
                            .entry("oauthAccount".to_string())
                            .or_insert_with(|| Value::Object(Map::new()));
                        if let Some(profile) = profile.as_object_mut() {
                            profile.entry("emailAddress".to_string()).or_insert(Value::String(user));
                        }
                    }
                    Value::Object(auth_object)
                }
            };
            let mut credential = parse_cpa_text(&source.to_string())
                .map_err(|_| LoginAuthIssue::Invalid)?
                .into_iter()
                .next()
                .ok_or(LoginAuthIssue::Invalid)?;
            if !user.is_empty() {
                credential.email = Some(user.to_string());
                if credential.display_name == "Official account" {
                    credential.display_name = user.to_string();
                }
            }
            Ok(credential)
        }
        // platform_for_agent already filtered unknown agents; reaching here means
        // a new agent string was added without a normalization arm.
        _ => Err(LoginAuthIssue::Invalid),
    }
}

fn string_field(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::platform::{ApiDialect, PlatformId};
    use crate::services::external_client_import_service::{PreparedBody, SkipBucket};
    use serde_json::json;
    use std::sync::Mutex;

    /// XDG_CONFIG_HOME is process-global; serialise the tests that touch it.
    static ENV_GUARD: Mutex<()> = Mutex::new(());

    async fn write_file(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        tokio::fs::write(&path, content).await.expect("write fixture");
        path
    }

    async fn prepare_with(dir: &Path) -> Vec<PreparedExternalEntry> {
        prepare_entries(dir).await.expect("prepare entries")
    }

    #[tokio::test]
    async fn remote_magpie_provider_is_counted_as_unsupported_not_imported() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "providers.json",
            r#"{"providers":[{"id":"remote-1","name":"Remote gateway","preset":"remote-magpie","key":"remote-key","chat":"http://192.0.2.1:3425/v1"}]}"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_id, "provider:remote-1:remote-magpie");
        assert!(matches!(
            &entries[0].body,
            PreparedBody::Skipped(SkipBucket::Unsupported(label)) if label == "remote-magpie"
        ));
    }

    #[tokio::test]
    async fn a_provider_with_several_protocol_urls_becomes_one_entry_each() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "providers.json",
            r#"{
                "providers": [{
                    "id": "relay1", "name": "多协议中转",
                    "key": "sk-multi",
                    "anthropic": "https://relay.example",
                    "chat": "https://relay.example/v1",
                    "headers": {"X-Debug": "1"},
                    "models": ["model-a", "model-b"]
                }]
            }"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source_id, "provider:relay1:anthropic");
        let PreparedBody::Api(anthropic) = &entries[0].body else {
            panic!("anthropic entry must be an API entry");
        };
        assert_eq!(anthropic.platform, PlatformId::Claude);
        assert_eq!(anthropic.interface_format, ApiDialect::Anthropic);
        assert_eq!(anthropic.base_url, "https://relay.example");
        assert_eq!(anthropic.api_key, "sk-multi");
        assert_eq!(
            anthropic.extra_headers,
            vec![("X-Debug".to_string(), "1".to_string())]
        );
        assert_eq!(anthropic.model_mappings.len(), 2);
        assert_eq!(anthropic.model_mappings[0].from, "model-a");

        assert_eq!(entries[1].source_id, "provider:relay1:chat");
        let PreparedBody::Api(chat) = &entries[1].body else {
            panic!("chat entry must be an API entry");
        };
        assert_eq!(chat.platform, PlatformId::Codex);
        assert_eq!(chat.interface_format, ApiDialect::OpenAi);
        assert_eq!(chat.base_url, "https://relay.example/v1");
    }

    #[tokio::test]
    async fn single_protocol_source_ids_still_carry_the_protocol_suffix() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "providers.json",
            r#"{
                "providers": [{
                    "id": "resp1", "name": "Responses",
                    "key": "sk-r",
                    "responses": "https://resp.example/v1"
                }]
            }"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_id, "provider:resp1:responses");
        let PreparedBody::Api(extracted) = &entries[0].body else {
            panic!("responses entry must be an API entry");
        };
        assert_eq!(extracted.interface_format, ApiDialect::OpenAiResponses);
        assert_eq!(extracted.platform, PlatformId::Codex);
    }

    #[tokio::test]
    async fn a_protocol_restricted_key_only_serves_its_own_protocol() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "providers.json",
            r#"{
                "providers": [{
                    "id": "dual", "name": "分协议 key",
                    "key": "sk-anthropic",
                    "keyProtocol": "anthropic",
                    "anthropic": "https://relay.example",
                    "chat": "https://relay.example/v1"
                }]
            }"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 2);
        let PreparedBody::Api(anthropic) = &entries[0].body else {
            panic!("anthropic entry must use the restricted key");
        };
        assert_eq!(anthropic.api_key, "sk-anthropic");
        match &entries[1].body {
            PreparedBody::Broken { issue_code, .. } => {
                assert_eq!(*issue_code, "external_import.api_key_missing");
            }
            other => panic!("chat must lack a key, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_provider_without_any_key_lists_broken_rows() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "providers.json",
            r#"{
                "providers": [{
                    "id": "nokey", "name": "无 key",
                    "responses": "https://nokey.example/v1"
                }]
            }"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        match &entries[0].body {
            PreparedBody::Broken { issue_code, .. } => {
                assert_eq!(*issue_code, "external_import.api_key_missing");
            }
            other => panic!("keyless provider must be broken, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn codex_logins_normalize_into_official_entries() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "logins.json",
            r#"[{
                "id": "login-1",
                "agent": "codex",
                "user": "user@example.com",
                "plan": "plus",
                "auth": {"auth_mode": "chatgpt", "tokens": {
                    "id_token": "id-token",
                    "access_token": "at-token",
                    "refresh_token": "rt-token",
                    "account_id": "acc-1",
                    "client_id": "fixture-codex-client"
                }}
            }]"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_id, "login:login-1");
        let PreparedBody::Official(credential) = &entries[0].body else {
            panic!("codex login must be an Official entry");
        };
        assert_eq!(credential.platform, "codex");
        assert_eq!(credential.email.as_deref(), Some("user@example.com"));
        assert_eq!(credential.display_name, "user@example.com");
        let secret: serde_json::Value =
            serde_json::from_str(&credential.secret_payload_json).expect("secret");
        assert_eq!(secret["access_token"], "at-token");
        assert_eq!(secret["refresh_token"], "rt-token");
        assert_eq!(secret["account_id"], "acc-1");
    }

    #[tokio::test]
    async fn claude_logins_normalize_into_official_entries() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "logins.json",
            r#"[{
                "id": "login-2",
                "agent": "claude",
                "user": "claude@example.com",
                "auth": {"claudeAiOauth": {
                    "accessToken": "sk-ant-oat01-abc",
                    "refreshToken": "sk-ant-ort01-abc",
                    "expiresAt": 1730000000000
                }}
            }]"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_id, "login:login-2");
        let PreparedBody::Official(credential) = &entries[0].body else {
            panic!("claude login must be an Official entry");
        };
        assert_eq!(credential.platform, "claude");
        assert_eq!(credential.email.as_deref(), Some("claude@example.com"));
        let secret: serde_json::Value =
            serde_json::from_str(&credential.secret_payload_json).expect("secret");
        assert_eq!(secret["access_token"], "sk-ant-oat01-abc");
        assert_eq!(secret["refresh_token"], "sk-ant-ort01-abc");
    }

    #[tokio::test]
    async fn setup_token_logins_import_as_claude_accounts() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "logins.json",
            r#"[{
                "id": "login-3",
                "agent": "claude",
                "user": "",
                "auth": {"setupToken": "sk-ant-oat01-setup"}
            }]"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        let PreparedBody::Official(credential) = &entries[0].body else {
            panic!("setup token must be an Official entry");
        };
        assert_eq!(credential.platform, "claude");
        let secret: serde_json::Value =
            serde_json::from_str(&credential.secret_payload_json).expect("secret");
        assert_eq!(secret["access_token"], "sk-ant-oat01-setup");
        assert_eq!(entries[0].source_id, "login:login-3");
    }

    #[tokio::test]
    async fn unrelated_agents_are_skipped_with_a_label() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "logins.json",
            r#"[
                {"id": "cop1", "agent": "copilot", "user": "dev@example.com", "auth": {}},
                {"id": "gem1", "agent": "gemini", "user": "g@example.com", "auth": {}}
            ]"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        assert_eq!(entries.len(), 2);
        for entry in &entries {
            match &entry.body {
                PreparedBody::Skipped(SkipBucket::Unsupported(label)) => {
                    assert!(label == "copilot" || label == "gemini");
                }
                other => panic!("unrelated agent must be skipped, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn access_only_logins_are_marked_in_their_display_name() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_file(
            dir.path(),
            "logins.json",
            r#"[{
                "id": "ao1",
                "agent": "codex",
                "user": "ao@example.com",
                "accessOnly": true,
                "auth": {"client_id": "magpie-client", "tokens": {"access_token": "at", "id_token": "id", "account_id": "ao-account"}}
            }]"#,
        )
        .await;

        let entries = prepare_with(dir.path()).await;
        let PreparedBody::Official(credential) = &entries[0].body else {
            panic!("access-only login must be an Official entry");
        };
        assert!(credential.display_name.contains("(access-only)"));
    }

    #[test]
    fn xdg_config_home_resolves_the_config_dir() {
        let _guard = ENV_GUARD.lock().expect("guard");
        let xdg = tempfile::tempdir().expect("temp dir");
        std::env::set_var("XDG_CONFIG_HOME", xdg.path());
        let resolved = resolve_source_dir(None).expect("resolve");
        assert_eq!(resolved, xdg.path().join("magpie"));
        std::env::remove_var("XDG_CONFIG_HOME");
    }

    #[tokio::test]
    async fn more_than_two_thousand_entries_are_refused() {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut providers = String::new();
        for index in 0..EXTERNAL_CLIENT_MAX_ITEMS + 1 {
            providers.push_str(&format!(
                r#"{{"id":"p{index}","chat":"https://h{index}.example/v1","key":"sk-{index}"}}"#
            ));
            if index < EXTERNAL_CLIENT_MAX_ITEMS {
                providers.push(',');
            }
        }
        write_file(
            dir.path(),
            "providers.json",
            &format!(r#"{{"providers":[{providers}]}}"#),
        )
        .await;

        let error = prepare_entries(dir.path()).await.expect_err("too many");
        assert!(matches!(
            error,
            AppError::Validation {
                code: "external_import.too_many_items",
                ..
            }
        ));
    }

    /// 尺寸检查必须发生在 JSON 解析之前：超大文件以大小错误拒绝，
    /// 而不是先整块读入再碰运气解析。
    #[tokio::test]
    async fn oversized_source_file_is_rejected_before_json_parsing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let oversized = format!(
            r#"{{"providers":[{{"id":"big","chat":"https://big.example/v1","key":"sk-{}"}}]}}"#,
            "x".repeat(EXTERNAL_CLIENT_MAX_SOURCE_BYTES + 1)
        );
        write_file(dir.path(), "providers.json", &oversized).await;

        let error = prepare_entries(dir.path()).await.expect_err("too large");
        assert!(matches!(
            error,
            AppError::Validation {
                code: "external_import.source_too_large",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn either_file_alone_is_enough_and_both_missing_reports_not_found() {
        let only_logins = tempfile::tempdir().expect("temp dir");
        // 无 id 的登录回退 agent:user 形态。
        write_file(only_logins.path(), "logins.json", r#"[{"agent":"codex","user":"fallback@example.com","auth":{"tokens":{"access_token":"at","refresh_token":"rt"}}}]"#).await;
        let entries = prepare_with(only_logins.path()).await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_id, "login:codex:fallback@example.com");

        let only_providers = tempfile::tempdir().expect("temp dir");
        write_file(only_providers.path(), "providers.json", r#"{"providers":[]}"#).await;
        let entries = prepare_with(only_providers.path()).await;
        assert!(entries.is_empty());

        let empty = tempfile::tempdir().expect("temp dir");
        let error = prepare_entries(empty.path()).await.expect_err("no files");
        assert!(matches!(
            error,
            AppError::Validation {
                code: "external_import.source_not_found",
                ..
            }
        ));
    }
}
