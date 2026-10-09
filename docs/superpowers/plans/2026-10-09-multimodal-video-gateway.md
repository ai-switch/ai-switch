# 多模态网关：视频渠道（G-P1 / G-P2c / G-P3）

## 背景

`otools-aigv` 插件的视频链路（P2c）已经收敛成「一份 `openai-videos` 契约（对齐 new-api）+ 少量
`vendor-task` 描述符兜底」。要让「装了 ai-switch 的用户少配 key」，网关侧必须提供同一份契约的**服务端**：
插件只认一个 `baseUrl` + 一个 `sk-` token，供应商差异全部在网关里吃掉。

设计依据：`otools-aigv/docs/模型提供方配置架构设计.md` 第七章（网关层 vs 插件层），
编号沿用 **G-** 前缀与插件侧 P 对齐。产品取舍取 §7.8 的 **(a) 无头网关 + 渠道管理**——
只加「视频渠道类型 + 统一端点 + 协议转换」，**不动导航与生成会话模型**（G-P5 暂不做）。

## 对外契约（new-api 对齐）

```
POST /v1/video/generations
  model / prompt / duration / fps / width / height / image / seed / n / metadata
→ 201 { id, object:"video", model, created_at, task_id, status:"processing" }

GET /v1/video/generations/{task_id}
→ 200 { task_id, status:"processing"|"succeeded"|"failed", url, format, metadata, error }
```

- `metadata` 是逃逸口：`negative_prompt` / `aspect_ratio` / `resolution` / `size` / `callback_url` …（各家私有参数不进主契约）。
- 状态枚举统一成 `processing` / `succeeded` / `failed`。

## 档位与进度

| 档 | 内容 | 状态 |
| --- | --- | --- |
| G-P1 | `Provider.kind` 语义扩为「模态:协议」（如 `video:kling`）；`dialect_from_provider_kind` 解析 | ✅ 已落地（解析函数） |
| G-P2c | `/v1/video/generations` 契约 + 五家方言协议转换（kling / ark / minimax / zhipu / sora） | ✅ 已落地（`protocol.rs`） |
| G-P3 | 异步任务表 + 轮询推进 + 回调 `callback_url` | 🟡 数据层已落地（`videogen_tasks` + repository），轮询调度/回调投递待接 |
| G-P4 | 计费计量单位扩展（次/秒、字符）——Saas 模块 | ⬜ 待做 |
| G-P5 | Generate TAB 合并（图像/视频/音频内 tab） | ⬜ 暂不做（仅 option (b) 才需要） |

## 本次落地内容

- **迁移** `src-tauri/migrations/202610090001_video_generation.sql`：`videogen_sessions` / `videogen_messages`
  / `videogen_assets` / `videogen_tasks`（外键 `ON DELETE CASCADE`/`SET NULL`），并在
  `src-tauri/src/database/migration_checksums.txt` 里固定其 SHA-384。
- **`src-tauri/src/videogen/`**：
  - `models.rs`：会话 / 消息 / 资产 / 任务 + 输入 DTO。
  - `protocol.rs`：new-api 契约的请求/响应构造 + 五家方言的上游请求体、提交响应取 taskId、状态响应统一。
  - `repository.rs`：会话/消息/资产 CRUD + 任务生命周期（`create_task` / `list_active_tasks` / `progress_task` / `mark_callback_delivered`）。
  - `mod.rs`：模块声明（暂 `#![allow(dead_code)]`，接线后移除）。
- **接线**：`lib.rs` 加 `mod videogen;`；`paths.rs` 加 `videogen_dir`；
  `services/route_proxy_service.rs` 加 `requested_video_capability` 并在候选过滤里与图像能力并列。

## 验证

```bash
cd src-tauri
CARGO_TARGET_DIR=target-codex cargo check --lib
CARGO_TARGET_DIR=target-codex cargo test --lib videogen
CARGO_TARGET_DIR=target-codex cargo test --lib migration_checksum
```

- `cargo check --lib`：通过（仅既有 warning）。
- `videogen`：7 例全过（方言解析 / 状态映射 / 上游请求体 / 上游响应解析 / 契约响应 / 比例推导 / 任务生命周期）。
- `migration_checksum`：3 例全过（新迁移已固定，无 CRLF）。

## 下一步

1. **G-P3 服务层**：`videogen/service.rs`（提交 → 落任务 → 轮询推进 → 终态落资产/回调）+ 轮询调度器。
2. **HTTP 路由**：把 `/v1/video/generations`（提交/查询）接进 `shared_fallback` → `route_proxy_service`，
   按 `Provider.kind` 选方言、按 `metadata` 透传私有参数。
3. **SaaS**：`saas/proxy` 加 video 端点白名单与 `execute_video_request`；`saas/billing` 加「次/秒」计价（G-P4）。
4. **前端（可选）**：`src/videogen/*` + Generate TAB 合并（G-P5，仅走 option (b) 时）。
