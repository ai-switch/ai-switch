use crate::error::AppError;
use crate::models::platform::PlatformId;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedOfficialCredential {
    pub display_name: String,
    pub email: Option<String>,
    /// 逐条从凭据自身字段推断出的厂商 platform（codex/claude/gemini/grok）。
    /// 统一池下存储平台恒为 codex，这个字段只用来推导 `provider`。
    pub platform: String,
    pub secret_payload_json: String,
    pub config_json: String,
}

/// 从外部凭据自身的厂商标记推断 platform。
///
/// 统一账号池下没有「选中平台」这回事：一条 CPA/Sub2API 列表可以同时含 OpenAI、
/// Claude、Gemini 订阅和 API 账号，厂商来源只能逐条从数据里读。这里集中所有别名
/// （type/provider/platform/app 的值都可能是 `anthropic` / `xai` / `openai` …），
/// 解析不出就返回错误，让该条目进失败列表而不是被错误地挂到别的厂商下。
pub fn infer_vendor_platform(value: &str) -> Option<PlatformId> {
    let platform = PlatformId::parse(value).ok()?;
    matches!(
        platform,
        PlatformId::Codex | PlatformId::Claude | PlatformId::Gemini | PlatformId::Grok
    )
    .then_some(platform)
}

pub fn parse_cpa_text(text: &str) -> Result<Vec<ParsedOfficialCredential>, AppError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(validation_error(
            "validation.cpa_empty",
            "CPA import text is empty",
            None,
        ));
    }

    let value: Value = serde_json::from_str(trimmed)?;

    match value {
        // Native Claude CLI export: `claudeAiOauth` has no type/vendor field, so it is
        // unambiguously Claude. Keep the special handling but infer the vendor from the
        // shape itself instead of a caller-supplied platform.
        Value::Object(object) if object.contains_key("claudeAiOauth") => {
            let mut native = object
                .get("claudeAiOauth")
                .and_then(Value::as_object)
                .cloned()
                .ok_or_else(|| {
                    validation_error(
                        "validation.cpa_shape",
                        "claudeAiOauth must be an object",
                        None,
                    )
                })?;
            if let Some(expiry) = native.get("expiresAt").cloned() {
                native.insert("expired".to_string(), expiry);
            }
            // The `claudeAiOauth` shape itself is an unambiguous Claude export.
            native
                .entry("type".to_string())
                .or_insert_with(|| json!("claude"));
            parse_cpa_object(&native).map(|credential| vec![credential])
        }
        Value::Object(object) => match object.get("accounts") {
            Some(accounts) => parse_cpa_accounts_wrapper(accounts),
            None => parse_cpa_object(&object).map(|credential| vec![credential]),
        },
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let object = item.as_object().ok_or_else(|| {
                    validation_error(
                        "validation.cpa_entry_object",
                        "CPA array entries must be objects",
                        Some(format!("Entry {index} is not an object")),
                    )
                })?;
                parse_cpa_object(object)
            })
            .collect(),
        _ => Err(validation_error(
            "validation.cpa_shape",
            "CPA import JSON must be an object or array",
            Some(trimmed.to_string()),
        )),
    }
}

pub fn parse_cpa_file<P: AsRef<Path>>(
    path: P,
    content: &str,
) -> Result<Vec<ParsedOfficialCredential>, AppError> {
    parse_cpa_text(content).map_err(|err| with_file_context(err, path.as_ref()))
}

