# 账号列表剩余高度修复 Implementation Plan

> **For agentic workers:** 本会话使用 executing-plans 实施，TDD 与真实浏览器布局核验共同验收。

**Goal:** 账号列表占满剩余空间，底部分组栏不随空列表上移。

**Architecture:** 接通现有全高页面至账号 workspace 的 flex 高度链；保留 grid 四区与单一列表滚动区。内部视图使用可增长的 flex 内容，长列表不在内部新增滚动区。

**Tech Stack:** React、UnoCSS、Vitest/RTL、Browser Use。

**Spec:** `docs/superpowers/specs/2026-11-13-account-list-remaining-height-design.md`

## Global Constraints

- 不改账号、分组或后端行为，不使用 fixed/absolute/硬编码视口减法。
- 浏览器测试仅模拟数据，禁止访问本机账号库和令牌。
- 保持 main 和原有本地开发改动，不自动提交推送/发布。

## Review Focus

- 空列表填满可用列表区，不能被同时渲染的空 account-list 分掉高度。
- 少量列表撑满，卡片不能被自动拉成异常高的格子。
- 长列表只在原工作区滚动，分组栏与模态信息保持在固定 grid 行。
- 显示分段栏时账号工作区仍占剩余高度，不溢出页面。
- 窄窗口、多个模态接入行换行时保持有限高度与可用滚动。

---

### Task 1: 高度链回归与修复

**Files:** `src/screens/CodexChannelsScreen.tsx`、`src/screens/AccountsScreen.tsx`、`tests/AccountsScreen.test.tsx`；浏览器 fixture 与日志保存在系统临时目录，不修改开发代理配置。

**Interfaces:** 使用现有 AppLayout、MotionPage、CodexChannelsScreen 和 AccountsScreen；不改组件 prop 或 API 签名。

- [x] 创建模拟 transport 的真实页面预览，核验修改前空列表底部分组栏位置。
- [x] 在 AccountsScreen 的实体测试中覆盖完整模态外壳链，并观察高度分配回归失败。
- [x] 修正外壳 flex/full/min-height 链以及内部列表 flex 内容；无账号时不让空 account-list 与空态争抢空间。
- [x] 复跑回归与浏览器：空、2账号、长列表，三个尺寸与各模态、分段栏两种入口。
- [x] 运行 pnpm typecheck、pnpm test:run，检查无额外滚动/横向溢出；不提交推送。

## 验证结果

- 修改前真实浏览器复现：708×650 空图片账号页的分组栏底边约 447px，页面下方留白；修复后工作区及分组栏底边均为 650px。
- 360×640 且显示分段栏时，分段换行后工作区仍使用剩余高度，分组栏底边为 640px，页面无额外纵向滚动。
- 少量卡片保持约 120px 的紧凑高度，卡片列表仍填充剩余区域；长列表滚动 700px 后底部分组位置不变，筛选栏保持粘附。
- 通用、图片、视频、音频的模拟真实页面均完成核验；向量预留段由既有回归覆盖，不新增账号功能。
- 新增 10 条回归，包含高度链及长列表筛选容器；各自先失败再修复。完整前端 89 文件 / 1085 条测试通过，类型检查及生产构建通过。
- 独立源码复核指出长列表 sticky 包含块边界，已改为可随内容增长的最小内容高度并补测试验证。
- 全部浏览器输入为模拟数据，未读取或修改真实账号数据；验证阶段修改未提交或发布。

## 后续发布授权

用户随后选择「发布 v0.18.2」，包含提交、推送 main 与 annotated tag、正式 CI 发布和资产核验。沿用 AGENTS.md 发布规则，保留既有本地开发改动，不自动安装。
