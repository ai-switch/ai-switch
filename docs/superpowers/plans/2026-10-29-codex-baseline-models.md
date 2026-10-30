# Codex 算力池基线模型配置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Codex 算力池的写死基线模型列表改为可持久化配置，并在 Codex 账号页右上角提供配置入口。

**Architecture:** 新增 SQLite 表保存每个平台的基线模型 JSON 数组；route-pool API 在 `RoutePoolState` 中返回当前列表和默认列表，并提供保存命令。模型能力模块保留无配置时的默认包装函数，同时增加带基线覆盖的运行时入口，所有代理、配置写入、模型状态、Agent 启动和 SaaS 目录调用点统一从数据库读取覆盖列表。前端在 Codex 页用独立弹窗编辑列表，保存后刷新 route-pool 和相关模型数据；其他平台的会话入口不变。

**Tech Stack:** React 18 + TypeScript + Vitest/Testing Library；Tauri 2 Rust；SQLite/sqlx migrations；Lucide icons；TanStack Query。

**Spec:** `docs/superpowers/specs/2026-10-29-codex-baseline-models-design.md`

## Global Constraints

- 直接在 `main` 工作，不创建或切换 feature branch/worktree。
- `docs/superpowers/specs` 和 `docs/superpowers/plans` 使用中文撰写。
- 保留现有未提交的 `src-tauri/src/services/route_proxy_service.rs` 改动，不 reset、checkout 或覆盖它；在同一文件内只追加本功能所需的变更。
- AI 调试/验证使用 `src-tauri/target-codex/`；在 `src-tauri` 下执行 Rust 命令时设置 `CARGO_TARGET_DIR=target-codex`，不创建其他 target 目录。
- 不修改 Codex CLI 根级 `model` 默认选择，不改变其他平台默认模型列表或路由池聚合/精确模式。
- 数据库存储模型 ID 的顺序；缺失、空数组或非法 JSON 回退当前默认 Codex 列表：`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`。

## Review Focus

- 数据库中的非法 JSON、空数组或缺失记录必须安全回退默认列表，不能让代理或账号页失败。
- 保存输入中的首尾空白、空行和大小写不敏感重复项必须被规范化或明确拒绝，不能生成重复模型。
- 保存后 `/v1/models` 必须在不重启代理的情况下立即使用新列表。
- Codex 配置变化不能改变 Claude/Gemini/Grok 等平台的基线模型和会话入口。
- 配置写入、模型失败范围、Agent 启动模型选项和 SaaS 目录不能继续偷偷使用旧的硬编码列表。

---

### Task 1: 建立基线模型持久化和 route-pool API

**Files:**
- Create: `src-tauri/migrations/202610290001_route_pool_baseline_models.sql`
- Create: `src-tauri/src/services/route_pool_baseline_models.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/database/repositories/route_pool_repository.rs`
- Modify: `src-tauri/src/models/route_pool.rs`
- Modify: `src-tauri/src/services/route_pool_service.rs`
- Modify: `src-tauri/src/commands/route_pool_commands.rs`
- Modify: `src/lib/api/types.ts`
- Modify: `src/lib/api/client.ts`
- Test: `src-tauri/src/database/repositories/route_pool_repository.rs` tests and `src-tauri/src/services/route_pool_service.rs` tests

**Interfaces:**
- Add `route_pool_baseline_models(platform TEXT PRIMARY KEY, models_json TEXT NOT NULL, updated_at TEXT NOT NULL)`.
- Add `route_pool_baseline_models::default_models(platform: &str) -> Vec<String>` and `normalize_models(models: &[String]) -> Result<Vec<String>, AppError>`; Codex defaults are the five current IDs, non-Codex defaults are empty.
- Add repository methods `RoutePoolRepository::baseline_models(pool: &SqlitePool, platform: &str) -> Result<Vec<String>, AppError>` and `RoutePoolRepository::save_baseline_models(pool: &SqlitePool, platform: &str, models: &[String]) -> Result<(), AppError>`. Reads parse stored JSON and fall back to `default_models`; saves use a normalized non-empty list or the default list when the input is empty.
- Extend `RoutePoolState` with `baseline_models: Vec<String>` and `default_baseline_models: Vec<String>`.
- Add `SetRoutePoolBaselineModelsInput { platform: String, models: Vec<String> }` and `RoutePoolService::set_baseline_models(pool, input) -> Result<RoutePoolState, AppError>`. The service accepts Codex only for this first UI, validates/normalizes the list, persists it, and returns fresh state.
- Add Tauri command `set_route_pool_baseline_models` and TypeScript `setRoutePoolBaselineModels(input)`; extend `RoutePoolState` with the two arrays.

**Steps:**

