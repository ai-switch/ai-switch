//! Preview and commit for "import from another client".
//!
//! Three readers are supported today — cc-switch, Codex++ and Magpie. Each
//! reader module owns "find the config" and "produce entries"; this service
//! owns classification, dedupe and the commit. The client id is a parameter
//! rather than baked in so a further reader can be added without reshaping the
//! command surface.
//!
//! Dedupe rule: `(external_source_client, external_source_id)` is unique, so an
//! account already imported from a given source record is *overwritten* rather
//! than duplicated. That is the deliberate difference from the AI Switch
//! transfer import, which refuses edited duplicates — here the external client
//! is the authority for the fields it owns.

use crate::database::repositories::route_credential_repository::{
    ExternalSourceMatch, ExternalSourceRef, RouteCredentialRepository,
};
use crate::database::repositories::route_pool_repository::UNIFIED_POOL_PLATFORM;
use crate::error::AppError;
use crate::models::external_client_import::{
    ExternalClientAccountPreviewItem, ExternalClientImportOutcome, ExternalClientImportPreview,
    ExternalClientImportPreviewCounts, ImportExternalClientAccountsInput,
    PreviewExternalClientImportInput, EXTERNAL_CLIENT_CC_SWITCH, EXTERNAL_CLIENT_CODEX_PLUS,
    EXTERNAL_CLIENT_MAGPIE,
};
use crate::models::platform::{PlatformId, PlatformOperation};
use crate::services::cc_switch_import_service::{
    self as cc_switch, ExtractedApiCredential,
};
use crate::services::codex_plus_import_service as codex_plus;
use crate::services::cpa_import_service::ParsedOfficialCredential;
// Reuse the deep-link masker rather than growing a second one: the preview must
// mask exactly like every other credential surface.
use crate::services::deeplink_service::mask_api_key;
use crate::services::magpie_import_service as magpie;
use crate::services::platform_capability_service::PlatformCapabilityService;
use crate::services::route_preview_service::RoutePreviewService;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};

/// Clients this build can read. Kept as a list so the frontend can be told what
/// is available rather than hard-coding the same knowledge twice.
pub fn supported_clients() -> Vec<&'static str> {
    vec![
        EXTERNAL_CLIENT_CC_SWITCH,
        EXTERNAL_CLIENT_CODEX_PLUS,
        EXTERNAL_CLIENT_MAGPIE,
    ]
}

/// One record a reader found, already translated into AI Switch terms.
///
/// Readers do the per-client extraction; everything after this point in the
/// service is client-agnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedExternalEntry {
    pub source_id: String,
    pub body: PreparedBody,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreparedBody {
    /// A ready-to-store API account.
    Api(ExtractedApiCredential),
    /// An entry we own but cannot import until its source account is repaired.
    /// Keep the kind so UI doesn't mislabel a broken OAuth snapshot as API.
    Broken {
        kind: String,
        display_name: String,
        issue_code: &'static str,
        platform_hint: Option<PlatformId>,
    },
    /// A ready-to-store official subscription account (OAuth snapshot).
    Official(ParsedOfficialCredential),
    /// Not listable at all, only counted.
    Skipped(SkipBucket),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipBucket {
    /// Belongs to another AI Switch platform; labelled for the "switch to the
    /// other platform" hint.
    OtherPlatform(Option<PlatformId>, String),
    /// Nothing AI Switch can map (another vendor's subscription, an internal
    /// aggregate definition); labelled for the unsupported summary.
    Unsupported(String),
}

/// Locates the source config and reads every entry out of it.
///
/// Returns the display path alongside the entries: the preview shows where the
/// accounts came from.
async fn resolve_entries(
    client: &str,
    source_path: Option<&str>,
) -> Result<(Vec<PreparedExternalEntry>, String), AppError> {
    match client {
        EXTERNAL_CLIENT_CC_SWITCH => {
            let path = cc_switch::resolve_source_path(source_path)?;
            let entries = cc_switch::prepare_entries(&path).await?;
            Ok((entries, path.display().to_string()))
        }
        EXTERNAL_CLIENT_CODEX_PLUS => codex_plus::read_entries(source_path).await,
        EXTERNAL_CLIENT_MAGPIE => {
            let dir = magpie::resolve_source_dir(source_path)?;
            let entries = magpie::prepare_entries(&dir).await?;
            Ok((entries, dir.display().to_string()))
        }
        // validate_client only lets the three constants through.
        _ => Err(AppError::Validation {
            code: "external_import.client_unsupported",
            message: "This client cannot be imported yet".to_string(),
            details: Some(client.to_string()),
            recoverable: true,
        }),
    }
}

fn validate_client(client: &str) -> Result<&'static str, AppError> {
    supported_clients()
        .into_iter()
        .find(|supported| supported.eq_ignore_ascii_case(client.trim()))
        .ok_or_else(|| AppError::Validation {
            code: "external_import.client_unsupported",
            message: "This client cannot be imported yet".to_string(),
            details: Some(client.trim().to_string()),
            recoverable: true,
        })
}

pub async fn preview_external_client_import(
    pool: &SqlitePool,
    input: PreviewExternalClientImportInput,
) -> Result<ExternalClientImportPreview, AppError> {
    let client = validate_client(&input.client)?;
    let platform = PlatformId::parse(&input.platform)?;
    PlatformCapabilityService::require(platform, PlatformOperation::RouteCredentials)?;

    let (entries, source_path) = resolve_entries(client, input.source_path.as_deref()).await?;
    let existing = existing_matches(pool, client).await?;

    let mut counts = ExternalClientImportPreviewCounts::default();
    let mut items = Vec::new();
    for entry in &entries {
        match classify(entry, platform, &existing) {
            Classification::OtherPlatform { label, .. } => {
                counts.other_platform += 1;
                *counts.other_platform_counts.entry(label).or_default() += 1;
            }
            Classification::Unsupported(label) => {
                counts.unsupported += 1;
                *counts.unsupported_counts.entry(label).or_default() += 1;
            }
            Classification::Item(item) => {
                counts.total += 1;
                match item.disposition.as_str() {
                    "create" => {
                        counts.create += 1;
                        counts.importable += 1;
                    }
                    "overwrite" => {
                        counts.overwrite += 1;
                        counts.importable += 1;
                    }
                    _ => counts.errors += 1,
                }
                if item.kind == "official" {
                    counts.official += 1;
                }
                items.push(item);
            }
        }
    }

    Ok(ExternalClientImportPreview {
        client: client.to_string(),
        source_path,
        counts,
        items,
    })
}

