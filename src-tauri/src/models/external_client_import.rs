use crate::models::route_credential::RouteCredential;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Client id for cc-switch imports.
///
/// This exact string is stored in `route_credentials.external_source_client`, so
/// renaming it orphans every account already imported under the old value and a
/// re-import would create duplicates instead of overwriting.
pub const EXTERNAL_CLIENT_CC_SWITCH: &str = "cc-switch";

/// Client id for Codex++ imports (`~/.codex-session-delete/`). Same
/// external_source_client constraint as cc-switch: the value is load-bearing.
pub const EXTERNAL_CLIENT_CODEX_PLUS: &str = "codex-plus";

/// Client id for Magpie imports (`~/.config/magpie/`). Same
/// external_source_client constraint as cc-switch: the value is load-bearing.
pub const EXTERNAL_CLIENT_MAGPIE: &str = "magpie";

/// Upper bound on how many provider entries one external config may contribute.
/// Mirrors the transfer-import ceiling: a pathological file should be refused,
/// not streamed into the account list.
pub const EXTERNAL_CLIENT_MAX_ITEMS: usize = 2_000;

/// Upper bound on one external source file, checked **before** JSON parsing so
/// a giant file dies with a size error instead of being slurped into memory.
/// Same ceiling as the credential-transfer payloads.
pub const EXTERNAL_CLIENT_MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreviewExternalClientImportInput {
    pub client: String,
    pub platform: String,
    /// Explicit config file chosen by the user. `None` means "look in the
    /// client's default location".
    #[serde(default)]
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportExternalClientAccountsInput {
    pub client: String,
    pub platform: String,
    #[serde(default)]
    pub source_path: Option<String>,
    /// The source's own record ids, exactly as reported by the preview. The
    /// import re-reads the config rather than trusting anything but these ids,
    /// so secrets never round-trip through the frontend.
    pub source_ids: Vec<String>,
}

/// One provider entry found in the external client's config.
///
/// Secret-bearing fields are masked: the preview is a display payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalClientAccountPreviewItem {
    pub source_id: String,
    pub display_name: String,
    pub platform: String,
    /// `api` (relay/provider) or `official` (subscription/OAuth login).
    #[serde(default = "default_api_kind")]
    pub kind: String,
    pub interface_format: Option<String>,
    pub base_url: Option<String>,
    pub api_key_masked: Option<String>,
    pub model_mapping_count: usize,
    /// `create`, `overwrite`, or `error`.
    pub disposition: String,
    pub existing_credential_id: Option<String>,
    pub existing_display_name: Option<String>,
    pub issue_codes: Vec<String>,
}

fn default_api_kind() -> String {
    "api".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ExternalClientImportPreviewCounts {
    pub total: usize,
    pub importable: usize,
    pub create: usize,
    pub overwrite: usize,
    pub errors: usize,
    /// Listed entries that are official subscription/OAuth accounts.
    #[serde(default)]
    pub official: usize,
    /// Entries that belong to a different AI Switch platform than the one being
    /// previewed. Reported so the list not showing them reads as intentional.
    pub other_platform: usize,
    pub other_platform_counts: BTreeMap<String, usize>,
    /// Entries the source tool holds but this import cannot map at all (an
    /// unrelated vendor's subscription, a Codex++ aggregate provider, a provider
    /// with no protocol URL). Counted, not listed.
    #[serde(default)]
    pub unsupported: usize,
    #[serde(default)]
    pub unsupported_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalClientImportPreview {
    pub client: String,
    pub source_path: String,
    pub counts: ExternalClientImportPreviewCounts,
    pub items: Vec<ExternalClientAccountPreviewItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ExternalClientImportOutcome {
    pub created: usize,
    pub overwritten: usize,
    pub skipped: usize,
    pub failed: usize,
    /// Every row written, created and overwritten alike, so the caller can
    /// refresh its cache from one payload.
    pub imported: Vec<RouteCredential>,
    /// Ids of the rows that did not exist before. Pool membership is offered for
    /// these only — an overwrite must not silently move an existing account in
    /// or out of the compute pool.
    pub created_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_preview_json_deserializes_with_default_kind_and_counts() {
        let legacy: ExternalClientAccountPreviewItem = serde_json::from_str(
            r#"{
                "source_id": "claude:p1",
                "display_name": "goRouter",
                "platform": "claude",
                "interface_format": "anthropic",
                "base_url": "https://relay.example",
                "api_key_masked": "sk-***7890",
                "model_mapping_count": 1,
                "disposition": "create",
                "existing_credential_id": null,
                "existing_display_name": null,
                "issue_codes": []
            }"#,
        )
        .expect("legacy preview item");
        assert_eq!(legacy.kind, "api");

        let legacy_counts: ExternalClientImportPreviewCounts = serde_json::from_str(
            r#"{
                "total": 1, "importable": 1, "create": 1, "overwrite": 0,
                "errors": 0, "other_platform": 0, "other_platform_counts": {}
            }"#,
        )
        .expect("legacy counts");
        assert_eq!(legacy_counts.official, 0);
        assert_eq!(legacy_counts.unsupported, 0);
        assert!(legacy_counts.unsupported_counts.is_empty());

        let item = ExternalClientAccountPreviewItem {
            kind: "official".to_string(),
            ..legacy
        };
        let serialized = serde_json::to_string(&item).expect("serialize item");
        assert!(serialized.contains(r#""kind":"official""#));

        let counts = ExternalClientImportPreviewCounts {
            official: 2,
            ..Default::default()
        };
        let serialized = serde_json::to_string(&counts).expect("serialize counts");
        assert!(serialized.contains(r#""official":2"#));
        assert!(serialized.contains(r#""unsupported_counts":{}"#));
    }

    #[test]
    fn new_client_ids_are_pinned() {
        assert_eq!(EXTERNAL_CLIENT_CC_SWITCH, "cc-switch");
        assert_eq!(EXTERNAL_CLIENT_CODEX_PLUS, "codex-plus");
        assert_eq!(EXTERNAL_CLIENT_MAGPIE, "magpie");
    }
}
