//! 视频生成领域模型（G-P1 / G-P2c / G-P3）
//!
//! 与 `imagegen::models` 同构，差异：
//! - `platform` 语义是「渠道平台」（对齐 `Provider.kind` 的「模态:协议」，如 `video:kling`）
//! - message 带 `task_id`（视频是异步任务）
//! - 额外有 `VideoTask`：异步任务表，驱动「提交 → 轮询 → 回调」
//!
//! 本文件里**只有任务链路（`VideoTask` / `VideoTaskProgress` / `VideoTaskStatus` 相关）
//! 已接线**；会话 / 消息 / 资产是 G-P5 的生成会话模型，按计划明确暂缓
//! （见 `docs/superpowers/plans/2026-10-09-multimodal-video-gateway.md` 的 G-P5）。
//! 所以这里保留 `allow(dead_code)`：G-P5 落地时应当移除它，让编译器重新盯着这批类型。
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct VideoSession {
    pub id: String,
    pub title: String,
    pub platform: String,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct VideoMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub prompt: String,
    pub request_json: String,
    pub status: String,
    pub model: Option<String>,
    pub upstream_model: Option<String>,
    pub member_id: Option<String>,
    pub task_id: Option<String>,
    pub error_message: Option<String>,
    pub video_count: i64,
    pub cost_micros: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct VideoAsset {
    pub id: String,
    pub session_id: String,
    pub message_id: String,
    pub relative_path: String,
    pub mime_type: String,
    pub sha256: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub byte_size: i64,
    pub created_at: String,
}

/// 异步视频任务（G-P3）。`task_id` 是对外的 new-api 契约 id；`upstream_task_id` 是上游的。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct VideoTask {
    pub task_id: String,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
    pub model: String,
    pub upstream_model: Option<String>,
    pub dialect: String,
    pub status: String,
    pub upstream_task_id: Option<String>,
    pub url: Option<String>,
    pub error_message: Option<String>,
    pub callback_url: Option<String>,
    pub callback_delivered: bool,
    pub attempt_count: i64,
    pub last_polled_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VideoConversation {
    pub session: VideoSession,
    pub messages: Vec<VideoMessage>,
    pub assets: Vec<VideoAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateVideoSessionInput {
    pub title: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateVideoSessionInput {
    pub id: String,
    pub title: Option<String>,
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewVideoMessage {
    pub session_id: String,
    pub role: String,
    pub prompt: String,
    pub request_json: String,
    pub status: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewVideoAsset {
    pub session_id: String,
    pub message_id: String,
    pub relative_path: String,
    pub mime_type: String,
    pub sha256: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub byte_size: i64,
}

/// 新建异步任务（提交成功后写入）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewVideoTask {
    pub task_id: String,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
    pub model: String,
    pub upstream_model: Option<String>,
    pub dialect: String,
    pub upstream_task_id: Option<String>,
    pub callback_url: Option<String>,
}

/// 轮询/回调推进任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VideoTaskProgress {
    pub status: String,
    pub url: Option<String>,
    pub error_message: Option<String>,
}

/// 保存一次提交的入参（供工作台会话回看用；网关直连时不落库）。
///
/// G-P5 的生成会话模型的一部分：会话/消息接线后由 `videogen_messages.request_json`
/// 承载，当前与那批类型一同暂缓。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredVideoRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}