pub async fn import_external_client_accounts(
    pool: &SqlitePool,
    input: ImportExternalClientAccountsInput,
) -> Result<ExternalClientImportOutcome, AppError> {
    let client = validate_client(&input.client)?;
    let platform = PlatformId::parse(&input.platform)?;
    PlatformCapabilityService::require(platform, PlatformOperation::RouteCredentials)?;

    let selected: HashSet<String> = input
        .source_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if selected.is_empty() {
        return Err(AppError::Validation {
            code: "external_import.selection_empty",
            message: "Select at least one account to import".to_string(),
            details: None,
            recoverable: true,
        });
    }

    // The preview supplies IDs only. Load the current bindings under the same
    // write transaction to keep concurrent imports from creating duplicates.
    let (entries, _) = resolve_entries(client, input.source_path.as_deref()).await?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|error| AppError::Database {
        code: "database.external_client_import_tx",
        message: "Could not start the external account import".to_string(),
        details: Some(error.to_string()),
        recoverable: true,
    })?;
    let existing = existing_matches(&mut *tx, client).await?;
    let mut outcome = ExternalClientImportOutcome::default();
    let mut matched = HashSet::new();
    for entry in &entries {
        if !selected.contains(&entry.source_id) || !matched.insert(&entry.source_id) {
            continue;
        }
        let (vendor, kind, display_name, email, payload) = match &entry.body {
            PreparedBody::Api(api) if platform_in_scope(platform, api.platform) => (
                api.platform.as_str(), "api", api.display_name.as_str(), None, build_payload(api),
            ),
            PreparedBody::Official(credential)
                if PlatformId::parse(&credential.platform).is_ok_and(|vendor| platform_in_scope(platform, vendor)) => (
                    credential.platform.as_str(), "official", credential.display_name.as_str(),
                    credential.email.as_deref(), official_payload(credential),
                ),
            _ => {
                outcome.failed += 1;
                continue;
            }
        };
        match overwrite_target(existing.get(&entry.source_id), kind) {
            Ok(Some(existing)) => {
                RouteCredentialRepository::overwrite_from_external_source(
                    &mut tx, &existing.id, display_name, &payload.secret_payload_json,
                    &payload.config_json, &payload.preview_json,
                    (kind == "official").then_some((vendor, email)),
                ).await?;
                outcome.overwritten += 1;
                outcome.imported.push(RouteCredentialRepository::get_tx(&mut tx, &existing.id).await?);
            }
            Ok(None) => {
                let created = RouteCredentialRepository::create_tx_with_external_source(
                    &mut tx, vendor, kind, display_name, email.map(str::to_owned), "ok", None,
                    &payload.secret_payload_json, &payload.config_json, &payload.preview_json,
                    Some(ExternalSourceRef { client, source_id: &entry.source_id }),
                ).await?;
                outcome.created += 1;
                outcome.created_ids.push(created.id.clone());
                outcome.imported.push(created);
            }
            Err(_) => outcome.failed += 1,
        }
    }

    outcome.skipped = selected.len() - matched.len();

    tx.commit().await.map_err(|error| AppError::Database {
        code: "database.external_client_import_commit",
        message: "Could not save the imported accounts".to_string(),
        details: Some(error.to_string()),
        recoverable: true,
    })?;
    Ok(outcome)
}

async fn existing_matches<'e>(
    executor: impl sqlx::SqliteExecutor<'e>,
    client: &str,
) -> Result<HashMap<String, ExternalSourceMatch>, AppError> {
    Ok(
        RouteCredentialRepository::external_source_matches(executor, client)
            .await?
            .into_iter()
            .collect(),
    )
}

enum Classification {
    /// Belongs to another AI Switch platform, so it is counted but not listed:
    /// the accounts page is per-platform and an entry the user cannot act on
    /// here is noise.
    OtherPlatform {
        platform: Option<PlatformId>,
        label: String,
    },
    /// Nothing AI Switch can map at all (another vendor's subscription, an
    /// aggregate definition); counted under its label only.
    Unsupported(String),
    Item(ExternalClientAccountPreviewItem),
}

/// The local row a re-import may overwrite, if there is one it is allowed to touch.
///
/// The unique index is global, not per platform, so the row bound to a source
/// record could in principle sit on another platform or be of another kind
/// (api ↔ official). Overwriting either would corrupt something the user cannot
/// see from here, so those cases become a visible error instead.
fn overwrite_target<'a>(
    matched: Option<&'a ExternalSourceMatch>,
    entry_kind: &str,
) -> Result<Option<&'a ExternalSourceMatch>, ExternalSourceMatch> {
    match matched {
        None => Ok(None),
        Some(matched)
            if matched.kind.eq_ignore_ascii_case(entry_kind)
                // 统一账号池（G-P8 P4a）：已有账号的 platform 恒为 `codex`；
                // 覆盖匹配只要求它是本功能写入的同 kind 账号。
                && PlatformId::parse(&matched.platform).is_ok_and(|local| {
                    local.as_str()
                        == crate::database::repositories::route_pool_repository::UNIFIED_POOL_PLATFORM
                }) =>
        {
            Ok(Some(matched))
        }
        Some(matched) => Err(matched.clone()),
    }
}

/// Codex identifies the unified pool rather than a vendor filter in that view.
fn platform_in_scope(requested: PlatformId, vendor: PlatformId) -> bool {
    requested.as_str() == UNIFIED_POOL_PLATFORM || requested == vendor
}

/// A preview needs the endpoint, not URL credentials, query values or fragments.
fn sanitize_external_url(input: &str) -> Option<String> {
    let mut url = url::Url::parse(input).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return None;
    }
    // Preserve the spelling of ordinary URLs (e.g. a bare hostname without a
    // trailing slash) after validation. Only rewrite when there's data to hide.
    if url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none() {
        return Some(input.to_string());
    }
    url.set_password(None).ok()?;
    url.set_username("").ok()?;
    url.set_query(None);
    url.set_fragment(None);
    Some(url.into())
}

