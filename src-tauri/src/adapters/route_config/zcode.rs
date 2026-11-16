use super::{
    base_url_root, base_url_with_v1, client_home, existing_text, generated_invalid,
    invalid_existing_config, route_proxy_key_matches, ClientModel, RouteConfigInput, TargetAdapter,
    TargetInspection,
};
use crate::{error::AppError, models::platform::PlatformId};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// ZCode 3.14 moved its provider registry out of `config.json` into a versioned
/// store. The old file is only read once, when this one does not exist yet, so
/// a write that lands there is invisible to a client that has already migrated.
const CONFIG_FILE_NAME: &str = "provider_config.json";

/// The managed marker. Every schema level in this file is `strict()` — an
/// unknown key makes ZCode fail the whole parse and degrade to an empty
/// provider list — so the marker has to ride in a field the client actually
/// owns. `api.headers` is such a field, is invisible in the UI, is preserved
/// across ZCode's own rewrites, and is only ever sent to this app's own proxy,
/// which ignores headers it does not know.
const MANAGED_HEADER: &str = "ai-switch-managed";

/// `config.api.type` values ZCode accepts, and the endpoint path each one
/// appends to `config.api.baseUrl`.
const API_TYPE_OPENAI: &str = "openai-responses";
const API_TYPE_ANTHROPIC: &str = "anthropic-messages";

/// The only `config.group` a hand-made provider may declare; the other two
/// members of ZCode's enum belong to its own first-party families.
const PROVIDER_GROUP: &str = "standard-personal";

pub(super) struct ZCodeAdapter {
    target_key: &'static str,
    platform: PlatformId,
    /// Selects ZCode's wire protocol. `openai-responses` hits
    /// `{baseURL}/responses`; `anthropic-messages` hits `{baseURL}/v1/messages`.
    api_type: &'static str,
    /// Appended to the proxy base URL. Differs per kind because ZCode adds its
    /// own suffix: anthropic would otherwise produce `/v1/v1/messages`.
    base_url_suffix: &'static str,
    /// Record key used when no existing entry can be adopted. Never prefixed
    /// with `builtin:` (coerced to a builtin and dropped from ZCode's registry),
    /// `account:` (its access is owned by ZCode's builtin config) or
    /// `default-` (filtered when the key is blank).
    fallback_provider_id: &'static str,
    display_name: &'static str,
}

impl ZCodeAdapter {
    pub(super) const fn codex() -> Self {
        Self {
            target_key: "zcode_codex",
            platform: PlatformId::Codex,
            api_type: API_TYPE_OPENAI,
            base_url_suffix: "/v1",
            fallback_provider_id: "ai-switch-codex",
            display_name: "AI Switch (Codex)",
        }
    }

    pub(super) const fn claude() -> Self {
        Self {
            target_key: "zcode_claude",
            platform: PlatformId::Claude,
            api_type: API_TYPE_ANTHROPIC,
            base_url_suffix: "",
            fallback_provider_id: "ai-switch-claude",
            display_name: "AI Switch (Claude)",
        }
    }

    fn base_url(&self, base_url: &str) -> String {
        if self.base_url_suffix.is_empty() {
            base_url_root(base_url)
        } else {
            base_url_with_v1(base_url)
        }
    }

    fn provider_id_of(rule: &Value) -> Option<&str> {
        rule.get("providerId").and_then(Value::as_str)
    }

    /// Whether this rule is the one this adapter writes, so the two ZCode
    /// targets — which share one file — never claim each other's entry.
    fn owns_rule(&self, rule: &Value) -> bool {
        let marked = rule
            .pointer("/config/api/headers")
            .and_then(Value::as_object)
            .and_then(|headers| headers.get(MANAGED_HEADER))
            .and_then(Value::as_str)
            .is_some_and(|value| value == self.platform.as_str());
        if marked {
            return true;
        }
        Self::provider_id_of(rule) == Some(self.fallback_provider_id)
    }

    /// Record key of the entry we should write into, in priority order: our own
    /// marker, then our own fallback key, then a hand-made entry recognizable by
    /// base URL plus current or rotated key.
    fn adoption_target(&self, rules: &[Value], input: &RouteConfigInput) -> Option<String> {
        if let Some(id) = rules
            .iter()
            .find(|rule| {
                rule.pointer("/config/api/headers")
                    .and_then(Value::as_object)
                    .and_then(|headers| headers.get(MANAGED_HEADER))
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == self.platform.as_str())
            })
            .and_then(Self::provider_id_of)
        {
            return Some(id.to_string());
        }
        if rules
            .iter()
            .any(|rule| Self::provider_id_of(rule) == Some(self.fallback_provider_id))
        {
            return Some(self.fallback_provider_id.to_string());
        }

