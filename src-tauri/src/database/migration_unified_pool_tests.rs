//! 统一账号池迁移（G-P8 P4a）的行为测试。
//!
//! 迁移动的是**真实用户数据**（账号、组、key、SaaS 销售分组），所以测试走真实
//! 执行路径：先只迁移到 `202611040001`，种出旧形状数据，再应用
//! `202611040002_unified_account_pool.sql`，断言终态。

use super::{create_memory_pool, MIGRATOR};
use sqlx::{Executor, Row};

const PREVIOUS_MIGRATION: i64 = 202611040001;

/// sqlx 0.8 的 Migrator 没有公开单版本 apply；这里按 run 的语义轻量重放：
/// 执行迁移 SQL + 写 `_sqlx_migrations` 记账行。记账与真实文件的一致性由
/// migration_checksum_manifest_tests 兜底。
async fn apply_migration(
    pool: &sqlx::SqlitePool,
    migration: &sqlx::migrate::Migration,
) {
    // 轻量重放不走 Migrator.run，记账表要先补齐（schema 与 sqlx 自建的一致）。
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);",
    )
    .execute(pool)
    .await
    .expect("bookkeeping table");
    sqlx::raw_sql(migration.sql.as_ref())
        .execute(pool)
        .await
        .expect("migration sql");
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time) \
         VALUES (?, ?, datetime('now'), TRUE, ?, 0)",
    )
    .bind(migration.version)
    .bind(&migration.description)
    .bind(migration.checksum.as_ref())
    .execute(pool)
    .await
    .expect("migration bookkeeping");
}

async fn run_migrations_until(pool: &sqlx::SqlitePool, version: i64) {
    for migration in MIGRATOR.iter() {
        if migration.version > version {
            break;
        }
        apply_migration(pool, migration).await;
    }
}

async fn apply_remaining_migrations(pool: &sqlx::SqlitePool) {
    for migration in MIGRATOR.iter() {
        if migration.version <= PREVIOUS_MIGRATION {
            continue;
        }
        apply_migration(pool, migration).await;
    }
}

async fn seed_legacy_pools(pool: &sqlx::SqlitePool) {
    // SaaS 表由独立的 SaaS 迁移链创建（应用里在 SaaS 初始化时执行）；先真实地
    // 跑一遍，后续的 SaaS 行才有落点。
    crate::saas::repository::migrate(pool).await.expect("saas migrations");
    // 旧形状：三个平台各自的账号与视图组；claude-default 被 SaaS 引用（销售分组）；
    // 多平台 key 并存；一个 base_url 可识别出 openrouter 的 API 账号。
    pool.execute(
        r#"
        INSERT INTO route_credentials (id,platform,kind,display_name,status,secret_payload_json,config_json,created_at,updated_at)
        VALUES
          ('codex-official','codex','official','Codex Sub','ok','{}','{}','2026-01-01','2026-01-01'),
          ('codex-api','codex','api','Codex API','ok','{}','{"interface_format":"openai-responses","base_url":"https://api.example.com/v1"}','2026-01-01','2026-01-01'),
          ('claude-official','claude','official','Claude Sub','ok','{}','{}','2026-01-01','2026-01-01'),
          ('claude-api','claude','api','Claude API','ok','{}','{"interface_format":"anthropic","base_url":"https://api.anthropic.com"}','2026-01-01','2026-01-01'),
          ('gemini-api','gemini','api','Gemini API','ok','{}','{"interface_format":"gemini","base_url":"https://generativelanguage.googleapis.com"}','2026-01-01','2026-01-01'),
          ('openrouter-api','codex','api','OpenRouter','ok','{}','{"interface_format":"openai","base_url":"https://openrouter.ai/api/v1"}','2026-01-01','2026-01-01'),
          ('kling-api','codex','api','Kling API','ok','{}','{"interface_format":"kling","base_url":"https://api.klingai.com"}','2026-01-01','2026-01-01')
        "#,
    )
    .await
    .unwrap();
    // 视图组直接复用迁移链种子（run_until 已建出 7 平台 × default/out/archived），
    // 这里只把要钉住的组拉回旧形状语义：claude-default 将被 SaaS 引用。
    pool.execute(
        r#"
        INSERT INTO route_pool_members (id,platform,route_credential_id,enabled,group_id,created_at,updated_at)
        VALUES
          ('m1','codex','codex-official',1,'codex-default','2026-01-01','2026-01-01'),
          ('m2','codex','codex-api',1,'codex-default','2026-01-01','2026-01-01'),
          ('m3','claude','claude-official',1,'claude-default','2026-01-01','2026-01-01'),
          ('m4','claude','claude-api',1,'claude-default','2026-01-01','2026-01-01'),
          ('m5','gemini','gemini-api',1,'gemini-default','2026-01-01','2026-01-01'),
          ('m6','codex','kling-api',0,NULL,'2026-01-01','2026-01-01')
        "#,
    )
    .await
    .unwrap();
    pool.execute(
        r#"
        INSERT INTO route_pool_cursors (platform,next_index,updated_at) VALUES ('codex',2,'2026-01-01'),('claude',1,'2026-01-01');
        INSERT INTO route_proxy_keys (platform,proxy_key,created_at,updated_at) VALUES
          ('codex','sk-codex-main','2026-01-01','2026-01-01'),
          ('claude','sk-claude-legacy','2026-01-01','2026-01-01');
        INSERT INTO route_proxy_key_aliases (proxy_key,platform,created_at) VALUES ('sk-claude-extra','claude','2026-01-01');
        INSERT INTO saas_users (id,github_id,login,github_created_at,status,balance_micros,frozen_micros,created_at,updated_at)
          VALUES ('su-1','gh-1','legacy-saas','2020-01-01T00:00:00Z','active',0,0,1,1);
        INSERT INTO saas_group_settings (group_id,multiplier_micros,max_output_tokens,timeout_seconds,max_concurrency,created_at,updated_at)
          VALUES ('claude-default',1000000,4096,120,10,1,1);
        INSERT INTO saas_api_keys (id,user_id,group_id,name,token_hash,prefix,suffix,status,spent_micros,frozen_micros,created_at,updated_at)
          VALUES ('sak-1','su-1','claude-default','legacy','hash-legacy','sk-','dead','active',0,0,1,1);
        "#,
    )
    .await
    .unwrap();
}

