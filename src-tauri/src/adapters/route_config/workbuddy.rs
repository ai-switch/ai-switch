use super::{
    client_home, existing_text, generated_invalid, invalid_existing_config, ClientModel,
    RouteConfigInput, TargetAdapter, TargetInspection,
};
use crate::{error::AppError, models::platform::PlatformId};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// WorkBuddy's per-model custom provider store, shared with the standalone
/// CodeBuddy Code CLI.
///
/// Verified against WorkBuddy 5.3.14 (`cli/dist/codebuddy.js`). Two facts drive
/// the whole adapter and are worth stating because both contradict the usual
/// assumption that this is a Claude Code fork:
///
/// - Codex models use **OpenAI Chat Completions** (`/v1/chat/completions`);
///   Claude models use the **Responses** endpoint (`/v1/responses`). The proxy
///   bridges whichever dialect each account actually speaks.
/// - It reads `CODEBUDDY_*` env keys only — `ANTHROPIC_BASE_URL` and friends have
///   zero hits — so there is no env-block shortcut like Claude Code's.
///
/// `models.json` is a flat array of model records, each carrying its own `url`
/// and `apiKey`, which is why one write emits one record per advertised model
/// rather than a single provider entry with a nested model map.
///
/// The desktop app and the CLI are the same code reading different data dirs:
/// the desktop injects `CODEBUDDY_CONFIG_DIR`/`WORKBUDDY_CONFIG_DIR` pointing at
/// its own data folder, while a bare `codebuddy` invocation resolves
/// `~/.codebuddy`. They are separate install targets, so each gets its own client
/// rather than one write pretending to cover both.
///
/// The data folder itself is not fixed: `getUserConfigPath()` falls back to
/// `path.join(os.homedir(), productJson.dataFolderName, "models.json")`, and the
/// mainland and overseas builds ship different `product.json` files. Verified on
/// disk for 5.5.6 and 5.5.2:
///
/// | build | `productName` | `applicationName` | `dataFolderName` |
/// | --- | --- | --- | --- |
/// | mainland | `WorkBuddy` | `WorkBuddy` | `.workbuddy` |
/// | overseas | `WorkBuddy AI` | `workbuddy-ai` | `.workbuddy-ai` |
///
/// Both can be installed side by side — they are two separate products in the
/// uninstall registry — so they are two clients with two files, exactly like the
/// desktop/CLI split above. Matching on `productName` would have collapsed them:
/// `"WorkBuddy AI".toLowerCase().includes("workbuddy")` is true.
pub(super) struct WorkBuddyAdapter {
    target_key: &'static str,
    client_key: &'static str,
    client_display_name: &'static str,
    /// Home-relative data dir holding `models.json`.
    config_dir: &'static str,
    platform: PlatformId,
    display_name_prefix: &'static str,
}

impl WorkBuddyAdapter {
    pub(super) const fn codex() -> Self {
        Self {
            target_key: "workbuddy_codex",
            client_key: "workbuddy",
            client_display_name: "WorkBuddy",
            config_dir: ".workbuddy",
            platform: PlatformId::Codex,
            display_name_prefix: "AI Switch Codex",
        }
    }

    pub(super) const fn claude() -> Self {
        Self {
            target_key: "workbuddy_claude",
            client_key: "workbuddy",
            client_display_name: "WorkBuddy",
            config_dir: ".workbuddy",
            platform: PlatformId::Claude,
            display_name_prefix: "AI Switch Claude",
        }
    }

    /// The overseas build ("WorkBuddy AI") ships `dataFolderName:
    /// ".workbuddy-ai"`, so it reads a different `models.json` than the mainland
    /// build. Same code, same file shape, different folder.
    pub(super) const fn workbuddy_ai_codex() -> Self {
        Self {
            target_key: "workbuddy_ai_codex",
            client_key: "workbuddy_ai",
            client_display_name: "WorkBuddy AI",
            config_dir: ".workbuddy-ai",
            platform: PlatformId::Codex,
            display_name_prefix: "AI Switch Codex",
        }
    }

    pub(super) const fn workbuddy_ai_claude() -> Self {
        Self {
            target_key: "workbuddy_ai_claude",
            client_key: "workbuddy_ai",
            client_display_name: "WorkBuddy AI",
            config_dir: ".workbuddy-ai",
            platform: PlatformId::Claude,
            display_name_prefix: "AI Switch Claude",
        }
    }