- [ ] Write the failing Rust repository/service tests first: migration creates the table; missing/invalid/empty stored data returns the five defaults; a saved ordered custom list round-trips; blank-only input restores the defaults and duplicate input is rejected case-insensitively; `RoutePoolState` exposes current and default arrays.
- [ ] Run the focused Rust tests with `CARGO_TARGET_DIR=target-codex cargo test route_pool_repository` and `CARGO_TARGET_DIR=target-codex cargo test route_pool_service` from `src-tauri`; confirm they fail because the table, methods, and fields do not exist yet.
- [ ] Add the migration, default/normalization module, repository methods, state fields, service method, command registration, and TypeScript client/types with the exact interfaces above.
- [ ] Run the focused Rust tests again with `CARGO_TARGET_DIR=target-codex cargo test route_pool_repository` and `CARGO_TARGET_DIR=target-codex cargo test route_pool_service`; expected: PASS.
- [ ] Run `pnpm typecheck`; expected: PASS after the new client/types are wired.

**Produces:** A persisted route-pool baseline contract that later model-catalog and UI tasks can consume.

---

### Task 2: Make every backend model consumer honor the configured baseline list

**Files:**
- Modify: `src-tauri/src/services/route_model_capability.rs`
- Modify: `src-tauri/src/services/route_config_service.rs`
- Modify: `src-tauri/src/services/route_proxy_service.rs`
- Modify: `src-tauri/src/services/route_credential_service.rs`
- Modify: `src-tauri/src/services/route_model_test_service.rs`
- Modify: `src-tauri/src/services/agent_launch_service.rs`
- Modify: `src-tauri/src/saas/domain/groups.rs`
- Test: `src-tauri/src/services/route_model_capability.rs` tests and relevant route proxy/model service tests

**Interfaces:**
- Keep existing no-override helpers for current tests and callers, and add override-aware helpers: `advertised_model_catalog_entries_with_baseline(platform, members, mode, baseline_models)`, `advertised_model_ids_with_baseline(platform, members, mode, baseline_models)`, `known_upstream_models_with_baseline(platform, capability, kind, baseline_models)`, and `codex_model_catalog_payload_with_baseline(members, mode, baseline_models)`.
- The override helpers accept `Option<&[String]>`; `None` or an empty slice uses the existing platform defaults. Existing wrappers delegate to them with `None`.
- The runtime call sites load `RoutePoolRepository::baseline_models` once per operation and pass `Some(&baseline_models)` only for the affected platform. Claude’s `client_facing_model_catalog_entries` remains unchanged.

**Steps:**

- [ ] Add failing Rust tests proving a custom Codex baseline list is used by the advertised model catalog, Codex catalog payload, and known-model failure siblings, while a `None` override preserves the five default IDs.
- [ ] Run `CARGO_TARGET_DIR=target-codex cargo test route_model_capability`; expected: the new custom-list assertions fail before implementation.
- [ ] Implement the override-aware helpers and move the shared default list/normalization logic to `route_pool_baseline_models.rs`; keep compatibility wrappers so unrelated tests remain readable.
- [ ] Update `route_config_service` model resolution and Codex catalog writing to load/pass the configured list.
- [ ] Update `route_proxy_service` model-list request handling to load the latest list from SQLite on each `/models` request and pass it into the payload builder. Preserve the existing uncommitted invalid-parameter retry change in this file.
- [ ] Update `route_credential_service`, `route_model_test_service`, and `route_proxy_service` failure-scope calculations so Codex sibling models use the configured list.
- [ ] Update `agent_launch_service` and `saas/domain/groups.rs` to pass the configured list when creating model options/catalogs.
- [ ] Run `CARGO_TARGET_DIR=target-codex cargo test route_model_capability`, `CARGO_TARGET_DIR=target-codex cargo test route_proxy_service`, `CARGO_TARGET_DIR=target-codex cargo test route_model_test_service`, and `CARGO_TARGET_DIR=target-codex cargo test route_credential_service`; expected: PASS, including the new custom-list assertions.
- [ ] Add/execute an integration assertion that saving a custom list in SQLite changes the generated `/v1/models` payload without restarting the proxy; expected: custom IDs present and old default-only IDs absent when no account mapping contributes them.

**Produces:** A single backend source of truth for Codex baseline models across proxy output, config writes, state tracking, launch options, and SaaS catalog generation.

---

### Task 3: Add the reusable Codex baseline-model editor dialog

**Files:**
- Create: `src/components/accounts/CodexBaselineModelsDialog.tsx`
- Create: `tests/CodexBaselineModelsDialog.test.tsx`

