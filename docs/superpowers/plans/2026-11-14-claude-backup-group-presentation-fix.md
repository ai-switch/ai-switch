# 旧 Claude 分组折叠展示 Implementation Plan

> **For agentic workers:** 本会话使用 executing-plans 实施，TDD 与真实浏览器核验共同验收。

**Goal:** 底部分组栏把旧 Claude 三个系统组折叠为一个「Claude 备份分组」入口，子视图切换真实组。

**Architecture:** 纯展示投影：新增 `routePoolGroupPresentation.ts` 从 `routePoolGroups` 派生真实组项与备份容器项；AccountsScreen 底栏/子视图/移动下拉按投影渲染，所有写操作仍用真实组 ID。

**Tech Stack:** React、TypeScript、UnoCSS、Vitest/RTL、Browser Use（模拟数据）。

**Spec:** `docs/superpowers/specs/2026-11-14-claude-backup-group-presentation-design.md`

## Global Constraints

- 不改 SQL、converge、分页/导出/移动契约；不重写数据库组名；不混合三子组账号列表。
- 写操作（激活/编辑/删除/移动/导出/拖拽/新增目标回退）只允许真实组 ID。
- 保持 main 与既有本地改动；不提交推送或发布。

## Review Focus

- 同名自建组或 `claude-saas` 不得被折叠；改名的固定 ID 仍识别；软删除组不计入。
- 容器点击不把虚拟 ID 送进查询/移动/导出；子视图切换提交真实 child ID 与正确 scope。
- 备份容器浏览不改变 active 成员、池级统计和测试候选；移动失败回滚仍回落真实组。
- 切换子视图重置页码/勾选，取消进行中拖拽与计时，避免跨组提交。
- 中英文文案、键盘可达、窄底栏不裁切；无 claude 系统组时不渲染备份入口。

---

### Task 1: 展示投影与底栏折叠

**Files:**
- Create: `src/lib/routePoolGroupPresentation.ts`
- Modify: `src/screens/AccountsScreen.tsx`（底栏渲染、子视图选择器、移动下拉 optgroup、容器不可写边界）
- Modify: `src/lib/i18n.tsx`（备份分组双语键）
- Test: `tests/lib/routePoolGroupPresentation.test.ts`、`tests/AccountsScreen.test.tsx`

**Interfaces:**
- 消费：`RoutePoolGroup`（`src/lib/api/types.ts:720`）、现有 `selectRouteGroup`、`routePoolGroups`。
- 产出：`presentRoutePoolGroups(groups): { items: PresentationItem[]; backup?: BackupContainer }`；容器含真实 children（按 default→out→archived 排序）与默认打开的 child。

- [x] 写投影失败测试（三组齐全/部分缺失/改名识别/同名自建组与 claude-saas 不折叠/软删除不计入），观察失败。
- [x] 实现 `routePoolGroupPresentation.ts` 使投影测试通过。
- [x] 写页面回归：底栏出现单个备份入口、children 点击提交真实 ID、容器无编辑/删除/激活、移动下拉 optgroup 标注、切换重置页码；观察失败。
- [x] 实现底栏折叠与子视图选择器，i18n 双语键，页面回归通过。
- [x] `pnpm typecheck`、`pnpm test:run` 全绿；不提交推送。

## 完成验证（按用户简化后的最终方案）

- 用户简化要求：不要子视图切换器，账号也要合并进一个列表；备份入口放在分组列表最后。
- 后端新增只读多组分页：`RouteCredentialPageRequest.group_ids`（与 `group_id` 互斥、显式空列表拒绝），一条 EXISTS IN 谓词同时喂计数/条目/翻页边界；跨组去重有测试；reorder 拒绝多组（排序语义未定义）；导出 selection context 同步支持 group_ids。
- 前端：底栏旧 Claude 组折叠为单个「Claude备份分组」放在最后；点击进入合并账号列表（一次 `group_ids` 查询）；备份视图禁用拖拽排序、新增/移动失败回滚不引用哨兵 ID、导出按合并范围取账号。
- 测试：后端多组分页/校验测试 RED→GREEN；前端投影 5 条 + 备份回归 3 条（折叠位置、合并列表请求断言、移动下拉 optgroup）；AccountsScreen 322 条全过；Rust 全量 2255 条全过；typecheck/生产构建通过。
- 真实浏览器核验（模拟数据，708×650）：底栏顺序为 codex 三组 + 同名自建组 + 「Claude备份分组」（最后）；点击后同一列表合并显示遗留组账号，无切换器。截图已存档于浏览器工件目录。
- 未提交推送或发布；未修改真实数据库与安装目录。

### Task 2: 真实浏览器核验

**Files:** 临时目录模拟预览（复用上次 fixture 方式，模拟数据含旧 Claude 组 + codex 三组 + 一个同名自建组）。

- [x] 708×650：底栏单入口、子视图切换数据、容器随选择高亮、无重复分组。
- [x] 记录核验结果；不连接真实账号数据。