    pub(super) const fn codebuddy_codex() -> Self {
        Self {
            target_key: "codebuddy_cli_codex",
            client_key: "codebuddy_cli",
            client_display_name: "CodeBuddy CLI",
            config_dir: ".codebuddy",
            platform: PlatformId::Codex,
            display_name_prefix: "AI Switch Codex",
        }
    }

    pub(super) const fn codebuddy_claude() -> Self {
        Self {
            target_key: "codebuddy_cli_claude",
            client_key: "codebuddy_cli",
            client_display_name: "CodeBuddy CLI",
            config_dir: ".codebuddy",
            platform: PlatformId::Claude,
            display_name_prefix: "AI Switch Claude",
        }
    }

    /// The upstream URL one model record points at.
    ///
    /// Codex keeps the OpenAI Chat Completions path. Claude goes through the
    /// proxy's Responses endpoint: WorkBuddy/CodeBuddy's Claude models talk the
    /// Responses protocol, and the proxy bridges it to each account's dialect.
    fn model_url(&self, base_url: &str) -> String {
        let suffix = if self.platform == PlatformId::Claude {
            "/responses"
        } else {
            "/chat/completions"
        };
        let trimmed = base_url.trim().trim_end_matches('/');
        if trimmed.ends_with(suffix) {
            return trimmed.to_string();
        }
        // Drop a legacy sibling suffix so an old base URL cannot double up.
        let trimmed = trimmed
            .strip_suffix("/chat/completions")
            .or_else(|| trimmed.strip_suffix("/responses"))
            .unwrap_or(trimmed);
        let with_version = if trimmed
            .rsplit('/')
            .next()
            .is_some_and(|segment| segment.eq_ignore_ascii_case("v1"))
        {
            trimmed.to_string()
        } else {
            format!("{trimmed}/v1")
        };
        format!("{with_version}{suffix}")
    }

    /// Whether this record is one of ours: either it carries our marker for this
    /// platform, or it is a hand-made record pointing at the same proxy URL with
    /// the platform's current or a rotated key.
    fn is_ours(&self, entry: &Value, input: &RouteConfigInput) -> bool {
        let managed = entry.pointer("/aiSwitch/managed").and_then(Value::as_bool) == Some(true);
        let marked_for_platform = entry
            .pointer("/aiSwitch/platform")
            .and_then(Value::as_str)
            .is_some_and(|value| value == self.platform.as_str());
        if managed && marked_for_platform {
            return true;
        }
        // A record marked for the sibling platform is explicitly not ours; both
        // adapters share this file and must not delete each other's records.
        if managed {
            return false;
        }

        let expected_url = self.model_url(&input.base_url);
        // A Claude record written before this change points at the legacy Chat
        // Completions URL. Accept it as ours so the next write replaces it in
        // place instead of appending a duplicate record.
        let legacy_claude_url = (self.platform == PlatformId::Claude)
            .then(|| input.base_url.trim().trim_end_matches('/'))
            .map(|base| {
                let base = base
                    .strip_suffix("/chat/completions")
                    .or_else(|| base.strip_suffix("/responses"))
                    .unwrap_or(base);
                let with_version = if base
                    .rsplit('/')
                    .next()
                    .is_some_and(|segment| segment.eq_ignore_ascii_case("v1"))
                {
                    base.to_string()
                } else {
                    format!("{base}/v1")
                };
                format!("{with_version}/chat/completions")
            });
        let url_matches = entry
            .get("url")
            .and_then(Value::as_str)
            .map(|value| value.trim().trim_end_matches('/'))
            .is_some_and(|value| {
                value == expected_url
                    || legacy_claude_url
                        .as_deref()
                        .is_some_and(|legacy| value == legacy)
            });
        let api_key = entry
            .get("apiKey")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let key_matches = !api_key.is_empty()
            && (api_key == input.route_proxy_key
                || input
                    .route_proxy_key_aliases
                    .iter()
                    .any(|alias| alias == api_key));
        url_matches && key_matches
    }

    fn model_records(&self, input: &RouteConfigInput) -> Vec<Value> {
        let url = self.model_url(&input.base_url);
        input
            .client_models
            .iter()
            .map(|model| self.model_record(model, &url, &input.route_proxy_key))
            .collect()
    }

