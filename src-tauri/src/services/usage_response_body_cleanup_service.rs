//! Delete stored response previews older than a cutoff, reclaiming their space.
//!
//! The proxy keeps a per-request response preview inside
//! `usage_events.metadata_json` (`response_body` on legacy rows, the compressed
//! `response_body_br` on new ones). It is the single largest thing the table
//! stores, and `usage_events` is never pruned, so on a long-lived install it
//! dominates the file. The stats the account list and overview draw were lifted
//! into their own columns, so the preview is the only thing that can be dropped
//! without changing a single number.
//!
//! This pass strips *only* those two keys from rows older than a caller-chosen
//! cutoff, leaving the row — and every column and metadata field the reports
//! read — in place. The one thing a preview still uniquely held, the upstream
//! response id, is recovered into its own column first by
//! [`crate::services::usage_response_id_backfill_service`]; run that before this
//! or a legacy row's CLI-transcript join is lost with its preview.
//!
//! ## Why this is safe to interrupt
//!
//! * **Idempotent.** The batch query only selects rows that still carry a
//!   preview key, so a stopped-and-restarted run simply resumes.
//! * **Per-row rewrite.** Each row's `metadata_json` is re-serialised with the
//!   two keys removed, in one `UPDATE`; there is no window where a row is
//!   half-written.
//! * **Bounded per batch.** Work happens in batches, each in its own
//!   transaction, so a run never holds the write lock for the whole table.
//!
//! ## Space is not returned until VACUUM
//!
//! Removing the keys shrinks the rows, but SQLite keeps the freed bytes as free
//! pages for reuse; only [`super::usage_history_compaction_service::vacuum`]
//! hands them back to the filesystem. Cleanup therefore reports how many rows it
//! touched, and the caller offers the (blocking, explicit) compaction
//! separately.

use crate::services::route_proxy_service::{
    ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY, ROUTE_PROXY_RESPONSE_BODY_KEY,
};
use sqlx::{Row, SqlitePool};

/// Rows per transaction. Same reasoning as the sibling passes: big enough that
/// per-batch overhead is negligible, small enough that the write lock is never
/// held long and an interrupted run loses almost nothing.
const BATCH_SIZE: i64 = 200;

/// Outcome of one cleanup run.
#[derive(Debug, Clone, Copy, Default)]
pub struct CleanupSummary {
    /// Rows whose preview keys were removed.
    pub cleared: usize,
    /// Bytes the `metadata_json` values shed, summed over cleared rows. This is
    /// the logical shrink; the file itself only shrinks after a VACUUM.
    pub freed_metadata_bytes: u64,
}

