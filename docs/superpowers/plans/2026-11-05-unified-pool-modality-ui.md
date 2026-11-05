# 统一账号池 P4b：模态导航与账号来源实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking。

**Goal:** 左侧只保留通用/图片/视频/音频/向量的账号池入口；通用管理官方订阅与 API 并按 provider 区分，媒体页只管理 API。客户端接入收进通用页。

**Architecture:** 复用现有账号管理与渠道页面，不另建账号池。模态导航使用独立、强类型的页面 id 和显示偏好，不再复用旧智能体显示开关；由 App 路由控制页面模态，避免侧边栏高亮与页内状态不一致。provider 显式穿过数据库输出、服务输入与表单，供应商身份不由统一后的 platform 推导。

**Tech Stack:** React/TypeScript、Vitest/Testing Library、Rust/SQLx/Axum、现有浏览器验证工具。

**Spec:** `docs/superpowers/specs/2026-11-04-unified-account-pool-design.md`（用户 2026-11-05 已确认的最终架构）。

## Global Constraints

- 继续现有 `feat/videogen-gateway` worktree，不修改主仓库、不换分支、不推送。
- 本次授权是继续开发；没有新的提交要求，不自动提交。
- Rust 验证只用 `src-tauri/target-codex`，`CARGO_INCREMENTAL=0`，不并行运行多个 Cargo 构建。
- 不修改已提交迁移的字节；需要新 schema 时追加迁移。
- 不把厂商/账号类型/协议/模态混为同一字段，不按价格反推账号来源。

## Review Focus

- 旧智能体显示偏好不能把新模态菜单一起隐藏；隐藏当前模态后落到下一可见项，全部隐藏仍可在设置恢复。
- 侧边栏连续切换两个媒体页时必须更新内容且唯一高亮；重开、导入聚焦与 Vibe 返回保持一致。
- provider 新建/更新/复制/重新导入不能误把 Claude 官方身份改成 OpenAI；遗漏字段的旧调用保持兼容。
- 媒体列表与分页总数均排除官方订阅，新建媒体不出现官方导入入口；官方导入必须按真实 provider 解析认证。
- 通用页客户端接入共用池 key，不再生出历史平台 key；认证轮转回归不能留红后假称完成。

## Task 1：模态导航与共享路由

**Files:** 新增 `src/lib/accountModalities.ts` 与其测试；修改 `App.tsx`、`AppLayout.tsx`、`SettingsScreen.tsx`、`CodexChannelsScreen.tsx`、`i18n.tsx`；修改对应导航/设置/页面测试。
**Interfaces:** `AccountModality`、模态页面映射、`ModalityVisibility`、读写偏好与可见页面解析；`CodexChannelsScreen` 增加受控模态与隐藏重复页签的能力。
- [ ] RED：五个菜单顺序、点击正确内容、唯一高亮、关闭当前模态后的转移、旧 agent 偏好隔离、窄窗点击后关抽屉。
- [ ] GREEN：用模态页面 id 路由，一份源数据生成菜单/设置，旧平台入口仅兼容映射到通用页。
- [ ] 运行完整导航/设置用例与 `pnpm typecheck`。

## Task 2：provider 输出与表单

**Files:** Rust `models/route_credential.rs`、凭据 repository/service、TS API types、来源 helper 与 AccountsScreen；对应 CRUD/筛选测试。
**Interfaces:** 输出 `RouteCredential.provider`；API 新增/更新 provider 可选输入（缺省保留/推导，显式值校验）；来源预设 official=openai/claude/gemini/grok，API=custom/openrouter/packycode/agentrouter。
- [ ] RED：存储 provider 能通过获取/分页返回；显式 provider 创建与更新往返；普通改名不改变来源；复制官方身份不丢。
- [ ] RED→GREEN：通用页按账号类型/来源筛选；分页总数同过滤；API 来源选择与持久化；官方厂商只在通用显示。
- [ ] Rust 凭据子集、AccountsScreen 全部测试与 TypeScript 检查通过。

## Task 3：客户端接入与完整验收

**Files:** AccountsScreen/ConfigWriteTargetsDialog、必要的客户端配置/直连服务；新增回归测试。
- [ ] RED→GREEN：通用页可选择实际客户端进行配置/启动，同一个池 key；媒体页仅保留模型/API 管理，不显示官方导入和客户端启动。
- [ ] 修复已有 `review_claude_baseline_follows_multiple_token_rotations`；先定位身份/客户端的混用，不发明槽位依赖掩盖回归。
- [ ] 全量 `cargo test`、standalone feature 测试/构建、`pnpm typecheck`、`pnpm test:run`、打包测试和 sidecar 验证。
- [ ] 进行一次独立审查与一轮测试驱动修复；浏览器验证可见导航/筛选/表单；如缺运行条件明确报告，不用静态检查冒充界面已验证。
