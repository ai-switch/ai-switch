use crate::error::AppError;
use crate::saas::domain::groups::GroupModel;
use crate::saas::repository::{self, db_error, invalid};
use crate::services::route_model_capability::{
    catalog_members, client_facing_model_catalog_entries, CatalogMemberInput,
};
use crate::services::route_pool_model_mode::PoolModelMode;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaasModelSyncResult {
    pub changed: bool,
    pub source_fingerprint: String,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub models: Vec<Value>,
}

#[derive(Debug, Clone, FromRow)]
struct SourceMember {
    id: String,
    platform: String,
    kind: String,
    display_name: String,
    config_json: String,
    status: String,
    archived_at: Option<String>,
    member_enabled: bool,
}

#[derive(Debug, Clone, FromRow)]
struct ExistingModel {
    model: String,
    upstream_model: String,
    input_price_micros: i64,
    cache_price_micros: i64,
    output_price_micros: i64,
    image_price_micros: i64,
    version: i64,
    enabled: bool,
    sync_state: String,
    managed_by_pool: bool,
    last_seen_at: Option<i64>,
    updated_at: i64,
}

#[derive(Debug, Clone, FromRow)]
struct SyncState {
    source_fingerprint: String,
    last_success_at: Option<i64>,
    last_error: Option<String>,
}

#[derive(Debug, Clone)]
struct DesiredModel {
    model: String,
}

