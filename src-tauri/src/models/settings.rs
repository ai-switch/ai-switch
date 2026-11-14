use serde::{Deserialize, Serialize};

pub const DEFAULT_ROUTE_PROXY_REQUEST_BODY_LIMIT_MIB: u32 = 128;

fn default_route_proxy_request_body_limit_mib() -> u32 {
    DEFAULT_ROUTE_PROXY_REQUEST_BODY_LIMIT_MIB
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub copy_import_sources: bool,
    pub logging_enabled: bool,
    pub secret_storage: String,
    pub data_dir: String,
    #[serde(default)]
    pub ccswitch_deeplink_compat_enabled: bool,
    /// Close-button behavior: hide to the tray (true) or quit the app (false).
    /// On macOS the Dock icon follows the main window while this is enabled.
    /// Settings files written before this field existed default to the tray,
    /// which is what the app did unconditionally back then.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default)]
    pub image_generation_enabled: bool,
    /// Pool-wide Claude Code client behavior switches (`includeCoAuthoredBy`,
    /// `permissions`, …), as a JSON object string. These are read by Claude Code
    /// from its own settings file, which the whole pool shares — so unlike model
    /// mappings they cannot be per-account. Merged into the settings file's root
    /// on every config write.
    #[serde(default)]
    pub claude_client_config_json: Option<String>,
    /// Per-model-mode Claude Code `/model` slot overrides, as
    /// `{"aggregate":{...},"precise":{...}}`. Keyed by mode because the model
    /// ids clients request differ: routing mode pins `<account>/<alias>` while
    /// aggregate mode exposes the bare `<alias>`. A stored override for the
    /// other mode must never silently leak into the active one.
    ///
    /// Absent / malformed / empty means every slot falls back to the automatic
    /// consensus resolution from the pool's API account mappings.
    #[serde(default)]
    pub claude_slot_overrides_json: Option<String>,
    /// Which clients each platform writes config for, as
    /// `{"codex":["codex","zcode"]}`. Recorded per platform because the dialog
    /// always opens in one platform's context. Absent or empty means the
    /// platform's native CLI only.
    #[serde(default)]
    pub config_write_clients_json: Option<String>,
    #[serde(default)]
    pub deepseek_harness_config_path: Option<String>,
    /// Notification channel configuration (Feishu, Bark, Webhook), serialized as
    /// a JSON object string. Absent means no notifications configured.
    #[serde(default)]
    pub notification_config_json: Option<String>,
    /// Whether outbound requests from this process should go through the
    /// user-configured HTTP proxy. Settings files written before this field
    /// existed default to off, leaving externally-set proxy env vars untouched.
    #[serde(default)]
    pub proxy_enabled: bool,
    /// Proxy endpoint applied to the process environment while
    /// `proxy_enabled` is on, e.g. `http://127.0.0.1:7890`.
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// Maximum inbound model request size in MiB; 0 disables this local limit.
    #[serde(default = "default_route_proxy_request_body_limit_mib")]
    pub route_proxy_request_body_limit_mib: u32,
    /// Write the Codex provider entry so the client keeps authenticating with
    /// the ChatGPT login in `~/.codex/auth.json` instead of the local proxy
    /// key. Off by default: it only works when that login exists, and enabling
    /// it removes `experimental_bearer_token` from the provider table.
    #[serde(default)]
    pub codex_keep_login_state: bool,
    /// Opt into the beta update channel: checks a manifest that also carries
    /// release candidates instead of the stable-only `/releases/latest`.
    /// Off by default, so ordinary users only ever see stable releases.
    #[serde(default)]
    pub beta_updates_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettingsView {
    pub language: String,
    pub theme: String,
    pub copy_import_sources: bool,
    pub logging_enabled: bool,
    pub secret_storage: String,
    pub data_dir: String,
    pub ccswitch_deeplink_compat_enabled: bool,
    pub ccswitch_deeplink_compat_supported: bool,
    pub close_to_tray: bool,
    pub image_generation_enabled: bool,
    pub claude_client_config_json: Option<String>,
    pub claude_slot_overrides_json: Option<String>,
    pub config_write_clients_json: Option<String>,
    pub deepseek_harness_config_path: Option<String>,
    pub notification_config_json: Option<String>,
    pub proxy_enabled: bool,
    pub proxy_url: Option<String>,
    pub route_proxy_request_body_limit_mib: u32,
    pub codex_keep_login_state: bool,
    pub beta_updates_enabled: bool,
}

impl AppSettingsView {
    pub fn from_settings(settings: AppSettings, supported: bool) -> Self {
        Self {
            language: settings.language,
            theme: settings.theme,
            copy_import_sources: settings.copy_import_sources,
            logging_enabled: settings.logging_enabled,
            secret_storage: settings.secret_storage,
            data_dir: settings.data_dir,
            ccswitch_deeplink_compat_enabled: settings.ccswitch_deeplink_compat_enabled,
            ccswitch_deeplink_compat_supported: supported,
            close_to_tray: settings.close_to_tray,
            image_generation_enabled: settings.image_generation_enabled,
            claude_client_config_json: settings.claude_client_config_json,
            claude_slot_overrides_json: settings.claude_slot_overrides_json,
            config_write_clients_json: settings.config_write_clients_json,
            deepseek_harness_config_path: settings.deepseek_harness_config_path,
            notification_config_json: settings.notification_config_json,
            proxy_enabled: settings.proxy_enabled,
            proxy_url: settings.proxy_url,
            route_proxy_request_body_limit_mib: settings.route_proxy_request_body_limit_mib,
            codex_keep_login_state: settings.codex_keep_login_state,
            beta_updates_enabled: settings.beta_updates_enabled,
        }
    }
}

impl AppSettings {
    pub fn defaults_for_data_dir(data_dir: String) -> Self {
        Self {
            language: "zh-CN".to_string(),
            theme: "system".to_string(),
            copy_import_sources: false,
            logging_enabled: true,
            secret_storage: "keyring".to_string(),
            data_dir,
            ccswitch_deeplink_compat_enabled: false,
            close_to_tray: true,
            image_generation_enabled: false,
            claude_client_config_json: None,
            claude_slot_overrides_json: None,
            config_write_clients_json: None,
            deepseek_harness_config_path: None,
            notification_config_json: None,
            proxy_enabled: false,
            proxy_url: None,
            route_proxy_request_body_limit_mib: DEFAULT_ROUTE_PROXY_REQUEST_BODY_LIMIT_MIB,
            codex_keep_login_state: false,
            beta_updates_enabled: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AppSettings;

    #[test]
    fn deserializes_legacy_settings_without_close_to_tray() {
        let json = r#"{
            "language": "zh-CN",
            "theme": "system",
            "copy_import_sources": false,
            "logging_enabled": true,
            "secret_storage": "keyring",
            "data_dir": "/tmp/ai-switch",
            "ccswitch_deeplink_compat_enabled": false
        }"#;
        let settings: AppSettings = serde_json::from_str(json).expect("parse legacy settings");
        let view = super::AppSettingsView::from_settings(settings.clone(), false);
        assert_eq!(
            serde_json::to_value(&settings).unwrap()["route_proxy_request_body_limit_mib"],
            128,
        );
        assert_eq!(
            serde_json::to_value(&view).unwrap()["route_proxy_request_body_limit_mib"],
            128,
        );
        assert!(settings.close_to_tray);
        assert!(!settings.image_generation_enabled);
        assert!(!settings.proxy_enabled);
        assert!(settings.proxy_url.is_none());
        // Keeping the ChatGPT login is opt-in: a settings file from before the
        // switch existed must not silently start writing auth-free providers.
        assert!(!settings.codex_keep_login_state);
        // Beta updates are opt-in: a settings file from before the switch
        // existed must not start checking the prerelease channel.
        assert!(!settings.beta_updates_enabled);
        assert_eq!(
            serde_json::to_value(&view).unwrap()["beta_updates_enabled"],
            false,
        );
        assert_eq!(
            serde_json::to_value(&view).unwrap()["codex_keep_login_state"],
            false,
        );
    }
}
