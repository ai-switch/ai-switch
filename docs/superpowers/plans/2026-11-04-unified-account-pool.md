# 统一账号池实施计划（G-P8 P4a）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 账号/组/成员的池身份统一为 `'codex'`，provider 与组级 agent 归属持久化，老 key 与 SaaS 计费零破坏。

**Architecture:** 一次 append-only 迁移承载全部数据变更；代码侧拆「池身份」（恒 codex）与「对接身份」（`PlatformId` 保留）两个语义。设计见 spec。

**Tech Stack:** Rust、SQLx/SQLite、既有 Vitest 设施。

**Spec:** `docs/superpowers/specs/2026-11-04-unified-account-pool-design.md`

## Global Constraints

- 在 `D:/Repos/ai-switch-gw` 的 `feat/videogen-gateway` 工作；迁移只追加不改旧文件，校验和追加进 `migration_checksums.txt`。
- Rust 验证 `CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=target-codex`。
- 未要求推送；改动保留本地。

## Review Focus

- 迁移在**有真实用户数据**的库上执行：official 账号的订阅类型、SaaS 组的计费列、老 key 全部无损。
- 唯一索引放开后，「默认组」类查询（原依赖一平台一 active 组）不得歧义或静默换组。
- 迁移幂等性/原子性：失败时库不得停在半统一状态。

## Task 1: 统一池数据迁移

**Files:** 新增 `src-tauri/migrations/202611040002_unified_account_pool.sql`、`src-tauri/src/database/migration_tests.rs`；修改 `src-tauri/src/database/migration_checksums.txt`、`src-tauri/src/database/mod.rs`。

**Produces:** `route_credentials.provider` 列；全部账号/组/成员 platform='codex'；`route_pool_groups.agent` 列；one-active 唯一索引放开；cursor 仅剩 codex。

- [ ] RED：迁移行为测试（provider 回填规则、platform 统一、agent 回填、索引放开、cursor 清理）。
- [ ] GREEN：迁移 SQL + 校验和钉住。
- [ ] 全量 `cargo test --lib` 通过。

## Task 2: 池身份/对接身份拆分（后端）

**Files:** `services/route_proxy_service.rs`（候选加载恒 codex、本地候选=serves_local 组并集）、SaaS principal 消费点、相关测试。

- [ ] RED→GREEN：跨池模型命中（claude 池账号迁入后被 codex key 的模型名访问）；默认组类查询在多 active 组下确定（serves_local 语义）。
- [ ] `/v1/models` 模态过滤（用户 2026-11-05 补充）：GET 查询参数 `type=video|audio|image|text`，缺省维持现状（全模态聚合）；未知 type 返回 400。本地侧按 `model_mappings.capabilities` 过滤（text=不含任何媒体能力）；SaaS 侧按组定价列推断（videoPrice/videoPricePerSecond>0→video、audioPriceMicrosPer1kChars>0→audio、imagePriceMicros>0→image、其余→text）。

## Task 3: P4b/P4c（另行切片）

前端 provider 分组展示、左侧模态导航、智能体对接收进通用页、claude 槽位配置。本计划不含。