fn parse_cpa_object(object: &Map<String, Value>) -> Result<ParsedOfficialCredential, AppError> {
    // Vendor is inferred from each entry itself. `normalize_cpa_wrapper_account` has
    // already promoted wrapper `provider`/`platform`/`app` into `type`.
    let raw_type = string_field(object, &["type", "provider", "platform", "app"]);
    let platform = infer_vendor_platform(raw_type.as_deref().unwrap_or(""))
        .or_else(|| infer_platform_from_token(object))
        .ok_or_else(|| {
            validation_error(
                "validation.cpa_platform_undetermined",
                "Cannot determine account vendor from CPA entry; add a type/provider field",
                None,
            )
        })?;
    let platform = platform.as_str();

    let email = string_field(object, &["email"]);
    let display_name = string_field(object, &["display_name", "displayName", "name", "label"])
        .or_else(|| email.clone())
        .unwrap_or_else(|| "Official account".to_string());

    let id_token = token_field(object, "id_token", "idToken");
    let access_token = token_field(object, "access_token", "accessToken");
    let refresh_token = token_field(object, "refresh_token", "refreshToken");
    let account_id = token_field(object, "account_id", "accountId");

    if !access_token
        .as_deref()
        .is_some_and(|token| !token.is_empty())
        && !refresh_token
            .as_deref()
            .is_some_and(|token| !token.is_empty())
    {
        return Err(validation_error(
            "validation.cpa_secret_required",
            "CPA credential requires a non-empty access_token or refresh_token",
            None,
        ));
    }
    if !access_token
        .as_deref()
        .is_some_and(|token| !token.is_empty())
        && !refresh_token
            .as_deref()
            .is_some_and(|token| !token.is_empty())
    {
        return Err(validation_error(
            "validation.cpa_secret_required",
            "CPA credential requires a non-empty access_token or refresh_token",
            None,
        ));
    }

    let last_refresh = value_field(object, &["last_refresh", "lastRefresh"]);
    let expired = value_field(object, &["expired"]);
    let base_url = string_field(object, &["base_url", "baseUrl"]);
    let token_endpoint = string_field(object, &["token_endpoint", "tokenEndpoint"]);
    let auth_kind = string_field(object, &["auth_kind", "authKind"]);
    let sub = string_field(object, &["sub"]);
    let token_type = string_field(object, &["token_type", "tokenType"]);
    let redirect_uri = string_field(object, &["redirect_uri", "redirectUri"]);
    let expires_in = value_field(object, &["expires_in", "expiresIn"]);
    let disabled = value_field(object, &["disabled"]);
    let headers = object
        .get("headers")
        .cloned()
        .filter(|value| value.is_object())
        .unwrap_or(Value::Null);
    let headers = normalize_imported_headers(platform, &headers);

    // Keep the original CPA object for lossless re-export / future fields.
    let raw = Value::Object(object.clone());

    let secret_payload_json = json!({
        "id_token": id_token,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "account_id": account_id,
    })
    .to_string();

    let mut config = Map::new();
    config.insert("type".to_string(), json!(platform));
    config.insert("raw_type".to_string(), json!(raw_type));
    config.insert("account_id".to_string(), json!(account_id));
    config.insert("last_refresh".to_string(), last_refresh);
    config.insert("expired".to_string(), expired);
    config.insert("expires_in".to_string(), expires_in);
    config.insert("disabled".to_string(), disabled);
    config.insert("raw".to_string(), raw);

    if platform == "claude" {
        for (field, aliases) in [
            ("scopes", &["scopes"][..]),
            ("subscription_type", &["subscription_type", "subscriptionType"][..]),
            ("rate_limit_tier", &["rate_limit_tier", "rateLimitTier"][..]),
            ("client_id", &["client_id", "clientId"][..]),
        ] {
            if let Some(value) = value_field_option(object, aliases).or_else(|| {
                object
                    .get("raw")
                    .and_then(Value::as_object)
                    .and_then(|raw| value_field_option(raw, aliases))
            }) {
                config.insert(field.to_string(), value);
            }
        }
    }

    if let Some(base_url) = base_url {
        config.insert("base_url".to_string(), json!(base_url));
    }
    if let Some(token_endpoint) = token_endpoint {
        config.insert("token_endpoint".to_string(), json!(token_endpoint));
    }
    if let Some(auth_kind) = auth_kind {
        config.insert("auth_kind".to_string(), json!(auth_kind));
    }
    if let Some(sub) = sub {
        config.insert("sub".to_string(), json!(sub));
    }
    if let Some(token_type) = token_type {
        config.insert("token_type".to_string(), json!(token_type));
    }
    if let Some(redirect_uri) = redirect_uri {
        config.insert("redirect_uri".to_string(), json!(redirect_uri));
    }
    if platform == "grok" || !headers.is_null() {
        config.insert("headers".to_string(), headers);
    }

    let config_json = Value::Object(config).to_string();

    Ok(ParsedOfficialCredential {
        display_name,
        email,
        platform: platform.to_string(),
        secret_payload_json,
        config_json,
    })
}

