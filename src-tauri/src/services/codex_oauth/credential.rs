use super::{oauth_error, ImportedCodexAccount};
use crate::database::repositories::batch_repository::BatchRepository;
use crate::database::repositories::route_credential_repository::RouteCredentialRepository;
use crate::error::AppError;
use crate::models::batch::NewBatch;
use crate::services::cpa_import_service::ParsedOfficialCredential;
use crate::services::route_preview_service::RoutePreviewService;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sqlx::SqlitePool;

const MAX_AUTH_BYTES: usize = 1024 * 1024;

fn invalid_credentials() -> AppError {
    oauth_error(
        "codex_oauth.invalid_credentials",
        "Codex did not produce complete ChatGPT login credentials. Update Codex CLI and try again.",
    )
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

// These claims only label credentials produced by the official login process.
// Decoding JWT metadata here is not authentication or signature verification.
fn claims(token: &str) -> Value {
    token
        .split('.')
        .nth(1)
        .and_then(|part| URL_SAFE_NO_PAD.decode(part.trim_end_matches('=')).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}

fn client_identity(value: Option<String>) -> Option<String> {
    value.filter(|s| {
        s.len() <= 256
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
    })
}

fn audience(value: &Value) -> Option<String> {
    client_identity(text(value, "azp"))
        .or_else(|| client_identity(text(value, "client_id")))
        .or_else(|| client_identity(text(value, "aud")))
        .or_else(|| {
            let audience = value.get("aud")?.as_array()?;
            if audience.len() != 1 {
                return None;
            }
            client_identity(audience[0].as_str().map(str::to_owned))
        })
}

pub(super) fn parse_auth_json(
    input: &str,
    client_id_hint: Option<&str>,
) -> Result<ParsedOfficialCredential, AppError> {
    if input.len() > MAX_AUTH_BYTES {
        return Err(invalid_credentials());
    }
    let auth: Value = serde_json::from_str(input).map_err(|_| invalid_credentials())?;
    if text(&auth, "auth_mode").is_some_and(|mode| mode != "chatgpt") {
        return Err(invalid_credentials());
    }
    let tokens = auth
        .get("tokens")
        .filter(|value| value.is_object())
        .ok_or_else(invalid_credentials)?;
    let access_token = text(tokens, "access_token").ok_or_else(invalid_credentials)?;
    let refresh_token = text(tokens, "refresh_token").ok_or_else(invalid_credentials)?;
    let id_token = text(tokens, "id_token").ok_or_else(invalid_credentials)?;
    let id_claims = claims(&id_token);
    let access_claims = claims(&access_token);
    let id_auth = &id_claims["https://api.openai.com/auth"];
    let access_auth = &access_claims["https://api.openai.com/auth"];
    let account_id = text(tokens, "account_id")
        .or_else(|| text(access_auth, "chatgpt_account_id"))
        .or_else(|| text(id_auth, "chatgpt_account_id"))
        .ok_or_else(invalid_credentials)?;
    let client_id = client_identity(text(&auth, "client_id"))
        .or_else(|| client_identity(text(tokens, "client_id")))
        .or_else(|| client_identity(client_id_hint.map(str::to_owned)))
        .or_else(|| audience(&id_claims))
        .or_else(|| audience(&access_claims))
        .ok_or_else(invalid_credentials)?;
    let email = text(&id_claims, "email")
        .or_else(|| text(&access_claims["https://api.openai.com/profile"], "email"));
    let subscription =
        text(access_auth, "chatgpt_plan_type").or_else(|| text(id_auth, "chatgpt_plan_type"));
    let secret_payload_json = json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "id_token": id_token,
        "account_id": account_id,
        "client_id": client_id,
    })
    .to_string();
    // Do not retain the raw auth.json in config: config is also used in UI previews.
    let config_json = json!({
        "type": "codex",
        "auth_kind": "oauth",
        "auth_mode": "chatgpt",
        "account_id": account_id,
        "client_id": client_id,
        "token_endpoint": "https://auth.openai.com/oauth/token",
        "expired": access_claims.get("exp").and_then(Value::as_i64),
        "last_refresh": text(&auth, "last_refresh"),
        "subscription_type": subscription,
    })
    .to_string();
    Ok(ParsedOfficialCredential {
        display_name: email.clone().unwrap_or_else(|| "Codex account".to_string()),
        email,
        secret_payload_json,
        config_json,
    })
}

