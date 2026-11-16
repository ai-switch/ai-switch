use super::{
    existing_text, generated_invalid, invalid_existing_config, route_proxy_key_matches, ClientModel,
    RouteConfigInput, TargetAdapter, TargetInspection,
};
use crate::{error::AppError, models::platform::PlatformId};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// Qoder ships as two independent products with separate accounts, separate
/// gateways and — the part that matters here — separate config directories.
///
/// The international build (`@qoder-ai/qodercli`) reads `~/.qoder/settings.json`;
/// the China build (`@qodercn-ai/qoderclicn`) reads `~/.qoder-cn/settings.json`.
/// Both bundles are built from one source tree: the CLI switches on a single
/// `isCn` flag for the directory (`.qoder-cn` vs `.qoder`), the environment
/// prefix (`QODERCN_` vs `QODER_`) and the binary name (`qodercn` vs `qoder`).
/// Their credentials do not overlap either — the CN build talks to
/// `gateway.qoder.com.cn` and signs in with an Alibaba Cloud account, the
/// international one talks to `api3.qoder.sh`.
///
/// Writing the international path for a CN user is therefore not a near miss:
/// the file is never read, and the picker shows nothing. Hence two clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum QoderFlavor {
    Global,
    China,
}

impl QoderFlavor {
    /// Config directory name directly under the home directory.
    const fn config_dir(self) -> &'static str {
        match self {
            Self::Global => ".qoder",
            Self::China => ".qoder-cn",
        }
    }

    const fn client_key(self) -> &'static str {
        match self {
            Self::Global => "qoder_cli",
            Self::China => "qoder_cn_cli",
        }
    }

    const fn display_name(self) -> &'static str {
        match self {
            Self::Global => "Qoder CLI",
            Self::China => "Qoder CN CLI",
        }
    }
}

/// Qoder CLI's undocumented `providers` settings key.
///
/// Verified against `@qoder-ai/qodercli` 1.1.28 and `@qodercn-ai/qoderclicn`
/// 1.1.75. Both bundles carry the same `providers` validator, the same
/// `openai-compatible` → `custom-openai` protocol table and the same
/// `get_external_providers_access` gate, so one renderer serves both — only the
/// directory differs. This is the only Qoder surface that can reach a local
/// proxy: the CLI calls `POST {baseUrl}/chat/completions` itself, client-side.
/// The documented BYOK key (`modelConfigs.customModels`) is the opposite — it
/// ships the endpoint to Alibaba's servers inside a protobuf
/// `CustomModelConfig`, so a loopback URL there is unreachable by construction.
///
/// Two runtime gates remain outside our control and are surfaced to the user
/// rather than worked around: the CLI must be logged in to a Qoder account, and
/// the server-side `get_external_providers_access` check must return `allowed`
/// or selecting the model fails with 403 `External Provider is not enabled for
/// the current user.`
pub(super) struct QoderCliAdapter {
    target_key: &'static str,
    platform: PlatformId,
    flavor: QoderFlavor,
    /// Record key for the provider entry. Doubles as the managed marker: the
    /// validator drops a provider outright when it carries an unrecognized key,
    /// so unlike the other adapters this one cannot embed an `aiSwitch` object.
    ///
    /// Must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` and must not be `qoder`.
    provider_id: &'static str,
    display_name: &'static str,
}

impl QoderCliAdapter {
    pub(super) const fn codex() -> Self {
        Self {
            target_key: "qoder_cli_codex",
            platform: PlatformId::Codex,
            flavor: QoderFlavor::Global,
            provider_id: "ai-switch-codex",
            display_name: "AI Switch (Codex)",
        }
    }

    pub(super) const fn claude() -> Self {
        Self {
            target_key: "qoder_cli_claude",
            platform: PlatformId::Claude,
            flavor: QoderFlavor::Global,
            provider_id: "ai-switch-claude",
            display_name: "AI Switch (Claude)",
        }
    }

    pub(super) const fn cn_codex() -> Self {
        Self {
            target_key: "qoder_cn_cli_codex",
            platform: PlatformId::Codex,
            flavor: QoderFlavor::China,
            provider_id: "ai-switch-codex",
            display_name: "AI Switch (Codex)",
        }
    }

    pub(super) const fn cn_claude() -> Self {
        Self {
            target_key: "qoder_cn_cli_claude",
            platform: PlatformId::Claude,
            flavor: QoderFlavor::China,
            provider_id: "ai-switch-claude",
            display_name: "AI Switch (Claude)",
        }
    }