/// Strip the two preview keys from every request row older than `cutoff_rfc3339`.
///
/// `cutoff_rfc3339` is an inclusive upper bound on `created_at`: rows created at
/// or before it are cleaned, newer rows are left alone. Timestamps are stored as
/// RFC 3339 strings and compared lexically, which is correct because they share
/// a fixed-width UTC format.
///
/// A failure on one batch ends the run and is surfaced to the caller; the rows
/// already cleared stay cleared, and a later run resumes from the rest.
pub async fn clear_response_bodies_before(
    pool: &SqlitePool,
    cutoff_rfc3339: &str,
) -> Result<CleanupSummary, sqlx::Error> {
    let mut summary = CleanupSummary::default();

    loop {
        let batch = next_batch(pool, cutoff_rfc3339).await?;
        if batch.is_empty() {
            break;
        }

        let mut updates: Vec<(String, String, u64)> = Vec::new();
        for (id, metadata_json) in &batch {
            if let Some((rewritten, freed)) = strip_preview_keys(metadata_json) {
                updates.push((id.clone(), rewritten, freed));
            }
        }

        if updates.is_empty() {
            // The batch query matched on the key substrings, so this only
            // happens for rows whose JSON is unparseable — they can never be
            // rewritten. Stop rather than reselect them forever.
            break;
        }

        let mut transaction = pool.begin().await?;
        for (id, metadata_json, _) in &updates {
            sqlx::query("UPDATE usage_events SET metadata_json = ? WHERE id = ?")
                .bind(metadata_json)
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;

        summary.cleared += updates.len();
        summary.freed_metadata_bytes += updates.iter().map(|(_, _, freed)| *freed).sum::<u64>();

        tokio::task::yield_now().await;

        if batch.len() < BATCH_SIZE as usize {
            break;
        }
    }

    Ok(summary)
}

/// The request rows at or before the cutoff that still carry a preview key,
/// oldest first.
async fn next_batch(
    pool: &SqlitePool,
    cutoff_rfc3339: &str,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, metadata_json FROM usage_events \
         WHERE metric_type = 'request' \
           AND created_at <= ? \
           AND (metadata_json LIKE ? OR metadata_json LIKE ?) \
         ORDER BY created_at LIMIT ?",
    )
    .bind(cutoff_rfc3339)
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

/// Remove both preview keys from one row's metadata.
///
/// Returns the rewritten JSON and the number of UTF-8 bytes removed, or `None`
/// when the row is unparseable or carried neither key (so there is nothing to
/// write). Byte counts are UTF-8 lengths so the summary reports what the file
/// will actually shed.
fn strip_preview_keys(metadata_json: &str) -> Option<(String, u64)> {
    let mut metadata: serde_json::Value = serde_json::from_str(metadata_json).ok()?;
    let object = metadata.as_object_mut()?;
    let removed = object.remove(ROUTE_PROXY_RESPONSE_BODY_KEY).is_some()
        | object.remove(ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY).is_some();
    if !removed {
        return None;
    }
    let before = metadata_json.len() as u64;
    let rewritten = metadata.to_string();
    let after = rewritten.len() as u64;
    Some((rewritten, before.saturating_sub(after)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_memory_pool, run_migrations};
    use crate::services::brotli_codec;

    async fn insert_row(pool: &SqlitePool, metadata_json: &str, created_at: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO usage_events \
             (id, route_credential_id, source_label, metric_type, amount, unit, \
              metadata_json, created_at) \
             VALUES (?, 'cred-1', 'route_proxy', 'request', 1, 'count', ?, ?)",
        )
        .bind(&id)
        .bind(metadata_json)
        .bind(created_at)
        .execute(pool)
        .await
        .expect("insert usage event");
        id
    }

    async fn stored_metadata(pool: &SqlitePool, id: &str) -> serde_json::Value {
        let raw: String = sqlx::query_scalar("SELECT metadata_json FROM usage_events WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .expect("read metadata");
        serde_json::from_str(&raw).expect("metadata json")
    }

    #[tokio::test]
    async fn removes_both_preview_forms_but_keeps_other_fields() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let plain = insert_row(
            &pool,
            &serde_json::json!({
                "status": 200,
                "success": true,
                "duration_ms": 42,
                "response_body": "a".repeat(4000),
            })
            .to_string(),
            "2026-01-01T00:00:00Z",
        )
        .await;
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            brotli_codec::compress(&vec![b'b'; 4000]).expect("compress"),
        );
        let compressed = insert_row(
            &pool,
            &serde_json::json!({
                "status": 500,
                "success": false,
                "response_body_br": encoded,
            })
            .to_string(),
            "2026-01-02T00:00:00Z",
        )
        .await;

        let summary = clear_response_bodies_before(&pool, "2026-06-01T00:00:00Z")
            .await
            .expect("cleanup");
        assert_eq!(summary.cleared, 2);
        assert!(summary.freed_metadata_bytes > 0);

        let plain_meta = stored_metadata(&pool, &plain).await;
        assert!(plain_meta.get("response_body").is_none());
        // Everything the reports read is untouched.
        assert_eq!(plain_meta.get("status").and_then(serde_json::Value::as_i64), Some(200));
        assert_eq!(plain_meta.get("success").and_then(serde_json::Value::as_bool), Some(true));
        assert_eq!(plain_meta.get("duration_ms").and_then(serde_json::Value::as_i64), Some(42));

        let compressed_meta = stored_metadata(&pool, &compressed).await;
        assert!(compressed_meta.get("response_body_br").is_none());
        assert_eq!(compressed_meta.get("status").and_then(serde_json::Value::as_i64), Some(500));
    }

    #[tokio::test]
    async fn leaves_rows_newer_than_the_cutoff_alone() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let old = insert_row(
            &pool,
            &serde_json::json!({ "response_body": "x".repeat(2000) }).to_string(),
            "2026-01-01T00:00:00Z",
        )
        .await;
        let recent = insert_row(
            &pool,
            &serde_json::json!({ "response_body": "y".repeat(2000) }).to_string(),
            "2026-12-31T00:00:00Z",
        )
        .await;

        let summary = clear_response_bodies_before(&pool, "2026-06-01T00:00:00Z")
            .await
            .expect("cleanup");
        assert_eq!(summary.cleared, 1);

        assert!(stored_metadata(&pool, &old).await.get("response_body").is_none());
        // The recent row still has its preview.
        assert!(stored_metadata(&pool, &recent).await.get("response_body").is_some());
    }

    #[tokio::test]
    async fn a_second_run_finds_nothing() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        insert_row(
            &pool,
            &serde_json::json!({ "response_body": "z".repeat(2000) }).to_string(),
            "2026-01-01T00:00:00Z",
        )
        .await;

        let first = clear_response_bodies_before(&pool, "2026-06-01T00:00:00Z")
            .await
            .expect("first");
        assert_eq!(first.cleared, 1);
        let second = clear_response_bodies_before(&pool, "2026-06-01T00:00:00Z")
            .await
            .expect("second");
        assert_eq!(second.cleared, 0);
    }

    #[tokio::test]
    async fn a_row_without_a_preview_is_not_touched() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        insert_row(
            &pool,
            &serde_json::json!({ "status": 200, "success": true }).to_string(),
            "2026-01-01T00:00:00Z",
        )
        .await;

        let summary = clear_response_bodies_before(&pool, "2026-06-01T00:00:00Z")
            .await
            .expect("cleanup");
        assert_eq!(summary.cleared, 0);
        assert_eq!(summary.freed_metadata_bytes, 0);
    }
}