    fn model_record(&self, model: &ClientModel, url: &str, api_key: &str) -> Value {
        json!({
            "id": model.id,
            "name": format!("{} {}", self.display_name_prefix, model.id),
            "vendor": "Custom",
            "url": url,
            "apiKey": api_key,
            "maxInputTokens": model.context_window,
            "maxOutputTokens": model.max_output_tokens,
            "supportsToolCall": true,
            "supportsImages": model.supports_image_input,
            "aiSwitch": { "managed": true, "platform": self.platform.as_str() },
        })
    }
}

impl TargetAdapter for WorkBuddyAdapter {
    fn target_key(&self) -> &'static str {
        self.target_key
    }

    fn client_key(&self) -> &'static str {
        self.client_key
    }

    fn client_display_name(&self) -> &'static str {
        self.client_display_name
    }

    fn native(&self) -> bool {
        false
    }

    fn restart_required(&self) -> bool {
        // models.json is watched (fs.watch + 1s debounce), but the desktop app
        // resolves credentials once per session, so a restart is still the
        // predictable path.
        true
    }

    fn requires_client_models(&self) -> bool {
        true
    }

    fn platform(&self) -> PlatformId {
        self.platform
    }

    /// The desktop app and its bundled CLI both call an `os-homedir` ponyfill
    /// (`HOME` first, then the profile dir), so a global `HOME` exported by
    /// other software — Cadence SPB 16.6 sets it to `%APPDATA%\SPB_16.6` —
    /// moves this file to the redirected root too. `home` here is the profile
    /// dir from `BaseDirs`, which is only the ponyfill's fallback; resolve
    /// through the same chain the client uses.
    ///
    /// `self.config_dir` is the build's own `product.json#dataFolderName`, so the
    /// mainland and overseas clients land on the file each of them actually
    /// reads. `WORKBUDDY_CONFIG_DIR`/`CODEBUDDY_CONFIG_DIR` take precedence over
    /// that folder in `getUserConfigPath()`, but a process-local injection is how
    /// the desktop points its own CLI child at the same folder — it never makes
    /// the two builds disagree about which folder is theirs, so it is not
    /// overridden here.
    fn resolve_path(&self, home: &Path) -> PathBuf {
        client_home::ponyfill_base_for(home)
            .join(self.config_dir)
            .join("models.json")
    }

    fn render(
        &self,
        path: &Path,
        existing: Option<&[u8]>,
        input: &RouteConfigInput,
    ) -> Result<Vec<u8>, AppError> {
        // The file accepts either a bare array (treated as `models`) or an object
        // wrapper. Normalizing to the object form on write keeps room for
        // `availableModels`, which we preserve but never author.
        let mut root = match existing {
            Some(bytes) => {
                let content = existing_text(path, "JSON", bytes)?;
                if content.trim().is_empty() {
                    Map::new()
                } else {
                    match serde_json::from_str::<Value>(content)
                        .map_err(|_| invalid_existing_config(path, "JSON", "syntax is invalid"))?
                    {
                        Value::Object(map) => map,
                        Value::Array(models) => {
                            let mut map = Map::new();
                            map.insert("models".to_string(), Value::Array(models));
                            map
                        }
                        _ => {
                            return Err(invalid_existing_config(
                                path,
                                "JSON",
                                "root value must be an object or an array of models",
                            ))
                        }
                    }
                }
            }
            None => Map::new(),
        };

        let existing_models = match root.remove("models") {
            Some(Value::Array(models)) => models,
            Some(Value::Null) | None => Vec::new(),
            Some(_) => {
                return Err(invalid_existing_config(
                    path,
                    "JSON",
                    "models must be an array",
                ))
            }
        };

        // Records we own are replaced wholesale, so a model the pool stopped
        // advertising disappears instead of lingering with a stale limit. Every
        // other record — the user's own, and the sibling platform's — survives.
        let mut models: Vec<Value> = existing_models
            .into_iter()
            .filter(|entry| !self.is_ours(entry, input))
            .collect();
        models.extend(self.model_records(input));
        root.insert("models".to_string(), Value::Array(models));

        let rendered = serde_json::to_vec_pretty(&Value::Object(root))
            .map_err(|_| generated_invalid(path, "JSON"))?;
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
        let models = match &config {
            Value::Array(models) => Some(models),
            Value::Object(root) => match root.get("models") {
                Some(Value::Array(models)) => Some(models),
                // Absent or null is a readable file that simply has no records
                // yet — the same shapes `render` accepts.
                None | Some(Value::Null) => Some(&EMPTY_MODELS),
                Some(_) => None,
            },
            _ => None,
        };
        let Some(models) = models else {
            return TargetInspection::invalid();
        };

        // Both WorkBuddy adapters read this one file, so the marker has to be
        // matched per platform or each target would report the other's records.
        let managed = models.iter().any(|entry| {
            entry.pointer("/aiSwitch/managed").and_then(Value::as_bool) == Some(true)
                && entry
                    .pointer("/aiSwitch/platform")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == self.platform.as_str())
        });

        TargetInspection::valid(managed)
    }
}