const CONFLICTING_LOCAL_ACCOUNT: &str = "external_import.conflicting_local_account";

fn classify(
    entry: &PreparedExternalEntry,
    platform: PlatformId,
    existing: &HashMap<String, ExternalSourceMatch>,
) -> Classification {
    match &entry.body {
        PreparedBody::Api(extracted) => {
            if !platform_in_scope(platform, extracted.platform) {
                return Classification::OtherPlatform {
                    platform: Some(extracted.platform),
                    label: extracted.platform.as_str().to_string(),
                };
            }
            let matched = match overwrite_target(existing.get(&entry.source_id), "api") {
                Ok(matched) => matched,
                Err(conflict) => {
                    return Classification::Item(ExternalClientAccountPreviewItem {
                        kind: "api".to_string(),
                        source_id: entry.source_id.clone(),
                        display_name: extracted.display_name.clone(),
                        platform: extracted.platform.as_str().to_string(),
                        interface_format: Some(extracted.interface_format.as_str().to_string()),
                        base_url: sanitize_external_url(&extracted.base_url),
                        api_key_masked: Some(mask_api_key(&extracted.api_key)),
                        model_mapping_count: extracted.model_mappings.len(),
                        disposition: "error".to_string(),
                        existing_credential_id: Some(conflict.id),
                        existing_display_name: Some(conflict.display_name),
                        issue_codes: vec![CONFLICTING_LOCAL_ACCOUNT.to_string()],
                    })
                }
            };
            Classification::Item(ExternalClientAccountPreviewItem {
                kind: "api".to_string(),
                source_id: entry.source_id.clone(),
                display_name: extracted.display_name.clone(),
                platform: extracted.platform.as_str().to_string(),
                interface_format: Some(extracted.interface_format.as_str().to_string()),
                base_url: sanitize_external_url(&extracted.base_url),
                api_key_masked: Some(mask_api_key(&extracted.api_key)),
                model_mapping_count: extracted.model_mappings.len(),
                disposition: if matched.is_some() {
                    "overwrite"
                } else {
                    "create"
                }
                .to_string(),
                existing_credential_id: matched.map(|matched| matched.id.clone()),
                existing_display_name: matched.map(|matched| matched.display_name.clone()),
                issue_codes: Vec::new(),
            })
        }
        PreparedBody::Official(credential) => {
            let credential_platform = PlatformId::parse(&credential.platform).ok();
            if credential_platform.is_some_and(|parsed| !platform_in_scope(platform, parsed)) {
                return Classification::OtherPlatform {
                    platform: credential_platform,
                    label: credential.platform.clone(),
                };
            }
            let matched = match overwrite_target(existing.get(&entry.source_id), "official")
            {
                Ok(matched) => matched,
                Err(conflict) => {
                    return Classification::Item(ExternalClientAccountPreviewItem {
                        kind: "official".to_string(),
                        source_id: entry.source_id.clone(),
                        display_name: credential.display_name.clone(),
                        platform: credential.platform.clone(),
                        interface_format: None,
                        base_url: None,
                        api_key_masked: official_masked_token(credential),
                        model_mapping_count: 0,
                        disposition: "error".to_string(),
                        existing_credential_id: Some(conflict.id),
                        existing_display_name: Some(conflict.display_name),
                        issue_codes: vec![CONFLICTING_LOCAL_ACCOUNT.to_string()],
                    })
                }
            };
            Classification::Item(ExternalClientAccountPreviewItem {
                kind: "official".to_string(),
                source_id: entry.source_id.clone(),
                display_name: credential.display_name.clone(),
                platform: credential.platform.clone(),
                interface_format: None,
                base_url: None,
                api_key_masked: official_masked_token(credential),
                model_mapping_count: 0,
                disposition: if matched.is_some() {
                    "overwrite"
                } else {
                    "create"
                }
                .to_string(),
                existing_credential_id: matched.map(|matched| matched.id.clone()),
                existing_display_name: matched.map(|matched| matched.display_name.clone()),
                issue_codes: Vec::new(),
            })
        }
        PreparedBody::Broken {
            kind,
            display_name,
            issue_code,
            platform_hint,
        } => {
            // A platform we do not map at all is not this platform's problem;
            // anything else is a real error the user should see and fix.
            if platform_hint.is_some_and(|hint| !platform_in_scope(platform, hint)) {
                return Classification::OtherPlatform {
                    platform: *platform_hint,
                    label: platform_hint
                        .map(|hint| hint.as_str().to_string())
                        .unwrap_or_else(|| display_name.clone()),
                };
            }
            Classification::Item(ExternalClientAccountPreviewItem {
                kind: kind.clone(),
                source_id: entry.source_id.clone(),
                display_name: display_name.clone(),
                platform: platform_hint
                    .map(|hint| hint.as_str().to_string())
                    .unwrap_or_default(),
                interface_format: None,
                base_url: None,
                api_key_masked: None,
                model_mapping_count: 0,
                disposition: "error".to_string(),
                existing_credential_id: None,
                existing_display_name: None,
                issue_codes: vec![(*issue_code).to_string()],
            })
        }
        PreparedBody::Skipped(bucket) => match bucket {
            SkipBucket::OtherPlatform(_, label) if platform.as_str() == UNIFIED_POOL_PLATFORM => {
                Classification::Unsupported(label.clone())
            }
            SkipBucket::OtherPlatform(platform, label) => Classification::OtherPlatform {
                platform: *platform,
                label: label.clone(),
            },
            SkipBucket::Unsupported(label) => Classification::Unsupported(label.clone()),
        },
    }
}

pub(crate) struct CredentialPayload {
    pub(crate) secret_payload_json: String,
    pub(crate) config_json: String,
    pub(crate) preview_json: String,
}

/// Official entries carry their payload ready-made from the CPA parser; only
/// the preview blob is generated here, for `kind: "official"`.
fn official_payload(credential: &ParsedOfficialCredential) -> CredentialPayload {
    let preview_json = RoutePreviewService::generate(
        &credential.platform,
        "official",
        &credential.secret_payload_json,
        &credential.config_json,
    );
    CredentialPayload {
        secret_payload_json: credential.secret_payload_json.clone(),
        config_json: credential.config_json.clone(),
        preview_json,
    }
}