/// 迁移中间态：一个池、provider 落列、组已标记、只留一把 key；
/// 组删除与成员迁移由启动收敛（`converge_legacy_pool_groups`）完成。
#[tokio::test]
async fn unified_pool_migration_unifies_identity_and_marks_legacy_groups() {
    let pool = create_memory_pool().await.expect("pool");
    run_migrations_until(&pool, PREVIOUS_MIGRATION).await;
    seed_legacy_pools(&pool).await;
    apply_remaining_migrations(&pool).await;

    // ── 池身份统一 ──
    let platforms: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT platform FROM route_credentials")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(platforms, ["codex"], "all accounts share one pool identity");
    let member_platforms: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT platform FROM route_pool_members")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(member_platforms, ["codex"]);
    let group_platforms: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT platform FROM route_pool_groups")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(group_platforms, ["codex"]);

    // ── provider 回填：official 按厂商，api 按 base_url 预设，其余 custom ──
    let providers: Vec<(String, String)> =
        sqlx::query_as("SELECT id,provider FROM route_credentials ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        providers,
        [
            ("claude-api".to_string(), "custom".to_string()),
            ("claude-official".to_string(), "claude".to_string()),
            ("codex-api".to_string(), "custom".to_string()),
            ("codex-official".to_string(), "openai".to_string()),
            ("gemini-api".to_string(), "custom".to_string()),
            ("kling-api".to_string(), "custom".to_string()),
            ("openrouter-api".to_string(), "openrouter".to_string()),
        ]
    );

    // ── 组标记：codex 视图组非 legacy；迁移链种子的其余平台组标 legacy；组尚未删除 ──
    let legacy_counts: (i64, i64) = sqlx::query_as(
        "SELECT SUM(legacy_group), SUM(1 - legacy_group) FROM route_pool_groups",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(legacy_counts, (18, 3), "7 platforms x 3 views, codex stays");
    let marked: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM route_pool_groups WHERE legacy_group = 1 AND id IN ('claude-default','gemini-default')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(marked, ["claude-default", "gemini-default"]);

    // ── serves_local：默认组与 SaaS 销售分组参与服务；未入池 / 已归档不参与 ──
    let serving: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM route_pool_groups WHERE serves_local = 1 ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(serving.len(), 7, "one serving default group per platform");
    let non_serving: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM route_pool_groups WHERE serves_local = 0 AND id IN ('codex-out','codex-archived') ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(non_serving, ["codex-archived", "codex-out"]);

    // ── 唯一索引放开：默认组与 SaaS 销售组可同时 active ──
    let index_name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_route_pool_groups_one_active'",
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert!(index_name.is_none(), "one-active unique index must be dropped");

    // ── 只留一把 key ──
    let keys: Vec<(String, String)> =
        sqlx::query_as("SELECT platform,proxy_key FROM route_proxy_keys")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(keys, [("codex".to_string(), "sk-codex-main".to_string())]);
    let aliases: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM route_proxy_key_aliases WHERE platform!='codex'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(aliases, 0);

    // ── 游标只剩 codex ──
    let cursors: Vec<String> =
        sqlx::query_scalar("SELECT platform FROM route_pool_cursors")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(cursors, ["codex"]);
}

/// 启动收敛终态：无 SaaS 引用的旧平台组删除、成员并入 codex 同类视图组；
/// SaaS 销售分组与成员无损保留。
#[tokio::test]
async fn legacy_pool_convergence_deletes_unreferenced_groups_and_preserves_saas() {
    let pool = create_memory_pool().await.expect("pool");
    run_migrations_until(&pool, PREVIOUS_MIGRATION).await;
    seed_legacy_pools(&pool).await;
    apply_remaining_migrations(&pool).await;
    crate::database::repositories::route_pool_repository::RoutePoolRepository::converge_legacy_pool_groups(&pool)
        .await
        .expect("convergence");

    let groups: Vec<String> =
        sqlx::query_scalar("SELECT id FROM route_pool_groups ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        groups,
        ["claude-default", "codex-archived", "codex-default", "codex-out"]
    );

    let memberships: Vec<(String, String)> = sqlx::query_as(
        "SELECT route_credential_id,COALESCE(group_id,'') FROM route_pool_members ORDER BY route_credential_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        memberships,
        [
            ("claude-api".to_string(), "claude-default".to_string()),
            ("claude-official".to_string(), "claude-default".to_string()),
            ("codex-api".to_string(), "codex-default".to_string()),
            ("codex-official".to_string(), "codex-default".to_string()),
            ("gemini-api".to_string(), "codex-default".to_string()),
            // kling-api 从未入池：收敛不改变它的游离状态。
            ("kling-api".to_string(), String::new()),
        ]
    );

    // 幂等：二次收敛无操作且不报错。
    crate::database::repositories::route_pool_repository::RoutePoolRepository::converge_legacy_pool_groups(&pool)
        .await
        .expect("idempotent convergence");
    let again: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM route_pool_groups")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(again, 4);

    // ── SaaS 无损：销售组的计费设置与 key 归属原样 ──
    let saas_settings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM saas_group_settings WHERE group_id='claude-default'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(saas_settings, 1);
    let saas_keys: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM saas_api_keys WHERE id='sak-1' AND group_id='claude-default'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(saas_keys, 1);
}

const SAAS_GROUP_REFERENCE_CASES: &[(&str, &str)] = &[
    (
        "saas_api_keys",
        "INSERT INTO saas_api_keys (id,user_id,group_id,name,token_hash,prefix,suffix,created_at,updated_at) \
         VALUES ('preserved-key','su-1',?,'fixture','preserved-hash','sk-','test',1,1)",
    ),
    (
        "saas_group_settings",
        "INSERT INTO saas_group_settings (group_id,multiplier_micros,max_output_tokens,timeout_seconds,max_concurrency,created_at,updated_at) \
         VALUES (?,1234567,8192,180,3,1,1)",
    ),
    (
        "saas_group_models",
        "INSERT INTO saas_group_models (group_id,model,upstream_model,input_price_micros,cache_price_micros,output_price_micros,version) \
         VALUES (?,'fixture-model','fixture-upstream',123,45,678,9)",
    ),
    (
        "saas_group_model_sync",
        "INSERT INTO saas_group_model_sync (group_id,source_fingerprint,last_success_at,last_error,updated_at) \
         VALUES (?,'fixture-fingerprint',123,'preserve sync state',456)",
    ),
    (
        "saas_billing_reservations",
        "INSERT INTO saas_billing_reservations (request_id,user_id,key_id,group_id,platform,model,price_json,reserved_micros,status,created_at,updated_at) \
         VALUES ('preserved-request','su-1','sak-1',?,'claude','fixture-model','{\"price\":123}',12345,'pending_review',1,2)",
    ),
    (
        "saas_usage_hourly",
        "INSERT INTO saas_usage_hourly (user_id,key_id,group_id,model,hour,request_count,input_tokens,output_tokens,cost_micros) \
         VALUES ('su-1','sak-1',?,'fixture-model',123,7,456,89,12345)",
    ),
];

async fn table_snapshot(pool: &sqlx::SqlitePool, table: &str) -> Vec<String> {
    let columns: Vec<String> = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| format!("\"{}\"", row.get::<String, _>("name")))
        .collect();
    sqlx::query_scalar(&format!(
        "SELECT json_array({}) FROM {table} ORDER BY 1",
        columns.join(",")
    ))
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn assert_foreign_keys_valid(pool: &sqlx::SqlitePool) {
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap();
    assert!(violations.is_empty(), "group convergence must preserve foreign keys");
}

async fn assert_reference_preserved(table: &str, insert: &str) {
    use super::repositories::route_pool_repository::RoutePoolRepository;

    let pool = create_memory_pool().await.expect("pool");
    run_migrations_until(&pool, PREVIOUS_MIGRATION).await;
    seed_legacy_pools(&pool).await;
    RoutePoolRepository::migrate_legacy_pool_views(&pool).await.unwrap();
    // The existing fixture protects claude-default with keys/settings. Use a
    // different group so no other table can hide a missing reference check.
    sqlx::query("UPDATE route_pool_members SET group_id='claude-out', enabled=0 WHERE id='m4'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(insert).bind("claude-out").execute(&pool).await.unwrap();
    if table == "saas_billing_reservations" {
        pool.execute(
            "INSERT INTO saas_wallet_ledger (id,user_id,kind,amount_micros,balance_after_micros,source_id,request_id,idempotency_key,actor,created_at) \
             VALUES ('preserved-ledger','su-1','usage',-12345,0,'fixture','preserved-request','fixture-ledger','fixture',1)",
        )
        .await
        .unwrap();
    }
    apply_remaining_migrations(&pool).await;
    let accounts = table_snapshot(&pool, "route_credentials").await;
    let referenced_rows = table_snapshot(&pool, table).await;
    let ledger = table_snapshot(&pool, "saas_wallet_ledger").await;
    let before_members: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), SUM(enabled) FROM route_pool_members",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    // The SQL migration has already committed, matching the failed upgrade's
    // next startup. Both calls use the real production migration entry point.
    for _ in 0..2 {
        super::run_migrations(&pool).await.unwrap_or_else(|error| {
            panic!("convergence must preserve a group referenced only by {table}: {error:?}")
        });
        assert_eq!(table_snapshot(&pool, "route_credentials").await, accounts);
        assert_eq!(table_snapshot(&pool, table).await, referenced_rows);
        assert_eq!(table_snapshot(&pool, "saas_wallet_ledger").await, ledger);
        let group: (i64, i64) = sqlx::query_as(
            "SELECT legacy_group, serves_local FROM route_pool_groups WHERE id='claude-out'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(group, (0, 0));
        let membership: (String, i64) = sqlx::query_as(
            "SELECT group_id, enabled FROM route_pool_members WHERE id='m4'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(membership, ("claude-out".to_string(), 0));
        let after_members: (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), SUM(enabled) FROM route_pool_members",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(after_members, before_members);
        assert_foreign_keys_valid(&pool).await;
    }
}

#[tokio::test]
async fn legacy_pool_convergence_preserves_api_key_only_group() {
    let (table, insert) = SAAS_GROUP_REFERENCE_CASES[0];
    assert_reference_preserved(table, insert).await;
}

#[tokio::test]
async fn legacy_pool_convergence_preserves_settings_only_group() {
    let (table, insert) = SAAS_GROUP_REFERENCE_CASES[1];
    assert_reference_preserved(table, insert).await;
}

#[tokio::test]
async fn legacy_pool_convergence_preserves_models_only_group() {
    let (table, insert) = SAAS_GROUP_REFERENCE_CASES[2];
    assert_reference_preserved(table, insert).await;
}

#[tokio::test]
async fn legacy_pool_convergence_preserves_model_sync_only_group() {
    let (table, insert) = SAAS_GROUP_REFERENCE_CASES[3];
    assert_reference_preserved(table, insert).await;
}

#[tokio::test]
async fn legacy_pool_convergence_preserves_reservations_only_group() {
    let (table, insert) = SAAS_GROUP_REFERENCE_CASES[4];
    assert_reference_preserved(table, insert).await;
}

#[tokio::test]
async fn legacy_pool_convergence_preserves_usage_only_group() {
    let (table, insert) = SAAS_GROUP_REFERENCE_CASES[5];
    assert_reference_preserved(table, insert).await;
}

// Reuse the real CREATE TABLE statements without installing the rest of the
// independent SaaS schema. A partially initialized schema must be safe too.
async fn create_saas_table(pool: &sqlx::SqlitePool, table: &str) {
    let source = if table == "saas_group_model_sync" {
        include_str!("../saas/migrations/0006_claude_model_sync.sql")
    } else {
        include_str!("../saas/migrations/0001_saas.sql")
    };
    let start = source.find(&format!("CREATE TABLE {table} (")).unwrap();
    let statement = &source[start..];
    let end = statement.find(");").unwrap() + 2;
    sqlx::raw_sql(&statement[..end]).execute(pool).await.unwrap();
}

#[tokio::test]
async fn legacy_pool_convergence_supports_partial_saas_schema() {
    use super::repositories::route_pool_repository::RoutePoolRepository;

    for &(table, insert) in SAAS_GROUP_REFERENCE_CASES {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations_until(&pool, PREVIOUS_MIGRATION).await;
        pool.execute(
            "INSERT INTO route_credentials (id,platform,kind,display_name,status,secret_payload_json,config_json,archived_at,created_at,updated_at) \
             VALUES ('archived-account','claude','api','fixture','ok','{}','{}','2026-01-01','2026-01-01','2026-01-01'); \
             INSERT INTO route_pool_members (id,platform,route_credential_id,enabled,group_id,created_at,updated_at) \
             VALUES ('archived-member','claude','archived-account',0,'claude-archived','2026-01-01','2026-01-01')",
        )
        .await
        .unwrap();
        if matches!(table, "saas_api_keys" | "saas_billing_reservations" | "saas_usage_hourly") {
            create_saas_table(&pool, "saas_users").await;
            pool.execute(
                "INSERT INTO saas_users (id,github_id,login,github_created_at,created_at,updated_at) \
                 VALUES ('su-1','fixture','fixture','2020-01-01',1,1)",
            )
            .await
            .unwrap();
        }
        if matches!(table, "saas_billing_reservations" | "saas_usage_hourly") {
            create_saas_table(&pool, "saas_api_keys").await;
            pool.execute(
                "INSERT INTO saas_api_keys (id,user_id,group_id,name,token_hash,prefix,suffix,created_at,updated_at) \
                 VALUES ('sak-1','su-1','codex-default','fixture','fixture-hash','sk-','test',1,1)",
            )
            .await
            .unwrap();
        }
        create_saas_table(&pool, table).await;
        sqlx::query(insert).bind("claude-archived").execute(&pool).await.unwrap();
        apply_remaining_migrations(&pool).await;
        let rows = table_snapshot(&pool, table).await;
        for _ in 0..2 {
            RoutePoolRepository::converge_legacy_pool_groups(&pool)
                .await
                .unwrap_or_else(|error| panic!("partial {table} schema: {error:?}"));
            let groups: Vec<String> = sqlx::query_scalar(
                "SELECT id FROM route_pool_groups ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(groups, ["claude-archived", "codex-archived", "codex-default", "codex-out"]);
            let membership: (String, i64) = sqlx::query_as(
                "SELECT group_id, enabled FROM route_pool_members WHERE id='archived-member'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(membership, ("claude-archived".to_string(), 0));
            assert_eq!(table_snapshot(&pool, table).await, rows);
            assert_foreign_keys_valid(&pool).await;
        }
    }
}

#[tokio::test]
async fn legacy_pool_convergence_without_saas_references_removes_old_groups() {
    use super::repositories::route_pool_repository::RoutePoolRepository;

    for with_saas_schema in [false, true] {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations_until(&pool, PREVIOUS_MIGRATION).await;
        if with_saas_schema {
            crate::saas::repository::migrate(&pool).await.unwrap();
        }
        pool.execute(
            "INSERT INTO route_credentials (id,platform,kind,display_name,status,secret_payload_json,config_json,archived_at,created_at,updated_at) \
             VALUES ('out-account','claude','api','fixture-out','ok','{}','{}',NULL,'2026-01-01','2026-01-01'), \
                    ('archived-account','claude','api','fixture-archived','ok','{}','{}','2026-01-01','2026-01-01','2026-01-01'); \
             INSERT INTO route_pool_members (id,platform,route_credential_id,enabled,group_id,created_at,updated_at) \
             VALUES ('out-member','claude','out-account',0,'claude-out','2026-01-01','2026-01-01'), \
                    ('archived-member','claude','archived-account',0,'claude-archived','2026-01-01','2026-01-01')",
        )
        .await
        .unwrap();
        apply_remaining_migrations(&pool).await;
        for _ in 0..2 {
            RoutePoolRepository::converge_legacy_pool_groups(&pool).await.unwrap();
            let groups: Vec<String> = sqlx::query_scalar(
                "SELECT id FROM route_pool_groups ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(groups, ["codex-archived", "codex-default", "codex-out"]);
            let memberships: Vec<(String, String, i64)> = sqlx::query_as(
                "SELECT id, group_id, enabled FROM route_pool_members ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                memberships,
                [
                    ("archived-member".to_string(), "codex-archived".to_string(), 0),
                    ("out-member".to_string(), "codex-out".to_string(), 0),
                ],
            );
            assert_foreign_keys_valid(&pool).await;
        }
    }
}

#[tokio::test]
async fn upgrade_from_v0171_preserves_model_sync_without_saas_configuration() {
    use super::repositories::route_pool_repository::RoutePoolRepository;

    let pool = create_memory_pool().await.expect("pool");
    run_migrations_until(&pool, 202610060001).await;
    seed_legacy_pools(&pool).await;
    // v0.17.1 has already performed the old Rust membership migration.
    RoutePoolRepository::migrate_legacy_pool_views(&pool).await.unwrap();
    sqlx::query(SAAS_GROUP_REFERENCE_CASES[3].1)
        .bind("claude-archived")
        .execute(&pool)
        .await
        .unwrap();
    let credentials: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, secret_payload_json, config_json FROM route_credentials ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let sync = table_snapshot(&pool, "saas_group_model_sync").await;
    for _ in 0..2 {
        super::run_migrations(&pool).await.expect("upgrade must succeed");
        let after: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT id, secret_payload_json, config_json FROM route_credentials ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(after, credentials);
        assert_eq!(table_snapshot(&pool, "saas_group_model_sync").await, sync);
        assert_foreign_keys_valid(&pool).await;
    }
}

fn validate_isolated_upgrade_copy(database: &std::path::Path) {
    let resolved = database.canonicalize().expect("existing temporary copy");
    let temporary_root = std::env::temp_dir().canonicalize().unwrap();
    let resolved_parent = resolved.parent().expect("temporary directory");
    assert_eq!(resolved.file_name().unwrap(), "upgrade-copy.db");
    assert_eq!(resolved_parent.parent().unwrap(), temporary_root);
    assert!(resolved_parent.file_name().unwrap().to_string_lossy().starts_with("ai-switch-upgrade-fix-"));
    assert_eq!(
        database.parent().unwrap().canonicalize().unwrap(),
        resolved_parent,
        "diagnostic backups must stay in the validated temporary copy directory",
    );
}

/// A file alias outside the validated directory must not redirect diagnostic
/// backups outside the temporary fixture, even if its target is a valid copy.
#[cfg(any(unix, windows))]
#[test]
fn isolated_upgrade_copy_rejects_external_file_aliases() {
    let allowed = tempfile::Builder::new()
        .prefix("ai-switch-upgrade-fix-")
        .tempdir()
        .unwrap();
    let copy = allowed.path().join("upgrade-copy.db");
    std::fs::write(&copy, b"fixture").unwrap();
    validate_isolated_upgrade_copy(&copy);
    let outside = tempfile::tempdir().unwrap();
    let alias = outside.path().join("upgrade-copy.db");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&copy, &alias).unwrap();
    #[cfg(windows)]
    if let Err(error) = std::os::windows::fs::symlink_file(&copy, &alias) {
        if error.raw_os_error() == Some(1314) {
            eprintln!("Skipping file-alias case: Windows symlink privilege is unavailable");
            return;
        }
        panic!("could not create diagnostic file alias: {error}");
    }
    assert!(
        std::panic::catch_unwind(|| validate_isolated_upgrade_copy(&alias)).is_err(),
        "an alias outside the validated copy directory must be rejected",
    );
}

/// Diagnostic verification only: the path must be a new temporary SQLite
/// backup, never the installed application's live database or a backup in it.
#[tokio::test]
#[ignore = "requires AI_SWITCH_UPGRADE_TEST_DB pointing to an isolated temporary database copy"]
async fn isolated_upgrade_database_copy_reopens_without_data_loss() {
    use sha2::{Digest, Sha256};

    let database = std::path::PathBuf::from(
        std::env::var_os("AI_SWITCH_UPGRADE_TEST_DB").expect("explicit temporary database copy"),
    );
    validate_isolated_upgrade_copy(&database);
    // Windows canonicalization adds the extended \\?\ path prefix. Validate with
    // that resolved path, but keep the ordinary path for the SQLite URL parser.
    let parent = database.parent().expect("temporary directory");

    let tables = [
        "route_credentials",
        "saas_users",
        "saas_api_keys",
        "saas_group_settings",
        "saas_group_models",
        "saas_group_model_sync",
        "saas_billing_reservations",
        "saas_usage_hourly",
        "saas_wallet_ledger",
        "saas_recharge_orders",
    ];
    let before_pool = super::create_pool(&database).await.unwrap();
    let mut before = Vec::new();
    for table in tables {
        let rows = table_snapshot(&before_pool, table).await;
        let digest = Sha256::digest(serde_json::to_vec(&rows).unwrap()).to_vec();
        before.push((table, rows.len(), digest));
    }
    let before_members: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT id, route_credential_id, enabled FROM route_pool_members ORDER BY id",
    )
    .fetch_all(&before_pool)
    .await
    .unwrap();
    let before_protected_members: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, group_id FROM route_pool_members WHERE group_id IN \
         (SELECT group_id FROM saas_api_keys UNION SELECT group_id FROM saas_group_settings \
          UNION SELECT group_id FROM saas_group_models UNION SELECT group_id FROM saas_group_model_sync \
          UNION SELECT group_id FROM saas_billing_reservations UNION SELECT group_id FROM saas_usage_hourly) \
         ORDER BY id",
    )
    .fetch_all(&before_pool)
    .await
    .unwrap();
    let before_groups: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM route_pool_groups WHERE id IN \
         (SELECT group_id FROM saas_api_keys UNION SELECT group_id FROM saas_group_settings \
          UNION SELECT group_id FROM saas_group_models UNION SELECT group_id FROM saas_group_model_sync \
          UNION SELECT group_id FROM saas_billing_reservations UNION SELECT group_id FROM saas_usage_hourly) \
         ORDER BY id",
    )
    .fetch_all(&before_pool)
    .await
    .unwrap();
    before_pool.close().await;

    for _ in 0..2 {
        let pool = super::open_migrated_pool(&database, &parent.join("backups"))
            .await
            .expect("isolated upgrade must complete");
        for (table, count, digest) in &before {
            let rows = table_snapshot(&pool, table).await;
            assert_eq!(rows.len(), *count, "row count changed in {table}");
            assert_eq!(
                Sha256::digest(serde_json::to_vec(&rows).unwrap()).as_slice(),
                digest.as_slice(),
                "contents changed in {table}",
            );
        }
        let members: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT id, route_credential_id, enabled FROM route_pool_members ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(members, before_members);
        let protected_members: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, group_id FROM route_pool_members WHERE group_id IN \
             (SELECT group_id FROM saas_api_keys UNION SELECT group_id FROM saas_group_settings \
              UNION SELECT group_id FROM saas_group_models UNION SELECT group_id FROM saas_group_model_sync \
              UNION SELECT group_id FROM saas_billing_reservations UNION SELECT group_id FROM saas_usage_hourly) \
             ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(protected_members, before_protected_members);
        let protected_groups: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM route_pool_groups WHERE id IN \
             (SELECT group_id FROM saas_api_keys UNION SELECT group_id FROM saas_group_settings \
              UNION SELECT group_id FROM saas_group_models UNION SELECT group_id FROM saas_group_model_sync \
              UNION SELECT group_id FROM saas_billing_reservations UNION SELECT group_id FROM saas_usage_hourly) \
             ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(protected_groups, before_groups);
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM route_pool_groups WHERE legacy_group=1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pending, 0);
        assert_foreign_keys_valid(&pool).await;
        pool.close().await;
    }
    println!("Verified both isolated database opens; preserved {} accounts and all model, sync, key and billing rows.", before[0].1);
}
