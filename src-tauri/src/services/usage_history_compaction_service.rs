//! One-time, resumable rewrite of stored response previews into their
//! compressed form.
//!
//! The route proxy used to keep its per-request response preview as plain text
//! inside `usage_events.metadata_json`. On a real database that was 161 MiB of a
//! 337 MiB file for 90,643 rows — and `usage_events` is never pruned, so the
//! cost only ever grew. The writer now stores base64 of a brotli stream under
//! `response_body_br` instead, and both readers accept either key.
//!
//! That leaves history: rows written before the change keep their plain text
//! forever. This is the pass that brings them along.
//!
//! Why a service rather than a `.sql` migration: the transform needs brotli, and
//! SQLite has no such function. A migration that cannot express the change would
//! have to be a no-op, leaving the work to the startup path anyway.
//!
//! ## Why this is safe to interrupt
//!
//! Every property below is deliberate, because this runs against a database the
//! user cannot easily replace:
//!
//! * **Idempotent.** A row that already carries `response_body_br` is skipped, so
//!   stopping and restarting simply resumes.
//! * **Verified per row.** The encoded value is decompressed again and compared
//!   byte-for-byte with the original before the row is written. A row that fails
//!   verification is left untouched, not written broken.
//! * **All-or-nothing per row.** The metadata object is re-serialised with the
//!   key swapped, in one `UPDATE`. There is no window where a row has neither
//!   form.
//! * **Bounded per batch.** Work happens in batches, each in its own
//!   transaction, yielding between them — so this can never hold the database or
//!   a runtime worker for the length of the whole table.
//!
//! ## Why it does not VACUUM by itself
//!
//! Compression does not shrink the file: the freed bytes become free pages that
//! SQLite reuses for later writes. Only `VACUUM` hands them back to the
//! filesystem, and it rewrites the entire file under an exclusive lock — seconds
//! to minutes on a database this size, during which the app is blocked. That is
//! a cost the user should choose, not one an upgrade should impose, so it is a
//! separate action ([`vacuum`]).

use crate::services::brotli_codec;
use crate::services::route_proxy_service::{
    ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY, ROUTE_PROXY_RESPONSE_BODY_KEY,
};
use sqlx::{Row, SqlitePool};

/// Rows per transaction. Large enough that the per-batch overhead disappears
/// next to the compression work, small enough that an interrupted run loses
/// almost nothing and a batch never holds the write lock for long.
const BATCH_SIZE: i64 = 200;

/// How long to wait before starting.
///
/// Startup is already busy — the live log restores, the proxy starts, the first
/// usage query runs — and this competes for the same database. The delay costs
/// nothing when there is no history to rewrite, and keeps the migration off the
/// critical path when there is.
const START_DELAY: std::time::Duration = std::time::Duration::from_secs(10);

/// How many rows migration should find done before it stops looking.
pub struct MigrationSummary {
    pub migrated: usize,
    pub skipped: usize,
    pub compressed_bytes: u64,
    pub original_bytes: u64,
}

