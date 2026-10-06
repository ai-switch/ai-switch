use super::*;
use crate::database::{create_memory_pool, run_migrations};
use crate::services::route_config_service::RouteConfigService;
use serde_json::json;

async fn fixture() -> (
    tempfile::TempDir,
    AppPaths,
    SqlitePool,
    ConfigWriteRuntimeState,
) {
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths::from_data_dir(root.path().join("data"));
    paths.ensure().await.unwrap();
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    (root, paths, pool, ConfigWriteRuntimeState::default())
}

async fn api_account(pool: &SqlitePool, platform: &str, key: &str) -> String {
    RouteCredentialRepository::create(pool, platform, "api", key, None, "ok", None,
        &json!({"api_key":key}).to_string(),
        &json!({"base_url":"https://upstream.example/v1", "interface_format": if platform=="codex" {"openai-responses"} else {"anthropic"},
          "model_mappings":[{"from":"alias","to":"native-model"}]}).to_string(), "{}")
        .await.unwrap().id
}

#[tokio::test]
async fn switching_accounts_is_one_to_one_and_status_has_no_secrets() {
    let (root, paths, pool, runtime) = fixture().await;
    let a = api_account(&pool, "codex", "secret-a").await;
    let b = api_account(&pool, "codex", "secret-b").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &a)
        .await
        .unwrap();
    let result = DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &b)
        .await
        .unwrap();
    assert_eq!(result.credential_id, b);
    let statuses = DirectModeService::statuses(&pool).await.unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].status, "active");
    let public = serde_json::to_string(&statuses).unwrap();
    assert!(!public.contains("secret-b"));
    assert!(!public.contains("auth_backup"));
    let config = std::fs::read_to_string(root.path().join(".codex/config.toml")).unwrap();
    assert!(config.contains("secret-b"));
    assert!(!config.contains("secret-a"));
}

#[tokio::test]
async fn only_checked_client_leaves_direct_mode_and_original_auth_is_restored() {
    let (root, paths, pool, runtime) = fixture().await;
    std::fs::create_dir_all(root.path().join(".claude")).unwrap();
    let original = br#"{"claudeAiOauth":{"accessToken":"original"},"other":{"keep":true}}"#;
    std::fs::write(root.path().join(".claude/.credentials.json"), original).unwrap();
    let a = api_account(&pool, "codex", "codex-secret").await;
    let b = api_account(&pool, "claude", "claude-secret").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &a)
        .await
        .unwrap();
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &b)
        .await
        .unwrap();
    let codex_config = std::fs::read(root.path().join(".codex/config.toml")).unwrap();
    let codex_auth = std::fs::read(root.path().join(".codex/auth.json")).unwrap();
    RouteConfigService::write_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19527",
        "claude",
        root.path(),
        Some(&["claude_code".into()]),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(root.path().join(".codex/config.toml")).unwrap(),
        codex_config
    );
    assert_eq!(
        std::fs::read(root.path().join(".codex/auth.json")).unwrap(),
        codex_auth
    );
    let statuses = DirectModeService::statuses(&pool).await.unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].client_key, "codex");
    let restored: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join(".claude/.credentials.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(restored["claudeAiOauth"]["accessToken"], "original");
    let config = std::fs::read_to_string(root.path().join(".claude/settings.json")).unwrap();
    assert!(!config.contains("claude-secret"));
    assert!(config.contains("19527"));
}

#[tokio::test]
async fn automatic_route_rewrites_preserve_direct_clients() {
    let (root, paths, pool, runtime) = fixture().await;
    RouteConfigService::write_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19527",
        "codex",
        root.path(),
        Some(&["codex".into()]),
    )
    .await
    .unwrap();
    let a = api_account(&pool, "codex", "direct-secret").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &a)
        .await
        .unwrap();
    let config = std::fs::read(root.path().join(".codex/config.toml")).unwrap();
    RouteConfigService::write_existing_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19528",
        root.path(),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(root.path().join(".codex/config.toml")).unwrap(),
        config
    );
    assert_eq!(
        DirectModeService::statuses(&pool).await.unwrap()[0].status,
        "active"
    );
}

