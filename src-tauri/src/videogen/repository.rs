//! 视频生成持久化（G-P3）：会话 / 消息 / 资产 / 异步任务

use super::models::*;
use crate::error::AppError;
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct VideoGenerationRepository;

const SESSION_COLUMNS: &str = "id,title,platform,archived,created_at,updated_at";
const MESSAGE_COLUMNS: &str = "id,session_id,role,prompt,request_json,status,model,upstream_model,member_id,task_id,error_message,video_count,cost_micros,created_at,updated_at";
const ASSET_COLUMNS: &str =
    "id,session_id,message_id,relative_path,mime_type,sha256,width,height,duration_ms,byte_size,created_at";
const TASK_COLUMNS: &str = "task_id,session_id,message_id,model,upstream_model,dialect,status,upstream_task_id,url,error_message,callback_url,callback_delivered,attempt_count,last_polled_at,created_at,updated_at";

impl VideoGenerationRepository {
    pub async fn create_session(
        pool: &SqlitePool,
        input: CreateVideoSessionInput,
    ) -> Result<VideoSession, AppError> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err(validation(
                "validation.video_session",
                "A title is required",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO videogen_sessions (id,title,platform,archived,created_at,updated_at) VALUES (?,?,?,0,?,?)")
            .bind(&id).bind(title).bind(&input.platform).bind(&now).bind(&now)
            .execute(pool).await.map_err(database)?;
        Self::get_session(pool, &id).await
    }

    pub async fn list_sessions(
        pool: &SqlitePool,
        include_archived: bool,
    ) -> Result<Vec<VideoSession>, AppError> {
        let sql = if include_archived {
            format!("SELECT {SESSION_COLUMNS} FROM videogen_sessions ORDER BY updated_at DESC")
        } else {
            format!("SELECT {SESSION_COLUMNS} FROM videogen_sessions WHERE archived=0 ORDER BY updated_at DESC")
        };
        sqlx::query_as(&sql).fetch_all(pool).await.map_err(database)
    }

    pub async fn get_session(pool: &SqlitePool, id: &str) -> Result<VideoSession, AppError> {
        let sql = format!("SELECT {SESSION_COLUMNS} FROM videogen_sessions WHERE id=?");
        sqlx::query_as(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(database)?
            .ok_or_else(|| validation("videogen.session_not_found", "Video session was not found"))
    }

    pub async fn update_session(
        pool: &SqlitePool,
        input: UpdateVideoSessionInput,
    ) -> Result<VideoSession, AppError> {
        let current = Self::get_session(pool, &input.id).await?;
        let title = input
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&current.title);
        let archived = input.archived.unwrap_or(current.archived);
        sqlx::query("UPDATE videogen_sessions SET title=?, archived=?, updated_at=? WHERE id=?")
            .bind(title)
            .bind(archived)
            .bind(Utc::now().to_rfc3339())
            .bind(&input.id)
            .execute(pool)
            .await
            .map_err(database)?;
        Self::get_session(pool, &input.id).await
    }

    pub async fn delete_session(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM videogen_sessions WHERE id=?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(database)?;
        if result.rows_affected() == 0 {
            return Err(validation(
                "videogen.session_not_found",
                "Video session was not found",
            ));
        }
        Ok(())
    }

    pub async fn conversation(pool: &SqlitePool, id: &str) -> Result<VideoConversation, AppError> {
        let session = Self::get_session(pool, id).await?;
        let messages_sql = format!(
            "SELECT {MESSAGE_COLUMNS} FROM videogen_messages WHERE session_id=? ORDER BY created_at ASC"
        );
        let messages = sqlx::query_as(&messages_sql)
            .bind(id)
            .fetch_all(pool)
            .await
            .map_err(database)?;
        let assets_sql = format!(
            "SELECT {ASSET_COLUMNS} FROM videogen_assets WHERE session_id=? ORDER BY created_at ASC"
        );
        let assets = sqlx::query_as(&assets_sql)
            .bind(id)
            .fetch_all(pool)
            .await
            .map_err(database)?;
        Ok(VideoConversation {
            session,
            messages,
            assets,
        })
    }

    pub async fn add_message(
        pool: &SqlitePool,
        input: NewVideoMessage,
    ) -> Result<VideoMessage, AppError> {
        Self::get_session(pool, &input.session_id).await?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO videogen_messages (id,session_id,role,prompt,request_json,status,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(&input.session_id).bind(&input.role).bind(&input.prompt).bind(&input.request_json).bind(&input.status).bind(&input.model).bind(&now).bind(&now)
            .execute(pool).await.map_err(database)?;
        sqlx::query("UPDATE videogen_sessions SET updated_at=? WHERE id=?")
            .bind(&now)
            .bind(&input.session_id)
            .execute(pool)
            .await
            .map_err(database)?;
        Self::get_message(pool, &id).await
    }

    pub async fn get_message(pool: &SqlitePool, id: &str) -> Result<VideoMessage, AppError> {
        let sql = format!("SELECT {MESSAGE_COLUMNS} FROM videogen_messages WHERE id=?");
        sqlx::query_as(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(database)?
            .ok_or_else(|| validation("videogen.message_not_found", "Video message was not found"))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn finish_message(
        pool: &SqlitePool,
        id: &str,
        status: &str,
        task_id: Option<&str>,
        upstream_model: Option<&str>,
        error: Option<&str>,
        video_count: i64,
    ) -> Result<VideoMessage, AppError> {
        sqlx::query("UPDATE videogen_messages SET status=?,task_id=?,upstream_model=?,error_message=?,video_count=?,updated_at=? WHERE id=?")
            .bind(status).bind(task_id).bind(upstream_model).bind(error).bind(video_count).bind(Utc::now().to_rfc3339()).bind(id)
            .execute(pool).await.map_err(database)?;
        Self::get_message(pool, id).await
    }

    pub async fn add_asset(pool: &SqlitePool, input: NewVideoAsset) -> Result<VideoAsset, AppError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO videogen_assets (id,session_id,message_id,relative_path,mime_type,sha256,width,height,duration_ms,byte_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&id).bind(&input.session_id).bind(&input.message_id).bind(&input.relative_path).bind(&input.mime_type).bind(&input.sha256).bind(input.width).bind(input.height).bind(input.duration_ms).bind(input.byte_size).bind(&now)
            .execute(pool).await.map_err(database)?;
        Self::get_asset(pool, &id).await
    }

    pub async fn get_asset(pool: &SqlitePool, id: &str) -> Result<VideoAsset, AppError> {
        let sql = format!("SELECT {ASSET_COLUMNS} FROM videogen_assets WHERE id=?");
        sqlx::query_as(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(database)?
            .ok_or_else(|| validation("videogen.asset_not_found", "Video asset was not found"))
    }

    // ─────────────── 异步任务（G-P3） ───────────────

    pub async fn create_task(
        pool: &SqlitePool,
        input: NewVideoTask,
    ) -> Result<VideoTask, AppError> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO videogen_tasks (task_id,session_id,message_id,model,upstream_model,dialect,status,upstream_task_id,callback_url,callback_delivered,attempt_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)")
            .bind(&input.task_id)
            .bind(&input.session_id)
            .bind(&input.message_id)
            .bind(&input.model)
            .bind(&input.upstream_model)
            .bind(&input.dialect)
            .bind("processing")
            .bind(&input.upstream_task_id)
            .bind(&input.callback_url)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await
            .map_err(database)?;
        Self::get_task(pool, &input.task_id).await
    }

    pub async fn get_task(pool: &SqlitePool, task_id: &str) -> Result<VideoTask, AppError> {
        let sql = format!("SELECT {TASK_COLUMNS} FROM videogen_tasks WHERE task_id=?");
        sqlx::query_as(&sql)
            .bind(task_id)
            .fetch_optional(pool)
            .await
            .map_err(database)?
            .ok_or_else(|| validation("videogen.task_not_found", "Video task was not found"))
    }

    /// 待轮询的任务（status=processing，按创建时间升序）
    pub async fn list_active_tasks(
        pool: &SqlitePool,
        limit: i64,
    ) -> Result<Vec<VideoTask>, AppError> {
        let sql = format!(
            "SELECT {TASK_COLUMNS} FROM videogen_tasks WHERE status='processing' ORDER BY created_at ASC LIMIT ?"
        );
        sqlx::query_as(&sql)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(database)
    }

    /// 推进任务状态（轮询或回调），attempt_count+1 并记录 last_polled_at
    pub async fn progress_task(
        pool: &SqlitePool,
        task_id: &str,
        progress: VideoTaskProgress,
    ) -> Result<VideoTask, AppError> {
        sqlx::query("UPDATE videogen_tasks SET status=?, url=COALESCE(?, url), error_message=?, attempt_count=attempt_count+1, last_polled_at=?, updated_at=? WHERE task_id=?")
            .bind(&progress.status)
            .bind(&progress.url)
            .bind(&progress.error_message)
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .bind(task_id)
            .execute(pool)
            .await
            .map_err(database)?;
        Self::get_task(pool, task_id).await
    }

    pub async fn mark_callback_delivered(
        pool: &SqlitePool,
        task_id: &str,
    ) -> Result<VideoTask, AppError> {
        sqlx::query("UPDATE videogen_tasks SET callback_delivered=1, updated_at=? WHERE task_id=?")
            .bind(Utc::now().to_rfc3339())
            .bind(task_id)
            .execute(pool)
            .await
            .map_err(database)?;
        Self::get_task(pool, task_id).await
    }
}

fn validation(code: &'static str, message: &str) -> AppError {
    AppError::Validation {
        code,
        message: message.to_string(),
        details: None,
        recoverable: true,
    }
}

fn database(error: sqlx::Error) -> AppError {
    AppError::Database {
        code: "database.videogen",
        message: "Could not access video generation data".to_string(),
        details: Some(error.to_string()),
        recoverable: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_memory_pool, run_migrations};

    #[tokio::test]
    async fn sessions_messages_assets_and_cascade_delete() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let session = VideoGenerationRepository::create_session(
            &pool,
            CreateVideoSessionInput {
                title: "Clip".into(),
                platform: "video:kling".into(),
            },
        )
        .await
        .expect("session");
        let message = VideoGenerationRepository::add_message(
            &pool,
            NewVideoMessage {
                session_id: session.id.clone(),
                role: "user".into(),
                prompt: "A fox running".into(),
                request_json: "{}".into(),
                status: "pending".into(),
                model: Some("kling-v2-6".into()),
            },
        )
        .await
        .expect("message");
        VideoGenerationRepository::add_asset(
            &pool,
            NewVideoAsset {
                session_id: session.id.clone(),
                message_id: message.id.clone(),
                relative_path: "v.mp4".into(),
                mime_type: "video/mp4".into(),
                sha256: "hash".into(),
                width: Some(1280),
                height: Some(720),
                duration_ms: Some(5000),
                byte_size: 1024,
            },
        )
        .await
        .expect("asset");

        assert_eq!(
            VideoGenerationRepository::conversation(&pool, &session.id)
                .await
                .expect("conversation")
                .assets
                .len(),
            1
        );

        VideoGenerationRepository::delete_session(&pool, &session.id)
            .await
            .expect("delete");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM videogen_assets")
                .fetch_one(&pool)
                .await
                .expect("count"),
            0
        );
    }

    #[tokio::test]
    async fn tasks_lifecycle_and_progress() {
        let pool = create_memory_pool().await.expect("pool");
        run_migrations(&pool).await.expect("migrations");

        let task = VideoGenerationRepository::create_task(
            &pool,
            NewVideoTask {
                task_id: "t-1".into(),
                session_id: None,
                message_id: None,
                model: "kling-v2-6".into(),
                upstream_model: Some("kling-v2-6".into()),
                dialect: "kling".into(),
                upstream_task_id: Some("k-1".into()),
                callback_url: Some("https://cb/1".into()),
            },
        )
        .await
        .expect("task");
        assert_eq!(task.status, "processing");
        assert!(!task.callback_delivered);
        assert_eq!(task.attempt_count, 0);

        assert_eq!(
            VideoGenerationRepository::list_active_tasks(&pool, 10)
                .await
                .expect("active")
                .len(),
            1
        );

        let progressed = VideoGenerationRepository::progress_task(
            &pool,
            "t-1",
            VideoTaskProgress {
                status: "succeeded".into(),
                url: Some("https://cdn/v.mp4".into()),
                error_message: None,
            },
        )
        .await
        .expect("progress");
        assert_eq!(progressed.status, "succeeded");
        assert_eq!(progressed.url.as_deref(), Some("https://cdn/v.mp4"));
        assert_eq!(progressed.attempt_count, 1);
        assert!(progressed.last_polled_at.is_some());

        // 终态后不再出现在待轮询列表
        assert_eq!(
            VideoGenerationRepository::list_active_tasks(&pool, 10)
                .await
                .expect("active")
                .len(),
            0
        );

        let delivered = VideoGenerationRepository::mark_callback_delivered(&pool, "t-1")
            .await
            .expect("delivered");
        assert!(delivered.callback_delivered);
    }
}
