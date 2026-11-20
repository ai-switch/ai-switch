use crate::error::AppError;
use crate::models::external_client_import::EXTERNAL_CLIENT_MAX_ITEMS;
use crate::services::codex_plus_import_service as codex_plus;
use crate::services::external_client_import_service::PreparedExternalEntry;
use crate::services::magpie_import_service as magpie;
use serde_json::Value;

/// Only claim shapes that identify an external client. Generic CPA/Sub2API
/// objects continue through the existing batch parser.
pub(crate) fn prepare_json(
    value: &Value,
) -> Option<Result<Vec<PreparedExternalEntry>, AppError>> {
    if value.get("format").and_then(Value::as_str) == Some("magpie-backup") {
        return Some(Err(export_error(
            "external_import.encrypted_backup",
            "Magpie 加密备份不能直接导入，请在 Magpie 中导出 Sub2API 或 CLIProxyAPI 账号 JSON。",
        )));
    }
    if value.get("schema").is_some() && value.get("settings").is_some() {
        return Some((|| {
            if value.get("schema").and_then(Value::as_u64) != Some(1) {
                return Err(export_error(
                    "external_import.export_version_unsupported",
                    "不支持此 Codex++ 导出版本，请使用 schema 1 的完整配置 JSON。",
                ));
            }
            let settings = &value["settings"];
            validate_collection(settings.get("relayProfiles"))?;
            codex_plus::prepare_values(Some(settings), None, None).and_then(nonempty)
        })());
    }
    if value.get("relayProfiles").is_some() {
        return Some((|| {
            validate_collection(value.get("relayProfiles"))?;
            codex_plus::prepare_values(Some(value), None, None).and_then(nonempty)
        })());
    }
    let providers = value.get("providers").and_then(Value::as_array);
    if providers.is_some_and(|providers| providers.iter().any(|item| item.get("relay").is_some())) {
        return Some((|| {
            validate_collection(value.get("providers"))?;
            codex_plus::prepare_values(None, Some(value), None).and_then(nonempty)
        })());
    }
    let native_logins = value.as_array().filter(|items| items.iter().any(is_magpie_login));
    let wrapped_logins = value.get("logins").and_then(Value::as_array)
        .filter(|items| items.iter().any(is_magpie_login));
    let native_providers = providers.is_some_and(|items| items.iter().any(is_magpie_provider));
    if native_providers || native_logins.is_some() || wrapped_logins.is_some() {
        return Some((|| {
            let logins = if native_logins.is_some() { Some(value) } else { value.get("logins") };
            if value.get("providers").is_some() {
                validate_collection(value.get("providers"))?;
            }
            if let Some(logins) = logins {
                validate_collection(Some(logins))?;
            }
            magpie::prepare_values(
                native_providers.then_some(value),
                logins,
            ).and_then(nonempty)
        })());
    }
    None
}

fn is_magpie_provider(value: &Value) -> bool {
    ["chat", "responses", "anthropic", "gemini", "keyProtocol"]
        .iter().any(|field| value.get(*field).is_some())
}

fn is_magpie_login(value: &Value) -> bool {
    value.get("agent").and_then(Value::as_str).is_some() && value.get("auth").is_some()
}

fn validate_collection(value: Option<&Value>) -> Result<(), AppError> {
    let items = value.and_then(Value::as_array).ok_or_else(|| export_error(
        "external_import.export_invalid",
        "客户端导出 JSON 的账号列表必须为数组。",
    ))?;
    if items.len() > EXTERNAL_CLIENT_MAX_ITEMS {
        return Err(export_error("external_import.too_many_items", "单次最多导入 2000 个账号条目。"));
    }
    Ok(())
}

fn nonempty(entries: Vec<PreparedExternalEntry>) -> Result<Vec<PreparedExternalEntry>, AppError> {
    if entries.is_empty() {
        return Err(export_error("external_import.export_empty", "此客户端 JSON 中没有账号条目。"));
    }
    Ok(entries)
}

