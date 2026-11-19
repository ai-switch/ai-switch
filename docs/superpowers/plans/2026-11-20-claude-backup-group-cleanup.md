# Claude 备份分组一键清理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 备份分组入口支持一键清理：删除三个遗留组内的全部账号（硬删）并删掉组本体，SaaS 引用防护，归档/恢复的保留组按需自动重建。

**Architecture:** 后端在 `route_pool_service` 新增 `delete_claude_backup_group`（SaaS 检查在 service 层，事务在 `route_group_repository` 新原子函数），`move_to_reserved_group` 前接 `ensure_reserved_group` 修复保留组依赖；前端投影跳过空遗留组，备份入口加删除按钮 + `window.confirm`。

**Tech Stack:** Rust (tauri command + sqlx 事务)、React/TS (vitest)。

**Spec:** `docs/superpowers/specs/2026-11-20-claude-backup-group-cleanup-design.md`

## Global Constraints

- 遗留组固定 ID：`claude-default` / `claude-out` / `claude-archived`（与前端 `CLAUDE_BACKUP_GROUP_IDS` 一致，不得改名）。
- 遗留组挂在统一池 `UNIFIED_POOL_PLATFORM` 下；写池函数内部归一（跟随 `create_group`/`move_group_members` 现状）。
- 账号删除 = 硬删除 `DELETE FROM route_credentials`（成员行靠 `ON DELETE CASCADE`），删除后调用 `best_effort_sync("codex")`。
- 组删除 = 软删除（`deleted_at`），不物理删行。
- 哨兵 ID `claude-backup` 不进任何写接口。
- 错误码：`validation.claude_backup_group_saas_referenced`；复用 `validation.route_pool_group_not_found` 语义时清理路径不报错（幂等成功）。
- i18n：新增文案同时加英文（~line 103）与中文（~line 1127）两份 key。

## Review Focus

- SaaS 密钥挂在 `claude-out`/`claude-archived`（不只 default）→ 防护必须覆盖三组。测试：Task 1 `cleanup_is_refused_when_saas_keys_reference_the_archived_group`。
- 软删过的保留组复活：先清理再归档 → `claude-archived` 复活并收下账号。测试：Task 2 `archiving_after_cleanup_rebuilds_the_reserved_group`。
- 混合空组投影：部分遗留组为空 → 只折叠非空；全空 → 入口消失。测试：Task 4 `skips_empty_legacy_groups`。
- 组已全部不存在时清理不报错（入口消失前连点）。测试：Task 1 `cleanup_is_idempotent_when_groups_are_gone`。
- 删除账号后成员行清空（级联）且普通组非空校验不受影响。测试：Task 1 `cleanup_deletes_accounts_members_and_groups`。

---

### Task 1: 后端清理（repository 原子函数 + service）

**Files:**
- Modify: `src-tauri/src/database/repositories/route_group_repository.rs`（新 `pub(super) fn delete_claude_backup_groups_atomic`，紧邻 `delete_group_atomic`）
- Modify: `src-tauri/src/database/repositories/route_pool_repository.rs`（`RoutePoolRepository` 转发 fn）
- Modify: `src-tauri/src/services/route_pool_service.rs`（`delete_group` 后新增 service fn 与常量）
- Test: `src-tauri/src/services/route_pool_service.rs`（tests 模块内追加）

**Interfaces:**
- Consumes: `route_pool_members`（UNIQUE(platform, route_credential_id), FK CASCADE）、`route_pool_groups`（`deleted_at` 软删）、`delete_group_atomic` 的 UPDATE 语义、`saas_api_keys.group_id` / `saas_group_settings.group_id`、`RoutePoolService::state(...)`（现有）、`best_effort_sync`（现有）。
- Produces:
  - `route_group_repository::CLAUDE_BACKUP_GROUP_IDS: [&str; 3]` = `["claude-default", "claude-out", "claude-archived"]`
  - `RoutePoolRepository::delete_claude_backup_groups_atomic(pool: &SqlitePool, platform: &str) -> Result<usize, AppError>`（返回删除账号数）
  - `RoutePoolService::delete_claude_backup_group(pool: &SqlitePool, platform: String) -> Result<RoutePoolState, AppError>`

- [ ] **Step 1: 写失败测试**（`route_pool_service.rs` tests 模块，沿用现有测试的内存池+迁移基建）：
  - `cleanup_deletes_accounts_members_and_groups`：seed 三个遗留组各含账号（成员表 UNIQUE(platform, route_credential_id)，一账号一行）、seed 一个普通空组 `codex-extra`；调用 `delete_claude_backup_group`；断言：返回的 state 里三个遗留组消失、`codex-extra` 仍在、三个账号 `route_credentials` 查不到、`route_pool_members` 中既无这三个组的成员行也无这三个账号的成员行。
  - `cleanup_is_idempotent_when_groups_are_gone`：空库直接调用 → 成功返回 state，不报错。
  - `cleanup_is_refused_when_saas_keys_reference_the_archived_group`：seed `saas_api_keys` 一行 `group_id = 'claude-archived'` → 断言错误码 `validation.claude_backup_group_saas_referenced`；同时验证 `saas_group_settings` 引用 `claude-default` 也被拒（可并入同测试第二个断言）。