    /// The validator rejects a `baseUrl` carrying credentials, a query string or
    /// a fragment, and trims one trailing slash itself. The CLI appends
    /// `/chat/completions`, so the `/v1` has to be here.
    fn base_url(&self, base_url: &str) -> String {
        let trimmed = base_url
            .trim()
            .trim_end_matches('/')
            .trim_end_matches("/chat/completions")
            .trim_end_matches('/');
        if trimmed
            .rsplit('/')
            .next()
            .is_some_and(|segment| segment.eq_ignore_ascii_case("v1"))
        {
            return trimmed.to_string();
        }
        format!("{trimmed}/v1")
    }

    /// Record key to write into: our own id first, then a hand-made entry whose
    /// base URL and key match. Identification is by record key and URL because
    /// no custom marker field can survive the validator.
    fn adoption_target(&self, providers: &Map<String, Value>, input: &RouteConfigInput) -> String {
        if providers.contains_key(self.provider_id) {
            return self.provider_id.to_string();
        }

        let expected_base = self.base_url(&input.base_url);
        providers
            .iter()
            .find(|(_, entry)| {
                let base_matches = entry
                    .get("baseUrl")
                    .and_then(Value::as_str)
                    .map(|value| value.trim().trim_end_matches('/'))
                    .is_some_and(|value| value == expected_base);
                let api_key = entry
                    .get("apiKey")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();
                let key_matches = route_proxy_key_matches(
                    api_key,
                    self.client_key(),
                    &input.route_proxy_key,
                    &input.route_proxy_key_aliases,
                );
                base_matches && key_matches
            })
            .map(|(key, _)| key.clone())
            .unwrap_or_else(|| self.provider_id.to_string())
    }

    /// Per-model records. The limits belong here and only here: the validator
    /// rejects `contextWindow` / `maxOutputTokens` at the provider level, and
    /// rejects `maxTokens` inside these entries.
    ///
    /// Reasoning tiers go under `capabilities.thinking`. The validator forbids a
    /// `thinking` key on the *model record itself* (`UBA` on the provider flags
    /// it, and `NBA` — which adds `maxTokens` — flags it on each model), but
    /// `capabilities.thinking` is the documented shape it parses and keeps. Both
    /// lists are closed enums:
    ///   * `modes` ∈ `["enabled", "adaptive"]` — how thinking may be switched on.
    ///   * `supportedEffortLevels` ∈ `["none","low","medium","high","xhigh","max"]`.
    ///
    /// Only models whose ladder is non-empty get the block. Qoder derives the
    /// picker's effort list from `supportedEffortLevels`, so an absent block
    /// means "no tier control", which is the correct reading for a model that
    /// declares none.
    fn model_entries(&self, models: &[ClientModel]) -> Vec<Value> {
        models
            .iter()
            .map(|model| {
                let mut capabilities = serde_json::Map::new();
                capabilities.insert("tools".to_string(), Value::Bool(true));
                capabilities.insert(
                    "vision".to_string(),
                    Value::Bool(model.supports_image_input),
                );
                // The client's own effort enum, minus `none`: that one is the
                // "thinking off" position Qoder appends when a ladder omits it,
                // and advertising it as a peer of the real tiers reads as a
                // sixth, empty tier. Deduped here rather than trusting the
                // caller: `supportedEffortLevels` is a set to the client, and a
                // repeated entry would show twice in the picker.
                let mut seen = std::collections::HashSet::new();
                let efforts = model
                    .reasoning_levels
                    .iter()
                    .map(|level| level.trim().to_ascii_lowercase())
                    .filter(|level| {
                        level != "none"
                            && QODER_EFFORT_LEVELS.contains(&level.as_str())
                            && seen.insert(level.clone())
                    })
                    .collect::<Vec<_>>();
                if !efforts.is_empty() {
                    capabilities.insert(
                        "thinking".to_string(),
                        json!({
                            // `enabled` is the plain on/off mode. `adaptive` lets
                            // the model decide, which Qoder surfaces as a separate
                            // choice rather than a tier — declared so the model can
                            // still use it, but the picker's effort list is what
                            // the account actually ticked.
                            "modes": ["enabled", "adaptive"],
                            "supportedEffortLevels": efforts,
                        }),
                    );
                }
                json!({
                    "model": model.id,
                    "displayName": format!("{} {}", self.display_name, model.id),
                    "contextWindow": model.context_window,
                    "maxOutputTokens": model.max_output_tokens,
                    "capabilities": capabilities,
                })
            })
            .collect()
    }
}

