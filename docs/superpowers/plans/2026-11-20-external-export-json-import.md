# Codex++ / Magpie 导出 JSON 批量导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 executing-plans 在本会话执行任务；每步先观察失败测试，再实现。用户已批准方案，不重复请求批准。

**Goal:** 两版新增账号的批量导入同时接收真实 Codex++ / Magpie 导出 JSON（文本及桌面文件）。

**Architecture:** 抽出既有 reader 内存转换，加明确格式探测；批量 parser 增加 PreparedApi 分支，复用 payload 构造；结果保留逐项失败。

**Tech Stack:** Rust/sqlx/serde_json，React/TypeScript/Vitest。

**Spec:** `docs/superpowers/specs/2026-11-20-external-export-json-import-design.md`

## Global Constraints

- 在当前 main 实现（已批准），不创建分支/worktree、不推送、不发版。
- 两仓功能保持一致；独立版 Rust 在 src-tauri、OT 在 native。
- 源 JSON 8 MiB、展开 2000 项；不刷新 OAuth、不读取 JSON 所指向路径。
- 批量新建，不写 external_source_client / external_source_id；API 与 Official 分开处理。
- 错误不包含用户导入原文/token；Magpie 加密备份明确拒绝。
- 独立版使用 CARGO_TARGET_DIR=target-codex 选择现有 AI 通道。

## Review Focus

- Codex++ 官方/API混合时不可丢一半，gateway 缺快照不能读取本机补齐（任务 1/2）。
- Magpie Sub2API 字段 expires_at、email_address、scope 不能无声丢失（任务 2）。
- providers/accounts 普通对象不可被错误抢占，历史 CPA/Sub2API 仍正确（任务 1/2）。
- 文本与文件对大小、数量、坏项处理一致；限制在创建批次/账号之前（任务 2）。
- 失败标签/消息不含原文 token，坏项不阻断合法项（任务 2/3）。

### Task 1: JSON 格式适配与纯 reader

**Files:** `native/src/services/{codex_plus_import_service,magpie_import_service,external_client_json_import_service,mod}.rs`

**Interfaces:**
- `prepare_values(Option<&Value>,...) -> Result<Vec<PreparedExternalEntry>,AppError>` 分别三参数与两参数，原本机读取调用纯函数。
- `prepare_json(value:&Value) -> Option<Result<Vec<PreparedExternalEntry>,AppError>>` 识别 Codex++ schema/settings、顶层 relayProfiles、Magpie 明文 providers/logins；加密格式明确 validation。

- [x] 写失败测试：Codex++ wrapper 的 API/OAuth/key/header 保持；Magpie 多协议和 login；未知版本/错误数组/空导出/加密信封；普通 CPA/accounts 不抢占。
- [x] 跑 `cargo test --manifest-path native/Cargo.toml external_client_json` 观察缺接口失败。
- [x] 提取 reader、实现 adapter、注册模块；仅小改可见性以复用 build_payload。
- [x] 跑新测试与既有 codex_plus/magpie/external_client 回归。

### Task 2: 批量文本/文件接入与 Magpie 导出兼容

**Files:** `native/src/services/route_credential_service.rs`、新 `native/src/services/route_credential_service/external_export_tests.rs`、`native/src/services/sub2api_import_service.rs`。

**Interfaces:**
- `ParsedBatchCredential::PreparedApi(ExtractedApiCredential)`；`ParsedBatchImport { credentials:Vec<ParsedBatchCredential>, failed:Vec<RouteCredentialImportFailure> }`。
- 既有 parse_batch_credentials_text/file 返回该结构；旧格式用空 failed 包装。
- 新格式 PreparedBody 的 Api/Official 成功，Broken/Skipped 转换为位置标签+固定 issue 原因。

- [x] 先写服务集成失败测试：真实 Codex++ wrapper、新建不覆盖、混合好坏条目、Magpie Sub2API/CLIProxyAPI 的邮箱/expiry/scope、Magpie provider config；同份文本/文件相同字段。
- [x] 跑集成过滤确认失败；补 Sub2API expires_at/email_address/scope 等明确字段，避免扩展不明别名。
- [x] 解析在 ensure_required_batch 之前；文件有界读取和文本用同一输入检查；多文件错误带文件名并保留成功结果。
- [x] 全部定向回归通过，检查数据库 source 绑定为空、官方厂商正确及无错误泄密。

### Task 3: 弹窗说明与结果

**Files:** `src/screens/AccountsScreen.tsx`、`tests/AccountsScreen.test.tsx`。

- [x] 写失败测试：新增弹窗显示两新来源与 JSON 方式；粘贴/文件仍调用当前接口；存在 imported+failed 的结果显示部分成功，清楚列出失败原因。
- [x] 更新支持文案并保留现有文件选择 UX；必要时补失败展示，不增加浏览器上传。
- [x] typecheck、AccountsScreen 和现有客户端面板测试通过。

### Task 4: 同步与交付验证

- [x] 把共用模块、reader、测试、docs 同步至独立版的 src-tauri 对应目录；service/UI 使用小范围补丁保留其独有功能。
- [x] 两版 `pnpm typecheck`、`pnpm test:run`、前端 build 与 Rust 串行全套；独立版 server check。输出写入本计划 workspace 日志并保留退出码。
- [x] 独立代理评审本次两仓差异；重要缺陷按 RED→GREEN 修复，必要时重跑受影响 suite。
- [x] 不自行提交/推送；报告实现、验证计数、真实样本限制及两仓状态。
