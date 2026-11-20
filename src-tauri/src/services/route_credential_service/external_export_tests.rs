use super::*;
use crate::database::{create_memory_pool, run_migrations};
use crate::models::external_client_import::{EXTERNAL_CLIENT_MAX_ITEMS, EXTERNAL_CLIENT_MAX_SOURCE_BYTES};

fn codex_export() -> Value {
    json!({"schema":1,"exported_at_ms":1_800_000_000_000i64,"settings":{"relayProfiles":[
        {"id":"api", "name":"JSON relay", "relayMode":"pureApi", "protocol":"anthropicMessages",
         "apiKey":"sk-json-export", "upstreamBaseUrl":"https://relay.example/v1",
         "anthropicAuthHeader":"authorization", "modelList":"claude-model",
         "customHeaders":[{"key":"X-Relay-Token","value":"header-token"}], "userAgent":"json-fixture/1"},
        {"id":"oauth", "name":"JSON OAuth", "relayMode":"official",
         "authContents":crate::services::codex_plus_import_service::test_support::valid_auth()}
    ]}})
}

async fn pool() -> SqlitePool {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn bulk_json_imports_codex_export_without_losing_api_or_oauth_fields() {
    let pool = pool().await;
    let result = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: codex_export().to_string(), batch_name: Some("JSON export".to_string()),
    }).await.expect("Codex++ exported document");
    assert!(result.failed.is_empty());
    assert_eq!(result.imported.len(), 2);
    let api = &result.imported[0];
    assert_eq!(api.kind, "api");
    assert_eq!(api.platform, "codex");
    let config: Value = serde_json::from_str(&api.config_json).unwrap();
    assert_eq!(config["interface_format"], "anthropic");
    assert_eq!(config["api_key_field"], "ANTHROPIC_AUTH_TOKEN");
    assert_eq!(config["headers"]["X-Relay-Token"], "header-token");
    assert_eq!(config["headers"]["User-Agent"], "json-fixture/1");
    assert_eq!(config["model_mappings"][0]["to"], "claude-model");
    let oauth = &result.imported[1];
    assert_eq!(oauth.kind, "official");
    assert_eq!(oauth.provider, "openai");
    assert_eq!(oauth.email.as_deref(), Some("codex@example.com"));
    let config: Value = serde_json::from_str(&oauth.config_json).unwrap();
    assert_eq!(config["token_endpoint"], "https://auth.openai.com/oauth/token");
    assert_eq!(config["client_id"], "codex-cli-client");
    let bindings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM route_credentials WHERE external_source_client IS NOT NULL")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(bindings, 0, "bulk import creates accounts without local source bindings");

    let again = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: codex_export().to_string(), batch_name: Some("JSON export again".to_string()),
    }).await.unwrap();
    assert_ne!(again.imported[0].id, api.id, "bulk import keeps its create-new semantics");
}

#[tokio::test]
async fn bulk_json_files_and_pasted_text_have_identical_payloads() {
    let pool = pool().await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("codex-plus-plus-settings.json");
    tokio::fs::write(&path, codex_export().to_string()).await.unwrap();
    let text = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: codex_export().to_string(), batch_name: Some("Pasted".to_string()),
    }).await.unwrap();
    let files = RouteCredentialService::import_official_files(&pool, ImportOfficialFilesInput {
        file_paths: vec![path.display().to_string()], batch_name: Some("Files".to_string()),
    }).await.unwrap();
    assert!(files.failed.is_empty());
    assert_eq!(files.imported.len(), text.imported.len());
    for (file, pasted) in files.imported.iter().zip(&text.imported) {
        assert_eq!(file.kind, pasted.kind);
        assert_eq!(file.provider, pasted.provider);
        assert_eq!(file.secret_payload_json, pasted.secret_payload_json);
        assert_eq!(file.config_json, pasted.config_json);
    }
}

#[tokio::test]
async fn bulk_json_reports_bad_and_unsupported_rows_without_echoing_tokens() {
    let pool = pool().await;
    let value = json!({"schema":1,"settings":{"relayProfiles":[
        {"id":"good","name":"Valid","relayMode":"pureApi","apiKey":"good-key","baseUrl":"https://relay.example"},
        {"id":"private-id-token","name":"private-name-token","relayMode":"official","authContents":"private-auth-token"},
        {"id":"aggregate","relayMode":"aggregate"}
    ]}});
    let result = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: value.to_string(), batch_name: Some("Partial".to_string()),
    }).await.unwrap();
    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.failed.len(), 2);
    let failures = serde_json::to_string(&result.failed).unwrap();
    assert!(!failures.contains("private-"));
    assert!(failures.contains("official_snapshot_invalid"));
    assert!(failures.contains("unsupported"));
}