/// Rewrite every plain-text preview still in the table.
///
/// Returns a summary; a failure on one batch is logged and ends the run rather
/// than propagating, since a partially migrated database is fully readable and
/// the next startup picks up where this one stopped.
pub async fn migrate_stored_response_bodies(pool: &SqlitePool) -> Result<MigrationSummary, sqlx::Error> {
    let mut summary = MigrationSummary {
        migrated: 0,
        skipped: 0,
        compressed_bytes: 0,
        original_bytes: 0,
    };

    loop {
        let batch = next_batch(pool).await?;
        if batch.is_empty() {
            break;
        }

        let mut updates: Vec<(String, String)> = Vec::with_capacity(batch.len());
        for (id, metadata_json) in &batch {
            match encode_row(metadata_json) {
                Some((rewritten, before, after)) => {
                    summary.migrated += 1;
                    summary.original_bytes += before;
                    summary.compressed_bytes += after;
                    updates.push((id.clone(), rewritten));
                }
                // Unparseable, already migrated, empty, or failed verification:
                // leave the row exactly as it is and move on. A row that cannot
                // be rewritten is still perfectly readable.
                None => summary.skipped += 1,
            }
        }

        if updates.is_empty() {
            // Nothing in this batch was rewritable. The batch query already
            // excludes migrated rows, so this only happens against rows that can
            // never succeed (unparseable JSON) — and it would loop forever.
            // Bounding it here keeps a malformed row from spinning the task.
            break;
        }

        let mut transaction = pool.begin().await?;
        for (id, metadata_json) in &updates {
            sqlx::query("UPDATE usage_events SET metadata_json = ? WHERE id = ?")
                .bind(metadata_json)
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;

        // Yield between batches: this shares a runtime with the proxy, and a
        // hundred thousand rows of compression would otherwise starve it.
        tokio::task::yield_now().await;

        if batch.len() < BATCH_SIZE as usize {
            break;
        }
    }

    Ok(summary)
}

/// The rows still holding a plain preview, oldest first.
///
/// The `LIKE` narrows to rows that mention the key at all; the JSON check in
/// [`encode_row`] decides what actually happens to them. Escape-free matching is
/// fine here because `response_body` contains no `%` or `_`... except that it
/// does contain `_`, which is a single-character wildcard. It matches a literal
/// underscore too, so the filter only ever over-selects, never under-selects —
/// and over-selection is corrected by the per-row check.
async fn next_batch(pool: &SqlitePool) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, metadata_json FROM usage_events \
         WHERE metadata_json LIKE ? AND metadata_json NOT LIKE ? \
         ORDER BY created_at LIMIT ?",
    )
    .bind(format!("%\"{ROUTE_PROXY_RESPONSE_BODY_KEY}\"%"))
    .bind(format!("%\"{ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY}\"%"))
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.get::<String, _>("id"), row.get::<String, _>("metadata_json")))
        .collect())
}

/// Swap one row's plain preview for the encoded one.
///
/// Returns the rewritten JSON plus the before/after byte counts, or `None` when
/// the row should be left alone. The byte counts are UTF-8 lengths rather than
/// `String::len`, so the summary reports what the file will actually lose.
///
/// A row is only rewritten when the result is genuinely smaller. Brotli has
/// overhead, and base64 inflates by a third, so a preview of a few dozen bytes
/// comes out *larger* than the text it replaced — there is nothing to gain from
/// rewriting it and the plain form is the more readable of the two. Those rows
/// stay as they are and both readers keep handling them.
fn encode_row(metadata_json: &str) -> Option<(String, u64, u64)> {
    let mut metadata: serde_json::Value = serde_json::from_str(metadata_json).ok()?;
    let object = metadata.as_object_mut()?;
    if object.contains_key(ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY) {
        return None;
    }
    let body = object.get(ROUTE_PROXY_RESPONSE_BODY_KEY)?.as_str()?;
    if body.trim().is_empty() {
        return None;
    }

    let compressed = brotli_codec::compress(body.as_bytes()).ok()?;
    // Verify before writing: the row is about to lose its only other copy.
    if brotli_codec::decompress(&compressed).ok()? != body.as_bytes() {
        return None;
    }

    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, compressed);
    object.remove(ROUTE_PROXY_RESPONSE_BODY_KEY);
    object.insert(
        ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY.to_string(),
        serde_json::Value::String(encoded),
    );

    let before = metadata_json.len() as u64;
    let rewritten = metadata.to_string();
    let after = rewritten.len() as u64;
    (after < before).then_some((rewritten, before, after))
}

/// Wait out the startup rush, then compress the stored previews.
///
/// Returns the future instead of spawning it, because the two callers do not
/// share a runtime: the desktop spawns it on Tauri's runtime (its setup hook
/// is *not* inside a Tokio context, so a `tokio::spawn` here panics with "there
/// is no reactor running"), while the standalone server is already async and
/// spawns it on Tokio. Same reason the live log hands its writer back.
///
/// Failures are logged rather than raised: a database that keeps its plain
/// previews is bigger than it needs to be, not broken.
pub async fn compress_stored_previews_after_startup(pool: SqlitePool) {
    tokio::time::sleep(START_DELAY).await;
    match migrate_stored_response_bodies(&pool).await {
        Ok(summary) if summary.migrated > 0 => {
            eprintln!(
                "usage history: compressed {} response previews, {} skipped, {:.1} MiB -> {:.1} MiB",
                summary.migrated,
                summary.skipped,
                summary.original_bytes as f64 / 1024.0 / 1024.0,
                summary.compressed_bytes as f64 / 1024.0 / 1024.0,
            );
        }
        Ok(_) => {}
        Err(error) => {
            eprintln!("usage history: could not compress stored response previews: {error}");
        }
    }
}