#[tokio::test]
async fn invalid_auth_preserves_all_files_and_does_not_record_direct_mode() {
    let (root, paths, pool, runtime) = fixture().await;
    std::fs::create_dir_all(root.path().join(".codex")).unwrap();
    std::fs::write(
        root.path().join(".codex/config.toml"),
        "model_provider = \"ai-switch\"\n",
    )
    .unwrap();
    std::fs::write(root.path().join(".codex/auth.json"), "invalid").unwrap();
    let a = api_account(&pool, "codex", "test-secret").await;
    assert!(
        DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &a)
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join(".codex/config.toml")).unwrap(),
        "model_provider = \"ai-switch\"\n"
    );
    assert!(DirectModeService::statuses(&pool).await.unwrap().is_empty());
}

#[tokio::test]
async fn changed_managed_config_is_not_reported_as_active() {
    let (root, paths, pool, runtime) = fixture().await;
    let a = api_account(&pool, "codex", "test-secret").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &a)
        .await
        .unwrap();
    std::fs::write(
        root.path().join(".codex/config.toml"),
        "model_provider = \"external\"\n",
    )
    .unwrap();
    assert_eq!(
        DirectModeService::statuses(&pool).await.unwrap()[0].status,
        "changed"
    );
}

#[tokio::test]
async fn state_failure_restores_every_written_file() {
    let root = tempfile::tempdir().unwrap();
    let a = root.path().join("config");
    let b = root.path().join("auth");
    std::fs::write(&a, b"original config").unwrap();
    std::fs::write(&b, b"original auth").unwrap();
    let changes = vec![
        Change {
            location: Location::file(a.clone()),
            before: ConfigWriter::inspect(&a).await.unwrap(),
            after: Some(b"new config".to_vec()),
        },
        Change {
            location: Location::file(b.clone()),
            before: ConfigWriter::inspect(&b).await.unwrap(),
            after: Some(b"new auth".to_vec()),
        },
    ];
    assert!(apply_changes(&changes, async { Err(state_error()) })
        .await
        .is_err());
    assert_eq!(std::fs::read(&a).unwrap(), b"original config");
    assert_eq!(std::fs::read(&b).unwrap(), b"original auth");
}

#[tokio::test]
async fn auth_store_failure_rolls_back_config_and_does_not_persist() {
    let root = tempfile::tempdir().unwrap();
    let a = root.path().join("config");
    let b = root.path().join("auth");
    std::fs::write(&a, b"before").unwrap();
    let absent = ConfigWriter::inspect(&b).await.unwrap();
    // 准备后该路径变为目录，认证写入必然失败。
    std::fs::create_dir(&b).unwrap();
    let changes = vec![
        Change {
            location: Location::file(a.clone()),
            before: ConfigWriter::inspect(&a).await.unwrap(),
            after: Some(b"new".to_vec()),
        },
        Change {
            location: Location::file(b),
            before: absent,
            after: Some(b"token".to_vec()),
        },
    ];
    let called = std::sync::atomic::AtomicBool::new(false);
    assert!(apply_changes(&changes, async {
        called.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    })
    .await
    .is_err());
    assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(std::fs::read(a).unwrap(), b"before");
}

#[tokio::test]
async fn rollback_never_overwrites_external_edits() {
    let root = tempfile::tempdir().unwrap();
    let a = root.path().join("config");
    std::fs::write(&a, b"before").unwrap();
    let changes = vec![Change {
        location: Location::file(a.clone()),
        before: ConfigWriter::inspect(&a).await.unwrap(),
        after: Some(b"ours".to_vec()),
    }];
    let error = apply_changes(&changes, async {
        std::fs::write(&a, b"external").unwrap();
        Err(state_error())
    })
    .await
    .err()
    .unwrap();
    assert!(matches!(
        error,
        AppError::Validation {
            code: "direct_mode.rollback_conflict",
            ..
        }
    ));
    assert_eq!(std::fs::read(a).unwrap(), b"external");
}

