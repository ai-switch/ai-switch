//! 直连配置的纯生成器；不读取用户真实登录，不把解析输入带进错误信息。
use crate::config_writer::hash_bytes;
use crate::error::AppError;
use serde_json::{json, Map, Value};
use toml_edit::{value, Document, Item, Table};

pub(crate) struct RenderedDirectProfile {
    pub config: Vec<u8>,
    pub auth: Vec<u8>,
}

pub(crate) fn failure(code: &'static str, message: &str) -> AppError {
    AppError::Validation {
        code,
        message: message.to_string(),
        details: None,
        recoverable: true,
    }
}

fn object(bytes: Option<&[u8]>) -> Result<Value, AppError> {
    let parsed = match bytes {
        None => json!({}),
        Some(b) => serde_json::from_slice(b).map_err(|_| {
            failure(
                "direct_mode.invalid_config",
                "配置或认证文件不是有效 JSON，未覆盖原文件。",
            )
        })?,
    };
    if !parsed.is_object() {
        return Err(failure(
            "direct_mode.invalid_config",
            "配置或认证文件必须是 JSON 对象，未覆盖原文件。",
        ));
    }
    Ok(parsed)
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn required<'a>(v: &'a Value, key: &str) -> Result<&'a str, AppError> {
    text(v, key).ok_or_else(|| {
        failure(
            "direct_mode.missing_credentials",
            &format!("该账号缺少 {key}，请导入完整登录凭据后再启用直连模式。"),
        )
    })
}

fn bytes(v: &Value) -> Vec<u8> {
    // Value 的序列化不会包含不支持的键类型。
    serde_json::to_vec_pretty(v).expect("JSON value")
}

fn toml_document(existing: Option<&[u8]>) -> Result<Document, AppError> {
    match existing {
        None => Ok(Document::new()),
        Some(b) => std::str::from_utf8(b)
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| {
                failure(
                    "direct_mode.invalid_config",
                    "Codex 配置无法解析，未覆盖原文件。",
                )
            }),
    }
}

fn upstream_model(config: &Value) -> Option<String> {
    config
        .get("model_mappings")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .filter(|row| row.get("enabled").and_then(Value::as_bool) != Some(false))
                .find_map(|row| text(row, "to").filter(|s| *s != "*").map(str::to_string))
        })
        .or_else(|| text(config, "model").map(str::to_string))
}

// Claude SDK 自行追加 /v1/messages；账号地址若已带 /v1，先去掉重复版本段。
// 通过解析后的 path 判断，不能把域名恰好叫 v1 的地址截坏。
fn claude_api_base(mut base: &str) -> &str {
    while url::Url::parse(base).is_ok_and(|url| url.path().ends_with("/v1")) {
        base = &base[..base.len() - 3];
    }
    base
}

pub(crate) const CLAUDE_AUTH_ENV: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "AI_SWITCH_ROUTE_PROXY",
    "AI_SWITCH_ROUTE_PROXY_API_KEY",
];

/// 仅移除会改变认证、模型或端点选择的配置；权限、MCP、插件等原样保留。
pub(crate) fn clean_claude_settings(existing: Option<&[u8]>) -> Result<Value, AppError> {
    let mut root = object(existing)?;
    let root_obj = root.as_object_mut().expect("object");
    root_obj.remove("apiKeyHelper");
    root_obj.remove("model");
    let env = root_obj
        .entry("env")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            failure(
                "direct_mode.invalid_config",
                "Claude 的 env 必须是对象，未覆盖原文件。",
            )
        })?;
    for key in CLAUDE_AUTH_ENV {
        env.remove(*key);
    }
    if let Some(ai_switch) = root_obj.get_mut("aiSwitch").and_then(Value::as_object_mut) {
        ai_switch.remove("routeProxy");
    }
    Ok(root)
}

/// CPA 保留 raw，原生导入保留完整 OAuth 对象；不要凭空增加 token 的权限/订阅。
fn metadata<'a>(secret: &'a Value, config: &'a Value, names: &[&str]) -> Option<&'a Value> {
    for source in [
        secret,
        config,
        &config["raw"],
        &config["raw"]["claudeAiOauth"],
        &secret["claudeAiOauth"],
    ] {
        for name in names {
            if let Some(v) = source.get(*name).filter(|v| !v.is_null()) {
                return Some(v);
            }
        }
    }
    None
}

