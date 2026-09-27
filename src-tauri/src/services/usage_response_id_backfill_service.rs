//! One-time, resumable backfill of `usage_events.upstream_response_id`.
//!
//! The upstream response id is the join key between a proxied request and the
//! local CLI transcript entry for the same request. Since migration
//! `202609020003` the proxy writes it to its own column at request time, but
//! rows written before that only ever carried it *inside* the stored response
//! preview (`metadata_json.response_body` / `response_body_br`). The overview
//! reader still recovers those by decoding the preview on the fly
//! ([`crate::services::usage_overview_service::resolve_proxy_response_id`]).
//!
//! That fallback is exactly what the cache-cleanup feature is about to remove:
//! once the previews are deleted to reclaim space, a legacy row's id would be
//! gone for good. This pass lifts the id out of the preview and into the column
//! first, so cleanup can drop the preview without losing the join.
//!
//! ## Why this is safe to interrupt
//!
//! * **Idempotent.** The batch query only selects rows whose column is still
//!   NULL, so stopping and restarting simply resumes.
//! * **Additive.** It only ever fills a NULL column; it never rewrites
//!   `metadata_json` and never touches a row that already has an id.
//! * **Bounded per batch.** Work happens in batches, each in its own
//!   transaction, yielding between them, so it can never hold the database or a
//!   runtime worker for the length of the whole table.
//!
//! ## Why a service rather than a `.sql` migration
//!
//! Extracting the id needs brotli (to decode `response_body_br`) and an
//! SSE/JSON parser. SQLite has neither, so a migration could not express the
//! transform and would leave the work to the startup path anyway.

use crate::services::brotli_codec;
use crate::services::route_proxy_service::{
    ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY, ROUTE_PROXY_RESPONSE_BODY_KEY,
};
use crate::services::upstream_response_id::extract_upstream_response_id;
use sqlx::{Row, SqlitePool};

/// Rows per transaction. Matches the compaction pass: large enough that the
/// per-batch overhead disappears next to the decode work, small enough that an
/// interrupted run loses almost nothing and a batch never holds the write lock
/// for long.
const BATCH_SIZE: i64 = 200;

/// How long to wait before starting. Startup is already busy and this competes
/// for the same database; the delay costs nothing when there is nothing to
/// backfill and keeps the pass off the critical path when there is.
const START_DELAY: std::time::Duration = std::time::Duration::from_secs(10);

/// Outcome of one backfill run.
pub struct BackfillSummary {
    /// Rows whose id was recovered from the preview and written to the column.
    pub filled: usize,
    /// Rows examined whose preview held no recoverable id.
    pub skipped: usize,
}

/// Fill `upstream_response_id` for every legacy row that still has it only in
/// its stored preview.
///
/// Returns a summary; a failure on one batch is logged by the caller and ends
/// the run rather than propagating, since a partially backfilled database is
/// fully readable and the next startup picks up where this one stopped.
pub async fn backfill_upstream_response_ids(
    pool: &SqlitePool,
) -> Result<BackfillSummary, sqlx::Error> {
    let mut summary = BackfillSummary {
        filled: 0,
        skipped: 0,
    };

    loop {
        let batch = next_batch(pool).await?;
        if batch.is_empty() {
            break;
        }

        let mut updates: Vec<(String, String)> = Vec::new();
        for (id, metadata_json) in &batch {
            match recover_response_id(metadata_json) {
                Some(response_id) => updates.push((id.clone(), response_id)),
                None => summary.skipped += 1,
            }
        }

        if updates.is_empty() {
            // Nothing in this batch was recoverable. The batch query already
            // excludes filled rows, so this only repeats over rows that can
            // never succeed — bounding it here keeps them from spinning the
            // task forever.
            break;
        }

        let mut transaction = pool.begin().await?;
        for (id, response_id) in &updates {
            sqlx::query("UPDATE usage_events SET upstream_response_id = ? WHERE id = ?")
                .bind(response_id)
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        summary.filled += updates.len();

        // Yield between batches: this shares a runtime with the proxy.
        tokio::task::yield_now().await;

        if batch.len() < BATCH_SIZE as usize {
            break;
        }
    }

    Ok(summary)
}

/// The request rows whose id column is still empty but whose preview might hold
/// one, oldest first.
///
/// `metric_type = 'request'` because only request rows ever carry a response
/// body. The `LIKE` narrows to rows that mention a preview key at all; the
/// per-row decode in [`recover_response_id`] decides what actually happens.
async fn next_batch(pool: &SqlitePool) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, metadata_json FROM usage_events \
         WHERE metric_type = 'request' \
           AND upstream_response_id IS NULL \
           AND (metadata_json LIKE ? OR metadata_json LIKE ?) \
         ORDER BY created_at LIMIT ?",
    )
    .bind(format!("%\"{ROUTE_PROXY_RESPONSE_BODY_KEY}\"%"))
    .bind(format!("%\"{ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY}\"%"))
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("id"),
                row.get::<String, _>("metadata_json"),
            )
        })
        .collect())
}