/// The token the preview row shows masked: access_token first, id_token as the
/// fallback (some access-only imports carry only that), else nothing.
fn official_masked_token(credential: &ParsedOfficialCredential) -> Option<String> {
    let secret: Value = serde_json::from_str(&credential.secret_payload_json).ok()?;
    ["access_token", "id_token"]
        .iter()
        .find_map(|key| {
            secret
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(mask_api_key)
        })
}

/// Builds the same three JSON blobs `RouteCredentialService::create_api` writes.
///
/// It deliberately mirrors that function's key set rather than calling it: the
/// import runs inside one transaction, and `create_api` owns its own connection.
/// Any key added there needs adding here too.
pub(crate) fn build_payload(extracted: &ExtractedApiCredential) -> CredentialPayload {
    let secret_payload_json = json!({ "api_key": extracted.api_key.trim() }).to_string();
    let mut config = json!({
        "base_url": extracted.base_url.trim(),
        "interface_format": extracted.interface_format.as_str(),
        "model_mappings": extracted.model_mappings,
        "fetched_models": Value::Array(Vec::new()),
        "responses_custom_tool_compat": false,
    });
    if let Some(api_key_field) = extracted.api_key_field {
        config["api_key_field"] = json!(api_key_field);
    }
    if !extracted.extra_headers.is_empty() || extracted.user_agent.is_some() {
        // serde_json's map sorts keys, but headers are a name→value table:
        // insertion order carries no meaning, so extra headers and the
        // User-Agent merge without an order contract.
        let mut headers = serde_json::Map::new();
        for (name, value) in &extracted.extra_headers {
            headers.insert(name.trim().to_string(), json!(value.trim()));
        }
        if let Some(user_agent) = extracted.user_agent.as_deref().map(str::trim) {
            headers
                .entry("User-Agent".to_string())
                .or_insert_with(|| json!(user_agent));
        }
        config["headers"] = Value::Object(headers);
    }
    let config_json = config.to_string();
    let preview_json = RoutePreviewService::generate(
        extracted.platform.as_str(),
        "api",
        &secret_payload_json,
        &config_json,
    );
    CredentialPayload {
        secret_payload_json,
        config_json,
        preview_json,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_memory_pool, run_migrations};
    use crate::models::platform::ApiDialect;
    use serde_json::json;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::path::Path;

    async fn write_source(path: &Path, rows: Vec<(&str, &str, &str, Value, Value)>) {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let source = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("create source db");
        sqlx::query(
            "CREATE TABLE providers (
                id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL,
                settings_config TEXT NOT NULL, category TEXT, sort_index INTEGER,
                meta TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY (id, app_type)
            )",
        )
        .execute(&source)
        .await
        .expect("create providers table");
        for (id, app_type, name, settings_config, meta) in rows {
            sqlx::query(
                "INSERT INTO providers (id, app_type, name, settings_config, category, sort_index, meta)
                 VALUES (?, ?, ?, ?, NULL, 0, ?)",
            )
            .bind(id)
            .bind(app_type)
            .bind(name)
            .bind(settings_config.to_string())
            .bind(meta.to_string())
            .execute(&source)
            .await
            .expect("insert provider");
        }
        source.close().await;
    }

    fn claude_settings(token: &str, base_url: &str) -> Value {
        json!({
            "env": {
                "ANTHROPIC_AUTH_TOKEN": token,
                "ANTHROPIC_BASE_URL": base_url,
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-opus-5[1M]",
            }
        })
    }

    #[tokio::test]
    async fn preview_marks_new_entries_create_and_hides_other_platforms() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_path = dir.path().join("cc-switch.db");
        write_source(
            &source_path,
            vec![
                (
                    "p1",
                    "claude",
                    "goRouter",
                    claude_settings("sk-claude-secret", "https://gorouter.app"),
                    json!({}),
                ),
                (
                    "p2",
                    "codex",
                    "kktoken",
                    json!({
                        "auth": { "OPENAI_API_KEY": "sk-codex" },
                        "config": "[model_providers.relay]\nbase_url = \"https://kktoken.cc/v1\"\n"
                    }),
                    json!({ "apiFormat": "openai_responses" }),
                ),
            ],
        )
        .await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
            },
        )
        .await
        .expect("preview");

        assert_eq!(preview.counts.total, 1);
        assert_eq!(preview.counts.create, 1);
        assert_eq!(preview.counts.overwrite, 0);
        assert_eq!(preview.counts.importable, 1);
        assert_eq!(preview.counts.other_platform, 1);
        assert_eq!(preview.counts.other_platform_counts["codex"], 1);
        assert_eq!(preview.items.len(), 1);
        let item = &preview.items[0];
        assert_eq!(item.source_id, "claude:p1");
        assert_eq!(item.disposition, "create");
        assert_eq!(item.base_url.as_deref(), Some("https://gorouter.app"));
        assert_eq!(item.model_mapping_count, 1);
        assert!(item.existing_credential_id.is_none());
        // The preview is a display payload: the key is masked everywhere.
        let serialized = serde_json::to_string(&preview).expect("serialize preview");
        assert!(!serialized.contains("sk-claude-secret"));
        assert!(item
            .api_key_masked
            .as_deref()
            .is_some_and(|masked| masked.contains("***")));
    }

    #[tokio::test]
    async fn repeated_import_overwrites_the_same_account_instead_of_duplicating() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_path = dir.path().join("cc-switch.db");
        write_source(
            &source_path,
            vec![(
                "p1",
                "claude",
                "goRouter",
                claude_settings("sk-old", "https://old.example"),
                json!({}),
            )],
        )
        .await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let import = |path: String| async {
            import_external_client_accounts(
                &pool,
                ImportExternalClientAccountsInput {
                    client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                    platform: "claude".to_string(),
                    source_path: Some(path),
                    source_ids: vec!["claude:p1".to_string()],
                },
            )
            .await
        };

        let first = import(source_path.display().to_string())
            .await
            .expect("first import");
        assert_eq!(first.created, 1);
        assert_eq!(first.overwritten, 0);
        assert_eq!(first.imported.len(), 1);
        let credential_id = first.imported[0].id.clone();

        // The user edits the provider in cc-switch and imports again.
        tokio::fs::remove_file(&source_path)
            .await
            .expect("replace source");
        write_source(
            &source_path,
            vec![(
                "p1",
                "claude",
                "goRouter renamed",
                claude_settings("sk-new", "https://new.example"),
                json!({}),
            )],
        )
        .await;
        let second = import(source_path.display().to_string())
            .await
            .expect("second import");
        assert_eq!(second.created, 0);
        assert_eq!(second.overwritten, 1);
        assert_eq!(second.imported[0].id, credential_id);
        assert_eq!(second.imported[0].display_name, "goRouter renamed");
        assert!(second.imported[0]
            .config_json
            .contains("https://new.example"));
        assert!(second.imported[0].secret_payload_json.contains("sk-new"));

        let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM route_credentials")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(total, 1, "a re-import must not add a second row");

        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
            },
        )
        .await
        .expect("preview after import");
        assert_eq!(preview.counts.overwrite, 1);
        assert_eq!(preview.counts.create, 0);
        assert_eq!(
            preview.items[0].existing_credential_id.as_deref(),
            Some(credential_id.as_str())
        );
        assert_eq!(
            preview.items[0].existing_display_name.as_deref(),
            Some("goRouter renamed")
        );
    }

    #[tokio::test]
    async fn import_writes_the_same_config_keys_as_a_hand_made_api_account() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_path = dir.path().join("cc-switch.db");
        write_source(
            &source_path,
            vec![(
                "p1",
                "claude",
                "Any",
                json!({
                    "env": {
                        "ANTHROPIC_API_KEY": "sk-any",
                        "ANTHROPIC_BASE_URL": "https://anyrouter.top",
                    }
                }),
                json!({ "customUserAgent": "claude-cli/2.1.161 (external, cli)" }),
            )],
        )
        .await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let outcome = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
                source_ids: vec!["claude:p1".to_string()],
            },
        )
        .await
        .expect("import");

        let config: Value =
            serde_json::from_str(&outcome.imported[0].config_json).expect("config json");
        assert_eq!(config["base_url"], "https://anyrouter.top");
        assert_eq!(config["interface_format"], "anthropic");
        assert_eq!(config["api_key_field"], "ANTHROPIC_API_KEY");
        assert_eq!(config["model_mappings"], json!([]));
        assert_eq!(config["fetched_models"], json!([]));
        assert_eq!(config["responses_custom_tool_compat"], false);
        assert_eq!(
            config["headers"]["User-Agent"],
            "claude-cli/2.1.161 (external, cli)"
        );
        assert_eq!(outcome.imported[0].kind, "api");
        assert_eq!(outcome.imported[0].status, "ok");
        assert_ne!(outcome.imported[0].preview_json, "{}");
    }

    #[tokio::test]
    async fn unselected_and_vanished_entries_are_skipped_not_imported() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_path = dir.path().join("cc-switch.db");
        write_source(
            &source_path,
            vec![
                (
                    "p1",
                    "claude",
                    "Picked",
                    claude_settings("sk-one", "https://one.example"),
                    json!({}),
                ),
                (
                    "p2",
                    "claude",
                    "Not picked",
                    claude_settings("sk-two", "https://two.example"),
                    json!({}),
                ),
            ],
        )
        .await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let outcome = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
                // One real id plus one the config no longer has.
                source_ids: vec!["claude:p1".to_string(), "claude:gone".to_string()],
            },
        )
        .await
        .expect("import");

        assert_eq!(outcome.created, 1);
        assert_eq!(outcome.skipped, 1);
        assert_eq!(outcome.failed, 0);
        assert_eq!(outcome.imported[0].display_name, "Picked");
    }

    #[tokio::test]
    async fn broken_entries_are_previewed_as_errors_and_refused_on_import() {
        let dir = tempfile::tempdir().expect("temp dir");
        let source_path = dir.path().join("cc-switch.db");
        write_source(
            &source_path,
            vec![(
                "p1",
                "claude",
                "No key",
                json!({ "env": { "ANTHROPIC_BASE_URL": "https://relay.example" } }),
                json!({}),
            )],
        )
        .await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
            },
        )
        .await
        .expect("preview");
        assert_eq!(preview.counts.errors, 1);
        assert_eq!(preview.counts.importable, 0);
        assert_eq!(preview.items[0].disposition, "error");
        assert_eq!(
            preview.items[0].issue_codes,
            vec!["external_import.api_key_missing".to_string()]
        );

        let outcome = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
                source_ids: vec!["claude:p1".to_string()],
            },
        )
        .await
        .expect("import");
        assert_eq!(outcome.failed, 1);
        assert_eq!(outcome.created, 0);
        assert!(outcome.imported.is_empty());
    }

    #[tokio::test]
    async fn rejects_unknown_clients_and_empty_selections() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let unknown = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: "some-other-app".to_string(),
                platform: "claude".to_string(),
                source_path: None,
            },
        )
        .await
        .expect_err("unknown client");
        assert!(matches!(
            unknown,
            AppError::Validation {
                code: "external_import.client_unsupported",
                ..
            }
        ));

        let empty = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: None,
                source_ids: Vec::new(),
            },
        )
        .await
        .expect_err("empty selection");
        assert!(matches!(
            empty,
            AppError::Validation {
                code: "external_import.selection_empty",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn source_matched_row_is_overwritten_regardless_of_origin_platform() {
        // The unique index is global, so a source record could be bound to a row
        // on another platform (e.g. the provider was imported under Codex, then
        // re-typed as Claude in cc-switch). Overwriting it would silently rewrite
        // an account the user cannot see from this tab.
        let dir = tempfile::tempdir().expect("temp dir");
        let source_path = dir.path().join("cc-switch.db");
        write_source(
            &source_path,
            vec![(
                "p1",
                "claude",
                "Moved provider",
                claude_settings("sk-one", "https://one.example"),
                json!({}),
            )],
        )
        .await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let mut tx = pool.begin().await.expect("transaction");
        let foreign = RouteCredentialRepository::create_tx_with_external_source(
            &mut tx,
            "codex",
            "api",
            "Imported as Codex",
            None,
            "ok",
            None,
            r#"{"api_key":"sk-codex"}"#,
            "{}",
            "{}",
            Some(ExternalSourceRef {
                client: EXTERNAL_CLIENT_CC_SWITCH,
                source_id: "claude:p1",
            }),
        )
        .await
        .expect("seed foreign-platform row");
        tx.commit().await.expect("commit");

        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
            },
        )
        .await
        .expect("preview");
        // 统一账号池（G-P8 P4a）：来源匹配的行可被同源导入覆盖，平台维度不再构成冲突。
        assert_eq!(preview.counts.errors, 0);
        assert_eq!(preview.counts.importable, 1);
        assert_eq!(preview.items[0].disposition, "overwrite");

        let outcome = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_CC_SWITCH.to_string(),
                platform: "claude".to_string(),
                source_path: Some(source_path.display().to_string()),
                source_ids: vec!["claude:p1".to_string()],
            },
        )
        .await
        .expect("import");
        // 同源覆盖：外部行被新内容覆盖，且仍只有一个账号。
        assert_eq!(outcome.failed, 0);
        assert_eq!(outcome.created, 0);
        assert_eq!(outcome.overwritten, 1);
        let overwritten = RouteCredentialRepository::get(&pool, &foreign.id)
            .await
            .expect("row still there");
        assert_eq!(overwritten.display_name, "Moved provider");
        assert!(overwritten.secret_payload_json.contains("sk-one"));
    }

    #[tokio::test]
    async fn api_preview_masks_urls_with_credentials_and_query_keys() {
        let dir = tempfile::tempdir().unwrap();
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        let url = "https://fixture-user:fixture-password@relay.example/v1?api_key=fixture-query-secret#fixture-fragment";
        tokio::fs::write(dir.path().join("providers.json"), json!({"providers": [{
            "id": "relay", "name": "Relay", "key": "sk-fixture-key", "responses": url,
        }]}).to_string()).await.unwrap();
        let path = Some(dir.path().display().to_string());
        let preview = preview_external_client_import(&pool, PreviewExternalClientImportInput {
            client: EXTERNAL_CLIENT_MAGPIE.into(), platform: "codex".into(), source_path: path.clone(),
        }).await.unwrap();
        assert_eq!(preview.items[0].base_url.as_deref(), Some("https://relay.example/v1"));
        let serialized = serde_json::to_string(&preview).unwrap();
        for secret in ["fixture-user", "fixture-password", "fixture-query-secret", "fixture-fragment", "sk-fixture-key"] {
            assert!(!serialized.contains(secret));
        }
        let result = import_external_client_accounts(&pool, ImportExternalClientAccountsInput {
            client: EXTERNAL_CLIENT_MAGPIE.into(), platform: "codex".into(), source_path: path,
            source_ids: vec!["provider:relay:responses".into()],
        }).await.unwrap();
        let config: Value = serde_json::from_str(&result.imported[0].config_json).unwrap();
        assert_eq!(config["base_url"], url);
    }

    #[test]
    fn masking_never_reveals_a_usable_key() {
        assert_eq!(mask_api_key("sk-1234567890"), "sk-1***7890");
        assert_eq!(mask_api_key("short"), "sh***");
        assert_eq!(mask_api_key("   "), "(empty)");
    }

    // ---- codex-plus / magpie：official 条目与真计数（Task 6）----


    async fn write_codex_plus_official_fixture(dir: &Path, display: &str) {
        let content = json!({
            "relayProfiles": [{
                "id": "of1",
                "name": display,
                "relayMode": "official",
                // settings.json 里的 authContents 是 JSON 字符串（auth.json 原文）。
                "authContents": crate::services::codex_plus_import_service::test_support::valid_auth(),
            }]
        })
        .to_string();
        tokio::fs::write(dir.join("settings.json"), content)
            .await
            .expect("write fixture");
    }

    #[tokio::test]
    async fn broken_official_snapshots_keep_the_official_kind_badge() {
        let dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            dir.path().join("settings.json"),
            r#"{"relayProfiles":[{"id":"missing","name":"No snapshot","relayMode":"official"}]}"#,
        )
        .await
        .expect("write fixture");
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
            },
        )
        .await
        .expect("preview");
        assert_eq!(preview.items.len(), 1);
        assert_eq!(preview.items[0].kind, "official");
        assert_eq!(preview.items[0].disposition, "error");
        assert!(preview.items[0]
            .issue_codes
            .contains(&"external_import.official_snapshot_missing".to_string()));
    }

    #[tokio::test]
    async fn official_preview_rows_mask_the_snapshot_tokens() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_codex_plus_official_fixture(dir.path(), "ChatGPT 订阅").await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
            },
        )
        .await
        .expect("preview");
        assert_eq!(preview.counts.total, 1);
        assert_eq!(preview.counts.official, 1);
        let item = &preview.items[0];
        assert_eq!(item.kind, "official");
        assert_eq!(item.disposition, "create");
        assert_eq!(item.interface_format, None);
        assert_eq!(item.base_url, None);
        assert!(item.api_key_masked.as_deref().is_some_and(|m| m.contains("***")));
        // 预览是展示载荷：快照明文不出现在序列化结果里。
        let serialized = serde_json::to_string(&preview).expect("serialize preview");
        let fixture: Value = serde_json::from_str(&codex_plus::test_support::valid_auth()).unwrap();
        for key in ["access_token", "id_token", "refresh_token"] {
            assert!(!serialized.contains(fixture["tokens"][key].as_str().unwrap()));
        }
    }

    #[tokio::test]
    async fn explicit_vendor_preview_keeps_legacy_filtering() {
        let dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            dir.path().join("logins.json"),
            r#"[
                {"id":"cl1","agent":"claude","user":"claude@example.com",
                 "auth":{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"sk-ant-ort01-abc"}}},
                {"id":"cx1","agent":"codex","user":"codex@example.com",
                 "auth":{"tokens":{"access_token":"at","refresh_token":"rt","id_token":"id","account_id":"acc","client_id":"fixture-client"}}}
            ]"#,
        )
        .await
        .expect("write logins");

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let preview = |platform: String| {
            let dir_display = dir.path().display().to_string();
            async {
                preview_external_client_import(
                    &pool,
                    PreviewExternalClientImportInput {
                        client: EXTERNAL_CLIENT_MAGPIE.to_string(),
                        platform,
                        source_path: Some(dir_display),
                    },
                )
                .await
                .expect("preview")
            }
        };

        let claude_preview = preview("claude".to_string()).await;
        assert_eq!(claude_preview.counts.total, 1);
        assert_eq!(claude_preview.items[0].kind, "official");
        assert_eq!(claude_preview.items[0].display_name, "claude@example.com");
        assert_eq!(claude_preview.counts.other_platform, 1);
        assert_eq!(claude_preview.counts.other_platform_counts["codex"], 1);

    }

    #[tokio::test]
    async fn unified_pool_preview_and_import_accept_magpie_claude_accounts() {
        let dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            dir.path().join("logins.json"),
            r#"[
                {"id":"cl1","agent":"claude","user":"claude@example.com","auth":{"claudeAiOauth":{"accessToken":"sk-ant-oat01-claude","refreshToken":"sk-ant-ort01-claude","expiresAt":4070908800000,"scopes":["user:inference"]}}},
                {"id":"cx1","agent":"codex","user":"codex@example.com","auth":{"auth_mode":"chatgpt","tokens":{"access_token":"at","refresh_token":"rt","id_token":"id","account_id":"acc","client_id":"client"}}}
            ]"#,
        )
        .await
        .expect("write logins");
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_MAGPIE.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
            },
        )
        .await
        .expect("unified-pool preview");
        assert_eq!(preview.counts.other_platform, 0);
        assert_eq!(preview.items.len(), 2);
        assert!(preview.items.iter().any(|item| item.source_id == "login:cl1"));
        assert!(preview.items.iter().any(|item| item.source_id == "login:cx1"));

        let result = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_MAGPIE.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
                source_ids: vec!["login:cl1".to_string()],
            },
        )
        .await
        .expect("unified-pool import");
        assert_eq!(result.created, 1);
        assert_eq!(result.imported[0].platform, "codex");
        assert_eq!(result.imported[0].kind, "official");
        assert_eq!(result.imported[0].provider, "claude");
        assert_eq!(result.imported[0].email.as_deref(), Some("claude@example.com"));
    }

    #[tokio::test]
    async fn unified_pool_import_accepts_magpie_anthropic_api_providers() {
        let dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            dir.path().join("providers.json"),
            r#"{"providers":[{"id":"claude-relay","name":"Claude relay","key":"sk-api","anthropic":"https://relay.example"}]}"#,
        )
        .await
        .expect("write providers");
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let result = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_MAGPIE.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
                source_ids: vec!["provider:claude-relay:anthropic".to_string()],
            },
        )
        .await
        .expect("unified-pool API import");
        assert_eq!(result.created, 1);
        assert_eq!(result.imported[0].kind, "api");
        assert_eq!(result.imported[0].provider, "custom");
        let config: Value = serde_json::from_str(&result.imported[0].config_json).unwrap();
        assert_eq!(config["interface_format"], "anthropic");
    }

    #[tokio::test]
    async fn repeated_official_import_overwrites_instead_of_duplicating() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_codex_plus_official_fixture(dir.path(), "第一次").await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let import = |dir_display: String, ids: Vec<String>| {
            async {
                import_external_client_accounts(
                    &pool,
                    ImportExternalClientAccountsInput {
                        client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
                        platform: "codex".to_string(),
                        source_path: Some(dir_display),
                        source_ids: ids,
                    },
                )
                .await
                .expect("import")
            }
        };

        let first = import(dir.path().display().to_string(), vec!["relay:of1:official".to_string()]).await;
        assert_eq!(first.created, 1);
        let credential_id = first.imported[0].id.clone();

        tokio::fs::remove_file(dir.path().join("settings.json"))
            .await
            .expect("replace fixture");
        write_codex_plus_official_fixture(dir.path(), "改名之后").await;
        let second = import(dir.path().display().to_string(), vec!["relay:of1:official".to_string()]).await;
        assert_eq!(second.created, 0);
        assert_eq!(second.overwritten, 1);
        assert_eq!(second.imported[0].id, credential_id);
        assert_eq!(second.imported[0].display_name, "改名之后");
        assert_eq!(second.imported[0].kind, "official");

        let total = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM route_credentials")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(total, 1, "official 重导不得新增行");
    }

    #[tokio::test]
    async fn overwriting_an_official_source_updates_the_login_email() {
        let dir = tempfile::tempdir().unwrap();
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        let auth: Value = serde_json::from_str(&codex_plus::test_support::valid_auth()).unwrap();
        let input = || ImportExternalClientAccountsInput {
            client: EXTERNAL_CLIENT_MAGPIE.into(), platform: "codex".into(),
            source_path: Some(dir.path().display().to_string()), source_ids: vec!["login:one".into()],
        };
        let mut ids = Vec::new();
        for user in ["alice@example.test", "bob@example.test"] {
            let content = json!([{"id":"one", "agent":"codex", "user":user, "auth":auth}]);
            tokio::fs::write(dir.path().join("logins.json"), content.to_string()).await.unwrap();
            let result = import_external_client_accounts(&pool, input()).await.unwrap();
            assert_eq!(result.imported.len(), 1);
            assert_eq!(result.imported[0].email.as_deref(), Some(user));
            ids.push(result.imported[0].id.clone());
        }
        assert_eq!(ids[0], ids[1]);
    }

    #[tokio::test]
    async fn api_rows_and_official_rows_never_overwrite_each_other() {
        let dir = tempfile::tempdir().expect("temp dir");
        // officialMixApiKey 的同 relay 同时给出 :api 与 :official 两条。
        tokio::fs::write(
            dir.path().join("settings.json"),
            &json!({"relayProfiles":[{
                "id":"mix1", "name":"混合", "relayMode":"mixedApi",
                "officialMixApiKey":true, "upstreamBaseUrl":"https://relay.example/v1",
                "apiKey":"sk-mix", "authContents":crate::services::codex_plus_import_service::test_support::valid_auth()
            }]}).to_string(),
        )
        .await
        .expect("write fixture");

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let input = |ids: Vec<&str>| ImportExternalClientAccountsInput {
            client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
            platform: "codex".to_string(),
            source_path: Some(dir.path().display().to_string()),
            source_ids: ids.into_iter().map(String::from).collect(),
        };

        // 先导 official 行，再让它拥有 :api 的绑定 → api 导入被拒。
        let official = import_external_client_accounts(
            &pool,
            input(vec!["relay:mix1:official"]),
        )
        .await
        .expect("official import");
        assert_eq!(official.created, 1);

        // 手工把该 official 行的绑定改成 :api（模拟同 id 先后为两种 kind）。
        sqlx::query(
            "UPDATE route_credentials SET external_source_id = 'relay:mix1:api' WHERE id = ?",
        )
        .bind(&official.imported[0].id)
        .execute(&pool)
        .await
        .expect("rebind");

        let api_attempt = import_external_client_accounts(&pool, input(vec!["relay:mix1:api"]))
            .await
            .expect("api import");
        assert_eq!(api_attempt.failed, 1, "跨 kind 覆盖必须被拒");
        assert_eq!(api_attempt.created, 0);
    }

    #[tokio::test]
    async fn official_import_stores_the_snapshot_verbatim_with_the_email() {
        let dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            dir.path().join("logins.json"),
            r#"[{"id":"cx9","agent":"codex","user":"snap@example.com",
                 "auth":{"tokens":{"id_token":"id-tok","access_token":"at-tok","refresh_token":"rt-tok","account_id":"acc-9","client_id":"fixture-client"}}}]"#,
        )
        .await
        .expect("write logins");

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let outcome = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_MAGPIE.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
                source_ids: vec!["login:cx9".to_string()],
            },
        )
        .await
        .expect("import");
        assert_eq!(outcome.created, 1);
        let row = &outcome.imported[0];
        assert_eq!(row.kind, "official");
        assert_eq!(row.email.as_deref(), Some("snap@example.com"));

        let secret: Value = serde_json::from_str(&row.secret_payload_json).expect("secret");
        // 快照原样落库：没有任何刷新或改写。
        assert_eq!(secret["access_token"], "at-tok");
        assert_eq!(secret["refresh_token"], "rt-tok");
        assert_eq!(secret["id_token"], "id-tok");
        assert_eq!(secret["account_id"], "acc-9");
    }

    #[tokio::test]
    async fn unsupported_entries_count_into_their_own_buckets() {
        let codex_dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            codex_dir.path().join("settings.json"),
            r#"{"relayProfiles":[{"id":"agg1","name":"聚合","relayMode":"aggregate"}]}"#,
        )
        .await
        .expect("write fixture");
        let magpie_dir = tempfile::tempdir().expect("temp dir");
        tokio::fs::write(
            magpie_dir.path().join("logins.json"),
            r#"[{"id":"cop1","agent":"copilot","user":"dev@example.com","auth":{}}]"#,
        )
        .await
        .expect("write logins");

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let codex_preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
                platform: "codex".to_string(),
                source_path: Some(codex_dir.path().display().to_string()),
            },
        )
        .await
        .expect("codex-plus preview");
        assert_eq!(codex_preview.counts.unsupported, 1);
        assert_eq!(codex_preview.counts.unsupported_counts["aggregate"], 1);
        assert_eq!(codex_preview.counts.other_platform, 0);

        let magpie_preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_MAGPIE.to_string(),
                platform: "codex".to_string(),
                source_path: Some(magpie_dir.path().display().to_string()),
            },
        )
        .await
        .expect("magpie preview");
        assert_eq!(magpie_preview.counts.unsupported, 1);
        assert_eq!(magpie_preview.counts.unsupported_counts["copilot"], 1);
    }

    #[tokio::test]
    async fn explicit_source_directory_flows_through_preview_and_import() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_codex_plus_official_fixture(dir.path(), "显式目录").await;

        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let preview = preview_external_client_import(
            &pool,
            PreviewExternalClientImportInput {
                client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
            },
        )
        .await
        .expect("preview");
        assert_eq!(preview.counts.importable, 1);
        assert_eq!(preview.source_path, dir.path().display().to_string());

        let outcome = import_external_client_accounts(
            &pool,
            ImportExternalClientAccountsInput {
                client: EXTERNAL_CLIENT_CODEX_PLUS.to_string(),
                platform: "codex".to_string(),
                source_path: Some(dir.path().display().to_string()),
                source_ids: vec!["relay:of1:official".to_string()],
            },
        )
        .await
        .expect("import");
        assert_eq!(outcome.created, 1);
    }


    #[test]
    fn build_payload_merges_custom_headers_with_the_user_agent() {
        let extracted = ExtractedApiCredential {
            platform: PlatformId::Claude,
            display_name: "Custom".to_string(),
            api_key: "sk-x".to_string(),
            base_url: "https://custom.example".to_string(),
            interface_format: ApiDialect::Anthropic,
            api_key_field: None,
            model_mappings: Vec::new(),
            user_agent: Some("ua/1".to_string()),
            extra_headers: vec![
                ("X-Debug".to_string(), "1".to_string()),
                ("X-Trace".to_string(), "2".to_string()),
            ],
        };

        let payload = build_payload(&extracted);
        let config: Value =
            serde_json::from_str(&payload.config_json).expect("config json");
        let headers = config["headers"].as_object().expect("headers object");
        assert_eq!(headers.get("User-Agent"), Some(&json!("ua/1")));
        assert_eq!(headers.get("X-Debug"), Some(&json!("1")));
        assert_eq!(headers.get("X-Trace"), Some(&json!("2")));

        let mut without_agent = extracted.clone();
        without_agent.user_agent = None;
        let payload = build_payload(&without_agent);
        let config: Value =
            serde_json::from_str(&payload.config_json).expect("config json");
        let headers = config["headers"].as_object().expect("headers object");
        assert_eq!(headers.get("X-Debug"), Some(&json!("1")));
        assert!(headers.get("User-Agent").is_none());
    }
}