**Interfaces:**
- Export `CodexBaselineModelsDialog({ models, defaultModels, loading, error, onClose, onSave })` where `models` and `defaultModels` are readonly string arrays, `loading` is optional boolean, `error` is nullable, `onClose` closes without saving, and `onSave` receives the ordered normalized string array.
- Render a dialog with one labeled text input per model, buttons to add/remove rows and move each row up/down, a “恢复默认” action, a save action, and visible error/loading states.
- Normalize each row by trimming; ignore empty rows on save; reject case-insensitive duplicates locally with an accessible error; preserve the user’s row order.

**Steps:**

- [ ] Write failing Testing Library tests for: rendering current models; adding/removing and moving a row; restoring defaults; trimming empty rows and rejecting duplicate IDs; invoking `onSave` only with the normalized ordered list; disabling save while loading.
- [ ] Run `pnpm vitest run tests/CodexBaselineModelsDialog.test.tsx`; expected: FAIL because the component does not exist.
- [ ] Implement the minimal dialog component with existing Tailwind/Lucide conventions and accessible labels/buttons.
- [ ] Run the focused dialog tests; expected: PASS.
- [ ] Run `pnpm vitest run tests/CodexBaselineModelsDialog.test.tsx tests/ModelMappingSummary.test.tsx`; expected: PASS.

**Produces:** A tested editor independent of route-pool data fetching, ready to mount from `AccountsScreen`.

---

### Task 4: Wire the Codex toolbar icon, route-pool state, and model summaries

**Files:**
- Modify: `src/screens/AccountsScreen.tsx`
- Modify: `src/components/accounts/ModelMappingSummary.tsx`
- Modify: `tests/AccountsScreen.test.tsx`
- Modify: `tests/ModelMappingSummary.test.tsx`
- Modify: `tests/darkThemeStyles.test.ts`

**Interfaces:**
- Add an optional `baselineModels?: readonly string[]` argument to `baselineModelsForPlatform`, `modelSummaryLine`, and `ModelMappingSummary`; configured Codex values take precedence, while absent values use the current frontend fallback list for isolated component tests.
- On Codex only, the right toolbar button uses the settings icon, `aria-label="配置 Codex 基线模型"`, and opens `CodexBaselineModelsDialog`; non-Codex keeps `aria-label="会话管理"` and `onOpenSessions` behavior.
- Save through `setRoutePoolBaselineModels({ platform: "codex", models })`, update/invalidate the active `route-pool` query and account/model queries, close on success, and show a formatted error on failure.
- Pass `routePoolQuery.data?.baseline_models` into model mapping summaries and model-test dropdown construction so the UI no longer uses the hardcoded Codex list during normal operation.

**Steps:**

- [ ] Add failing UI tests asserting that Codex shows the settings icon/button and opens the baseline dialog, Claude still shows the session button and calls `onOpenSessions`, custom route-pool values appear in the dialog and empty-mapping summary, and saving triggers the route-pool API with the ordered list.
- [ ] Update summary tests to verify a supplied custom list appears in the baseline tooltip while the no-prop fallback preserves the existing five-model expectation.
- [ ] Run the focused tests; expected: FAIL because the toolbar still renders `MessageSquareText`, the dialog is not mounted, and summaries ignore configured values.
- [ ] Implement the query/mutation/dialog wiring in `AccountsScreen`, replacing only the Codex right-side session action; update `ModelMappingSummary` and model-test option generation to consume the configured list.
- [ ] Run `pnpm vitest run tests/CodexBaselineModelsDialog.test.tsx tests/ModelMappingSummary.test.tsx tests/AccountsScreen.test.tsx tests/darkThemeStyles.test.ts`; expected: PASS.
- [ ] Run `pnpm typecheck`; expected: PASS.

**Produces:** The requested Codex-only configuration entry and a frontend that reflects the same persisted list as the backend.

---

### Task 5: Full verification and cleanup

**Files:**
- Modify only files required by preceding tasks; do not touch unrelated worktree changes.

**Steps:**

- [ ] Run `pnpm test:run`; expected: PASS with no new warnings or failures.
- [ ] Run `pnpm typecheck`; expected: PASS.
- [ ] From `src-tauri`, run `$env:CARGO_TARGET_DIR='target-codex'; cargo fmt --check`; expected: PASS.
- [ ] From `src-tauri`, run `$env:CARGO_TARGET_DIR='target-codex'; cargo check`; expected: PASS.
- [ ] From `src-tauri`, run `$env:CARGO_TARGET_DIR='target-codex'; cargo test`; expected: PASS.
- [ ] Review `git diff` and `git status --short`; verify only the new feature files plus the pre-existing `src-tauri/src/services/route_proxy_service.rs`, `.workbuddy/`, and `.workbuddy-ai/` changes are present, and no extra target directory was created.

**Produces:** A verified implementation ready for manual UI review, with the user’s pre-existing work preserved.