/// Reconcile one Claude SaaS group inside an existing transaction.
///
/// The operation only manages Claude groups. Other SaaS platforms return a
/// stable no-op result so callers can safely use the same hook for all groups.
pub(crate) async fn reconcile_group_connection(
    connection: &mut SqliteConnection,
    group_id: &str,
) -> Result<SaasModelSyncResult, AppError> {
    let group: Option<(String, bool)> = sqlx::query_as(
        "SELECT platform,is_internal FROM route_pool_groups
         WHERE id=? AND deleted_at IS NULL AND platform IN ('codex','claude','gemini')",
    )
    .bind(group_id)
    .fetch_optional(&mut *connection)
    .await
    .map_err(db_error)?;
    let Some((platform, _is_internal)) = group else {
        return Err(invalid("saas.group_not_found", "Core group is unavailable"));
    };

    let (members, mode) = source_members(connection, group_id, &platform).await?;
    let source_fingerprint = fingerprint(&members, mode);
    let previous: Option<SyncState> = sqlx::query_as(
        "SELECT source_fingerprint,last_success_at,last_error
         FROM saas_group_model_sync WHERE group_id=?",
    )
    .bind(group_id)
    .fetch_optional(&mut *connection)
    .await
    .map_err(db_error)?;

    if platform != "claude" {
        return result_from_connection(
            connection,
            group_id,
            false,
            source_fingerprint,
            previous.as_ref().and_then(|state| state.last_success_at),
            previous.and_then(|state| state.last_error),
        )
        .await;
    }

    if let Some(state) = &previous {
        if state.source_fingerprint == source_fingerprint && state.last_error.is_none() {
            return result_from_connection(
                connection,
                group_id,
                false,
                source_fingerprint,
                state.last_success_at,
                None,
            )
            .await;
        }
    }

    let desired = desired_models(&members);
    let existing: Vec<ExistingModel> = sqlx::query_as(
        "SELECT model,upstream_model,input_price_micros,cache_price_micros,
                output_price_micros,image_price_micros,version,enabled,sync_state,
                managed_by_pool,last_seen_at,updated_at
         FROM saas_group_models WHERE group_id=? ORDER BY model",
    )
    .bind(group_id)
    .fetch_all(&mut *connection)
    .await
    .map_err(db_error)?;

    let now = repository::now();
    let mut changed = false;
    let mut used_rows = BTreeMap::<String, bool>::new();

    for desired_model in &desired {
        let exact = existing.iter().find(|row| row.model == desired_model.model);
        let upstream_match = existing
            .iter()
            .filter(|row| row.upstream_model == desired_model.model)
            .max_by_key(|row| (row.version, row.updated_at));
        let source = exact.or(upstream_match);

        if let Some(source) = source {
            used_rows.insert(source.model.clone(), true);
            if source.model != desired_model.model {
                upsert_migrated_model(connection, group_id, source, &desired_model.model, now)
                    .await?;
                changed = true;
                used_rows.insert(desired_model.model.clone(), true);
                if source.sync_state != "stale" || source.managed_by_pool {
                    mark_stale(connection, group_id, &source.model, now).await?;
                }
                continue;
            }

            let next_state = match source.sync_state.as_str() {
                "stale" => "active",
                // A newly discovered model remains pending until an administrator
                // explicitly prices/enables it.
                "pending_pricing" => "pending_pricing",
                _ => "active",
            };
            if source.upstream_model != desired_model.model
                || source.sync_state != next_state
                || !source.managed_by_pool
                || source.last_seen_at != Some(now)
            {
                sqlx::query(
                    "UPDATE saas_group_models
                     SET upstream_model=?,sync_state=?,managed_by_pool=1,
                         last_seen_at=?,updated_at=?
                     WHERE group_id=? AND model=?",
                )
                .bind(&desired_model.model)
                .bind(next_state)
                .bind(now)
                .bind(now)
                .bind(group_id)
                .bind(&source.model)
                .execute(&mut *connection)
                .await
                .map_err(db_error)?;
                changed = true;
            }
        } else {
            sqlx::query(
                "INSERT INTO saas_group_models
                   (group_id,model,upstream_model,input_price_micros,cache_price_micros,
                    output_price_micros,image_price_micros,version,enabled,sync_state,
                    managed_by_pool,last_seen_at,updated_at)
                 VALUES(?,?,?,0,0,0,0,1,0,'pending_pricing',1,?,?)",
            )
            .bind(group_id)
            .bind(&desired_model.model)
            .bind(&desired_model.model)
            .bind(now)
            .bind(now)
            .execute(&mut *connection)
            .await
            .map_err(db_error)?;
            changed = true;
            used_rows.insert(desired_model.model.clone(), true);
        }
    }

    // Old managed rows are retained for price recovery but hidden from users.
    for row in &existing {
        if row.managed_by_pool && !used_rows.contains_key(&row.model) {
            if row.sync_state != "stale" || row.last_seen_at.is_some() {
                mark_stale(connection, group_id, &row.model, now).await?;
                changed = true;
            }
        }
    }

    let last_success_at = now;
    sqlx::query(
        "INSERT INTO saas_group_model_sync
           (group_id,source_fingerprint,last_success_at,last_error,updated_at)
         VALUES(?,?,?,NULL,?)
         ON CONFLICT(group_id) DO UPDATE SET
           source_fingerprint=excluded.source_fingerprint,
           last_success_at=excluded.last_success_at,
           last_error=NULL,
           updated_at=excluded.updated_at",
    )
    .bind(group_id)
    .bind(&source_fingerprint)
    .bind(last_success_at)
    .bind(now)
    .execute(&mut *connection)
    .await
    .map_err(db_error)?;

    result_from_connection(
        connection,
        group_id,
        changed,
        source_fingerprint,
        Some(last_success_at),
        None,
    )
    .await
}

/// Synchronize a group in its own transaction and return the current catalog
/// rows. The transaction boundary keeps pool changes independent from SaaS
/// metadata changes while making a single sync internally atomic.
pub async fn sync_group(pool: &SqlitePool, group_id: &str) -> Result<Value, AppError> {
    let mut transaction = repository::begin(pool).await?;
    let result = match reconcile_group_connection(&mut *transaction, group_id).await {
        Ok(result) => result,
        Err(error) => {
            transaction.rollback().await.map_err(db_error)?;
            record_sync_error(pool, group_id, &error).await;
            return Err(error);
        }
    };
    transaction.commit().await.map_err(db_error)?;
    serde_json::to_value(result)
        .map_err(|_| invalid("saas.serialization", "Could not encode model sync result"))
}