- [ ] **Step 2: 运行确认失败**：`cargo test --lib delete_claude_backup` → 编译错误（fn 不存在）。
- [ ] **Step 3: 实现**：
  - `delete_claude_backup_groups_atomic`：`BEGIN IMMEDIATE` → `DELETE FROM route_credentials WHERE id IN (SELECT route_credential_id FROM route_pool_members WHERE platform=? AND group_id IN (...3 ids...))` → 对每个 id：若 `route_pool_groups` 存在该行则 `UPDATE ... SET deleted_at=?, updated_at=? WHERE id=? AND platform=? AND deleted_at IS NULL`（无则跳过）→ commit，返回删除账号数（`rows_affected` 之和）。
  - service：`PlatformId::parse(platform)?` + capability 校验 → SaaS 两条 COUNT 查询（`saas_api_keys` / `saas_group_settings`，`WHERE group_id IN (三 id)`）非零即返回上述错误码 → 调 repository → `best_effort_sync(pool, UNIFIED_POOL_PLATFORM).await` → `Self::state(pool, UNIFIED_POOL_PLATFORM, None, DEFAULT_REQUEST_PAGE, DEFAULT_REQUEST_PAGE_SIZE).await`。
- [ ] **Step 4: 运行测试通过**：`cargo test --lib delete_claude_backup` PASS（3 个）。
- [ ] **Step 5: 回归**：`cargo test --lib route_pool` 全绿（现有 delete_group 语义不变）。
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(accounts): 备份分组一键清理后端"`

### Task 2: 保留组自动重建（archive/restore）

**Files:**
- Modify: `src-tauri/src/database/repositories/route_pool_repository.rs`（新 `ensure_reserved_group`）
- Modify: `src-tauri/src/services/route_credential_service.rs`（`move_to_reserved_group` 接入）
- Test: `src-tauri/src/services/route_credential_service.rs` tests 模块

**Interfaces:**
- Consumes: `route_pool_groups` 表结构（id/platform/name/sort_order/is_internal/is_active/created_at/updated_at/deleted_at，主键 id 固定）、`move_group_members`（组缺失报 `route_pool_group_not_found`）。
- Produces: `RoutePoolRepository::ensure_reserved_group(pool: &SqlitePool, platform: &str, group_id: &str, name: &str) -> Result<(), AppError>` — 存在（deleted_at IS NULL）跳过；软删过则复活（deleted_at=NULL）；无则按固定 id INSERT（`is_internal=1, is_active=0, sort_order=MAX+1`）。

- [ ] **Step 1: 写失败测试**（route_credential_service tests）：
  - `archiving_after_cleanup_rebuilds_the_reserved_group`：seed 账号（无 `claude-archived` 组，模拟清理后）→ `RouteCredentialService::archive(pool, vec![id])` → 断言成功且 `claude-archived` 存在且含该账号、`archived_at` 已打标。
  - `restoring_after_cleanup_rebuilds_the_out_group`：同构，`restore` → `claude-out` 重建。
  - `resurrects_a_soft_deleted_reserved_group`：seed `claude-archived` 软删行 → archive → 断言行复活（deleted_at IS NULL）且成员移入。
- [ ] **Step 2: 运行确认失败**：`cargo test --lib reserved_group` / 按测试名过滤 → 编译错误。
- [ ] **Step 3: 实现**：`ensure_reserved_group`（见 Produces）；`move_to_reserved_group` 在每组 move 前 `ensure_reserved_group(pool, platform, &group_id, name)`，name 由 slug 映射：`out => "未入池"`、`archived => "已归档"`。
- [ ] **Step 4: 运行测试通过**。
- [ ] **Step 5: 回归**：`cargo test --lib route_credential_service` 全绿（现有 archive/restore 行为不变——组已存在时 ensure 是 no-op）。
- [ ] **Step 6: Commit** `git commit -am "fix(accounts): 归档/恢复的保留组缺失时自动重建"`

### Task 3: 命令、client、types

**Files:**
- Modify: `src-tauri/src/commands/route_pool_commands.rs`（`delete_route_pool_group` 后新增 command）
- Modify: `src-tauri/src/desktop.rs`（use 导入 + `invoke_handler` 列表两处；列表在 ~line 625 `delete_route_pool_group` 旁）
- Modify: `src/lib/api/types.ts`（`DeleteRoutePoolGroupInput` 附近新增）
- Modify: `src/lib/api/client.ts`（`deleteRoutePoolGroup` ~line 202 后新增）
- Test: 编译级（前端 Task 5 测试覆盖调用）

**Interfaces:**
- Consumes: Task 1 的 `RoutePoolService::delete_claude_backup_group`。
- Produces:
  - tauri command `delete_claude_backup_group(state, input: DeleteClaudeBackupGroupInput) -> Result<RoutePoolState, ApiError>`
  - types: `export type DeleteClaudeBackupGroupInput = { platform: string };`
  - client: `export function deleteClaudeBackupGroup(input: DeleteClaudeBackupGroupInput): Promise<RoutePoolState>` → `invoke("delete_claude_backup_group", { input })`