impl TargetAdapter for QoderCliAdapter {
    fn target_key(&self) -> &'static str {
        self.target_key
    }

    fn client_key(&self) -> &'static str {
        self.flavor.client_key()
    }

    fn client_display_name(&self) -> &'static str {
        self.flavor.display_name()
    }

    fn native(&self) -> bool {
        false
    }

    fn restart_required(&self) -> bool {
        // The settings schema marks `providers` requiresRestart.
        true
    }

    fn requires_client_models(&self) -> bool {
        true
    }

    fn platform(&self) -> PlatformId {
        self.platform
    }

    fn resolve_path(&self, home: &Path) -> PathBuf {
        home.join(self.flavor.config_dir())
            .join("settings.json")
    }

    fn render(
        &self,
        path: &Path,
        existing: Option<&[u8]>,
        input: &RouteConfigInput,
    ) -> Result<Vec<u8>, AppError> {
        // Qoder tolerates `//` comments here. We parse strict JSON, so a
        // commented file lands in the invalid branch and is refused rather than
        // silently stripped of the user's notes.
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
        let providers = root
            .entry("providers".to_string())
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| invalid_existing_config(path, "JSON", "providers must be an object"))?;

        let provider_id = self.adoption_target(providers, input);
        let existing_entry = providers.get(&provider_id).cloned();

        // Keep a display name the user may have edited.
        let display_name = existing_entry
            .as_ref()
            .and_then(|entry| entry.get("displayName"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(self.display_name)
            .to_string();

        let mut entry = existing_entry
            .and_then(|entry| entry.as_object().cloned())
            .unwrap_or_default();
        entry.insert(
            "type".to_string(),
            Value::String("openai-compatible".to_string()),
        );
        entry.insert("displayName".to_string(), Value::String(display_name));
        entry.insert(
            "baseUrl".to_string(),
            Value::String(self.base_url(&input.base_url)),
        );
        // Must be a literal: a `${VAR}` value is rejected outright.
        entry.insert(
            "apiKey".to_string(),
            Value::String(input.route_proxy_key.clone()),
        );
        // Sampling and window keys are forbidden at this level; anything a user
        // added there would sink the whole provider, so drop them.
        for forbidden in PROVIDER_FORBIDDEN_KEYS {
            entry.remove(*forbidden);
        }
        if let Some(first) = input.client_models.first() {
            entry.insert("model".to_string(), Value::String(first.id.clone()));
        } else {
            entry.remove("model");
        }
        entry.insert(
            "models".to_string(),
            Value::Array(self.model_entries(&input.client_models)),
        );

        providers.insert(provider_id, Value::Object(entry));

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

        // Keyed by our own record key, which is what distinguishes the two
        // platforms inside this shared file.
        let managed = root
            .get("providers")
            .and_then(Value::as_object)
            .is_some_and(|providers| providers.contains_key(self.provider_id));

        TargetInspection::valid(managed)
    }
}

/// Keys the validator refuses at the provider level. Present so an adopted
/// hand-made entry cannot keep a value that would make Qoder discard the whole
/// provider with `[external-providers] Invalid provider configuration`.
///
/// `thinking` / `reasoning` are here because the provider record has no such
/// field — but they are *not* banned outright: reasoning tiers belong under each
/// model's `capabilities.thinking`, which [`QoderCliAdapter::model_entries`]
/// writes. The same list also guards the model records themselves (with
/// `maxTokens` added), so this only ever strips a key that would have been
/// rejected anyway.
const PROVIDER_FORBIDDEN_KEYS: &[&str] = &[
    "contextWindow",
    "maxOutputTokens",
    "temperature",
    "top_p",
    "topP",
    "top_k",
    "topK",
    "thinking",
    "reasoning",
    "preserve_thinking",
    "preserveThinking",
    "generation",
];