#[tokio::test]
async fn bulk_json_magpie_providers_and_native_logins_preserve_kinds() {
    let pool = pool().await;
    let value = json!({"providers":[
        {"id":"relay","name":"Magpie relay","key":"sk-magpie",
         "chat":"https://chat.example/v1","responses":"https://responses.example/v1",
         "models":["model-a"],"headers":{"X-Gateway":"gateway-header"}}
    ],"logins":[
        {"id":"login","agent":"claude","user":"claude@example.com",
         "auth":{"claudeAiOauth":{"accessToken":"claude-access","refreshToken":"claude-refresh",
            "expiresAt":2_000_000_000_000i64,"scopes":["user:inference"]}}}
    ]});
    let result = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: value.to_string(), batch_name: Some("Magpie".to_string()),
    }).await.unwrap();
    assert_eq!(result.imported.len(), 3);
    assert_eq!(result.imported.iter().map(|c| c.kind.as_str()).collect::<Vec<_>>(), vec!["api", "api", "official"]);
    assert_eq!(result.imported[2].provider, "claude");
}

#[tokio::test]
async fn bulk_json_magpie_sub2api_keeps_identity_expiry_scope_and_client_id() {
    let pool = pool().await;
    // Matches Magpie login_export.go sub2apiAccount, including the asymmetric expires_at types.
    let value = json!({"type":"sub2api-data","version":1,"exported_at":"2026-11-20T00:00:00Z","proxies":[],"accounts":[
        {"name":"Codex exported","platform":"openai","type":"oauth","concurrency":10,"priority":1,
         "credentials":{"access_token":"codex-access","refresh_token":"codex-refresh","id_token":"id",
            "chatgpt_account_id":"workspace","email":"codex@example.com","client_id":"magpie-client",
            "expires_at":"2033-05-18T03:33:20Z","plan_type":"plus"}},
        {"name":"Claude exported","platform":"anthropic","type":"oauth","concurrency":10,"priority":1,
         "credentials":{"access_token":"claude-access","refresh_token":"claude-refresh",
            "email_address":"claude@example.com","expires_at":2_000_000_000i64,
            "scope":"user:inference user:profile","account_uuid":"account-uuid","org_uuid":"org-uuid"},
         "extra":{"email_address":"claude@example.com"}}
    ]});
    let result = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: value.to_string(), batch_name: Some("Magpie export".to_string()),
    }).await.unwrap();
    assert_eq!(result.imported.len(), 2);
    assert_eq!(result.imported[1].email.as_deref(), Some("claude@example.com"));
    let codex: Value = serde_json::from_str(&result.imported[0].config_json).unwrap();
    let claude: Value = serde_json::from_str(&result.imported[1].config_json).unwrap();
    assert_eq!(codex["expired"], "2033-05-18T03:33:20Z");
    assert_eq!(codex["client_id"], "magpie-client");
    assert_eq!(claude["expired"], 2_000_000_000i64);
    assert_eq!(claude["scopes"], json!(["user:inference", "user:profile"]));
    assert_eq!(claude["account_uuid"], "account-uuid");
    assert_eq!(claude["org_uuid"], "org-uuid");
}

#[tokio::test]
async fn bulk_json_magpie_cliproxyapi_still_imports_both_vendors() {
    let pool = pool().await;
    let value = json!([
        {"type":"codex","email":"codex@example.com","access_token":"at","refresh_token":"rt",
         "id_token":"id","account_id":"account","last_refresh":"2026-11-20T00:00:00Z","expired":"2033-05-18T03:33:20Z"},
        {"type":"claude","email":"claude@example.com","access_token":"at","refresh_token":"rt",
         "last_refresh":"2026-11-20T00:00:00Z","expired":"2033-05-18T03:33:20Z","account_uuid":"account-uuid","org_uuid":"org-uuid"}
    ]);
    let result = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: value.to_string(), batch_name: Some("Magpie CLIProxy".to_string()),
    }).await.unwrap();
    assert_eq!(result.imported.len(), 2);
    assert_eq!(result.imported.iter().map(|c| c.provider.as_str()).collect::<Vec<_>>(), vec!["openai", "claude"]);
}