/// How much of the file is free pages that only `VACUUM` can return.
pub async fn reclaimable_bytes(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let page_size: i64 = sqlx::query_scalar("PRAGMA page_size").fetch_one(pool).await?;
    let free_pages: i64 = sqlx::query_scalar("PRAGMA freelist_count")
        .fetch_one(pool)
        .await?;
    Ok((page_size.max(0) as u64) * (free_pages.max(0) as u64))
}

/// Hand the free pages back to the filesystem.
///
/// Deliberately not automatic: `VACUUM` rewrites the whole file under an
/// exclusive lock, so on a few-hundred-megabyte database this blocks every other
/// reader for seconds. Callers must be somewhere the user has accepted that
/// pause. Requires free disk equal to the current file size, since it writes a
/// complete copy before replacing the original.
pub async fn vacuum(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("VACUUM").execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_memory_pool, run_migrations};

    /// Insert one proxy row and return its id and the metadata actually stored.
    async fn insert_row(pool: &SqlitePool, metadata_json: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO usage_events \
             (id, route_credential_id, source_label, metric_type, amount, unit, \
              metadata_json, created_at) \
             VALUES (?, 'cred-1', 'route_proxy', 'request', 1, 'count', ?, ?)",
        )
        .bind(&id)
        .bind(metadata_json)
        .bind(chrono::Utc::now().to_rfc3339())
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

    /// The row's own bytes have to survive the round trip, because afterwards
    /// there is no second copy to fall back to.
    #[tokio::test]
    async fn a_plain_preview_is_replaced_by_the_encoded_one() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let body = "event: message_start\ndata: {\"usage\":{\"prompt_tokens\":120}}\n\n".repeat(30);
        let id = insert_row(
            &pool,
            &serde_json::json!({
                "path": "/v1/messages",
                "status": 200,
                "response_body": body,
            })
            .to_string(),
        )
        .await;

        let summary = migrate_stored_response_bodies(&pool).await.expect("migrate");
        assert_eq!(summary.migrated, 1);
        assert_eq!(summary.skipped, 0);
        assert!(summary.compressed_bytes < summary.original_bytes);

        let metadata = stored_metadata(&pool, &id).await;
        // The plain key is gone, not merely supplemented: keeping both would
        // preserve the size this pass exists to remove.
        assert!(metadata.get(ROUTE_PROXY_RESPONSE_BODY_KEY).is_none());
        let encoded = metadata
            .get(ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY)
            .and_then(serde_json::Value::as_str)
            .expect("encoded key");
        assert_eq!(brotli_codec::decode_stored_text(encoded), body);
        // Everything else in the blob is untouched.
        assert_eq!(
            metadata.get("path").and_then(serde_json::Value::as_str),
            Some("/v1/messages")
        );
        assert_eq!(
            metadata.get("status").and_then(serde_json::Value::as_i64),
            Some(200)
        );
    }

    /// A second run must find nothing to do, or a restart would recompress the
    /// whole history every time.
    #[tokio::test]
    async fn migrating_twice_changes_nothing() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body": "data: {\"id\":1}\n\n".repeat(40) }).to_string(),
        )
        .await;

        let first = migrate_stored_response_bodies(&pool).await.expect("first");
        assert_eq!(first.migrated, 1);
        let after_first = stored_metadata(&pool, &id).await;

        let second = migrate_stored_response_bodies(&pool).await.expect("second");
        assert_eq!(second.migrated, 0);
        assert_eq!(second.skipped, 0);
        assert_eq!(stored_metadata(&pool, &id).await, after_first);
    }

    /// A row whose JSON cannot be parsed is left alone rather than rewritten:
    /// whatever it holds, the user can still read it today, and a rewrite would
    /// be guessing at what it meant.
    #[tokio::test]
    async fn an_unparseable_row_is_left_alone() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let broken = "{\"response_body\": \"unterminated";
        let id = insert_row(&pool, broken).await;

        let summary = migrate_stored_response_bodies(&pool).await.expect("migrate");
        assert_eq!(summary.migrated, 0);
        assert_eq!(summary.skipped, 1);

        let raw: String = sqlx::query_scalar("SELECT metadata_json FROM usage_events WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .expect("read");
        assert_eq!(raw, broken);
    }

    /// A blank preview has nothing worth compressing, and compressing it would
    /// grow the row (a few bytes of stream plus base64 padding).
    #[tokio::test]
    async fn a_blank_preview_is_skipped() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        insert_row(&pool, &serde_json::json!({ "response_body": "   " }).to_string()).await;
        insert_row(&pool, &serde_json::json!({ "response_body": "" }).to_string()).await;
        insert_row(
            &pool,
            &serde_json::json!({ "path": "/v1/messages", "status": 200 }).to_string(),
        )
        .await;

        let summary = migrate_stored_response_bodies(&pool).await.expect("migrate");
        assert_eq!(summary.migrated, 0);
    }

    /// The whole point of batching: a table larger than one batch must still
    /// finish, and must not lose a row at the boundary.
    #[tokio::test]
    async fn a_table_larger_than_one_batch_is_fully_migrated() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let total = (BATCH_SIZE as usize) + 25;
        for index in 0..total {
            insert_row(
                &pool,
                &serde_json::json!({
                    "seq": index,
                    "response_body": format!("data: {{\"seq\":{index}}}\n\n").repeat(20),
                })
                .to_string(),
            )
            .await;
        }

        let summary = migrate_stored_response_bodies(&pool).await.expect("migrate");
        assert_eq!(summary.migrated, total);

        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM usage_events WHERE metadata_json LIKE '%\"response_body\"%'",
        )
        .fetch_one(&pool)
        .await
        .expect("count");
        assert_eq!(remaining, 0, "一个批次边界上的行被漏掉了");
    }

    /// The values the readers depend on have to survive: the response id is
    /// recovered from this very preview.
    #[tokio::test]
    async fn the_encoded_preview_still_yields_the_upstream_response_id() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        // Shaped like the real thing: a short preamble plus the frame the id
        // lives in, repeated as a streaming body would be.
        let body = format!(
            "{}event: message_start\ndata: {{\"message\":{{\"id\":\"msg_after_migrate\"}}}}\n\n",
            "event: message_start\ndata: {\"type\":\"message_start\"}\n\n".repeat(20)
        );
        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body": body }).to_string(),
        )
        .await;

        let summary = migrate_stored_response_bodies(&pool).await.expect("migrate");
        assert_eq!(summary.migrated, 1);

        let metadata = stored_metadata(&pool, &id).await;
        let encoded = metadata
            .get(ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY)
            .and_then(serde_json::Value::as_str)
            .expect("encoded key");
        let decoded = brotli_codec::decode_stored_text(encoded);
        assert!(
            crate::services::upstream_response_id::extract_upstream_response_id(
                decoded.as_bytes()
            )
            .is_some(),
            "压缩后仍然要能解析出上游响应 ID"
        );
    }

    /// 短到压不小的预览保持原样：base64 的 4/3 膨胀会把 `response_body` 换成
    /// `response_body_br` 这点收益吃掉，压了反而更大。
    #[tokio::test]
    async fn a_preview_too_short_to_compress_keeps_its_plain_form() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let body = "{\"error\":\"expired\"}";
        let id = insert_row(
            &pool,
            &serde_json::json!({ "response_body": body }).to_string(),
        )
        .await;

        let summary = migrate_stored_response_bodies(&pool).await.expect("migrate");
        assert_eq!(summary.migrated, 0);

        let metadata = stored_metadata(&pool, &id).await;
        assert_eq!(
            metadata
                .get(ROUTE_PROXY_RESPONSE_BODY_KEY)
                .and_then(serde_json::Value::as_str),
            Some(body),
            "小到不值得压缩的预览必须留原文"
        );
        assert!(metadata.get(ROUTE_PROXY_RESPONSE_BODY_ENCODED_KEY).is_none());
    }
}