/// Decode one row's stored preview and pull the upstream response id out of it.
///
/// Accepts both preview forms: the compressed `response_body_br` (base64 of
/// brotli) and the legacy plain `response_body`. Returns `None` when the row is
/// unparseable, holds neither key, or holds a preview with no recoverable id —
/// all cases the caller counts as skipped and leaves untouched.
fn recover_response_id(metadata_json: &str) -> Option<String> {
    let metadata: serde_json::Value = serde_json::from_str(metadata_json).ok()?;
    let body = if let Some(encoded) = metadata
        .get(ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY)
        .and_then(serde_json::Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        brotli_codec::decode_stored_text(encoded)
    } else {
        metadata
            .get(ROUTE_PROXY_RESPONSE_BODY_KEY)
            .and_then(serde_json::Value::as_str)?
            .to_string()
    };
    extract_upstream_response_id(body.as_bytes())
}

/// Wait out the startup rush, then backfill the ids.
///
/// Returns the future instead of spawning it, because the two callers do not
/// share a runtime: the desktop spawns it on Tauri's runtime (its setup hook is
/// not inside a Tokio context), while the standalone server is already async.
/// Same pattern as the preview compaction pass.
///
/// Failures are logged rather than raised: a database that keeps recovering
/// ids from previews on read is slower, not broken.
pub async fn backfill_upstream_response_ids_after_startup(pool: SqlitePool) {
    tokio::time::sleep(START_DELAY).await;
    match backfill_upstream_response_ids(&pool).await {
        Ok(summary) if summary.filled > 0 => {
            eprintln!(
                "usage history: backfilled {} upstream response ids, {} skipped",
                summary.filled, summary.skipped,
            );
        }
        Ok(_) => {}
        Err(error) => {
            eprintln!("usage history: could not backfill upstream response ids: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_memory_pool, run_migrations};

    /// Insert one request row with the given metadata and a preset column value.
    async fn insert_row(
        pool: &SqlitePool,
        metadata_json: &str,
        upstream_response_id: Option<&str>,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO usage_events \
             (id, route_credential_id, source_label, metric_type, amount, unit, \
              metadata_json, upstream_response_id, created_at) \
             VALUES (?, 'cred-1', 'route_proxy', 'request', 1, 'count', ?, ?, ?)",
        )
        .bind(&id)
        .bind(metadata_json)
        .bind(upstream_response_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await
        .expect("insert usage event");
        id
    }

    async fn stored_id(pool: &SqlitePool, id: &str) -> Option<String> {
        sqlx::query_scalar("SELECT upstream_response_id FROM usage_events WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .expect("read id")
    }

    #[tokio::test]
    async fn plain_preview_yields_its_response_id() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let body = r#"{"id":"resp_plain_123","object":"response"}"#;
        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body": body }).to_string(),
            None,
        )
        .await;

        let summary = backfill_upstream_response_ids(&pool)
            .await
            .expect("backfill");
        assert_eq!(summary.filled, 1);
        assert_eq!(stored_id(&pool, &id).await.as_deref(), Some("resp_plain_123"));
    }

    #[tokio::test]
    async fn compressed_preview_is_decoded_before_extraction() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let body = r#"{"message":{"id":"msg_compressed_456"}}"#;
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            brotli_codec::compress(body.as_bytes()).expect("compress"),
        );
        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body_br": encoded }).to_string(),
            None,
        )
        .await;

        let summary = backfill_upstream_response_ids(&pool)
            .await
            .expect("backfill");
        assert_eq!(summary.filled, 1);
        assert_eq!(
            stored_id(&pool, &id).await.as_deref(),
            Some("msg_compressed_456")
        );
    }

    #[tokio::test]
    async fn a_row_that_already_has_an_id_is_left_alone() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        // Column already set, and the preview carries a *different* id: the pass
        // must not select it, so the existing column wins.
        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body": r#"{"id":"resp_other"}"# }).to_string(),
            Some("resp_existing"),
        )
        .await;

        let summary = backfill_upstream_response_ids(&pool)
            .await
            .expect("backfill");
        assert_eq!(summary.filled, 0);
        assert_eq!(stored_id(&pool, &id).await.as_deref(), Some("resp_existing"));
    }

    #[tokio::test]
    async fn a_preview_without_an_id_is_skipped_not_written() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body": "no id anywhere in here" }).to_string(),
            None,
        )
        .await;

        let summary = backfill_upstream_response_ids(&pool)
            .await
            .expect("backfill");
        assert_eq!(summary.filled, 0);
        assert_eq!(summary.skipped, 1);
        assert_eq!(stored_id(&pool, &id).await, None);
    }

    #[tokio::test]
    async fn a_second_run_finds_nothing_left() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        insert_row(
            &pool,
            &serde_json::json!({ "response_body": r#"{"id":"resp_once"}"# }).to_string(),
            None,
        )
        .await;

        let first = backfill_upstream_response_ids(&pool).await.expect("first");
        assert_eq!(first.filled, 1);
        let second = backfill_upstream_response_ids(&pool).await.expect("second");
        assert_eq!(second.filled, 0);
        assert_eq!(second.skipped, 0);
    }
}