/// Stand-in for a wrapper object that has no `models` key yet, so `inspect` can
/// treat it as valid-but-unmanaged instead of borrowing a temporary.
static EMPTY_MODELS: Vec<Value> = Vec::new();

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::route_config::TargetAdapterRegistry;

    const BASE_URL: &str = "http://127.0.0.1:19527";
    const CODEX_KEY: &str = "sk-ai-switch-codexkey";

    fn input(models: &[&str]) -> RouteConfigInput {
        RouteConfigInput {
            base_url: BASE_URL.to_string(),
            route_proxy_key: CODEX_KEY.to_string(),
            route_proxy_key_aliases: Vec::new(),
            claude_env: crate::adapters::route_config::ClaudeEnvPlan::default(),
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
            .by_client_and_platform("workbuddy", PlatformId::Codex)
            .expect("workbuddy codex adapter")
    }

    fn claude_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("workbuddy", PlatformId::Claude)
            .expect("workbuddy claude adapter")
    }

    fn render(adapter: &dyn TargetAdapter, existing: Option<&[u8]>, models: &[&str]) -> Value {
        let bytes = adapter
            .render(Path::new("models.json"), existing, &input(models))
            .expect("render");
        serde_json::from_slice(&bytes).expect("valid JSON")
    }

    fn ids(json: &Value) -> Vec<String> {
        json["models"]
            .as_array()
            .expect("models array")
            .iter()
            .map(|entry| entry["id"].as_str().unwrap_or_default().to_string())
            .collect()
    }
    #[test]
    fn model_records_write_the_configured_image_input_support() {
        let mut with_image = input(&["deepseek-v4.1"]);
        with_image.client_models[0].supports_image_input = true;
        let mut without_image = input(&["deepseek-v4-flash"]);
        without_image.client_models[0].supports_image_input = false;

        for (input, expected) in [(with_image, true), (without_image, false)] {
            let bytes = codex_adapter()
                .render(Path::new("models.json"), None, &input)
                .expect("render");
            let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
            assert_eq!(json["models"][0]["supportsImages"], expected);
        }
    }

    #[test]
    fn adapter_identity_declares_workbuddy_as_a_restart_required_non_native_client() {
        for adapter in [codex_adapter(), claude_adapter()] {
            assert_eq!(adapter.client_key(), "workbuddy");
            assert!(!adapter.native());
            assert!(adapter.restart_required());
            // WorkBuddy skips defaultRelatedModels for custom entries and never
            // probes /v1/models, so the pool has to supply the list.
            assert!(adapter.requires_client_models());
        }
        assert_eq!(codex_adapter().target_key(), "workbuddy_codex");
        assert_eq!(claude_adapter().target_key(), "workbuddy_claude");
    }

    #[test]
    fn resolved_path_is_the_user_level_custom_model_store() {
        let home = Path::new("/home/user");
        assert_eq!(
            codex_adapter().resolve_path(home),
            home.join(".workbuddy").join("models.json")
        );
    }

    /// The overseas build reads `.workbuddy-ai`, not `.workbuddy`. Matching the
    /// product name would have been wrong — "WorkBuddy AI" contains
    /// "workbuddy" — so the folder comes from each build's `product.json`.
    #[test]
    fn the_overseas_build_reads_its_own_data_folder() {
        let registry = TargetAdapterRegistry::new();
        let home = Path::new("/home/user");

        for (platform, target_key) in [
            (PlatformId::Codex, "workbuddy_ai_codex"),
            (PlatformId::Claude, "workbuddy_ai_claude"),
        ] {
            let adapter = registry
                .by_client_and_platform("workbuddy_ai", platform)
                .expect("workbuddy ai adapter");
            assert_eq!(adapter.target_key(), target_key);
            assert_eq!(adapter.client_display_name(), "WorkBuddy AI");
            assert_eq!(
                adapter.resolve_path(home),
                home.join(".workbuddy-ai").join("models.json")
            );
        }

        // Two installs, two files: configuring one must never be mistaken for
        // configuring the other.
        assert_ne!(
            registry
                .by_client_and_platform("workbuddy", PlatformId::Codex)
                .expect("workbuddy")
                .resolve_path(home),
            registry
                .by_client_and_platform("workbuddy_ai", PlatformId::Codex)
                .expect("workbuddy ai")
                .resolve_path(home)
        );
    }

    /// The desktop app and the bare CLI are the same code reading different data
    /// dirs, so they are separate clients writing separate files. A single write
    /// must never be assumed to cover both.
    #[test]
    fn the_standalone_codebuddy_cli_is_a_separate_client_with_its_own_data_dir() {
        let registry = TargetAdapterRegistry::new();
        let home = Path::new("/home/user");

        for (platform, target_key) in [
            (PlatformId::Codex, "codebuddy_cli_codex"),
            (PlatformId::Claude, "codebuddy_cli_claude"),
        ] {
            let adapter = registry
                .by_client_and_platform("codebuddy_cli", platform)
                .expect("codebuddy cli adapter");
            assert_eq!(adapter.target_key(), target_key);
            assert_eq!(adapter.client_display_name(), "CodeBuddy CLI");
            assert_eq!(
                adapter.resolve_path(home),
                home.join(".codebuddy").join("models.json")
            );
            // Same file shape as the desktop app; the endpoint follows the
            // platform's wire protocol (Codex chat, Claude responses).
            let json = render(adapter.as_ref(), None, &["gpt-5.6-sol"]);
            let expected_suffix = if platform == PlatformId::Claude {
                "/v1/responses"
            } else {
                "/v1/chat/completions"
            };
            assert_eq!(
                json["models"][0]["url"],
                format!("http://127.0.0.1:19527{expected_suffix}")
            );
        }

        // Distinct paths: writing one leaves the other untouched.
        assert_ne!(
            registry
                .by_client_and_platform("workbuddy", PlatformId::Codex)
                .expect("workbuddy")
                .resolve_path(home),
            registry
                .by_client_and_platform("codebuddy_cli", PlatformId::Codex)
                .expect("codebuddy cli")
                .resolve_path(home)
        );
    }

    #[test]
    fn claude_workbuddy_uses_responses_but_codex_keeps_chat_completions() {
        let claude_json = render(claude_adapter().as_ref(), None, &["provider-sonnet"]);
        assert_eq!(
            claude_json["models"][0]["url"],
            format!("{BASE_URL}/v1/responses")
        );

        let codex_json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        assert_eq!(
            codex_json["models"][0]["url"],
            format!("{BASE_URL}/v1/chat/completions")
        );
    }

    #[test]
    fn managed_record_carries_credentials_limits_and_the_managed_marker() {
        let json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        let record = &json["models"][0];

        assert_eq!(record["id"], "gpt-5.6-sol");
        assert_eq!(record["apiKey"], CODEX_KEY);
        assert_eq!(record["vendor"], "Custom");
        assert_eq!(record["maxInputTokens"], 200_000);
        assert_eq!(record["maxOutputTokens"], 128_000);
        assert_eq!(record["supportsToolCall"], true);
        assert_eq!(record["aiSwitch"]["managed"], true);
        assert_eq!(record["aiSwitch"]["platform"], "codex");
        // The loader rewrites these itself (`custom-local:` prefix, `tags`,
        // override mode), so authoring them would be misleading.
        assert!(record.get("tags").is_none());
        assert!(record.get("aliases").is_none());
    }

    #[test]
    fn render_preserves_unrelated_models_and_the_sibling_platform_records() {
        let existing = br#"{
  "models": [
    {
      "id": "my-own-model",
      "name": "Hand made",
      "url": "https://upstream.example/v1/chat/completions",
      "apiKey": "sk-not-ours"
    },
    {
      "id": "claude-sonnet-alias",
      "url": "http://127.0.0.1:19527/v1/chat/completions",
      "apiKey": "sk-ai-switch-claudekey",
      "aiSwitch": { "managed": true, "platform": "claude" }
    }
  ],
  "availableModels": ["my-own-model"]
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);

        assert_eq!(
            ids(&json),
            vec!["my-own-model", "claude-sonnet-alias", "gpt-5.6-sol"]
        );
        // We never author availableModels, so a user who curated it keeps it.
        assert_eq!(json["availableModels"], json!(["my-own-model"]));
    }

    #[test]
    fn rewriting_replaces_only_our_own_records_so_dropped_models_disappear() {
        let first = codex_adapter()
            .render(
                Path::new("models.json"),
                None,
                &input(&["gpt-5.6-sol", "gpt-5.6-sol-lite"]),
            )
            .expect("first render");
        let json: Value = serde_json::from_slice(&first).expect("valid JSON");
        assert_eq!(ids(&json), vec!["gpt-5.6-sol", "gpt-5.6-sol-lite"]);

        let narrowed = render(codex_adapter().as_ref(), Some(&first), &["gpt-5.6-sol"]);
        assert_eq!(ids(&narrowed), vec!["gpt-5.6-sol"]);
    }

    #[test]
    fn a_hand_made_record_for_the_same_proxy_is_adopted_rather_than_duplicated() {
        // What a user who wired this up by hand has: no marker, but our URL and
        // a key the platform used before rotation.
        let existing = br#"{
  "models": [
    {
      "id": "gpt-5.6-sol",
      "name": "My Local Proxy",
      "url": "http://127.0.0.1:19527/v1/chat/completions",
      "apiKey": "sk-ai-switch-previous"
    }
  ]
}"#;

        let mut with_alias = input(&["gpt-5.6-sol"]);
        with_alias.route_proxy_key_aliases = vec!["sk-ai-switch-previous".to_string()];
        let bytes = codex_adapter()
            .render(Path::new("models.json"), Some(existing), &with_alias)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");

        assert_eq!(ids(&json), vec!["gpt-5.6-sol"]);
        assert_eq!(json["models"][0]["apiKey"], CODEX_KEY);
        assert_eq!(json["models"][0]["aiSwitch"]["managed"], true);
    }

    #[test]
    fn a_bare_array_file_is_normalized_to_the_object_form() {
        let existing = br#"[{ "id": "keep-me", "url": "https://upstream.example/v1" }]"#;
        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);

        assert_eq!(ids(&json), vec!["keep-me", "gpt-5.6-sol"]);
    }

    #[test]
    fn inspection_filters_by_platform_so_the_two_targets_do_not_impersonate_each_other() {
        let path = Path::new("models.json");
        assert_eq!(codex_adapter().inspect(path, None).file_status, "missing");

        let claude_only = br#"{
  "models": [
    {
      "id": "claude-sonnet-alias",
      "url": "http://127.0.0.1:19527/v1/chat/completions",
      "apiKey": "k",
      "aiSwitch": { "managed": true, "platform": "claude" }
    }
  ]
}"#;
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

        // An empty wrapper is readable, just not ours yet.
        assert_eq!(
            codex_adapter().inspect(path, Some(b"{}")).file_status,
            "unmanaged"
        );
    }

    #[test]
    fn corrupt_or_wrongly_shaped_config_is_refused_rather_than_overwritten() {
        let path = Path::new("models.json");
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

        // `models` present but not an array: overwriting would drop whatever the
        // user meant to put there.
        assert!(codex_adapter()
            .render(path, Some(br#"{"models": {}}"#), &input(&["gpt-5.6-sol"]))
            .is_err());
        assert_eq!(
            codex_adapter()
                .inspect(path, Some(br#"{"models": {}}"#))
                .file_status,
            "invalid"
        );
    }

    #[test]
    fn empty_file_renders_a_fresh_model_list() {
        let json = render(codex_adapter().as_ref(), Some(b"   "), &["gpt-5.6-sol"]);
        assert_eq!(ids(&json), vec!["gpt-5.6-sol"]);
    }
}
