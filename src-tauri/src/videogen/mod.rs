//! 视频生成（多模态网关的 video 渠道）
//!
//! 对应设计文档 §七 的网关侧编号：
//! - **G-P1**：`Provider.kind` 语义扩为「模态:协议」（`video:kling` / `video:sora` …）
//! - **G-P2c**：`/v1/video/generations` + `GET /{task_id}`（new-api 契约）+ 各家协议转换（`protocol.rs`）
//! - **G-P3**：异步任务表 + 轮询推进 + 回调（`repository.rs` 的 `videogen_tasks`）
//!
//! - **G-P3**：服务层（`service.rs`）：提交 → 落库 → 轮询推进 → 回调
//! - **G-P4**：HTTP 路由 `/v1/video/generations` + SaaS 白名单与计费

pub mod models;
pub mod protocol;
pub mod repository;
pub mod service;

pub use service::{SubmitVideoInput, VideoGenerationService};