        let expected_base = self.base_url(&input.base_url);
        rules.iter().find_map(|rule| {
            let base_matches = rule
                .pointer("/config/api/baseUrl")
                .and_then(Value::as_str)
                .map(|value| value.trim().trim_end_matches('/'))
                .is_some_and(|value| value == expected_base);
            let api_key = rule
                .pointer("/config/access/apiKey")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            let key_matches = route_proxy_key_matches(
                api_key,
                self.client_key(),
                &input.route_proxy_key,
                &input.route_proxy_key_aliases,
            );
            (base_matches && key_matches)
                .then(|| Self::provider_id_of(rule).map(str::to_string))
                .flatten()
        })
    }

    fn model_rule(&self, provider_id: &str, model: &ClientModel) -> Value {
        // Every field here is optional in ZCode's own schema; the ones we do
        // write must satisfy it (`contextWindow` and `maxOutputTokens.max` are
        // positive integers), so a zero — an account that declares nothing — is
        // left out rather than written as something the client refuses.
        let mut properties = Map::new();
        if model.context_window > 0 {
            properties.insert("contextWindow".to_string(), json!(model.context_window));
        }
        properties.insert(
            "inputFormat".to_string(),
            json!({
                "supportsText": true,
                "supportsImage": model.supports_image_input,
            }),
        );
        let mut option_specs = Map::new();
        if model.max_output_tokens > 0 {
            option_specs.insert(
                "maxOutputTokens".to_string(),
                json!({ "max": model.max_output_tokens }),
            );
        }
        // `values` is a free-form list — the client lets reasoning levels be
        // customised, and its builtin providers only happen to use
        // `low`/`high`/`max` — so the catalog's own names go through untouched.
        // A model with no efforts gets no block at all, so the client does not
        // offer an empty control.
        if !model.reasoning_levels.is_empty() {
            option_specs.insert(
                "reasoningLevel".to_string(),
                json!({ "values": model.reasoning_levels }),
            );
        }
        json!({
            "modelId": model.id,
            "providerId": provider_id,
            "config": {
                "properties": Value::Object(properties),
                "optionSpecs": Value::Object(option_specs),
            },
        })
    }
}