#[tokio::test]
async fn bulk_json_magpie_sub2api_reports_invalid_rows_and_rejects_unknown_versions() {
    let pool = pool().await;
    let value = json!({"type":"sub2api-data","version":1,"accounts":[
        {"platform":"openai","name":"good","credentials":{"access_token":"access","refresh_token":"refresh"}},
        {"platform":"anthropic","name":"private-name","credentials":{"access_token":""}}
    ]});
    let result = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: value.to_string(), batch_name: Some("Partial Sub2API".to_string()),
    }).await.unwrap();
    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.failed.len(), 1);
    assert!(!serde_json::to_string(&result.failed).unwrap().contains("private-name"));
    let error = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: json!({"type":"sub2api-data","version":99,"accounts":[]}).to_string(),
        batch_name: Some("Unknown version".to_string()),
    }).await.expect_err("future version must not be guessed");
    assert_eq!(error.code(), "external_import.export_version_unsupported");
}

#[tokio::test]
async fn bulk_json_file_errors_keep_valid_files_and_do_not_create_empty_batches() {
    let pool = pool().await;
    let dir = tempfile::tempdir().unwrap();
    let good = dir.path().join("good.json");
    let bad = dir.path().join("bad.json");
    let large = dir.path().join("large.json");
    tokio::fs::write(&good, codex_export().to_string()).await.unwrap();
    tokio::fs::write(&bad, "{\"secret\":\"private-file-token\",broken").await.unwrap();
    tokio::fs::write(&large, " ".repeat(EXTERNAL_CLIENT_MAX_SOURCE_BYTES+1)).await.unwrap();
    let result = RouteCredentialService::import_official_files(&pool, ImportOfficialFilesInput {
        file_paths: vec![good.display().to_string(), bad.display().to_string(), large.display().to_string()],
        batch_name: Some("Mixed files".to_string()),
    }).await.unwrap();
    assert_eq!(result.imported.len(), 2);
    assert_eq!(result.failed.len(), 2);
    assert!(!serde_json::to_string(&result.failed).unwrap().contains("private-file-token"));
    assert!(result.failed.iter().any(|failure| failure.error.contains("8 MiB")));
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM batches").fetch_one(&pool).await.unwrap();
    let result = RouteCredentialService::import_official_files(&pool, ImportOfficialFilesInput {
        file_paths: vec![large.display().to_string()], batch_name: Some("All bad".to_string()),
    }).await.unwrap();
    assert!(result.imported.is_empty());
    assert_eq!(result.failed.len(), 1);
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM batches").fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
}

#[tokio::test]
async fn bulk_json_nested_sub2api_accounts_cannot_bypass_expanded_limit() {
    let pool = pool().await;
    let accounts = vec![json!({"platform":"openai","credentials":{"access_token":"access"}}); EXTERNAL_CLIENT_MAX_ITEMS + 1];
    let value = json!({"type":"sub2api-data","version":1,"accounts":[{"accounts":accounts}]});
    let error = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
        text: value.to_string(), batch_name: Some("Oversized nested export".to_string()),
    }).await.expect_err("expanded items, not wrapper count, must be limited");
    assert_eq!(error.code(), "external_import.too_many_items");
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM route_credentials").fetch_one(&pool).await.unwrap();
    let batches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM batches").fetch_one(&pool).await.unwrap();
    assert_eq!(total, 0);
    assert_eq!(batches, 0);
}

#[tokio::test]
async fn bulk_json_limits_are_checked_before_any_batch_is_created() {
    let pool = pool().await;
    for (text, code) in [
        (" ".repeat(EXTERNAL_CLIENT_MAX_SOURCE_BYTES + 1), "external_import.source_too_large"),
        (json!({"schema":1,"settings":{"relayProfiles":vec![json!({"id":"x"}); EXTERNAL_CLIENT_MAX_ITEMS+1]}}).to_string(), "external_import.too_many_items"),
        (json!({"format":"magpie-backup","version":1,"data":"ciphertext"}).to_string(), "external_import.encrypted_backup"),
    ] {
        let error = RouteCredentialService::import_official_text(&pool, ImportOfficialTextInput {
            text, batch_name: Some("Rejected".to_string()),
        }).await.expect_err("invalid export");
        assert_eq!(error.code(), code);
    }
    let batches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM batches").fetch_one(&pool).await.unwrap();
    assert_eq!(batches, 0, "invalid input must not create empty batches");
}
