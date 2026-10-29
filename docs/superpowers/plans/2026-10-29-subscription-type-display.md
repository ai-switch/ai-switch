# 订阅类型友好显示实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将账号卡片中的订阅类型从后端原始标识改为可读名称，并通过悬停提示保留原始值。

**Architecture:** 新增一个无副作用的订阅类型格式化模块，集中维护已知类型映射和未知值的通用格式化；`AccountsScreen` 继续负责读取账号数据，只消费格式化结果并渲染徽章。原始订阅值不写回、不修改后端。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Tailwind utility classes。

**Spec:** `docs/superpowers/specs/2026-10-29-subscription-type-display-design.md`

## Global Constraints

- `self_serve_business_prolite` 必须显示为 `Business 高级版`。
- 悬停提示必须包含原始值 `self_serve_business_prolite`。
- 空值或纯空白值不显示订阅徽章。
- 未知值不能丢失原始信息，显示时只做下划线/连字符到空格的通用格式化。
- 仅修改前端显示，不修改 API、数据库或持久化原始值。
- AI 测试命令使用既有 `src-tauri/target-codex/` 约束；本次前端测试不创建 Rust target。

## Review Focus

- 已知值必须显示友好名称而不是原始 slug；由格式化模块单元测试和账号卡片测试覆盖。
- 原始值必须能从悬停/无障碍提示中取回；由账号卡片测试覆盖 `title` 和 `aria-label`。
- 未知值仍应可读且不丢失信息；由格式化模块单元测试覆盖。
- 空白输入不能产生空徽章；由格式化模块单元测试覆盖。
- 账号卡片原有 `officialSubscriptionType` 的配置回退逻辑不能改变；由既有 AccountsScreen 测试套件回归验证。

---

### Task 1: 新增订阅类型格式化模块及单元测试

**Files:**
- Create: `src/lib/subscriptionType.ts`
- Test: `tests/subscriptionType.test.ts`

**Interfaces:**
- Produces `formatSubscriptionType(raw: string | null | undefined): SubscriptionTypeDisplay | null`。
- `SubscriptionTypeDisplay` 包含 `raw`、`label`、`title`、`ariaLabel` 四个字符串字段。

- [x] **Step 1: 写已知值、未知值和空值的失败测试**

  测试要求：
  - `self_serve_business_prolite` 返回 `label === "Business 高级版"`，且 `title`/`ariaLabel` 都包含原始 slug。
  - `unknown_plan_type` 显示为 `Unknown Plan Type`，且仍保留原始值。
  - `null`、`undefined`、空字符串和空白字符串返回 `null`。

- [x] **Step 2: 运行单元测试确认因模块不存在或断言不满足而失败**

  Run: `pnpm exec vitest run tests/subscriptionType.test.ts`

  Expected: FAIL，失败原因应指向待实现的格式化模块/行为，而不是测试配置错误。

- [x] **Step 3: 实现最小格式化模块**

  在 `src/lib/subscriptionType.ts` 中：
  - 用大小写不敏感的键匹配已知映射 `self_serve_business_prolite -> Business 高级版`。
  - 未知值把连续下划线或连字符转换为空格，并将 ASCII 单词首字母大写。
  - 返回原始去首尾空白后的 `raw`，以及包含友好名称和原始值的中文 `title` 与 `ariaLabel`。

- [x] **Step 4: 运行单元测试确认通过**

  Run: `pnpm exec vitest run tests/subscriptionType.test.ts`

  Expected: PASS。

### Task 2: 接入账号卡片并增加界面回归测试

**Files:**
- Modify: `src/screens/AccountsScreen.tsx`（订阅徽章计算与渲染处）
- Modify: `tests/AccountsScreen.test.tsx`（账号卡片订阅徽章测试）

**Interfaces:**
- `AccountsScreen` 调用 Task 1 的 `formatSubscriptionType`，保留现有 `officialSubscriptionType` 读取逻辑。
- 徽章可见文本使用 `display.label`，`title` 使用 `display.title`，`aria-label` 使用 `display.ariaLabel`。

- [x] **Step 1: 写账号卡片失败测试**

  给官方账号 fixture 设置 `subscription_type: "self_serve_business_prolite"`，断言：
  - 徽章可见文本为 `订阅 Business 高级版`。
  - 徽章不显示原始 slug。
  - `title` 和 `aria-label` 包含 `self_serve_business_prolite`。

- [x] **Step 2: 运行目标测试确认失败**

  Run: `pnpm exec vitest run tests/AccountsScreen.test.tsx -t "订阅类型"`

  Expected: FAIL，因为当前界面仍直接显示原始 slug且没有相应的无障碍提示。

- [x] **Step 3: 实现最小 UI 接入**

  导入格式化函数；在账号映射中生成格式化结果；仅在结果非空时渲染现有蓝色徽章，并替换可见文本、`title`，新增 `aria-label` 和稳定 `data-testid`。

- [x] **Step 4: 运行目标测试确认通过**

  Run: `pnpm exec vitest run tests/AccountsScreen.test.tsx -t "订阅类型"`

  Expected: PASS。

### Task 3: 回归验证与收尾

**Files:**
- No additional production files.

- [x] **Step 1: 运行相关测试文件**

  Run: `pnpm exec vitest run tests/subscriptionType.test.ts tests/AccountsScreen.test.tsx`

  Expected: PASS。

- [x] **Step 2: 运行项目类型检查**

  Run: `pnpm typecheck`

  Expected: PASS，无新增 TypeScript 错误。

- [x] **Step 3: 运行完整前端测试**

  Run: `pnpm test:run`

  Expected: PASS；若仓库已有与本次无关的失败，记录具体测试名和失败原因。

- [x] **Step 4: 检查差异和工作区状态**

  Run: `git diff --check; git status --short`

  Expected: 无空白错误；只包含本次设计文档、计划文档、格式化模块及相关测试/UI 修改。


## 执行记录

- Task 1 RED：`pnpm exec vitest run tests/subscriptionType.test.ts` 因格式化模块不存在失败。
- Task 1 GREEN：新增 `src/lib/subscriptionType.ts` 后，6 个单元测试通过。
- Task 2 RED：账号卡片测试因找不到订阅徽章 `data-testid` 失败。
- Task 2 GREEN：接入格式化结果后，目标测试通过。
- 回归：相关测试 276/276 通过；`pnpm typecheck` 通过；完整前端测试 967/967 通过。
- Final review: self-review (no subagent tool)。确认已知映射、未知值回退、空值隐藏、原始值悬停提示和无障碍标签均与设计文档一致；未发现 Critical 或 Important 问题。
