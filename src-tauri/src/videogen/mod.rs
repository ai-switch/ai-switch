//! 视频生成（多模态网关的 video 渠道）
//!
//! 对应设计文档 §七 的网关侧编号：
//! - **G-P1**：`Provider.kind` 语义扩为「模态:协议」（`video:kling` / `video:sora` …）
//! - **G-P2c**：`/v1/video/generations` + `GET /{task_id}`（new-api 契约）+ 各家协议转换（`protocol.rs`）
//! - **G-P3**：异步任务表 + 轮询推进 + 回调（`repository.rs` 的 `videogen_tasks`）
//!
//! 注意：本模块目前只到「契约 + 持久化」层；`service` / HTTP 路由 / SaaS 计费接线是下一步，
//! 故暂允许未被引用的公开项（`dead_code`），接线后应移除本 allow。
#![allow(dead_code)]

pub mod models;
pub mod protocol;
pub mod repository;

pub use models::*;
