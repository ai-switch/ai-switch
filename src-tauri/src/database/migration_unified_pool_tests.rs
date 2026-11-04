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
