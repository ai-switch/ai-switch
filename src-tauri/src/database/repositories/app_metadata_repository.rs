use crate::error::AppError;
use chrono::Utc;
use sqlx::{Row, SqlitePool};

/// Small key/value store for app-internal state that is neither user data nor
/// file config. One consumer today: the Tailscale Funnel manager's
/// `desiredEnabled`/`owned` preference (`web_service_tailscale_funnel`).
pub struct AppMetadataRepository;

impl AppMetadataRepository {
    pub async fn get_value(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
        let row = sqlx::query("SELECT value FROM app_metadata WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await
            .map_err(|err| AppError::Database {
                code: "database.app_metadata_get",
                message: "Could not load app metadata".to_string(),
                details: Some(err.to_string()),
                recoverable: true,
            })?;

        Ok(row.map(|row| row.get::<String, _>("value")))
    }

    pub async fn upsert_value(pool: &SqlitePool, key: &str, value: &str) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO app_metadata (key, value, created_at, updated_at) \
             VALUES (?, ?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|err| AppError::Database {
            code: "database.app_metadata_upsert",
            message: "Could not save app metadata".to_string(),
            details: Some(err.to_string()),
            recoverable: true,
        })?;
        Ok(())
    }

    pub async fn delete_value(pool: &SqlitePool, key: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM app_metadata WHERE key = ?")
            .bind(key)
            .execute(pool)
            .await
            .map_err(|err| AppError::Database {
                code: "database.app_metadata_delete",
                message: "Could not delete app metadata".to_string(),
                details: Some(err.to_string()),
                recoverable: true,
            })?;
        Ok(())
    }
}
