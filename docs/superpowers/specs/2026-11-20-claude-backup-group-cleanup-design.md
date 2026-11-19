# Claude 备份分组一键清理 — 设计

日期：2026-11-20
状态：待批准
范围：独立版（open/ai-switch）。备份分组只存在于独立版，OT 插件版无此功能，不同步。

## 意图

「Claude 备份分组」是旧 Claude 平台三个系统视图组（`claude-default` / `claude-out` /
`claude-archived`）的展示层折叠（`routePoolGroupPresentation.ts`），迁移到统一账号池后
一直挂在分组栏末尾。用户希望支持**一键清理**：把备份分组整体删掉，里面的账号直接删除。

## 现状事实（实现依赖）

- 三个遗留组是真实数据库组；备份入口只是前端投影，哨兵 ID `claude-backup` 不进写接口。
- `claude-out`（未入池）与 `claude-archived`（已归档）是**保留组**：`archive`/`restore`
  把账号移进对应固定 ID 组（`route_credential_service::move_to_reserved_group`）；
  `move_group_members` 在组不存在时报 `route_pool_group_not_found` → 删组后这两个功能会坏。
- 现有组删除语义：软删除（`deleted_at`），**非空组禁止删**、活动组禁止删。
- 现有账号删除语义：**硬删除**（`DELETE FROM route_credentials`）+ `best_effort_sync`；
  `route_pool_members` 对账号有 `ON DELETE CASCADE`，成员行随账号一起消失。
- SaaS 引用真实存在：`saas_api_keys.group_id`、`saas_group_settings.group_id` 可能指向
  `claude-default`（v0.18.1 收敛时因此保留这些组）。
- 备份投影折叠**任何存在**的遗留组（含空组）；组全部消失后入口自动消失。

## 目标 / 非目标 / 反目标

- 目标：备份入口一键清理——删账号（硬删，与现有账号删除一致）、删三个遗留组。
- 目标：清理后归档/恢复仍可用（保留组按需自动重建）。
- 非目标：不合并/迁移历史数据；不动 SaaS 密钥本身；不做批量选择式删除。
- 反目标：删除被 SaaS 引用的组（静默悬空）；把清理做成多个独立操作让用户逐个确认。

## 方案

**选定：一键清理（删除账号 + 删三个组）+ 保留组自动重建 + SaaS 引用防护。**

放弃的替代：
- 「搬空才能删」（保持现有非空校验）——清理体验差，被用户否决（"账号直接删掉"）。
- 「只删 claude-default，保留 out/archived」——备份入口仍在，达不到清理目的。

### 后端

1. `RoutePoolService::delete_claude_backup_group(pool, platform)`（`route_pool_service.rs`，
   与 `delete_group` 相邻）：
   - 平台校验走现有 `PlatformCapabilityService::require(RouteCredentials)`。
   - **SaaS 引用防护**：`saas_api_keys` 或 `saas_group_settings` 任一行 `group_id` 属于
     三个遗留组 → 拒绝，错误码 `validation.claude_backup_group_saas_referenced`，提示先
     解绑对应密钥/计费设置。
   - 单事务（`BEGIN IMMEDIATE`）：
     a. 收集三个组内全部账号（`route_pool_members` join）；
     b. `DELETE FROM route_credentials WHERE id IN (...)`（成员行级联消失）；
     c. 对仍存在的遗留组执行软删除（复用 `delete_group_atomic` 的 UPDATE 语义，绕过
        非空校验——本函数就是清理，不做搬空前置）。
   - 组不存在视为幂等成功（入口消失前连点不报错）。
   - 返回 `RoutePoolState`（复用 `Self::state(...)` 刷新）。
   - 成功路径调用 `best_effort_sync("codex")` 同步原生客户端配置。
2. **保留组自动重建**：`move_to_reserved_group` 在 `move_group_members` 前确保
   `<platform>-out` / `<platform>-archived` 存在（缺失则按固定 ID 创建，复用现有建组
   repository）。通用健壮性修复，不只为本次清理。
3. 命令注册：新增 tauri command `delete_claude_backup_group`，与现有组命令同处注册。

### 前端

- 备份容器入口（分组栏末尾）加删除按钮（次要危险样式，与普通组删除按钮一致）。
- 点击弹确认框：文案列出「将删除 N 个账号，不可恢复」；N 来自三个子组的
  `account_count` 之和。
- 确认后调用新命令；成功后依赖返回的 state 刷新，入口消失。
- **投影调整**（`routePoolGroupPresentation.ts`）：折叠条件收紧为「遗留组存在**且有
  账号**」。空遗留组不再折叠显示——否则归档一个账号自动重建 `claude-archived` 后，
  备份入口会带着空子组复活，清理成果被打断。连带 `initialChildId` 取第一个非空 child。

## 错误码

- `validation.claude_backup_group_saas_referenced`：SaaS 密钥/计费设置引用遗留组。

## 测试

后端（TDD）：
- 清理删除三个组内全部账号与组本身；组缺失时幂等成功。
- SaaS 密钥引用 `claude-default` 时清理被拒（错误码断言）。
- 清理后 `archive` 自动重建 `claude-archived` 并移入账号；`restore` 同理重建 `claude-out`。
- 现有组删除语义回归不受影响（非空校验仍生效于普通组）。

前端：
- 投影跳过空遗留组（纯函数单测）。
- 删除按钮触发确认框、调用命令、成功后入口消失（AccountsScreen 测试）。

## 交付说明口径

- 清理是**硬删除**：账号与组都不可恢复（独立版现有账号删除即硬删，无回收站）。
- 被 SaaS 引用时清理被拒，用户需先在 SaaS 侧解绑。