/// Ensure the persisted catalog reflects the current pool. The fingerprint
/// short-circuit makes this cheap on read and billing paths.
pub async fn ensure_group_current(pool: &SqlitePool, group_id: &str) -> Result<(), AppError> {
    let _ = sync_group(pool, group_id).await?;
    Ok(())
}

/// Best-effort refresh of every Claude SaaS group bound to `platform`.
///
/// Called after a route-pool mutation has committed. Only Claude groups are
/// managed by the pool; other platforms return success without touching any
/// hand-configured model rows. Errors are returned so callers can log them, but
/// callers must not fail the primary operation because of a sync problem.
pub async fn best_effort_sync_platform(pool: &SqlitePool, platform: &str) -> Result<(), AppError> {
    if platform != "claude" {
        return Ok(());
    }
    let group_ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM route_pool_groups
         WHERE platform='claude' AND deleted_at IS NULL
         ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    for group_id in group_ids {
        if let Err(error) = sync_group(pool, &group_id).await {
            return Err(error);
        }
    }
    Ok(())
}

async fn source_members(
    connection: &mut SqliteConnection,
    group_id: &str,
    platform: &str,
) -> Result<(Vec<SourceMember>, PoolModelMode), AppError> {
    let members: Vec<SourceMember> = sqlx::query_as(
        "SELECT rc.id,rc.platform,rc.kind,rc.display_name,rc.config_json,rc.status,
                rc.archived_at,pm.enabled AS member_enabled
         FROM route_pool_members pm
         JOIN route_credentials rc ON rc.id=pm.route_credential_id
         WHERE pm.group_id=? AND rc.platform=?
         ORDER BY rc.id",
    )
    .bind(group_id)
    .bind(platform)
    .fetch_all(&mut *connection)
    .await
    .map_err(db_error)?;
    let mode =
        sqlx::query_scalar::<_, String>("SELECT mode FROM route_pool_model_modes WHERE platform=?")
            .bind(platform)
            .fetch_optional(&mut *connection)
            .await
            .map_err(db_error)?
            .map(|value| PoolModelMode::parse(&value))
            .unwrap_or_default();
    Ok((members, mode))
}

fn fingerprint(members: &[SourceMember], mode: PoolModelMode) -> String {
    let payload: Vec<Value> = members
        .iter()
        .map(|member| {
            json!({
                "id": member.id,
                "platform": member.platform,
                "kind": member.kind,
                "displayName": member.display_name,
                "configJson": member.config_json,
                "status": member.status,
                "archivedAt": member.archived_at,
                "memberEnabled": member.member_enabled,
                "mode": mode.as_str(),
            })
        })
        .collect();
    let canonical = serde_json::to_vec(&payload).unwrap_or_default();
    format!("{:x}", Sha256::digest(canonical))
}

fn desired_models(members: &[SourceMember]) -> Vec<DesiredModel> {
    let active_inputs: Vec<CatalogMemberInput<'_>> = members
        .iter()
        .filter(|member| {
            member.member_enabled && member.status == "ok" && member.archived_at.is_none()
        })
        .map(|member| CatalogMemberInput {
            id: &member.id,
            display_name: &member.display_name,
            kind: &member.kind,
            config_json: &member.config_json,
        })
        .collect();
    let catalog_members = catalog_members(&active_inputs);
    let entries =
        client_facing_model_catalog_entries("claude", &catalog_members, PoolModelMode::Aggregate);
    let mut models = entries
        .into_iter()
        .map(|entry| DesiredModel { model: entry.id })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.model.cmp(&right.model));
    models.dedup_by(|left, right| left.model == right.model);
    models
}