- [ ] **Step 1: 实现**：command 结构与 `delete_route_pool_group` 同构；types/client 按上述签名。
- [ ] **Step 2: 验证**：`cargo check --all-targets` 无错；`pnpm typecheck` 无错。
- [ ] **Step 3: Commit** `git commit -am "feat(api): 备份分组清理命令"`

### Task 4: 投影跳过空遗留组

**Files:**
- Modify: `src/lib/routePoolGroupPresentation.ts`（`presentRoutePoolGroups` 的 `legacy` 收集）
- Test: `tests/lib/routePoolGroupPresentation.test.ts`

**Interfaces:**
- Consumes: `RoutePoolGroup.account_count`（现有字段）。
- Produces: `presentRoutePoolGroups` 行为——`account_count === 0` 的遗留组不进入折叠；三个全空时返回无 `backup` 的 items；`children`/`initialChildId` 只含非空组（`initialChildId` 仍取 `children[0].id`）。

- [ ] **Step 1: 写失败测试**（追加到现有测试文件）：
  - `skips_empty_legacy_groups`：三个遗留组全空 → 结果无 backup 项、三组以普通项出现。
  - `folds_only_nonempty_legacy_groups`：default 有 2 个账号、out/archived 空 → backup.children 仅 default，out/archived 以普通项出现。
- [ ] **Step 2: 运行确认失败**：`pnpm vitest run tests/lib/routePoolGroupPresentation.test.ts`。
- [ ] **Step 3: 实现**：`legacy.set(id, match)` 前加 `if (match.account_count > 0)` 过滤；其余逻辑不变（`legacy.size === 0` 早退已覆盖全空情形）。
- [ ] **Step 4: 运行测试通过** + 现有投影用例回归（注意：现有用例若有"空组也折叠"的断言需按新行为更新——以新行为为准）。
- [ ] **Step 5: Commit** `git commit -am "fix(accounts): 备份分组折叠跳过空遗留组"`

### Task 5: 前端清理按钮 + 确认

**Files:**
- Modify: `src/screens/AccountsScreen.tsx`（备份分支 JSX ~line 8571；新增 mutation ~line 5249 `groupDeleteMutation` 旁；i18n key）
- Modify: `src/lib/i18n.tsx`（en ~line 103 / zh ~line 1127 各加一条）
- Test: `tests/AccountsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 3 `deleteClaudeBackupGroup`、`presentRoutePoolGroups` 的 backup item（`children` 带 `account_count`）。
- Produces: 备份入口旁删除按钮；确认文案 key `accounts.backupGroup.cleanupConfirm`（en: `Delete the backup group and its {count} accounts? This cannot be undone.`；zh: `将删除Claude备份分组及其 {count} 个账号，且不可恢复。继续？`）。

- [ ] **Step 1: 写失败测试**（AccountsScreen.test.tsx，mock `deleteClaudeBackupGroup`）：
  - `cleans_up_the_backup_group_after_confirmation`：渲染带非空遗留组的 pool state → 点 `data-testid="claude-backup-group-delete"` → `window.confirm` 被调且文案含账号总数 → mock confirm 返回 true → `deleteClaudeBackupGroup` 以 `{ platform: "codex" }` 被调 → 成功反馈出现。
  - confirm 返回 false → 不调用命令。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**：备份分支外包 `<div className="flex shrink-0 items-center gap-0.5">`；原按钮保持，右侧加小删除按钮 `data-testid="claude-backup-group-delete"`（红色次要样式，`title` 用 cleanupConfirm 渲染后的静态提示）；`onClick` 计算 `count = item.children.reduce((sum, child) => sum + child.account_count, 0)` → `window.confirm(t("accounts.backupGroup.cleanupConfirm", { count }))`（若项目 t 不支持插值则用模板串拼接，与 `agentRouterGpt6ResponsesMessage` 同法）→ true 则 `backupCleanupMutation.mutate()`；mutation 调 `deleteClaudeBackupGroup({ platform: activePlatform })`，onSuccess 复用 `groupDeleteMutation` 的 feedback/invalidate 模式（文案 `备份分组已清理。`）。
- [ ] **Step 4: 运行测试通过**。
- [ ] **Step 5: Commit** `git commit -am "feat(accounts): 备份分组入口支持一键清理"`

### Task 6: 全量验证与交付

- [ ] `pnpm typecheck` 无错。
- [ ] `pnpm test:run` 全绿（记录文件/用例数）。
- [ ] `cargo test -- --test-threads=1` 全绿（记录计数）。
- [ ] `cargo check --no-default-features --features standalone-server --lib` 无错。
- [ ] Commit 剩余文件；交付说明：清理为硬删除、SaaS 引用时需先解绑、清理后归档/恢复仍可用（保留组自动重建）、otools 不同步（无此功能）。
