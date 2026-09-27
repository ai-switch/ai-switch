//! Shared usage-history housekeeping for the Tauri commands and the web
//! dispatcher.
//!
//! Mirrors [`crate::core::usage_overview`]: the implementation lives here so a
//! change cannot land on one surface and be forgotten on the other.

use crate::error::AppError;
use crate::services::usage_history_compaction_service;
use crate::services::usage_response_body_cleanup_service;
use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::SqlitePool;

/// What the settings screen needs to decide whether to offer a reclaim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistoryStorage {
    /// Bytes sitting in SQLite's freelist — already unused, but still occupying
    /// the file until a `VACUUM` rewrites it.
    pub reclaimable_bytes: u64,
}

pub async fn get_usage_history_storage_core(
    pool: &SqlitePool,
) -> Result<UsageHistoryStorage, AppError> {
    let reclaimable_bytes = usage_history_compaction_service::reclaimable_bytes(pool).await?;
    Ok(UsageHistoryStorage { reclaimable_bytes })
}

/// Rewrite the database file compactly, returning it to the filesystem.
///
/// Slow and exclusive by nature — `VACUUM` copies the whole database under a
/// write lock before swapping it in — so this is only ever reached from an
/// explicit user action, never from startup.
pub async fn compact_usage_history_core(pool: &SqlitePool) -> Result<UsageHistoryStorage, AppError> {
    usage_history_compaction_service::vacuum(pool).await?;
    get_usage_history_storage_core(pool).await
}

/// What a cleanup run cleared, for the settings screen to report back.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseBodyCleanup {
    /// Rows whose stored response preview was removed.
    pub cleared_rows: u64,
    /// Bytes the metadata values shed. The file itself only shrinks after the
    /// user runs the separate compaction, so this is the logical amount freed.
    pub freed_metadata_bytes: u64,
    /// Freelist bytes after the cleanup — how much a compaction could now return
    /// to the filesystem.
    pub reclaimable_bytes: u64,
}

/// Delete stored response previews older than `older_than_days`, keeping the
/// rows (and every statistic) intact.
///
/// The response preview is the largest thing `usage_events` stores and it is
/// never pruned, so this is the lever that actually bounds the file. The stats
/// the reports draw live in their own columns, so removing the preview changes
/// no number. `older_than_days` is the age threshold in whole days: `30` clears
/// previews for requests made more than 30 days ago. A value of `0` clears
/// every preview regardless of age.
///
/// The freed bytes become free pages; returning them to the filesystem is the
/// separate, explicit [`compact_usage_history_core`], so this reports the new
/// reclaimable size to let the caller offer that follow-up.
pub async fn clear_response_bodies_core(
    pool: &SqlitePool,
    older_than_days: i64,
) -> Result<ResponseBodyCleanup, AppError> {
    // Clamp negatives to "everything": a negative age has no meaning, and the
    // safe reading of "older than -1 days" is not "the future", it is "no lower
    // bound", which is what a zero-day cutoff already expresses.
    let days = older_than_days.max(0);
    let cutoff = (Utc::now() - Duration::days(days)).to_rfc3339();

    let summary =
        usage_response_body_cleanup_service::clear_response_bodies_before(pool, &cutoff).await?;
    let reclaimable_bytes = usage_history_compaction_service::reclaimable_bytes(pool).await?;

    Ok(ResponseBodyCleanup {
        cleared_rows: summary.cleared as u64,
        freed_metadata_bytes: summary.freed_metadata_bytes,
        reclaimable_bytes,
    })
}