async fn upsert_migrated_model(
    connection: &mut SqliteConnection,
    group_id: &str,
    source: &ExistingModel,
    target: &str,
    now: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO saas_group_models
           (group_id,model,upstream_model,input_price_micros,cache_price_micros,
            output_price_micros,image_price_micros,version,enabled,sync_state,
            managed_by_pool,last_seen_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,'active',1,?,?)
         ON CONFLICT(group_id,model) DO UPDATE SET
           upstream_model=excluded.upstream_model,
           input_price_micros=excluded.input_price_micros,
           cache_price_micros=excluded.cache_price_micros,
           output_price_micros=excluded.output_price_micros,
           image_price_micros=excluded.image_price_micros,
           version=excluded.version,
           enabled=excluded.enabled,
           sync_state=excluded.sync_state,
           managed_by_pool=excluded.managed_by_pool,
           last_seen_at=excluded.last_seen_at,
           updated_at=excluded.updated_at",
    )
    .bind(group_id)
    .bind(target)
    .bind(target)
    .bind(source.input_price_micros)
    .bind(source.cache_price_micros)
    .bind(source.output_price_micros)
    .bind(source.image_price_micros)
    .bind(source.version)
    .bind(source.enabled)
    .bind(now)
    .bind(now)
    .execute(&mut *connection)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn mark_stale(
    connection: &mut SqliteConnection,
    group_id: &str,
    model: &str,
    now: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE saas_group_models
         SET sync_state='stale',managed_by_pool=1,last_seen_at=NULL,updated_at=?
         WHERE group_id=? AND model=?",
    )
    .bind(now)
    .bind(group_id)
    .bind(model)
    .execute(&mut *connection)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn result_from_connection(
    connection: &mut SqliteConnection,
    group_id: &str,
    changed: bool,
    source_fingerprint: String,
    last_success_at: Option<i64>,
    last_error: Option<String>,
) -> Result<SaasModelSyncResult, AppError> {
    let rows: Vec<GroupModel> = sqlx::query_as(
        "SELECT model,upstream_model,input_price_micros,cache_price_micros,
                output_price_micros,image_price_micros,enabled,sync_state,
                managed_by_pool,last_seen_at,updated_at
         FROM saas_group_models WHERE group_id=? ORDER BY model",
    )
    .bind(group_id)
    .fetch_all(&mut *connection)
    .await
    .map_err(db_error)?;
    let models = rows
        .into_iter()
        .map(|row| {
            serde_json::to_value(row)
                .map_err(|_| invalid("saas.serialization", "Could not encode model row"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SaasModelSyncResult {
        changed,
        source_fingerprint,
        last_success_at: last_success_at.map(repository::timestamp),
        last_error,
        models,
    })
}

async fn record_sync_error(pool: &SqlitePool, group_id: &str, error: &AppError) {
    let _ = sqlx::query(
        "INSERT INTO saas_group_model_sync
           (group_id,source_fingerprint,last_success_at,last_error,updated_at)
         VALUES(?,COALESCE((SELECT source_fingerprint FROM saas_group_model_sync WHERE group_id=?),''),
                (SELECT last_success_at FROM saas_group_model_sync WHERE group_id=?),?,?)
         ON CONFLICT(group_id) DO UPDATE SET last_error=excluded.last_error,updated_at=excluded.updated_at",
    )
    .bind(group_id)
    .bind(group_id)
    .bind(group_id)
    .bind(error.to_string())
    .bind(repository::now())
    .execute(pool)
    .await;
}

#[cfg(test)]
mod tests {
    use crate::saas::repository;

    #[tokio::test]
    async fn claude_sync_deduplicates_to_and_starts_new_models_as_pending() {
        let pool = repository::test_pool().await;
        repository::insert_claude_sync_fixture(&pool).await;

        let result = super::sync_group(&pool, "claude-saas").await.expect("sync");

        assert_eq!(result["changed"], true);
        assert_eq!(result["models"].as_array().map(Vec::len), Some(1));
        assert_eq!(result["models"][0]["model"], "provider-sonnet");
        assert_eq!(result["models"][0]["upstreamModel"], "provider-sonnet");
        assert_eq!(result["models"][0]["syncState"], "pending_pricing");
        assert_eq!(result["models"][0]["enabled"], false);
        assert_eq!(result["models"][0]["managedByPool"], true);

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM saas_group_models WHERE group_id='claude-saas'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn claude_sync_preserves_price_and_reactivates_a_returning_to() {
        let pool = repository::test_pool().await;
        repository::insert_claude_sync_fixture(&pool).await;
        super::sync_group(&pool, "claude-saas")
            .await
            .expect("initial sync");

        sqlx::query(
            "UPDATE saas_group_models
             SET input_price_micros=11,cache_price_micros=22,output_price_micros=33,
                 image_price_micros=44,enabled=1,sync_state='active',updated_at=101
             WHERE group_id='claude-saas' AND model='provider-sonnet'",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE route_pool_members SET enabled=0 WHERE group_id='claude-saas'")
            .execute(&pool)
            .await
            .unwrap();

        super::sync_group(&pool, "claude-saas")
            .await
            .expect("mark stale");
        let stale: (i64, i64, i64, i64, bool, String) = sqlx::query_as(
            "SELECT input_price_micros,cache_price_micros,output_price_micros,
                    image_price_micros,enabled,sync_state
             FROM saas_group_models
             WHERE group_id='claude-saas' AND model='provider-sonnet'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stale, (11, 22, 33, 44, true, "stale".to_string()));

        sqlx::query(
            "UPDATE route_pool_members
             SET enabled=1
             WHERE group_id='claude-saas' AND route_credential_id='claude-sync-sonnet'",
        )
        .execute(&pool)
        .await
        .unwrap();
        super::sync_group(&pool, "claude-saas")
            .await
            .expect("restore");

        let restored: (i64, i64, i64, i64, bool, String) = sqlx::query_as(
            "SELECT input_price_micros,cache_price_micros,output_price_micros,
                    image_price_micros,enabled,sync_state
             FROM saas_group_models
             WHERE group_id='claude-saas' AND model='provider-sonnet'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(restored, (11, 22, 33, 44, true, "active".to_string()));
    }

    #[tokio::test]
    async fn claude_sync_migrates_alias_pricing_and_is_idempotent() {
        let pool = repository::test_pool().await;
        repository::insert_claude_sync_fixture(&pool).await;
        sqlx::query(
            "INSERT INTO saas_group_models
               (group_id,model,upstream_model,input_price_micros,cache_price_micros,
                output_price_micros,image_price_micros,version,enabled,sync_state,
                managed_by_pool,last_seen_at,updated_at)
             VALUES('claude-saas','claude-sonnet-alias','provider-sonnet',101,202,303,404,
                    7,1,'active',0,NULL,99)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let first = super::sync_group(&pool, "claude-saas")
            .await
            .expect("normalize alias");
        assert_eq!(first["changed"], true);

        let normalized: (String, i64, i64, i64, i64, i64, bool, String, bool) = sqlx::query_as(
            "SELECT upstream_model,input_price_micros,cache_price_micros,
                        output_price_micros,image_price_micros,version,enabled,sync_state,
                        managed_by_pool
                 FROM saas_group_models
                 WHERE group_id='claude-saas' AND model='provider-sonnet'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            normalized,
            (
                "provider-sonnet".to_string(),
                101,
                202,
                303,
                404,
                7,
                true,
                "active".to_string(),
                true,
            )
        );
        let alias_state: (String, bool) = sqlx::query_as(
            "SELECT sync_state,managed_by_pool FROM saas_group_models
             WHERE group_id='claude-saas' AND model='claude-sonnet-alias'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(alias_state, ("stale".to_string(), true));

        let second = super::sync_group(&pool, "claude-saas")
            .await
            .expect("repeat sync");
        assert_eq!(second["changed"], false);
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM saas_group_models WHERE group_id='claude-saas'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 2);
    }
}
