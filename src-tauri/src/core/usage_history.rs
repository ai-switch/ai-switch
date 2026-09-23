//! Shared usage-history housekeeping for the Tauri commands and the web
//! dispatcher.
//!
//! Mirrors [`crate::core::usage_overview`]: the implementation lives here so a
//! change cannot land on one surface and be forgotten on the other.

use crate::error::AppError;
use crate::services::usage_history_compaction_service;
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