impl TargetAdapter for ZCodeAdapter {
    fn target_key(&self) -> &'static str {
        self.target_key
    }

    fn client_key(&self) -> &'static str {
        "zcode"
    }

    fn client_display_name(&self) -> &'static str {
        "ZCode"
    }

    fn native(&self) -> bool {
        false
    }

    fn restart_required(&self) -> bool {
        true
    }

    fn requires_client_models(&self) -> bool {
        true
    }

    fn platform(&self) -> PlatformId {
        self.platform
    }

    /// ZCode resolves its data root as: runtime override →
    /// `ZCODE_DATA_BASE_DIR` → homedir ponyfill (`HOME` first). Third-party
    /// software (Cadence SPB 16.6 was observed) exports a global `HOME`, which
    /// silently moves the client's config to e.g.
    /// `%APPDATA%\SPB_16.6\.zcode\v2` while `BaseDirs::home_dir()` stays on the
    /// profile dir — so the base path alone is wrong whenever `HOME` is
    /// redirected. Re-derive the client's own resolution instead of scanning
    /// for install-shaped directories.
    fn resolve_path(&self, home: &Path) -> PathBuf {
        client_home::zcode_base_for(home)
            .join(".zcode")
            .join("v2")
            .join(CONFIG_FILE_NAME)
    }

    fn render(
        &self,
        path: &Path,
        existing: Option<&[u8]>,
        input: &RouteConfigInput,
    ) -> Result<Vec<u8>, AppError> {
        let mut config = match existing {
            Some(bytes) => {
                let content = existing_text(path, "JSON", bytes)?;
                if content.trim().is_empty() {
                    Value::Object(Map::new())
                } else {
                    serde_json::from_str(content)
                        .map_err(|_| invalid_existing_config(path, "JSON", "syntax is invalid"))?
                }
            }
            None => Value::Object(Map::new()),
        };

        let root = config
            .as_object_mut()
            .ok_or_else(|| invalid_existing_config(path, "JSON", "root value must be an object"))?;
        // The store is versioned; ZCode refuses anything above the version it
        // understands, so a version it already carries is left untouched.
        if !root.contains_key("schemaVersion") {
            root.insert("schemaVersion".to_string(), json!(1));
        }
        let store = root
            .entry("config".to_string())
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| invalid_existing_config(path, "JSON", "config must be an object"))?;

        let provider_rules = store
            .entry("providerConfigRules".to_string())
            .or_insert_with(|| json!({ "providerRules": [] }))
            .as_object_mut()
            .ok_or_else(|| {
                invalid_existing_config(path, "JSON", "providerConfigRules must be an object")
            })?
            .entry("providerRules".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| {
                invalid_existing_config(path, "JSON", "providerRules must be an array")
            })?;

        let provider_id = self
            .adoption_target(provider_rules, input)
            .unwrap_or_else(|| self.fallback_provider_id.to_string());
        let existing_rule = provider_rules
            .iter()
            .find(|rule| Self::provider_id_of(rule) == Some(provider_id.as_str()))
            .cloned();

        // Keep a name the user may have edited; only fill one in when adopting an
        // entry that has none.
        let name = existing_rule
            .as_ref()
            .and_then(|rule| rule.get("providerName"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(self.display_name)
            .to_string();
        // Headers the user added by hand survive; only our own marker is forced.
        let mut headers = existing_rule
            .as_ref()
            .and_then(|rule| rule.pointer("/config/api/headers"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        headers.insert(
            MANAGED_HEADER.to_string(),
            Value::String(self.platform.as_str().to_string()),
        );
        let mut entry_config = existing_rule
            .as_ref()
            .and_then(|rule| rule.get("config"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        // A personal rule may not declare builtin models; carrying one over
        // would make ZCode reject the file.
        entry_config.remove("builtinModelIds");
        entry_config.insert(
            "group".to_string(),
            Value::String(PROVIDER_GROUP.to_string()),
        );
        entry_config.insert(
            "access".to_string(),
            json!({ "type": "api-key", "apiKey": input.route_proxy_key }),
        );
        entry_config.insert(
            "api".to_string(),
            json!({
                "type": self.api_type,
                "baseUrl": self.base_url(&input.base_url),
                "headers": Value::Object(headers),
            }),
        );
        // The list is replaced wholesale, so a hand-added model is removed
        // rather than merged. Confirmed with the user for the old format and
        // still the only coherent reading of a pool-owned entry.
        let model_ids: Vec<Value> = input
            .client_models
            .iter()
            .map(|model| Value::String(model.id.clone()))
            .collect();
        entry_config.insert(
            "personalModelIds".to_string(),
            Value::Array(model_ids.clone()),
        );
        entry_config.insert("modelOrder".to_string(), Value::Array(model_ids));

        let entry = json!({
            "providerId": provider_id,
            "providerName": name,
            "config": Value::Object(entry_config),
        });
        match provider_rules
            .iter()
            .position(|rule| Self::provider_id_of(rule) == Some(provider_id.as_str()))
        {
            // Adopt in place: a second entry pointing at the same proxy would
            // show up twice in ZCode's picker.
            Some(index) => provider_rules[index] = entry,
            None => provider_rules.push(entry),
        }

        let model_rules = store
            .entry("modelConfigRules".to_string())
            .or_insert_with(|| json!({ "providerModelRules": [], "manualProviderModelRules": [] }))
            .as_object_mut()
            .ok_or_else(|| {
                invalid_existing_config(path, "JSON", "modelConfigRules must be an object")
            })?;
        // A provider/model pair may be declared either way, never both: leaving
        // a stale manual rule for a model we now declare would fail ZCode's
        // whole-file check.
        match model_rules
            .entry("manualProviderModelRules".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
        {
            Some(manual_rules) => {
                manual_rules.retain(|rule| Self::provider_id_of(rule) != Some(provider_id.as_str()))
            }
            None => {
                return Err(invalid_existing_config(
                    path,
                    "JSON",
                    "manualProviderModelRules must be an array",
                ))
            }
        }
        let provider_model_rules = model_rules
            .entry("providerModelRules".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| {
                invalid_existing_config(path, "JSON", "providerModelRules must be an array")
            })?;
        // Another provider's rules are the user's and stay.
        provider_model_rules
            .retain(|rule| Self::provider_id_of(rule) != Some(provider_id.as_str()));
        for model in &input.client_models {
            provider_model_rules.push(self.model_rule(&provider_id, model));
        }

        let rendered =
            serde_json::to_vec_pretty(&config).map_err(|_| generated_invalid(path, "JSON"))?;
        let generated: Value =
            serde_json::from_slice(&rendered).map_err(|_| generated_invalid(path, "JSON"))?;
        if !generated.is_object() {
            return Err(generated_invalid(path, "JSON"));
        }
        Ok(rendered)
    }

    fn inspect(&self, _path: &Path, existing: Option<&[u8]>) -> TargetInspection {
        let Some(bytes) = existing else {
            return TargetInspection::missing();
        };
        let Ok(config) = serde_json::from_slice::<Value>(bytes) else {
            return TargetInspection::invalid();
        };
        let Some(root) = config.as_object() else {
            return TargetInspection::invalid();
        };
        if root.get("config").is_some_and(|store| !store.is_object()) {
            return TargetInspection::invalid();
        }

        // Both ZCode adapters read this one file, so the marker has to be
        // matched per platform or each target would report the other's entry as
        // its own.
        let managed = root
            .get("config")
            .and_then(|store| store.pointer("/providerConfigRules/providerRules"))
            .and_then(Value::as_array)
            .is_some_and(|rules| rules.iter().any(|rule| self.owns_rule(rule)));

        TargetInspection::valid(managed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::route_config::{ClientModel, TargetAdapterRegistry};
    use serde_json::json;

    const BASE_URL: &str = "http://127.0.0.1:19527";
    const CODEX_KEY: &str = "sk-ai-switch-codexkey";

    fn input(models: &[&str]) -> RouteConfigInput {
        RouteConfigInput {
            base_url: BASE_URL.to_string(),
            route_proxy_key: CODEX_KEY.to_string(),
            route_proxy_key_aliases: Vec::new(),
            claude_env: crate::adapters::route_config::ClaudeEnvPlan::default(),
            codex_keep_login_state: false,
            client_models: models
                .iter()
                .map(|id| ClientModel {
                    id: (*id).to_string(),
                    context_window: 200_000,
                    max_output_tokens: 128_000,
                    reasoning_levels: Vec::new(),
                    supports_image_input: true,
                })
                .collect(),
        }
    }

    fn codex_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("zcode", PlatformId::Codex)
            .expect("zcode codex adapter")
    }

    fn claude_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("zcode", PlatformId::Claude)
            .expect("zcode claude adapter")
    }

    fn render(adapter: &dyn TargetAdapter, existing: Option<&[u8]>, models: &[&str]) -> Value {
        let bytes = adapter
            .render(Path::new("provider_config.json"), existing, &input(models))
            .expect("render");
        serde_json::from_slice(&bytes).expect("valid JSON")
    }

    fn codex_rule(json: &Value) -> Value {
        let rules = json["config"]["providerConfigRules"]["providerRules"]
            .as_array()
            .expect("provider rules");
        rules
            .iter()
            .find(|rule| rule["providerId"] == "ai-switch-codex")
            .cloned()
            .unwrap_or_else(|| panic!("no ai-switch-codex rule in {json}"))
    }

    fn model_rules_for(json: &Value, provider_id: &str) -> Vec<Value> {
        json["config"]["modelConfigRules"]["providerModelRules"]
            .as_array()
            .expect("provider model rules")
            .iter()
            .filter(|rule| rule["providerId"] == provider_id)
            .cloned()
            .collect()
    }

    #[test]
    fn resolved_path_is_the_versioned_provider_store() {
        // ZCode reads its provider registry from this file; `config.json` next
        // to it is only a one-time migration source.
        let home = Path::new("/home/user");
        assert_eq!(
            codex_adapter().resolve_path(home),
            home.join(".zcode").join("v2").join("provider_config.json")
        );
    }

    #[test]
    fn a_fresh_store_carries_the_schema_version_zcode_requires() {
        let json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        assert_eq!(json["schemaVersion"], 1);
        // A version the client already carries is never bumped behind its back.
        let existing = br#"{"schemaVersion": 1, "config": {}}"#;
        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);
        assert_eq!(json["schemaVersion"], 1);
    }

    #[test]
    fn codex_writes_a_v1_suffixed_base_url_and_claude_does_not() {
        // openai-responses hits {baseURL}/responses, so the /v1 has to be in
        // baseUrl.
        let json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        let entry = codex_rule(&json);
        assert_eq!(entry["config"]["api"]["type"], "openai-responses");
        assert_eq!(
            entry["config"]["api"]["baseUrl"],
            "http://127.0.0.1:19527/v1"
        );
        assert_eq!(entry["config"]["group"], "standard-personal");

        // anthropic-messages appends /v1/messages itself; a /v1 here would
        // produce /v1/v1/messages.
        let json = render(claude_adapter().as_ref(), None, &["claude-sonnet-alias"]);
        let entry = &json["config"]["providerConfigRules"]["providerRules"][0];
        assert_eq!(entry["providerId"], "ai-switch-claude");
        assert_eq!(entry["config"]["api"]["type"], "anthropic-messages");
        assert_eq!(entry["config"]["api"]["baseUrl"], "http://127.0.0.1:19527");
    }

    #[test]
    fn managed_entry_carries_credentials_models_and_the_managed_marker() {
        let json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol", "glm-5.3"]);
        let entry = codex_rule(&json);

        assert_eq!(entry["providerName"], "AI Switch (Codex)");
        assert_eq!(
            entry["config"]["access"],
            json!({ "type": "api-key", "apiKey": CODEX_KEY })
        );
        // The schema is strict at every level, so the marker rides in a field
        // the client owns instead of as a stray key.
        assert_eq!(entry["config"]["api"]["headers"][MANAGED_HEADER], "codex");
        assert_eq!(
            entry["config"]["personalModelIds"],
            json!(["gpt-5.6-sol", "glm-5.3"])
        );
        assert_eq!(
            entry["config"]["modelOrder"],
            json!(["gpt-5.6-sol", "glm-5.3"])
        );
        // Leaving `enabled` unset keeps the entry "not explicitly disabled".
        assert!(entry.get("enabled").is_none());
        // A personal rule may not declare builtin models.
        assert!(entry["config"].get("builtinModelIds").is_none());
    }

    #[test]
    fn model_rules_carry_context_image_support_output_limit_and_efforts() {
        let mut row = input(&["gpt-5.6-sol", "deepseek-v4-flash"]);
        row.client_models[0].reasoning_levels =
            vec!["low".to_string(), "medium".to_string(), "ultra".to_string()];
        row.client_models[1].supports_image_input = false;

        let bytes = codex_adapter()
            .render(Path::new("provider_config.json"), None, &row)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");

        let rules = model_rules_for(&json, "ai-switch-codex");
        assert_eq!(rules.len(), 2);
        let solver = &rules[0];
        assert_eq!(solver["modelId"], "gpt-5.6-sol");
        assert_eq!(solver["config"]["properties"]["contextWindow"], 200_000);
        assert_eq!(
            solver["config"]["properties"]["inputFormat"],
            json!({ "supportsText": true, "supportsImage": true })
        );
        assert_eq!(
            solver["config"]["optionSpecs"]["maxOutputTokens"],
            json!({ "max": 128_000 })
        );
        // The catalog's own names go through untouched: `values` is a free-form
        // list, so `ultra` is not renamed to the builtin providers' `max` —
        // doing so would misreport what the account declares.
        assert_eq!(
            solver["config"]["optionSpecs"]["reasoningLevel"],
            json!({ "values": ["low", "medium", "ultra"] })
        );

        let flash = &rules[1];
        assert_eq!(
            flash["config"]["properties"]["inputFormat"],
            json!({ "supportsText": true, "supportsImage": false })
        );
        // An empty control would be a lie, so a model with no efforts gets no
        // reasoning block at all.
        assert!(flash["config"]["optionSpecs"]
            .get("reasoningLevel")
            .is_none());
    }

    #[test]
    fn a_model_that_declares_nothing_gets_no_unprovable_numbers() {
        // `contextWindow` and `maxOutputTokens.max` are positive integers in
        // ZCode's schema; writing a zero would fail the whole file.
        let mut row = input(&["mystery-model"]);
        row.client_models[0].context_window = 0;
        row.client_models[0].max_output_tokens = 0;

        let bytes = codex_adapter()
            .render(Path::new("provider_config.json"), None, &row)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
        let rules = model_rules_for(&json, "ai-switch-codex");
        assert!(rules[0]["config"]["properties"]
            .get("contextWindow")
            .is_none());
        assert!(rules[0]["config"]["optionSpecs"]
            .get("maxOutputTokens")
            .is_none());
        // Still listed, because a model-less provider cannot be picked at all.
        assert_eq!(
            codex_rule(&json)["config"]["personalModelIds"],
            json!(["mystery-model"])
        );
    }

    #[test]
    fn render_preserves_other_providers_and_the_sibling_platform_entry() {
        let existing = br#"{
  "schemaVersion": 1,
  "config": {
    "providerOrder": ["ai-switch-claude", "someone-elses-proxy"],
    "providerConfigRules": {
      "providerRules": [
        {
          "providerId": "someone-elses-proxy",
          "providerName": "Other Proxy",
          "config": {
            "group": "standard-personal",
            "access": { "type": "api-key", "apiKey": "sk-not-ours" },
            "api": { "type": "openai-responses", "baseUrl": "http://127.0.0.1:8080/v1" }
          }
        },
        {
          "providerId": "ai-switch-claude",
          "providerName": "AI Switch (Claude)",
          "config": {
            "group": "standard-personal",
            "access": { "type": "api-key", "apiKey": "sk-ai-switch-claudekey" },
            "api": {
              "type": "anthropic-messages",
              "baseUrl": "http://127.0.0.1:19527",
              "headers": { "ai-switch-managed": "claude" }
            }
          }
        }
      ]
    },
    "modelConfigRules": {
      "providerModelRules": [
        {
          "modelId": "GLM-5.3",
          "providerId": "someone-elses-proxy",
          "config": { "properties": { "contextWindow": 128000 } }
        }
      ],
      "manualProviderModelRules": []
    }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);

        let rules = json["config"]["providerConfigRules"]["providerRules"]
            .as_array()
            .expect("provider rules");
        assert_eq!(
            rules.len(),
            3,
            "the sibling entry must not be replaced: {json}"
        );
        let other = rules
            .iter()
            .find(|rule| rule["providerId"] == "someone-elses-proxy")
            .expect("other provider");
        assert_eq!(other["config"]["access"]["apiKey"], "sk-not-ours");
        let claude = rules
            .iter()
            .find(|rule| rule["providerId"] == "ai-switch-claude")
            .expect("claude entry");
        assert_eq!(
            claude["config"]["access"]["apiKey"],
            "sk-ai-switch-claudekey"
        );
        // Ordering the user arranged is left alone.
        assert_eq!(
            json["config"]["providerOrder"],
            json!(["ai-switch-claude", "someone-elses-proxy"])
        );
        // So is another provider's model rule.
        let model_rules = model_rules_for(&json, "someone-elses-proxy");
        assert_eq!(model_rules.len(), 1);
        assert_eq!(model_rules[0]["modelId"], "GLM-5.3");
    }

    #[test]
    fn rewriting_replaces_our_own_model_rules_and_drops_conflicting_manual_ones() {
        // A provider/model pair may be declared either as a smart rule or a
        // manual one, never both; ZCode rejects the whole file otherwise.
        let existing = br#"{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "ai-switch-codex",
        "providerName": "AI Switch (Codex)",
        "config": {
          "group": "standard-personal",
          "api": {
            "type": "openai-responses",
            "baseUrl": "http://127.0.0.1:19527/v1",
            "headers": { "ai-switch-managed": "codex" }
          },
          "personalModelIds": ["gone-model"],
          "modelOrder": ["gone-model"]
        }
      }]
    },
    "modelConfigRules": {
      "providerModelRules": [
        {
          "modelId": "gone-model",
          "providerId": "ai-switch-codex",
          "config": { "properties": { "contextWindow": 1000 } }
        }
      ],
      "manualProviderModelRules": [
        {
          "modelId": "gpt-5.6-sol",
          "providerId": "ai-switch-codex",
          "config": { "properties": { "contextWindow": 64000 } }
        },
        {
          "modelId": "GLM-5.3",
          "providerId": "someone-elses-proxy",
          "config": { "properties": { "contextWindow": 128000 } }
        }
      ]
    }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);

        let rules = model_rules_for(&json, "ai-switch-codex");
        assert_eq!(rules.len(), 1, "the stale rule is gone: {json}");
        assert_eq!(rules[0]["modelId"], "gpt-5.6-sol");
        assert_eq!(
            json["config"]["modelConfigRules"]["manualProviderModelRules"],
            json!([{
                "modelId": "GLM-5.3",
                "providerId": "someone-elses-proxy",
                "config": { "properties": { "contextWindow": 128000 } }
            }]),
            "only our own manual rule is dropped: {json}"
        );
    }

    #[test]
    fn adoption_claims_the_entry_marked_managed_for_this_platform() {
        let existing = br#"{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "3c109843-30ed-4307-a74e-ac537218d8be",
        "providerName": "My Renamed Pool",
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "sk-ai-switch-stale" },
          "api": {
            "type": "openai-responses",
            "baseUrl": "http://127.0.0.1:1/v1",
            "headers": { "ai-switch-managed": "codex" }
          }
        }
      }]
    },
    "modelConfigRules": { "providerModelRules": [], "manualProviderModelRules": [] }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);
        let rules = json["config"]["providerConfigRules"]["providerRules"]
            .as_array()
            .expect("provider rules");
        assert_eq!(rules.len(), 1, "adopted in place: {json}");

        let entry = &rules[0];
        // The user may have renamed it; renaming it back is a surprise.
        assert_eq!(entry["providerId"], "3c109843-30ed-4307-a74e-ac537218d8be");
        assert_eq!(entry["providerName"], "My Renamed Pool");
        assert_eq!(entry["config"]["access"]["apiKey"], CODEX_KEY);
        assert_eq!(
            entry["config"]["api"]["baseUrl"],
            "http://127.0.0.1:19527/v1"
        );
        assert!(json["config"]["providerConfigRules"]["providerRules"]
            .as_array()
            .unwrap()
            .iter()
            .all(|rule| rule["providerId"] != "ai-switch-codex"));
    }

    #[test]
    fn adoption_claims_a_hand_made_entry_by_base_url_and_key() {
        // What a user who wired this up by hand actually has: no managed
        // marker, but the platform's own sk and a local base URL.
        let existing = br#"{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "hand-made",
        "providerName": "Ai-Switch",
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "sk-ai-switch-codexkey" },
          "api": { "type": "openai-responses", "baseUrl": "http://127.0.0.1:19527/v1" },
          "personalModelIds": ["glm-5.3"],
          "modelOrder": ["glm-5.3"]
        }
      }]
    },
    "modelConfigRules": { "providerModelRules": [], "manualProviderModelRules": [] }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);
        let entry = &json["config"]["providerConfigRules"]["providerRules"][0];

        assert_eq!(entry["providerId"], "hand-made");
        assert_eq!(
            entry["config"]["api"]["headers"][MANAGED_HEADER], "codex",
            "adopting also marks it: {json}"
        );
        // The pool owns the list, so a hand-added model is replaced rather than
        // merged.
        assert_eq!(entry["config"]["personalModelIds"], json!(["gpt-5.6-sol"]));
    }

    #[test]
    fn adoption_recognizes_a_rotated_key_via_the_alias_list() {
        let existing = br#"{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "hand-made",
        "providerName": "Ai-Switch",
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "sk-ai-switch-previous" },
          "api": { "type": "openai-responses", "baseUrl": "http://127.0.0.1:19527/v1" }
        }
      }]
    },
    "modelConfigRules": { "providerModelRules": [], "manualProviderModelRules": [] }
  }
}"#;

        let mut with_alias = input(&["gpt-5.6-sol"]);
        with_alias.route_proxy_key_aliases = vec!["sk-ai-switch-previous".to_string()];
        let bytes = codex_adapter()
            .render(
                Path::new("provider_config.json"),
                Some(existing),
                &with_alias,
            )
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");

        // The user rotated their sk; the stale entry is still theirs.
        let rules = json["config"]["providerConfigRules"]["providerRules"]
            .as_array()
            .expect("provider rules");
        assert_eq!(rules.len(), 1, "{json}");
        assert_eq!(rules[0]["providerId"], "hand-made");
        assert_eq!(rules[0]["config"]["access"]["apiKey"], CODEX_KEY);
    }

    #[test]
    fn adoption_recognizes_suffixed_and_legacy_keys() {
        // Three shapes are all the same user's entry: the raw base key written
        // before client suffixes existed, a rotated raw alias, and the suffixed
        // alias this client wrote before the last rotation.
        for configured in [
            CODEX_KEY,
            "sk-ai-switch-previous",
            "sk-ai-switch-previous.zcode",
        ] {
            let existing = format!(
                r#"{{
  "schemaVersion": 1,
  "config": {{
    "providerConfigRules": {{
      "providerRules": [{{
        "providerId": "hand-made",
        "providerName": "Ai-Switch",
        "config": {{
          "group": "standard-personal",
          "access": {{ "type": "api-key", "apiKey": "{configured}" }},
          "api": {{ "type": "openai-responses", "baseUrl": "http://127.0.0.1:19527/v1" }}
        }}
      }}]
    }},
    "modelConfigRules": {{ "providerModelRules": [], "manualProviderModelRules": [] }}
  }}
}}"#
            );

            let mut with_alias = input(&["gpt-5.6-sol"]);
            with_alias.route_proxy_key = format!("{CODEX_KEY}.zcode");
            with_alias.route_proxy_key_aliases = vec!["sk-ai-switch-previous".to_string()];
            let bytes = codex_adapter()
                .render(
                    Path::new("provider_config.json"),
                    Some(existing.as_bytes()),
                    &with_alias,
                )
                .expect("render");
            let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
            let rules = json["config"]["providerConfigRules"]["providerRules"]
                .as_array()
                .expect("provider rules");

            assert_eq!(rules.len(), 1, "no duplicate for {configured}: {json}");
            assert_eq!(rules[0]["providerId"], "hand-made");
            assert_eq!(rules[0]["config"]["access"]["apiKey"], format!("{CODEX_KEY}.zcode"));
        }
    }

    #[test]
    fn unrelated_local_provider_is_not_adopted() {
        // Same host, different port and a foreign key: not ours.
        let existing = br#"{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "someone-elses-proxy",
        "providerName": "Other Proxy",
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "sk-not-ours" },
          "api": { "type": "openai-responses", "baseUrl": "http://127.0.0.1:8080/v1" }
        }
      }]
    },
    "modelConfigRules": { "providerModelRules": [], "manualProviderModelRules": [] }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);
        let rules = json["config"]["providerConfigRules"]["providerRules"]
            .as_array()
            .expect("provider rules");
        assert_eq!(rules.len(), 2, "{json}");
        assert_eq!(
            rules
                .iter()
                .find(|rule| rule["providerId"] == "someone-elses-proxy")
                .expect("other provider")["config"]["access"]["apiKey"],
            "sk-not-ours"
        );
        assert_eq!(codex_rule(&json)["config"]["access"]["apiKey"], CODEX_KEY);
    }

    #[test]
    fn inspection_filters_by_platform_so_the_two_targets_do_not_impersonate_each_other() {
        let path = Path::new("provider_config.json");
        assert_eq!(codex_adapter().inspect(path, None).file_status, "missing");

        let claude_only = br#"{
  "schemaVersion": 1,
  "config": {
    "providerConfigRules": {
      "providerRules": [{
        "providerId": "ai-switch-claude",
        "config": {
          "api": {
            "type": "anthropic-messages",
            "baseUrl": "http://127.0.0.1:19527",
            "headers": { "ai-switch-managed": "claude" }
          }
        }
      }]
    },
    "modelConfigRules": { "providerModelRules": [], "manualProviderModelRules": [] }
  }
}"#;
        // Both adapters read the same file, so an unfiltered check would report
        // the Codex target as managed here.
        assert_eq!(
            codex_adapter().inspect(path, Some(claude_only)).file_status,
            "unmanaged"
        );
        assert_eq!(
            claude_adapter()
                .inspect(path, Some(claude_only))
                .file_status,
            "managed"
        );

        let managed = codex_adapter()
            .render(path, None, &input(&["gpt-5.6-sol"]))
            .unwrap();
        let inspection = codex_adapter().inspect(path, Some(&managed));
        assert_eq!(inspection.file_status, "managed");
        assert!(inspection.managed);
    }

    #[test]
    fn corrupt_config_is_refused_rather_than_overwritten() {
        let path = Path::new("provider_config.json");
        // A failed parse makes ZCode degrade to an empty provider list, so
        // overwriting would destroy every provider the user has.
        let error = codex_adapter()
            .render(path, Some(b"{not json"), &input(&["gpt-5.6-sol"]))
            .expect_err("must refuse");
        assert!(matches!(
            error,
            AppError::Validation {
                code: "validation.route_config_existing_invalid",
                ..
            }
        ));

        assert_eq!(
            codex_adapter()
                .inspect(path, Some(b"{not json"))
                .file_status,
            "invalid"
        );
        // A JSON array parses but has no place for the provider store.
        assert_eq!(
            codex_adapter().inspect(path, Some(b"[]")).file_status,
            "invalid"
        );
        assert!(codex_adapter()
            .render(path, Some(b"[]"), &input(&["gpt-5.6-sol"]))
            .is_err());
        // So does an object whose `config` is not an object.
        let bad_config = br#"{"schemaVersion": 1, "config": []}"#;
        assert_eq!(
            codex_adapter().inspect(path, Some(bad_config)).file_status,
            "invalid"
        );
    }

    #[test]
    fn empty_config_file_renders_a_fresh_provider_store() {
        let json = render(codex_adapter().as_ref(), Some(b"   "), &["gpt-5.6-sol"]);
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(
            codex_rule(&json)["config"]["api"]["type"],
            "openai-responses"
        );
    }

    #[test]
    fn adapter_identity_declares_zcode_as_a_restart_required_non_native_client() {
        for adapter in [codex_adapter(), claude_adapter()] {
            assert_eq!(adapter.client_key(), "zcode");
            assert!(
                !adapter.native(),
                "ZCode is not a platform's first-party CLI"
            );
            // ZCode caches the provider list in the running app.
            assert!(adapter.restart_required());
            // ZCode never probes /v1/models for custom providers.
            assert!(adapter.requires_client_models());
        }
        assert_eq!(codex_adapter().target_key(), "zcode_codex");
        assert_eq!(claude_adapter().target_key(), "zcode_claude");
    }
}