fn parse_cpa_accounts_wrapper(
    accounts: &Value,
) -> Result<Vec<ParsedOfficialCredential>, AppError> {
    let accounts = accounts.as_array().ok_or_else(|| {
        validation_error(
            "validation.cpa_accounts_array",
            "CPA accounts wrapper must contain an accounts array",
            None,
        )
    })?;

    accounts
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let object = item.as_object().ok_or_else(|| {
                validation_error(
                    "validation.cpa_entry_object",
                    "CPA accounts wrapper entries must be objects",
                    Some(format!("Entry {index} is not an object")),
                )
            })?;
            let normalized = normalize_cpa_wrapper_account(object);
            parse_cpa_object(&normalized)
        })
        .collect()
}

fn normalize_cpa_wrapper_account(object: &Map<String, Value>) -> Map<String, Value> {
    let mut normalized = object.clone();

    if !normalized.contains_key("type") {
        if let Some(provider) = value_field_option(object, &["provider", "platform", "app"]) {
            normalized.insert("type".to_string(), provider);
        }
    }

    if let Some(credentials) = object.get("credentials").and_then(Value::as_object) {
        for (key, value) in credentials {
            normalized
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }

    normalized
}

fn normalize_imported_headers(platform: &str, headers: &Value) -> Value {
    // Preserve non-Grok headers as-is.
    if platform != "grok" {
        return headers.clone();
    }

    // CLIProxyAPI chat-proxy identity headers (force-set on request too).
    // Older CPA exports only store User-Agent=grok-cli which upstream treats as version none.
    let mut map = match headers {
        Value::Object(object) => object.clone(),
        _ => Map::new(),
    };
    map.insert("User-Agent".to_string(), json!("xai-grok-workspace/0.2.93"));
    map.insert("X-XAI-Token-Auth".to_string(), json!("xai-grok-cli"));
    map.insert("x-grok-client-version".to_string(), json!("0.2.93"));
    map.remove("X-Client-Name");
    map.remove("x-client-name");
    Value::Object(map)
}

fn token_field(object: &Map<String, Value>, snake_case: &str, camel_case: &str) -> Option<String> {
    string_field(object, &[snake_case, camel_case]).or_else(|| {
        object
            .get("tokens")
            .and_then(Value::as_object)
            .and_then(|tokens| string_field(tokens, &[snake_case, camel_case]))
    })
}

fn string_field(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn value_field(object: &Map<String, Value>, keys: &[&str]) -> Value {
    value_field_option(object, keys).unwrap_or(Value::Null)
}

fn value_field_option(object: &Map<String, Value>, keys: &[&str]) -> Option<Value> {
    keys.iter().find_map(|key| object.get(*key).cloned())
}

/// Last-resort vendor inference from OAuth token shape, for exports that omit any
/// type/vendor field (e.g. the native `claudeAiOauth` object). Only Claude has a
/// recognizable token prefix; everything else must declare its vendor explicitly.
fn infer_platform_from_token(object: &Map<String, Value>) -> Option<PlatformId> {
    let token = token_field(object, "access_token", "accessToken")
        .or_else(|| token_field(object, "refresh_token", "refreshToken"))?;
    if token.starts_with("sk-ant-") {
        Some(PlatformId::Claude)
    } else {
        None
    }
}

fn validation_error(code: &'static str, message: &str, details: Option<String>) -> AppError {
    AppError::Validation {
        code,
        message: message.to_string(),
        details,
        recoverable: true,
    }
}

fn with_file_context(err: AppError, path: &Path) -> AppError {
    let label = path.to_string_lossy();
    match err {
        AppError::Validation {
            code,
            message,
            details,
            recoverable,
        } => AppError::Validation {
            code,
            message: format!("{label}: {message}"),
            details,
            recoverable,
        },
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_access_and_refresh_tokens() {
        let parsed = parse_cpa_text(
            r#"{"type":"codex","access_token":"","refresh_token":"","account_id":"account","client_id":"client"}"#,
        )
        .expect_err("empty token values must be rejected");
        assert!(matches!(
            parsed,
            AppError::Validation {
                code: "validation.cpa_secret_required",
                ..
            }
        ));
    }

    #[test]
    fn accepts_claude_setup_token_as_an_official_credential_snapshot() {
        let rows = parse_cpa_text(r#"{"type":"claude","access_token":"sk-ant-oat01-setup"}"#)
            .expect("setup token is an official credential snapshot");
        assert_eq!(rows.len(), 1);
        let secret: Value = serde_json::from_str(&rows[0].secret_payload_json).expect("secret");
        assert_eq!(secret["access_token"], "sk-ant-oat01-setup");
        assert_eq!(rows[0].platform, "claude");
    }

    #[test]
    fn preserves_native_claude_oauth_metadata_for_refresh_and_direct_mode() {
        let parsed = parse_cpa_text(
            r#"{"claudeAiOauth":{"accessToken":"access","refreshToken":"refresh","expiresAt":4070908800000,"refreshTokenExpiresAt":4071908800000,"scopes":["user:inference","user:profile"],"subscriptionType":"max","rateLimitTier":"default_claude_max_5x","clientId":"claude-client"}}"#,
        )
        .expect("native Claude OAuth");
        let config: Value = serde_json::from_str(&parsed[0].config_json).expect("config");
        assert_eq!(config["expired"], 4070908800000i64);
        assert_eq!(config["subscription_type"], "max");
        assert_eq!(config["rate_limit_tier"], "default_claude_max_5x");
        assert_eq!(config["client_id"], "claude-client");
        assert_eq!(config["scopes"], json!(["user:inference", "user:profile"]));
    }

    #[test]
    fn parses_cliproxyapi_codex_object() {
        let text = r#"{
          "type":"codex",
          "email":"a@example.com",
          "id_token":"id",
          "access_token":"at",
          "refresh_token":"rt_1",
          "account_id":"ac_1"
        }"#;
        let parsed = parse_cpa_text(text).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].email.as_deref(), Some("a@example.com"));
        assert_eq!(parsed[0].platform, "codex");
        assert!(parsed[0].secret_payload_json.contains("rt_1"));
    }

    #[test]
    fn parses_nested_and_camel_case_array() {
        let text = r#"[{
          "type":"claude",
          "email":"b@example.com",
          "tokens":{"accessToken":"sk-ant-oat01-x","refreshToken":"sk-ant-ort01-y"}
        }]"#;
        let parsed = parse_cpa_text(text).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].platform, "claude");
    }

    #[test]
    fn parses_accounts_wrapper_export() {
        let text = r#"{"accounts":[{"provider":"anthropic","email":"x@example.com","credentials":{"access_token":"a","refresh_token":"b"}}]}"#;
        let parsed = parse_cpa_text(text).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].email.as_deref(), Some("x@example.com"));
        assert_eq!(parsed[0].platform, "claude");
        assert!(parsed[0]
            .secret_payload_json
            .contains("\"access_token\":\"a\""));
        assert!(parsed[0]
            .secret_payload_json
            .contains("\"refresh_token\":\"b\""));
        assert!(parsed[0].config_json.contains("\"raw\""));
    }

    #[test]
    fn infers_each_vendor_independently_in_mixed_wrapper() {
        // 一个列表里同时含 Claude 订阅与 OpenAI 订阅：逐条推断，互不干扰。
        let text = r#"{"accounts":[
          {"provider":"anthropic","email":"c@example.com","credentials":{"access_token":"sk-ant-oat01-a","refresh_token":"sk-ant-ort01-b"}},
          {"provider":"openai","email":"o@example.com","credentials":{"access_token":"at","refresh_token":"rt"}},
          {"platform":"xai","email":"g@example.com","credentials":{"access_token":"at","refresh_token":"rt"}}
        ]}"#;
        let parsed = parse_cpa_text(text).unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(
            parsed.iter().map(|item| item.platform.as_str()).collect::<Vec<_>>(),
            vec!["claude", "codex", "grok"]
        );
    }

    #[test]
    fn rejects_unknown_vendor_without_a_selected_platform() {
        let text = r#"{"type":"my-grok-wrapper","access_token":"at","refresh_token":"rt"}"#;

        let error = parse_cpa_text(text).expect_err("substring aliases are unsafe");

        assert!(matches!(
            error,
            AppError::Validation {
                code: "validation.cpa_platform_undetermined",
                ..
            }
        ));
    }

    #[test]
    fn accepts_xai_type_alias_for_grok_vendor() {
        let text = r#"{
          "type":"xai",
          "email":"g@example.com",
          "access_token":"at-xai",
          "refresh_token":"rt-xai",
          "id_token":"id-xai",
          "token_type":"Bearer",
          "expires_in":null,
          "expired":"2026-07-21T10:31:25Z",
          "last_refresh":"2026-07-21T04:31:26Z",
          "auth_kind":"oauth",
          "sub":"2835da8c-3bdf-4096-9920-0af2a8dc325b",
          "redirect_uri":"",
          "token_endpoint":"https://auth.x.ai/oauth2/token",
          "base_url":"https://cli-chat-proxy.grok.com/v1",
          "disabled":false,
          "headers":{
            "User-Agent":"grok-cli",
            "X-Client-Name":"grok-cli"
          }
        }"#;
        let parsed = parse_cpa_text(text).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].email.as_deref(), Some("g@example.com"));
        assert_eq!(parsed[0].platform, "grok");
        assert!(parsed[0].secret_payload_json.contains("at-xai"));
        assert!(parsed[0].secret_payload_json.contains("rt-xai"));
        assert!(parsed[0].secret_payload_json.contains("id-xai"));
        assert!(parsed[0].config_json.contains("\"type\":\"grok\""));
        assert!(parsed[0].config_json.contains("\"raw_type\":\"xai\""));
        assert!(parsed[0]
            .config_json
            .contains("https://cli-chat-proxy.grok.com/v1"));
        assert!(parsed[0]
            .config_json
            .contains("https://auth.x.ai/oauth2/token"));
        assert!(parsed[0].config_json.contains("xai-grok-workspace/0.2.93"));
        assert!(parsed[0].config_json.contains("x-grok-client-version"));
        // Stored headers are upgraded; original CPA payload remains in raw for lossless re-export.
        assert!(
            parsed[0]
                .config_json
                .contains("\"headers\":{\"User-Agent\":\"xai-grok-workspace/0.2.93\"")
                || parsed[0].config_json.contains("xai-grok-workspace/0.2.93")
        );
        assert!(parsed[0].config_json.contains("\"auth_kind\":\"oauth\""));
        assert!(parsed[0]
            .config_json
            .contains("2835da8c-3bdf-4096-9920-0af2a8dc325b"));
        assert!(parsed[0].config_json.contains("\"raw\""));
    }

    #[test]
    fn xai_and_grok_aliases_both_resolve_to_grok() {
        for alias in ["grok", "xai"] {
            let text = format!(r#"{{"type":"{alias}","access_token":"at","refresh_token":"rt"}}"#);
            let parsed = parse_cpa_text(&text).unwrap();
            assert_eq!(parsed.len(), 1);
            assert_eq!(parsed[0].platform, "grok");
            assert!(parsed[0].config_json.contains("\"type\":\"grok\""));
        }
    }

    #[test]
    fn fills_default_grok_cli_headers_when_missing() {
        let text = r#"{"type":"xai","access_token":"at","refresh_token":"rt","base_url":"https://cli-chat-proxy.grok.com/v1"}"#;
        let parsed = parse_cpa_text(text).unwrap();
        assert!(parsed[0].config_json.contains("xai-grok-workspace/0.2.93"));
        assert!(parsed[0].config_json.contains("x-grok-client-version"));
        assert!(parsed[0].config_json.contains("X-XAI-Token-Auth"));
    }
}

#[cfg(test)]
mod native_claude_auth_tests {
    use super::*;
    #[test]
    fn imports_native_claude_oauth_with_expiry_and_scopes_for_direct_mode() {
        let input = r#"{"claudeAiOauth":{"accessToken":"at","refreshToken":"rt","expiresAt":4070908800000,"scopes":["user:inference","user:profile"],"subscriptionType":"max"}}"#;
        let rows = parse_cpa_text(input).unwrap();
        assert_eq!(rows[0].platform, "claude");
        let config: Value = serde_json::from_str(&rows[0].config_json).unwrap();
        assert_eq!(config["expired"], 4070908800000i64);
        let secret: Value = serde_json::from_str(&rows[0].secret_payload_json).unwrap();
        assert_eq!(secret["access_token"], "at");
        assert_eq!(
            config["raw"]["scopes"],
            json!(["user:inference", "user:profile"])
        );
    }
}