fn export_error(code: &'static str, message: &str) -> AppError {
    AppError::Validation {
        code,
        message: message.to_string(),
        details: None,
        recoverable: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::platform::ApiDialect;
    use crate::services::external_client_import_service::{PreparedBody, SkipBucket};
    use serde_json::json;

    #[test]
    fn codex_export_preserves_api_and_official_credentials() {
        let document = json!({
            "schema": 1,
            "exported_at_ms": 1_800_000_000_000i64,
            "settings": {"relayProfiles": [
                {"id":"api", "name":"Exported relay", "relayMode":"pureApi",
                 "upstreamBaseUrl":"https://relay.example/v1", "apiKey":"sk-exported",
                 "protocol":"anthropicMessages", "anthropicAuthHeader":"authorization",
                 "modelList":"claude-test", "customHeaders":[{"key":"X-Relay","value":"relay-value"}]},
                {"id":"oauth", "name":"Exported subscription", "relayMode":"official",
                 "authContents":crate::services::codex_plus_import_service::test_support::valid_auth()}
            ]}
        });
        let entries = prepare_json(&document).expect("recognized export").expect("entries");
        assert_eq!(entries.len(), 2);
        let PreparedBody::Api(api) = &entries[0].body else { panic!("API relay") };
        assert_eq!(api.interface_format, ApiDialect::Anthropic);
        assert_eq!(api.api_key, "sk-exported");
        assert_eq!(api.api_key_field, Some("ANTHROPIC_AUTH_TOKEN"));
        assert_eq!(api.model_mappings[0].to, "claude-test");
        assert_eq!(api.extra_headers, vec![("X-Relay".to_string(), "relay-value".to_string())]);
        let PreparedBody::Official(official) = &entries[1].body else { panic!("OAuth snapshot") };
        let config: serde_json::Value = serde_json::from_str(&official.config_json).unwrap();
        assert_eq!(config["client_id"], "codex-cli-client");
        assert_eq!(config["token_endpoint"], "https://auth.openai.com/oauth/token");
        assert!(!official.config_json.contains("codex-refresh-token"));
    }

    #[test]
    fn magpie_plaintext_providers_expand_per_protocol() {
        let entries = prepare_json(&json!({"providers":[
            {"id":"multi", "name":"Multi", "key":"sk-magpie",
             "responses":"https://relay.example/v1", "anthropic":"https://relay.example",
             "headers":{"X-Relay":"value"}, "models":["model-a"]}
        ]})).unwrap().unwrap();
        assert_eq!(entries.len(), 2);
        for entry in entries {
            let PreparedBody::Api(api) = entry.body else { panic!("API provider") };
            assert_eq!(api.api_key, "sk-magpie");
            assert_eq!(api.extra_headers, vec![("X-Relay".to_string(), "value".to_string())]);
            assert_eq!(api.model_mappings[0].to, "model-a");
        }
    }

    #[test]
    fn magpie_native_logins_keep_oauth_kind() {
        let entries = prepare_json(&json!([
            {"id":"claude", "agent":"claude", "user":"claude@example.com",
             "auth":{"claudeAiOauth":{"accessToken":"access","refreshToken":"refresh",
                "expiresAt":2_000_000_000_000i64,"scopes":["user:inference"]}}}
        ])).unwrap().unwrap();
        let PreparedBody::Official(official) = &entries[0].body else { panic!("official login") };
        assert_eq!(official.platform, "claude");
        assert_eq!(official.email.as_deref(), Some("claude@example.com"));
    }

    #[test]
    fn invalid_entries_are_reported_without_losing_valid_neighbors() {
        let entries = prepare_json(&json!({"schema":1,"settings":{"relayProfiles":[
            {"id":"good","relayMode":"pureApi","apiKey":"good-key","baseUrl":"https://relay.example/v1"},
            {"id":"bad","relayMode":"official","authContents":"private-token"},
            {"id":"aggregate","relayMode":"aggregate"},
            {"apiKey":"secret-without-id"},
            null
        ]}})).unwrap().unwrap();
        assert_eq!(entries.len(), 5);
        assert!(matches!(entries[0].body, PreparedBody::Api(_)));
        assert!(matches!(entries[1].body, PreparedBody::Broken { .. }));
        assert!(matches!(entries[2].body, PreparedBody::Skipped(SkipBucket::Unsupported(_))));
        assert!(matches!(entries[3].body, PreparedBody::Broken { .. }));
        assert!(matches!(entries[4].body, PreparedBody::Broken { .. }));
    }

    #[test]
    fn rejects_unknown_schema_encrypted_backups_and_invalid_collections() {
        for (document, code) in [
            (json!({"schema":2,"settings":{"relayProfiles":[]}}), "external_import.export_version_unsupported"),
            (json!({"schema":1,"settings":{"relayProfiles":"private-content"}}), "external_import.export_invalid"),
            (json!({"format":"magpie-backup","version":1,"data":"encrypted-secret"}), "external_import.encrypted_backup"),
            (json!({"schema":1,"settings":{"relayProfiles":[]}}), "external_import.export_empty"),
        ] {
            let error = prepare_json(&document).expect("recognized format").expect_err("rejected");
            assert_eq!(error.code(), code);
            assert!(!error.to_string().contains("private-content"));
            assert!(!error.to_string().contains("encrypted-secret"));
        }
    }

    #[test]
    fn malformed_magpie_rows_are_reported_alongside_valid_rows() {
        let entries = prepare_json(&json!({
            "providers":[
                {"id":"good","key":"key","chat":"https://relay.example"},
                {"key":"private-key","chat":"https://relay.example"},
                null
            ],
            "logins":[
                {"agent":"claude","user":"user@example.com","auth":{"setupToken":"setup-token"}},
                {"auth":{"setupToken":"private-token"}},
                null
            ]
        })).unwrap().unwrap();
        assert_eq!(entries.len(), 6);
        assert!(matches!(entries[0].body, PreparedBody::Api(_)));
        assert!(matches!(entries[1].body, PreparedBody::Broken { .. }));
        assert!(matches!(entries[2].body, PreparedBody::Broken { .. }));
        assert!(matches!(entries[3].body, PreparedBody::Official(_)));
        assert!(matches!(entries[4].body, PreparedBody::Broken { .. }));
        assert!(matches!(entries[5].body, PreparedBody::Broken { .. }));
    }

    #[test]
    fn ordinary_cpa_sub2api_and_other_providers_are_not_misidentified() {
        for document in [
            json!({"type":"claude","access_token":"access"}),
            json!({"type":"sub2api-data","accounts":[{"platform":"openai","credentials":{"access_token":"access"}}]}),
            json!({"providers":[{"name":"different-format","base_url":"https://example.com"}]}),
            json!([{"type":"api","api-key":"key","base-url":"https://example.com"}]),
        ] {
            assert!(prepare_json(&document).is_none());
        }
    }
}