#[tokio::test]
async fn codex_official_refresh_is_adopted_before_switching_back_to_api() {
    let (root, paths, pool, runtime) = fixture().await;
    let official=RouteCredentialRepository::create(&pool,"codex","official","official",None,"ok",None,
        &json!({"access_token":"old-at","refresh_token":"old-rt","id_token":"id","account_id":"account"}).to_string(),"{}","{}").await.unwrap();
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &official.id)
        .await
        .unwrap();
    let auth_path = root.path().join(".codex/auth.json");
    let mut auth: Value = serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    auth["tokens"]["access_token"] = json!("native-refreshed-at");
    auth["tokens"]["refresh_token"] = json!("native-refreshed-rt");
    std::fs::write(&auth_path, auth.to_string()).unwrap();
    let selected = SelectedCredential {
        id: official.id.clone(),
        platform: "codex".into(),
        kind: "official".into(),
        display_name: "official".into(),
        status: "ok".into(),
        route_priority: 3,
        max_concurrency: 5,
        secret_payload_json: official.secret_payload_json,
        config_json: official.config_json,
    };
    let refreshed = crate::services::route_proxy_service::maybe_refresh_official_credential(
        &pool, &selected, None,
    )
    .await
    .unwrap();
    assert!(refreshed
        .secret_payload_json
        .contains("native-refreshed-at"));
    let api = api_account(&pool, "codex", "api-key").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &api)
        .await
        .unwrap();
    let saved = RouteCredentialRepository::get(&pool, &official.id)
        .await
        .unwrap();
    assert!(saved.secret_payload_json.contains("native-refreshed-rt"));
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(auth_path).unwrap()).unwrap()["auth_mode"],
        "apikey"
    );
}

#[tokio::test]
async fn claude_api_official_and_router_switch_without_losing_other_credentials() {
    let (root, paths, pool, runtime) = fixture().await;
    std::fs::create_dir_all(root.path().join(".claude")).unwrap();
    std::fs::write(
        root.path().join(".claude/.credentials.json"),
        r#"{"other":{"keep":true}}"#,
    )
    .unwrap();
    let api = api_account(&pool, "claude", "api-key").await;
    let official = RouteCredentialRepository::create(
        &pool,
        "claude",
        "official",
        "official",
        None,
        "ok",
        None,
        r#"{"access_token":"at","refresh_token":"rt"}"#,
        r#"{"expired":"2099-01-01T00:00:00Z","scopes":["user:inference","user:profile"]}"#,
        "{}",
    )
    .await
    .unwrap();
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &api)
        .await
        .unwrap();
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &official.id)
        .await
        .unwrap();
    let auth_path = root.path().join(".claude/.credentials.json");
    let auth: Value = serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    assert_eq!(auth["claudeAiOauth"]["accessToken"], "at");
    assert_eq!(auth["other"]["keep"], true);
    RouteConfigService::write_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19527",
        "claude",
        root.path(),
        Some(&["claude_code".into()]),
    )
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(&auth_path).unwrap()).unwrap(),
        json!({"other":{"keep":true}})
    );
    assert!(DirectModeService::statuses(&pool).await.unwrap().is_empty());
}

#[tokio::test]
async fn corrupt_auth_backup_keeps_direct_mode_and_files_untouched() {
    let (root, paths, pool, runtime) = fixture().await;
    std::fs::create_dir_all(root.path().join(".codex")).unwrap();
    std::fs::write(root.path().join(".codex/auth.json"), "{}").unwrap();
    let api = api_account(&pool, "codex", "api-key").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &api)
        .await
        .unwrap();
    let row = record(&pool, "codex").await.unwrap().unwrap();
    std::fs::write(row.auth_backup_path.unwrap(), b"corrupt backup").unwrap();
    let before = std::fs::read(root.path().join(".codex/config.toml")).unwrap();
    assert!(RouteConfigService::write_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19527",
        "codex",
        root.path(),
        Some(&["codex".into()])
    )
    .await
    .is_err());
    assert_eq!(
        std::fs::read(root.path().join(".codex/config.toml")).unwrap(),
        before
    );
    assert_eq!(
        DirectModeService::statuses(&pool).await.unwrap()[0].status,
        "active"
    );
}

async fn codex_official(pool: &SqlitePool) -> String {
    RouteCredentialRepository::create(
        pool,
        "codex",
        "official",
        "official",
        None,
        "ok",
        None,
        r#"{"access_token":"at","refresh_token":"rt","id_token":"id","account_id":"account"}"#,
        "{}",
        "{}",
    )
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn official_model_change_does_not_prevent_explicit_return_to_router() {
    let (root, paths, pool, runtime) = fixture().await;
    let id = codex_official(&pool).await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &id)
        .await
        .unwrap();
    let path = root.path().join(".codex/config.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, format!("model = \"gpt-user-selected\"\n{original}")).unwrap();
    RouteConfigService::write_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19527",
        "codex",
        root.path(),
        Some(&["codex".into()]),
    )
    .await
    .unwrap();
    assert!(DirectModeService::statuses(&pool).await.unwrap().is_empty());
}