/// The closed effort enum Qoder accepts in `capabilities.thinking.
/// supportedEffortLevels` — the CLI's own `AK` array, minus `none`.
///
/// `none` is deliberately excluded. Qoder appends it itself when a ladder does
/// not list it (`GT`: `[...efforts, "none"]`), so declaring it would duplicate
/// the entry the client already synthesises and add an empty sixth tier to a
/// five-tier model.
///
/// Anything outside this list must not be advertised: the CLI throws while
/// building the request when the effort it is about to send is missing from
/// `supportedEffortLevels`, so a stray value would turn every turn into an error
/// rather than degrading to a coarser tier.
const QODER_EFFORT_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

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

    /// A single-model input carrying an explicit effort ladder.
    fn input_with_levels(model: &str, levels: &[&str]) -> RouteConfigInput {
        let mut built = input(&[model]);
        built.client_models[0].reasoning_levels =
            levels.iter().map(|level| (*level).to_string()).collect();
        built
    }

    fn codex_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("qoder_cli", PlatformId::Codex)
            .expect("qoder codex adapter")
    }

    fn claude_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("qoder_cli", PlatformId::Claude)
            .expect("qoder claude adapter")
    }

    fn cn_codex_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("qoder_cn_cli", PlatformId::Codex)
            .expect("qoder cn codex adapter")
    }

    fn cn_claude_adapter() -> std::sync::Arc<dyn TargetAdapter> {
        TargetAdapterRegistry::new()
            .by_client_and_platform("qoder_cn_cli", PlatformId::Claude)
            .expect("qoder cn claude adapter")
    }

    fn render(adapter: &dyn TargetAdapter, existing: Option<&[u8]>, models: &[&str]) -> Value {
        let bytes = adapter
            .render(Path::new("settings.json"), existing, &input(models))
            .expect("render");
        serde_json::from_slice(&bytes).expect("valid JSON")
    }
    #[test]
    fn model_capabilities_write_the_configured_image_input_support() {
        let mut with_image = input(&["deepseek-v4.1"]);
        with_image.client_models[0].supports_image_input = true;
        let mut without_image = input(&["deepseek-v4-flash"]);
        without_image.client_models[0].supports_image_input = false;

        for (input, expected) in [(with_image, true), (without_image, false)] {
            let bytes = codex_adapter()
                .render(Path::new("settings.json"), None, &input)
                .expect("render");
            let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
            assert_eq!(
                json["providers"]["ai-switch-codex"]["models"][0]["capabilities"]["vision"],
                expected
            );
        }
    }

    #[test]
    fn adapter_identity_declares_qoder_as_a_restart_required_non_native_client() {
        for adapter in [
            codex_adapter(),
            claude_adapter(),
            cn_codex_adapter(),
            cn_claude_adapter(),
        ] {
            assert!(!adapter.native());
            // The settings schema marks `providers` requiresRestart.
            assert!(adapter.restart_required());
            assert!(adapter.requires_client_models());
        }
        assert_eq!(codex_adapter().client_key(), "qoder_cli");
        assert_eq!(claude_adapter().client_key(), "qoder_cli");
        assert_eq!(cn_codex_adapter().client_key(), "qoder_cn_cli");
        assert_eq!(cn_claude_adapter().client_key(), "qoder_cn_cli");
        assert_eq!(codex_adapter().target_key(), "qoder_cli_codex");
        assert_eq!(claude_adapter().target_key(), "qoder_cli_claude");
        assert_eq!(cn_codex_adapter().target_key(), "qoder_cn_cli_codex");
        assert_eq!(cn_claude_adapter().target_key(), "qoder_cn_cli_claude");
    }

    #[test]
    fn the_two_flavors_read_their_own_config_directories() {
        let home = Path::new("/home/user");
        // `@qoder-ai/qodercli` reads the international file...
        assert_eq!(
            codex_adapter().resolve_path(home),
            home.join(".qoder").join("settings.json")
        );
        // ...and `@qodercn-ai/qoderclicn` reads the China one. One tree builds
        // both: the CLI picks `.qoder-cn` over `.qoder` from its `isCn` flag.
        assert_eq!(
            cn_codex_adapter().resolve_path(home),
            home.join(".qoder-cn").join("settings.json")
        );
        assert_eq!(
            cn_claude_adapter().resolve_path(home),
            home.join(".qoder-cn").join("settings.json")
        );
        assert_ne!(
            codex_adapter().resolve_path(home),
            cn_codex_adapter().resolve_path(home)
        );
    }

    #[test]
    fn the_china_build_accepts_the_same_provider_document() {
        // Both bundles carry one validator (`ite`/`YJl` in the shipped code) and
        // one `openai-compatible` protocol table, so the renderer is shared and
        // only the directory differs. Assert the fields the validator checks.
        let json = render(cn_codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        let entry = &json["providers"]["ai-switch-codex"];

        assert_eq!(entry["type"], "openai-compatible");
        assert_eq!(entry["baseUrl"], "http://127.0.0.1:19527/v1");
        assert_eq!(entry["apiKey"], CODEX_KEY);
        assert_eq!(entry["models"][0]["model"], "gpt-5.6-sol");
        assert_eq!(entry["models"][0]["contextWindow"], 200_000);
        assert_eq!(entry["models"][0]["maxOutputTokens"], 128_000);
    }

    #[test]
    fn declared_reasoning_levels_reach_the_model_capabilities() {
        // Qoder reads the picker's effort list from `capabilities.thinking.
        // supportedEffortLevels`; without it the model has no tier control.
        let input = input_with_levels("deepseek-v4.1", &["low", "medium", "high", "max"]);
        let bytes = codex_adapter()
            .render(Path::new("settings.json"), None, &input)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
        let thinking = &json["providers"]["ai-switch-codex"]["models"][0]["capabilities"]["thinking"];

        assert_eq!(
            thinking["supportedEffortLevels"],
            serde_json::json!(["low", "medium", "high", "max"])
        );
        // `modes` is a closed enum in the CLI: only these two are accepted.
        assert_eq!(
            thinking["modes"],
            serde_json::json!(["enabled", "adaptive"])
        );
        // A model record may not carry `thinking` at its own level — the
        // validator treats it like `maxTokens` and rejects the whole model.
        assert!(json["providers"]["ai-switch-codex"]["models"][0]
            .get("thinking")
            .is_none());
        assert!(json["providers"]["ai-switch-codex"]
            .get("thinking")
            .is_none());
    }

    #[test]
    fn a_ladder_without_declared_levels_carries_no_thinking_block() {
        // An empty ladder means "the account declared nothing". Writing an empty
        // `supportedEffortLevels` would still render a tier control with no
        // tiers, so the block is omitted entirely.
        let json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        let capabilities = &json["providers"]["ai-switch-codex"]["models"][0]["capabilities"];

        assert!(capabilities.get("thinking").is_none());
        // The rest of the capability record is unaffected.
        assert_eq!(capabilities["tools"], true);
        assert_eq!(capabilities["vision"], true);
    }

    #[test]
    fn only_efforts_the_cli_recognises_are_advertised() {
        // `none` is stripped: Qoder appends it itself when a ladder omits it, so
        // declaring it would add a duplicate, empty tier. Anything the CLI does
        // not know is dropped rather than forwarded — the client throws while
        // building a request whose effort is missing from this list.
        let input = input_with_levels(
            "deepseek-v4.1",
            &["none", "LOW", "medium", " insane ", "max", "low"],
        );
        let bytes = codex_adapter()
            .render(Path::new("settings.json"), None, &input)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
        let levels = &json["providers"]["ai-switch-codex"]["models"][0]["capabilities"]["thinking"]
            ["supportedEffortLevels"];

        // Lowercased, deduped, `none` dropped, unknown dropped, order preserved.
        assert_eq!(levels, &serde_json::json!(["low", "medium", "max"]));
    }

    #[test]
    fn deliberation_modes_do_not_leak_into_the_provider_record() {
        // The provider level has no reasoning field, and a stray one makes Qoder
        // discard the whole provider. The tiers belong to each model.
        let input = input_with_levels("deepseek-v4.1", &["low", "high"]);
        let bytes = codex_adapter()
            .render(Path::new("settings.json"), None, &input)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
        let provider = json["providers"]["ai-switch-codex"]
            .as_object()
            .expect("provider object");

        assert!(!provider.contains_key("thinking"));
        assert!(!provider.contains_key("reasoning"));
        assert!(!provider.contains_key("temperature"));
        assert_eq!(
            provider["models"][0]["capabilities"]["thinking"]["supportedEffortLevels"],
            serde_json::json!(["low", "high"])
        );
    }

    #[test]
    fn provider_ids_are_valid_and_never_the_reserved_name() {
        // `^[A-Za-z0-9][A-Za-z0-9._-]*$`, and `qoder` is rejected by the CLI.
        for adapter in [
            codex_adapter(),
            claude_adapter(),
            cn_codex_adapter(),
            cn_claude_adapter(),
        ] {
            let json = render(adapter.as_ref(), None, &["gpt-5.6-sol"]);
            let providers = json["providers"].as_object().expect("providers object");
            for id in providers.keys() {
                assert_ne!(id, "qoder");
                assert!(
                    id.chars()
                        .next()
                        .is_some_and(|first| first.is_ascii_alphanumeric()),
                    "id must start alphanumeric: {id}"
                );
                assert!(
                    id.chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')),
                    "id has an illegal character: {id}"
                );
            }
        }
    }

    #[test]
    fn managed_entry_carries_a_versioned_base_url_a_literal_key_and_per_model_limits() {
        let json = render(codex_adapter().as_ref(), None, &["gpt-5.6-sol"]);
        let entry = &json["providers"]["ai-switch-codex"];

        assert_eq!(entry["type"], "openai-compatible");
        // The CLI appends /chat/completions itself, so /v1 belongs here.
        assert_eq!(entry["baseUrl"], "http://127.0.0.1:19527/v1");
        // A `${VAR}` value would be rejected, so the key must be literal.
        assert_eq!(entry["apiKey"], CODEX_KEY);
        assert!(!entry["apiKey"].as_str().unwrap().contains("${"));
        assert_eq!(entry["model"], "gpt-5.6-sol");
        assert_eq!(entry["models"][0]["model"], "gpt-5.6-sol");
        assert_eq!(entry["models"][0]["contextWindow"], 200_000);
        assert_eq!(entry["models"][0]["maxOutputTokens"], 128_000);
        assert_eq!(entry["models"][0]["capabilities"]["tools"], true);

        // Forbidden at provider level; forbidden inside a model entry.
        assert!(entry.get("contextWindow").is_none());
        assert!(entry.get("maxOutputTokens").is_none());
        assert!(entry.get("temperature").is_none());
        assert!(entry["models"][0].get("maxTokens").is_none());
    }

    #[test]
    fn render_preserves_other_settings_and_the_sibling_platform_provider() {
        let existing = br#"{
  "securityScan": { "l1StaticCheck": true },
  "model": { "name": "ai-switch-claude/claude-sonnet-alias" },
  "providers": {
    "ai-switch-claude": {
      "type": "openai-compatible",
      "baseUrl": "http://127.0.0.1:19527/v1",
      "apiKey": "sk-ai-switch-claudekey"
    },
    "someone-elses": {
      "type": "openai-compatible",
      "baseUrl": "https://upstream.example/v1",
      "apiKey": "sk-not-ours"
    }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);

        assert_eq!(json["securityScan"]["l1StaticCheck"], true);
        // We never author the active model selection.
        assert_eq!(
            json["model"]["name"],
            "ai-switch-claude/claude-sonnet-alias"
        );
        assert_eq!(
            json["providers"]["ai-switch-claude"]["apiKey"],
            "sk-ai-switch-claudekey"
        );
        assert_eq!(json["providers"]["someone-elses"]["apiKey"], "sk-not-ours");
        assert_eq!(json["providers"]["ai-switch-codex"]["apiKey"], CODEX_KEY);
    }

    #[test]
    fn adoption_claims_a_hand_made_entry_by_base_url_and_rotated_key() {
        let existing = br#"{
  "providers": {
    "my-proxy": {
      "type": "openai-compatible",
      "displayName": "My Renamed Proxy",
      "baseUrl": "http://127.0.0.1:19527/v1",
      "apiKey": "sk-ai-switch-previous",
      "temperature": 0.7
    }
  }
}"#;

        let mut with_alias = input(&["gpt-5.6-sol"]);
        with_alias.route_proxy_key_aliases = vec!["sk-ai-switch-previous".to_string()];
        let bytes = codex_adapter()
            .render(Path::new("settings.json"), Some(existing), &with_alias)
            .expect("render");
        let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
        let entry = &json["providers"]["my-proxy"];

        // Adopt in place rather than adding a second entry for the same proxy.
        assert!(json["providers"].get("ai-switch-codex").is_none());
        // The user may have renamed it; renaming it back is a surprise.
        assert_eq!(entry["displayName"], "My Renamed Proxy");
        assert_eq!(entry["apiKey"], CODEX_KEY);
        // A stray sampling key would make Qoder discard the whole provider.
        assert!(entry.get("temperature").is_none());
    }

    #[test]
    fn adoption_recognizes_suffixed_and_legacy_keys() {
        for configured in [
            CODEX_KEY,
            "sk-ai-switch-previous",
            "sk-ai-switch-previous.qoder_cli",
        ] {
            let existing = format!(
                r#"{{
  "providers": {{
    "my-proxy": {{
      "type": "openai-compatible",
      "displayName": "My Renamed Proxy",
      "baseUrl": "http://127.0.0.1:19527/v1",
      "apiKey": "{configured}"
    }}
  }}
}}"#
            );

            let mut with_alias = input(&["gpt-5.6-sol"]);
            with_alias.route_proxy_key = format!("{CODEX_KEY}.qoder_cli");
            with_alias.route_proxy_key_aliases = vec!["sk-ai-switch-previous".to_string()];
            let bytes = codex_adapter()
                .render(Path::new("settings.json"), Some(existing.as_bytes()), &with_alias)
                .expect("render");
            let json: Value = serde_json::from_slice(&bytes).expect("valid JSON");
            let providers = json["providers"].as_object().expect("providers");

            assert_eq!(
                providers.len(),
                1,
                "no duplicate for {configured}: {json}"
            );
            assert_eq!(
                json["providers"]["my-proxy"]["apiKey"],
                format!("{CODEX_KEY}.qoder_cli")
            );
            assert!(json["providers"].get("ai-switch-codex").is_none());
        }
    }

    #[test]
    fn unrelated_local_provider_is_not_adopted() {
        let existing = br#"{
  "providers": {
    "other-proxy": {
      "type": "openai-compatible",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "apiKey": "sk-not-ours"
    }
  }
}"#;

        let json = render(codex_adapter().as_ref(), Some(existing), &["gpt-5.6-sol"]);

        assert_eq!(json["providers"]["other-proxy"]["apiKey"], "sk-not-ours");
        assert_eq!(json["providers"]["ai-switch-codex"]["apiKey"], CODEX_KEY);
    }

    #[test]
    fn models_are_replaced_wholesale_so_a_dropped_model_disappears() {
        let first = codex_adapter()
            .render(
                Path::new("settings.json"),
                None,
                &input(&["gpt-5.6-sol", "gpt-5.6-sol-lite"]),
            )
            .expect("first render");
        let json: Value = serde_json::from_slice(&first).expect("valid JSON");
        assert_eq!(
            json["providers"]["ai-switch-codex"]["models"]
                .as_array()
                .map(Vec::len),
            Some(2)
        );

        let narrowed = render(codex_adapter().as_ref(), Some(&first), &["gpt-5.6-sol"]);
        let models = narrowed["providers"]["ai-switch-codex"]["models"]
            .as_array()
            .expect("models array");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["model"], "gpt-5.6-sol");
    }

    #[test]
    fn inspection_filters_by_platform_so_the_two_targets_do_not_impersonate_each_other() {
        let path = Path::new("settings.json");
        assert_eq!(codex_adapter().inspect(path, None).file_status, "missing");

        let claude_only = br#"{
  "providers": {
    "ai-switch-claude": {
      "type": "openai-compatible",
      "baseUrl": "http://127.0.0.1:19527/v1",
      "apiKey": "k"
    }
  }
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

        // A real settings file with no providers yet: readable, not ours.
        assert_eq!(
            codex_adapter()
                .inspect(path, Some(br#"{"securityScan":{"l1StaticCheck":true}}"#))
                .file_status,
            "unmanaged"
        );
    }

    #[test]
    fn corrupt_config_is_refused_rather_than_overwritten() {
        let path = Path::new("settings.json");
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

        // Qoder tolerates `//` comments; we refuse rather than strip them.
        assert!(codex_adapter()
            .render(
                path,
                Some(b"{\n  // keep my notes\n  \"providers\": {}\n}"),
                &input(&["gpt-5.6-sol"])
            )
            .is_err());

        assert_eq!(
            codex_adapter().inspect(path, Some(b"[]")).file_status,
            "invalid"
        );
        assert!(codex_adapter()
            .render(path, Some(b"[]"), &input(&["gpt-5.6-sol"]))
            .is_err());
    }

    #[test]
    fn empty_settings_file_renders_a_fresh_provider_map() {
        let json = render(codex_adapter().as_ref(), Some(b"   "), &["gpt-5.6-sol"]);
        assert_eq!(
            json["providers"]["ai-switch-codex"]["type"],
            "openai-compatible"
        );
    }
}