pub(super) async fn import_account(
    pool: &SqlitePool,
    batch_name: &str,
    credential: ParsedOfficialCredential,
) -> Result<ImportedCodexAccount, AppError> {
    let batch_name = batch_name.trim();
    if batch_name.is_empty() {
        return Err(oauth_error(
            "validation.batch_name_required",
            "Batch name is required",
        ));
    }
    // Never forward SQL errors containing credential values across the OAuth API.
    let import_error = || {
        oauth_error(
            "codex_oauth.import_failed",
            "Could not import the Codex account. Please try again.",
        )
    };
    let mut tx = pool.begin().await.map_err(|_| import_error())?;
    let batch = BatchRepository::create_tx(
        &mut tx,
        NewBatch {
            name: batch_name.to_string(),
            source: "codex_oauth".to_string(),
            notes: None,
        },
    )
    .await
    .map_err(|_| import_error())?;
    let preview = RoutePreviewService::generate(
        "codex",
        "official",
        &credential.secret_payload_json,
        &credential.config_json,
    );
    let account = RouteCredentialRepository::create_tx(
        &mut tx,
        "codex",
        "official",
        &credential.display_name,
        credential.email,
        "ok",
        Some(batch.id),
        &credential.secret_payload_json,
        &credential.config_json,
        &preview,
    )
    .await
    .map_err(|_| import_error())?;
    tx.commit().await.map_err(|_| import_error())?;
    Ok(ImportedCodexAccount {
        id: account.id,
        display_name: account.display_name,
        email: account.email,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_memory_pool, run_migrations};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use serde_json::{json, Value};

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.fixture",
            URL_SAFE_NO_PAD.encode(payload.to_string())
        )
    }

    pub(super) fn auth_json() -> String {
        json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "access_token": jwt(json!({"exp": 2000000000, "https://api.openai.com/profile": {"email": "profile@example.test"}})),
                "id_token": jwt(json!({"email": "user@example.test", "aud": "cli-client-from-token", "https://api.openai.com/auth": {"chatgpt_account_id": "account-from-token", "chatgpt_plan_type": "plus"}})),
                "refresh_token": "fixture-refresh-secret"
            },
            "last_refresh": "2026-09-14T00:00:00Z"
        }).to_string()
    }

    #[test]
    fn extracts_identity_and_refresh_metadata_without_raw_token_copies_in_config() {
        let parsed = parse_auth_json(&auth_json(), None).expect("valid official auth.json");
        assert_eq!(parsed.email.as_deref(), Some("user@example.test"));
        assert_eq!(parsed.display_name, "user@example.test");
        let secret: Value = serde_json::from_str(&parsed.secret_payload_json).unwrap();
        let config: Value = serde_json::from_str(&parsed.config_json).unwrap();
        assert_eq!(secret["account_id"], "account-from-token");
        assert_eq!(secret["client_id"], "cli-client-from-token");
        assert_eq!(config["client_id"], "cli-client-from-token");
        assert_eq!(
            config["token_endpoint"],
            "https://auth.openai.com/oauth/token"
        );
        assert_eq!(config["expired"], 2000000000_i64);
        assert_eq!(config["subscription_type"], "plus");
        assert_eq!(config["last_refresh"], "2026-09-14T00:00:00Z");
        assert!(!parsed.config_json.contains("fixture-refresh-secret"));
        assert!(config.get("raw").is_none());
    }

    #[test]
    fn explicit_account_and_client_ids_take_precedence_over_claims() {
        let mut auth: Value = serde_json::from_str(&auth_json()).unwrap();
        auth["tokens"]["account_id"] = json!("explicit-account");
        auth["client_id"] = json!("explicit-client");
        let parsed = parse_auth_json(&auth.to_string(), Some("url-client")).unwrap();
        let secret: Value = serde_json::from_str(&parsed.secret_payload_json).unwrap();
        assert_eq!(secret["account_id"], "explicit-account");
        assert_eq!(secret["client_id"], "explicit-client");
        auth.as_object_mut().unwrap().remove("client_id");
        let parsed = parse_auth_json(&auth.to_string(), Some("url-client")).unwrap();
        let config: Value = serde_json::from_str(&parsed.config_json).unwrap();
        assert_eq!(config["client_id"], "url-client");
    }

    #[test]
    fn rejects_api_key_and_incomplete_credentials_without_echoing_input() {
        for text in [
            r#"{"auth_mode":"apikey","OPENAI_API_KEY":"secret-marker"}"#.to_string(),
            r#"{"tokens":{"access_token":"secret-marker"}}"#.to_string(),
            "secret-marker invalid json".to_string(),
        ] {
            let error = parse_auth_json(&text, None).unwrap_err();
            assert_eq!(error.code(), "codex_oauth.invalid_credentials");
            assert!(error.details().is_none());
            assert!(!format!("{error:?}").contains("secret-marker"));
        }
    }

    #[test]
    fn requires_refresh_client_identity_instead_of_guessing_a_fixed_client() {
        let mut auth: Value = serde_json::from_str(&auth_json()).unwrap();
        auth["tokens"]["id_token"] = json!(jwt(json!({"email": "user@example.test"})));
        auth["tokens"]["account_id"] = json!("explicit-account");
        let error = parse_auth_json(&auth.to_string(), None).unwrap_err();
        assert_eq!(error.code(), "codex_oauth.invalid_credentials");
        assert!(parse_auth_json(&auth.to_string(), Some("observed-client")).is_ok());
    }

    #[tokio::test]
    async fn atomically_imports_one_official_account_and_returns_only_a_summary() {
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        let parsed = parse_auth_json(&auth_json(), None).unwrap();
        let summary = import_account(&pool, "  OAuth batch  ", parsed)
            .await
            .unwrap();
        let row: (String, String, String) = sqlx::query_as(
            "SELECT rc.kind, b.name, rc.secret_payload_json FROM route_credentials rc JOIN batches b ON b.id = rc.batch_id WHERE rc.id = ?",
        ).bind(&summary.id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "official");
        assert_eq!(row.1, "OAuth batch");
        assert!(row.2.contains("fixture-refresh-secret"));
        let serialized = serde_json::to_string(&summary).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("token"));
        assert_eq!(summary.email.as_deref(), Some("user@example.test"));
    }

    #[tokio::test]
    async fn failed_import_rolls_back_its_batch() {
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        sqlx::query("CREATE TRIGGER reject_oauth BEFORE INSERT ON route_credentials BEGIN SELECT RAISE(ABORT, 'fixture secret-marker'); END")
            .execute(&pool).await.unwrap();
        let parsed = parse_auth_json(&auth_json(), None).unwrap();
        let error = import_account(&pool, "failed batch", parsed)
            .await
            .unwrap_err();
        assert_eq!(error.code(), "codex_oauth.import_failed");
        assert!(!format!("{error:?}").contains("secret-marker"));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM batches")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