fn expiry_millis(secret: &Value, config: &Value) -> Result<i64, AppError> {
    let v = metadata(secret, config, &["expiresAt", "expires_at", "expired"]).ok_or_else(|| {
        failure(
            "direct_mode.missing_credentials",
            "Claude 官方直连需要 expiresAt/expired，请导入完整 OAuth 凭据。",
        )
    })?;
    let n = v
        .as_i64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()));
    if let Some(n) = n.filter(|n| *n > 0) {
        return Ok(if n < 10_000_000_000 { n * 1000 } else { n });
    }
    v.as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .ok_or_else(|| {
            failure(
                "direct_mode.missing_credentials",
                "官方凭据的过期时间无效。",
            )
        })
}

pub(crate) fn render(
    platform: &str,
    kind: &str,
    secret: &str,
    config: &str,
    existing: Option<&[u8]>,
    existing_auth: Option<&[u8]>,
) -> Result<RenderedDirectProfile, AppError> {
    if !matches!(platform, "codex" | "claude") || !matches!(kind, "api" | "official") {
        return Err(failure(
            "direct_mode.unsupported",
            "直连模式仅支持 Codex / Claude 的 API 和官方账号。",
        ));
    }
    let secret = object(Some(secret.as_bytes()))?;
    let config = object(Some(config.as_bytes()))?;
    let mut auth = object(existing_auth)?;
    if kind == "api" {
        let dialect = config
            .get("interface_format")
            .and_then(Value::as_str)
            .unwrap_or("");
        let supported = (platform == "codex" && dialect == "openai-responses")
            || (platform == "claude" && dialect == "anthropic");
        if !supported {
            return Err(failure("direct_mode.unsupported_protocol", "该账号协议不能被此客户端直接使用，请改用算力池精确模式（Codex 需要 Responses，Claude 需要 Anthropic）。"));
        }
    }
    let base_url = if kind == "api" {
        let raw = required(&config, "base_url")?;
        let url = url::Url::parse(raw)
            .map_err(|_| failure("direct_mode.invalid_config", "上游地址无效。"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(failure(
                "direct_mode.invalid_config",
                "上游地址需为不含内嵌认证、查询参数和片段的 HTTP(S) 地址。",
            ));
        }
        Some(raw.trim_end_matches('/'))
    } else {
        None
    };

    if platform == "codex" {
        let mut doc = toml_document(existing)?;
        // 不擅自覆盖 profile；它的优先级高于这里修改的根级配置。
        if doc.get("profile").and_then(Item::as_str).is_some() {
            return Err(failure(
                "direct_mode.profile_conflict",
                "Codex 当前启用了配置 profile，请先取消默认 profile 再切换直连模式。",
            ));
        }
        for key in ["model_catalog_json", "chatgpt_base_url", "openai_base_url"] {
            doc.remove(key);
        }
        doc["cli_auth_credentials_store"] = value("file");
        if kind == "api" {
            let key = required(&secret, "api_key")?;
            let model = upstream_model(&config)
                .or_else(|| {
                    doc.get("model")
                        .and_then(Item::as_str)
                        .filter(|m| !m.contains('/'))
                        .map(str::to_owned)
                })
                .ok_or_else(|| {
                    failure(
                        "direct_mode.model_required",
                        "请先在该账号的模型映射中配置真实上游模型，再启用直连。",
                    )
                })?;
            doc["model_provider"] = value("ai-switch-direct");
            doc["model"] = value(model);
            if doc.get("model_providers").is_none() {
                doc["model_providers"] = Item::Table(Table::new());
            }
            let providers = doc["model_providers"].as_table_mut().ok_or_else(|| {
                failure(
                    "direct_mode.invalid_config",
                    "Codex model_providers 必须是表。",
                )
            })?;
            let mut provider = Table::new();
            provider["name"] = value("AI Switch Direct");
            provider["base_url"] = value(base_url.expect("api URL"));
            provider["wire_api"] = value("responses");
            provider["requires_openai_auth"] = value(false);
            provider["experimental_bearer_token"] = value(key);
            if let Some(headers) = config
                .get("headers")
                .and_then(Value::as_object)
                .filter(|m| !m.is_empty())
            {
                let mut table = Table::new();
                for (name, v) in headers {
                    let content = v.as_str().ok_or_else(|| {
                        failure("direct_mode.invalid_config", "请求头的值必须是字符串。")
                    })?;
                    if matches!(name.to_ascii_lowercase().as_str(), "authorization" | "host") {
                        return Err(failure(
                            "direct_mode.invalid_config",
                            "直连配置不接受覆盖认证或 Host 的自定义请求头。",
                        ));
                    }
                    table[name] = value(content);
                }
                provider["http_headers"] = Item::Table(table);
            }
            providers.insert("ai-switch-direct", Item::Table(provider));
            auth = json!({"auth_mode":"apikey","OPENAI_API_KEY":key});
        } else {
            doc["model_provider"] = value("openai");
            if doc
                .get("model")
                .and_then(Item::as_str)
                .is_some_and(|m| m.contains('/'))
            {
                doc.remove("model");
            }
            if let Some(providers) = doc.get_mut("model_providers").and_then(Item::as_table_mut) {
                providers.remove("ai-switch-direct");
                providers.remove("openai");
            }
            auth = json!({"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{
                "access_token":required(&secret,"access_token")?, "refresh_token":required(&secret,"refresh_token")?,
                "id_token":required(&secret,"id_token")?, "account_id":required(&secret,"account_id")?
            }});
            if let Some(refresh) = config.get("last_refresh").filter(|v| !v.is_null()) {
                auth["last_refresh"] = refresh.clone();
            }
        }
        return Ok(RenderedDirectProfile {
            config: doc.to_string().into_bytes(),
            auth: bytes(&auth),
        });
    }

    let mut settings = clean_claude_settings(existing)?;
    let env = settings["env"].as_object_mut().expect("env object");
    if kind == "api" {
        let auth_key = match text(&config, "api_key_field") {
            Some("ANTHROPIC_AUTH_TOKEN") => "ANTHROPIC_AUTH_TOKEN",
            _ => "ANTHROPIC_API_KEY",
        };
        env.insert(auth_key.into(), json!(required(&secret, "api_key")?));
        env.insert(
            "ANTHROPIC_BASE_URL".into(),
            json!(claude_api_base(base_url.expect("api URL"))),
        );
        if let Some(model) = upstream_model(&config) {
            env.insert("ANTHROPIC_MODEL".into(), json!(model));
        }
        if let Some(headers) = config
            .get("headers")
            .and_then(Value::as_object)
            .filter(|m| !m.is_empty())
        {
            let mut lines = Vec::new();
            for (key, val) in headers {
                let v = val.as_str().ok_or_else(|| {
                    failure("direct_mode.invalid_config", "请求头的值必须是字符串。")
                })?;
                if key.contains(['\r', '\n', ':'])
                    || v.contains(['\r', '\n'])
                    || matches!(
                        key.to_ascii_lowercase().as_str(),
                        "authorization" | "x-api-key" | "host"
                    )
                {
                    return Err(failure(
                        "direct_mode.invalid_config",
                        "自定义请求头不适用于原生直连认证。",
                    ));
                }
                lines.push(format!("{key}: {v}"));
            }
            env.insert("ANTHROPIC_CUSTOM_HEADERS".into(), json!(lines.join("\n")));
        }
        auth.as_object_mut()
            .expect("auth object")
            .remove("claudeAiOauth");
    } else {
        let scopes = metadata(&secret, &config, &["scopes"])
            .and_then(Value::as_array)
            .filter(|a| {
                a.iter().all(Value::is_string)
                    && a.iter().any(|v| v.as_str() == Some("user:inference"))
            })
            .ok_or_else(|| {
                failure(
                    "direct_mode.missing_credentials",
                    "Claude 官方直连需要包含 user:inference 的真实 scopes，请导入完整 OAuth 凭据。",
                )
            })?;
        let mut oauth = json!({"accessToken":required(&secret,"access_token")?,"refreshToken":required(&secret,"refresh_token")?,
            "expiresAt":expiry_millis(&secret,&config)?,"scopes":scopes});
        for (native, names) in [
            (
                "subscriptionType",
                vec!["subscriptionType", "subscription_type"],
            ),
            ("rateLimitTier", vec!["rateLimitTier", "rate_limit_tier"]),
            ("clientId", vec!["clientId", "client_id"]),
        ] {
            if let Some(v) = metadata(&secret, &config, &names) {
                oauth[native] = v.clone();
            }
        }
        auth["claudeAiOauth"] = oauth;
    }
    Ok(RenderedDirectProfile {
        config: bytes(&settings),
        auth: bytes(&auth),
    })
}