#[tokio::test]
async fn official_login_changed_externally_is_not_reported_as_active() {
    let (root, paths, pool, runtime) = fixture().await;
    let id = codex_official(&pool).await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &id)
        .await
        .unwrap();
    let path = root.path().join(".codex/auth.json");
    let mut auth: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    auth["tokens"]["account_id"] = json!("another-account");
    std::fs::write(&path, auth.to_string()).unwrap();
    assert_eq!(
        DirectModeService::statuses(&pool).await.unwrap()[0].status,
        "changed"
    );
}

#[tokio::test]
async fn unchecked_native_client_is_untouched_when_writing_another_codex_client() {
    let (root, paths, pool, runtime) = fixture().await;
    let id = api_account(&pool, "codex", "direct-key").await;
    crate::database::repositories::route_pool_repository::RoutePoolRepository::replace_members(
        &pool,
        "codex",
        std::slice::from_ref(&id),
    )
    .await
    .unwrap();
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &id)
        .await
        .unwrap();
    let before_config = std::fs::read(root.path().join(".codex/config.toml")).unwrap();
    let before_auth = std::fs::read(root.path().join(".codex/auth.json")).unwrap();
    let before_status = DirectModeService::statuses(&pool).await.unwrap();
    RouteConfigService::write_configs_for_home(
        &paths,
        &pool,
        &runtime,
        "http://127.0.0.1:19527",
        "codex",
        root.path(),
        Some(&["zcode".into()]),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(root.path().join(".codex/config.toml")).unwrap(),
        before_config
    );
    assert_eq!(
        std::fs::read(root.path().join(".codex/auth.json")).unwrap(),
        before_auth
    );
    assert_eq!(
        DirectModeService::statuses(&pool).await.unwrap(),
        before_status
    );
    assert!(!root
        .path()
        .join(".codex/ai-switch-model-catalog.json")
        .exists());
    assert!(root.path().join(".zcode/v2/config.json").exists());
}

#[tokio::test]
async fn database_failure_restores_files_and_leaves_no_active_binding() {
    let (root, paths, pool, runtime) = fixture().await;
    std::fs::create_dir_all(root.path().join(".codex")).unwrap();
    std::fs::write(
        root.path().join(".codex/config.toml"),
        b"model_provider = \"openai\"\n",
    )
    .unwrap();
    std::fs::write(root.path().join(".codex/auth.json"), b"{}").unwrap();
    let id = api_account(&pool, "codex", "direct-key").await;
    sqlx::query("CREATE TRIGGER reject_direct_state BEFORE INSERT ON client_direct_modes BEGIN SELECT RAISE(ABORT, 'fixture'); END").execute(&pool).await.unwrap();
    assert!(
        DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &id)
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read(root.path().join(".codex/config.toml")).unwrap(),
        b"model_provider = \"openai\"\n"
    );
    assert_eq!(
        std::fs::read(root.path().join(".codex/auth.json")).unwrap(),
        b"{}"
    );
    assert!(DirectModeService::statuses(&pool).await.unwrap().is_empty());
}

#[test]
fn an_existing_empty_auth_file_is_restored_as_a_file() {
    assert_eq!(
        restore_auth("codex", Some(br#"{"OPENAI_API_KEY":"test"}"#), Some(b"{}")).unwrap(),
        Some(b"{}".to_vec())
    );
}

#[tokio::test]
async fn official_logout_does_not_block_an_explicit_new_direct_account() {
    let (root, paths, pool, runtime) = fixture().await;
    let official = codex_official(&pool).await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &official)
        .await
        .unwrap();
    std::fs::remove_file(root.path().join(".codex/auth.json")).unwrap();
    let api = api_account(&pool, "codex", "new-api-key").await;
    DirectModeService::enable_for_home(&paths, &pool, &runtime, root.path(), &api)
        .await
        .unwrap();
    assert_eq!(
        DirectModeService::statuses(&pool).await.unwrap()[0].credential_id,
        api
    );
    let old = RouteCredentialRepository::get(&pool, &official)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&old.secret_payload_json).unwrap()["account_id"],
        "account"
    );
}
