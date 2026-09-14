# Codex OAuth 登录实施计划

> 按 executing-plans 在当前会话逐项执行，每项先验证失败测试再实现；不创建分支、worktree 或子代理。

**目标：** 在桌面端 Codex 官方账号导入区域增加隔离的官方 app-server 浏览器/设备码登录。

**架构：** Rust 独立运行时管理单次授权和安全清理，进程/协议与凭据导入分离。React 弹窗只接触安全状态和账号摘要，复用现有导入后分组逻辑。

**技术栈：** Rust、Tokio、Tauri、SQLx/SQLite、React、TanStack Query、Vitest。

**设计：** `docs/superpowers/specs/2026-09-14-codex-oauth-login-design.md`

## 全局约束

- 用户已在会话 1125 选择官方 Codex app-server；仅桌面端，不覆盖 ~/.codex/auth.json。
- 直接在 main 工作；保留已有暗黑/XP/Docker 改动及用户的 .workbuddy 目录。
- 所有 Rust 命令在 src-tauri 中设置 `$env:CARGO_TARGET_DIR='target-codex'`。
- OAuth 响应不包含原始凭据；错误不回显子进程输出；授权最多 10 分钟。
- 临时 home 与 cwd 相同；Windows 无 shell 拼接且无可见控制台；结束后清理。

## 任务 1：凭据转换与原子导入

文件：新增 `src-tauri/src/services/codex_oauth/credential.rs`、`mod.rs`，修改 `services/mod.rs`。

接口：`parse_auth_json(&str, Option<&str>) -> Result<ParsedOfficialCredential, AppError>`；`import_account(&SqlitePool, &str, ParsedOfficialCredential) -> Result<ImportedCodexAccount, AppError>`。

- [x] 编写 auth.json 元数据提取、拒绝 API Key/缺失凭据、状态摘要无 Token、事务回滚测试。
- [x] 运行 `$env:CARGO_TARGET_DIR='target-codex'; cargo test --lib services::codex_oauth`，确认缺少行为时失败。
- [x] 实现严格解析及 BatchRepository::create_tx / RouteCredentialRepository::create_tx 事务复用。
- [x] 重跑测试并审查无秘密回显。

## 任务 2：隔离子进程、协议与运行时

文件：新增 `src-tauri/src/services/codex_oauth/process.rs`、测试文件，完善 `mod.rs`；新增 `commands/codex_oauth_commands.rs`；修改 `commands/mod.rs`、`desktop.rs`。

接口：start(input: {method: browser|device_code, batch_name}) / status(session_id) / cancel(session_id) 均返回 `CodexOAuthStatus`；终态摘要为 `{id, display_name, email}`。

- [x] 先写握手/消息乱序、登录 ID 匹配、官方 URL、PATH 查找和环境隔离测试。
- [x] 实现原生 CLI 解析、临时 home、初始化、启动、完成通知及有界读取。
- [x] 先写 busy、取消、超时、清理和事务完成竞争测试，再实现 watch 状态及后台任务。
- [x] 注册桌面命令和退出 shutdown，Web 不注册。
- [x] 使用官方 CLI 验证隔离握手/启动/取消；不读取原有 auth.json，不完成真实用户授权。

## 任务 3：前端登录弹窗与导入入口

文件：新增 `src/components/accounts/CodexOAuthDialog.tsx`、`tests/CodexOAuthDialog.test.tsx`；修改 `src/lib/api/{client,types,commandSupport}.ts`、`src/screens/AccountsScreen.tsx`、`tests/AccountsScreen.test.tsx`、`tests/transport/command-contract.test.ts`。

- [x] 先写入口、批量必填、浏览器/设备码、完成、取消、晚到响应和错误恢复测试。
- [x] 运行 `pnpm exec vitest run tests/CodexOAuthDialog.test.tsx tests/AccountsScreen.test.tsx tests/transport/command-contract.test.ts`，确认新测试失败。
- [x] 增加类型与桌面 API；实现轮询和一次性完成回调，卸载取消。
- [x] 接入同一行按钮；复用新增账号后的分组、清空和缓存失效逻辑，原 JSON 导入不变。
- [x] 重跑定向测试及 `pnpm typecheck`。

## 任务 4：回归与交付

- [x] `pnpm test:run`、`pnpm release:manifest:test`、`pnpm build`。
- [x] `$env:CARGO_TARGET_DIR='target-codex'; cargo check`、`cargo test --lib`，必要时验证 standalone-server 不受影响。
- [x] 检查新增 Rust 格式；保留仓库已有格式差异，不做全仓无关格式化。
- [x] 审查 git diff、安全清理及临时文件；记录实际测试结果和需用户交互的登录验证限制。


## 验证结果（2026-09-15）

- `pnpm typecheck`：通过。
- `pnpm test:run`：76 个文件、851 项测试通过。
- `pnpm release:manifest:test`：52 项通过。验证中发现工作期间新增的 Docker 仓库迁移提交遗漏了 ZIP 权限恢复，保留新仓库地址，仅补回解压后的 `chmod 0755`。
- `pnpm build`：通过；既有 OCR 依赖的 externalized/eval 警告保留。
- `cargo check`：通过；既有 unused/dead-code 警告保留。
- `cargo test --lib`：1608 项通过，11 项默认忽略。
- `cargo test --lib official_cli_browser_login_start_and_cancel_smoke -- --ignored`：通过（真实官方 Codex CLI 0.150.1，独立临时目录，启动浏览器流程后取消，未完成真实账号授权）。
- `cargo check --no-default-features --features standalone-server --bin ai-switch-server`：通过。
- `go test ./...`（sidecar/ai-switch-tsnet）：通过。
- 新增 Rust 文件 `rustfmt --check`、`git diff --check`：通过。
- Windows 实测确认：必须释放 app-server 的标准输入/输出管道与进程句柄才能及时清理工作目录；临时登录禁用插件和连接器初始化，避免不相关的后台目录下载。
- 当前没有可用的浏览器控制连接，未完成实时截图检查；弹窗明暗样式复用既有主题规则，交互由 Vitest 覆盖。
- 尚需人工完成一次浏览器或设备码真实授权；本次不自动授权用户账号，也未提交、打 tag 或推送。