/// 仅比较直连管理的字段，用户调整权限/MCP 不会被误判成切换账号。
pub(crate) fn fingerprint(platform: &str, config: &[u8]) -> Result<String, AppError> {
    let selected = if platform == "codex" {
        let doc = toml_document(Some(config))?;
        let as_json = serde_json::to_value(
            doc.to_string()
                .parse::<toml::Value>()
                .map_err(|_| failure("direct_mode.invalid_config", "Codex 配置无法解析。"))?,
        )
        .expect("toml value");
        json!({"provider":as_json["model_provider"],"model":as_json["model"],"catalog":as_json["model_catalog_json"],
            "store":as_json["cli_auth_credentials_store"],"profile":as_json["profile"],
            "direct":as_json["model_providers"]["ai-switch-direct"], "openai":as_json["model_providers"]["openai"],
            "chatgpt_base_url":as_json["chatgpt_base_url"]})
    } else {
        let root = object(Some(config))?;
        let mut env = Map::new();
        for key in CLAUDE_AUTH_ENV {
            if let Some(v) = root["env"].get(*key) {
                env.insert((*key).into(), v.clone());
            }
        }
        json!({"env":env,"model":root["model"],"helper":root["apiKeyHelper"]})
    };
    Ok(hash_bytes(&bytes(&selected)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn api_config(format: &str) -> String {
        json!({"base_url":"https://upstream.example/v1", "interface_format":format,
            "model_mappings":[{"from":"local-alias","to":"native-model"}]})
        .to_string()
    }

    #[test]
    fn codex_api_uses_native_model_and_preserves_unrelated_settings() {
        let result = render("codex", "api", r#"{"api_key":"test-key"}"#,
            &api_config("openai-responses"), Some(b"model_provider = \"ai-switch\"\nmodel = \"Account/local-alias\"\nmodel_catalog_json = \"ai-switch-model-catalog.json\"\n[sandbox_workspace_write]\nnetwork_access = true\n"), None).unwrap();
        let config: toml::Value =
            toml::from_str(std::str::from_utf8(&result.config).unwrap()).unwrap();
        assert_eq!(config["model_provider"].as_str(), Some("ai-switch-direct"));
        assert_eq!(config["model"].as_str(), Some("native-model"));
        assert!(config.get("model_catalog_json").is_none());
        assert_eq!(
            config["sandbox_workspace_write"]["network_access"].as_bool(),
            Some(true)
        );
        assert_eq!(
            config["model_providers"]["ai-switch-direct"]["base_url"].as_str(),
            Some("https://upstream.example/v1")
        );
        let auth: Value = serde_json::from_slice(&result.auth).unwrap();
        assert_eq!(auth["OPENAI_API_KEY"], "test-key");
    }

    #[test]
    fn codex_official_writes_full_chatgpt_login_not_an_api_token() {
        let secret = json!({"access_token":"at", "refresh_token":"rt", "id_token":"id", "account_id":"account"});
        let result = render("codex", "official", &secret.to_string(), "{}",
            Some(b"model_provider = \"ai-switch\"\nmodel = \"Account/gpt-model\"\ncli_auth_credentials_store = \"keyring\"\n"), None).unwrap();
        let config: toml::Value =
            toml::from_str(std::str::from_utf8(&result.config).unwrap()).unwrap();
        assert_eq!(config["model_provider"].as_str(), Some("openai"));
        assert_eq!(config["cli_auth_credentials_store"].as_str(), Some("file"));
        assert!(config.get("model").is_none());
        let auth: Value = serde_json::from_slice(&result.auth).unwrap();
        assert_eq!(auth["auth_mode"], "chatgpt");
        assert_eq!(auth["tokens"]["refresh_token"], "rt");
        assert_eq!(auth["tokens"]["id_token"], "id");
        assert_eq!(auth["tokens"]["account_id"], "account");
    }

    #[test]
    fn claude_api_removes_oauth_and_route_overrides_but_keeps_user_preferences() {
        let old = br#"{"permissions":{"allow":["Read"]},"apiKeyHelper":"old-helper","env":{"CLAUDE_CODE_OAUTH_TOKEN":"old", "ANTHROPIC_AUTH_TOKEN":"route-key", "EDITOR":"vim"},"aiSwitch":{"routeProxy":{"enabled":true}}}"#;
        let result = render(
            "claude",
            "api",
            r#"{"api_key":"test-key"}"#,
            &api_config("anthropic"),
            Some(old),
            Some(br#"{"claudeAiOauth":{"accessToken":"old"},"other":{"keep":true}}"#),
        )
        .unwrap();
        let config: Value = serde_json::from_slice(&result.config).unwrap();
        assert_eq!(config["env"]["ANTHROPIC_API_KEY"], "test-key");
        assert_eq!(config["env"]["ANTHROPIC_MODEL"], "native-model");
        assert!(config["env"].get("CLAUDE_CODE_OAUTH_TOKEN").is_none());
        assert!(config["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
        assert!(config.get("apiKeyHelper").is_none());
        assert_eq!(config["permissions"]["allow"][0], "Read");
        assert_eq!(config["env"]["EDITOR"], "vim");
        let auth: Value = serde_json::from_slice(&result.auth).unwrap();
        assert!(auth.get("claudeAiOauth").is_none());
        assert_eq!(auth["other"]["keep"], true);
    }

    #[test]
    fn claude_official_emits_native_oauth_fields_and_preserves_other_credentials() {
        let secret = json!({"access_token":"at", "refresh_token":"rt"});
        let config = json!({"expired":"2099-01-01T00:00:00Z", "raw":{"scopes":["user:inference","user:profile"],"subscriptionType":"max"}});
        let result = render("claude", "official", &secret.to_string(), &config.to_string(),
            Some(br#"{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:19527","ANTHROPIC_AUTH_TOKEN":"route"}}"#),
            Some(br#"{"other":{"keep":true}}"#)).unwrap();
        let settings: Value = serde_json::from_slice(&result.config).unwrap();
        assert!(settings["env"].get("ANTHROPIC_BASE_URL").is_none());
        let auth: Value = serde_json::from_slice(&result.auth).unwrap();
        assert_eq!(auth["claudeAiOauth"]["accessToken"], "at");
        assert_eq!(auth["claudeAiOauth"]["refreshToken"], "rt");
        assert_eq!(auth["claudeAiOauth"]["expiresAt"], 4070908800000i64);
        assert_eq!(
            auth["claudeAiOauth"]["scopes"],
            json!(["user:inference", "user:profile"])
        );
        assert_eq!(auth["claudeAiOauth"]["subscriptionType"], "max");
        assert_eq!(auth["other"]["keep"], true);
    }

    #[test]
    fn claude_api_base_does_not_duplicate_the_native_v1_messages_path() {
        let config = json!({"base_url":"https://upstream.example/anthropic/v1", "interface_format":"anthropic"});
        let rendered = render(
            "claude",
            "api",
            r#"{"api_key":"test-key"}"#,
            &config.to_string(),
            None,
            None,
        )
        .unwrap();
        let settings: Value = serde_json::from_slice(&rendered.config).unwrap();
        assert_eq!(
            settings["env"]["ANTHROPIC_BASE_URL"],
            "https://upstream.example/anthropic"
        );
    }

    #[test]
    fn incompatible_protocol_and_incomplete_login_are_refused() {
        assert!(render(
            "codex",
            "api",
            r#"{"api_key":"test"}"#,
            &api_config("openai"),
            None,
            None
        )
        .is_err());
        assert!(render(
            "claude",
            "api",
            r#"{"api_key":"test"}"#,
            &api_config("openai-responses"),
            None,
            None
        )
        .is_err());
        assert!(render(
            "codex",
            "official",
            r#"{"access_token":"at","refresh_token":"rt"}"#,
            "{}",
            None,
            None
        )
        .is_err());
        assert!(render(
            "claude",
            "official",
            r#"{"access_token":"at"}"#,
            "{}",
            None,
            None
        )
        .is_err());
    }

    #[test]
    fn malformed_existing_config_or_auth_is_never_overwritten() {
        assert!(render(
            "codex",
            "api",
            r#"{"api_key":"test"}"#,
            &api_config("openai-responses"),
            Some(b"not TOML!"),
            None
        )
        .is_err());
        assert!(render(
            "claude",
            "api",
            r#"{"api_key":"test"}"#,
            &api_config("anthropic"),
            Some(b"[]"),
            None
        )
        .is_err());
        assert!(render(
            "claude",
            "api",
            r#"{"api_key":"test"}"#,
            &api_config("anthropic"),
            None,
            Some(b"broken")
        )
        .is_err());
    }
}
