# 实施计划：Tailscale 公网访问迁移到系统 CLI Funnel

依据 [`2026-11-14-tailscale-funnel-cli-design.md`](../specs/2026-11-14-tailscale-funnel-cli-design.md)。参考实现为 `lingyun/codeg-plus` 的 `src-tauri/src/web/tailscale_funnel.rs`（+ `cli.rs`、`tests.rs`）与其前端 `tailscale-funnel-settings.tsx`。

## 阶段 1：后端核心

1. `src-tauri/Cargo.toml` 增加依赖：`tokio-util = "0.7"`（CancellationToken）、`which = "7"`。
2. 迁移 `202611140001_app_metadata.sql`（`app_metadata` KV 表，`key` 唯一）+ 更新 `migration_checksums.txt`（按现有 SHA-384 流程追加） + `database/repositories/app_metadata_repository.rs`（sqlx `get_value` / `upsert_value` / `delete_value`）。
3. 新增 `src/web/tailscale_funnel.rs` + `tailscale_funnel/cli.rs` + `tailscale_funnel/tests.rs`，端口自 codeg-plus：
   - `Executor` trait（`installed` / `run`）与 `SystemExecutor`；
   - `FunnelStatus` / `FunnelPrerequisite` / `Preference` / `OwnedMapping`；
   - `FunnelManager`（`Runtime` + generation 守卫）；
   - `Mapping` 校验（`inspect_mapping` / `occupies_https_port`）与 `authorization_url`；
   - CLI 命令集见设计文档。
4. 与 codeg-plus 的差异（适配我们的基础设施）：
   - sea-orm → sqlx `app_metadata_repository`；
   - `AppCommandError` → `crate::error::AppError`（funnel 错误多数走 `FunnelStatus.error` 带内返回，只有停止时 `cleanupFailed` 上抛）；
   - `crate::process::tokio_command` → 自含 spawn（`CREATE_NO_WINDOW` + `LC_ALL=C` 便于 stderr 分类）；
   - `WebServerState` + `ws.lifecycle` → `&AppState` / `Arc<AppState>` + 复用 `WebService` 的 `config_reconciliation_lock`；
   - `ws.live_port()` → 读 `WebServiceRuntimeState` 的 running/port。
5. `enable_locked` 的 bind host 取自 `WebService::load_config`（`0.0.0.0` / `127.0.0.1`），不能取 advertised host（`0.0.0.0` 会被折叠成 `127.0.0.1`）。
6. 新增 auth key 通道：`login_with_auth_key_core`，spawn `up --authkey=<key> --timeout=60s`，`capture_auth=false`（不捕获授权链接，让无效 key 表现为失败而非弹出登录页）。

## 阶段 2：Web 服务集成

7. `app_state.rs`：`tailscale: TailscaleRuntimeState` → `tailscale_funnel: Arc<FunnelManager>`；同步更新所有测试夹具。
8. `web_service.rs`：
   - `WebServiceConfig` 删除 4 个 tailscale 字段（旧 JSON 靠 serde 忽略未知键）；
   - `create_mobile_pairing` 门槛改为 funnel enabled，`publicUrl` 取 funnel 地址、`privateUrl` 置空；
   - `start` 成功后 `tailscale_funnel::restore`；
   - `stop` 返回 `Result`，先 `shutdown_locked`，失败上抛；
   - 新增 6 个 funnel 包装方法 + `apply_funnel_gate_locked`；
   - `sensitive_commands_enabled_for_runtime` 改为按 funnel 状态判定；
   - 删除旧的 `tailscale_status` / `start_tailscale_login` / `start_tailscale_with_auth_key` / `disconnect_tailscale` / `ensure_web_running_locked` / `reconcile_sensitive_command_gate` / `apply_observed_tailscale_status_locked`；
   - funnel 各 core 出口统一 `apply_funnel_gate_locked`。
9. `desktop.rs`：启动 `initialize`、退出 `shutdown`、命令注册改名；`server.rs`：启动 `initialize`、bind 后 `restore`、退出 `shutdown`。
10. `paths.rs`：删除 `tailscale_dir`。
11. 删除 `services/tailscale_service.rs`、`tailscale_sidecar.rs`、`tailscale_types.rs` 及 `services/mod.rs` 声明。

## 阶段 3：命令 / API

12. `commands/web_service_commands.rs`：新增 6 个命令（`get_tailscale_funnel_status` / `start_tailscale_login` / `start_tailscale_with_auth_key` / `enable_tailscale_funnel` / `disable_tailscale_funnel` / `cancel_tailscale_funnel_operation`），删除旧 4 个；`stop_web_server` 传播错误。
13. `web/handlers/mod.rs`：dispatch 分支与 `is_sensitive_command` 名单同步；`WebServiceRuntimeState` 的 `inner` / `config_reconciliation_lock` 提到 `pub(crate)`。
14. `web/router.rs`：门控测试的命令列表更新。

## 阶段 4：前端

15. `src/lib/api/types.ts`：删 `TailscaleStatus` / `TailscaleLogin`、`WebServiceConfig` 的 tailscale 字段；新增 `TailscaleFunnelStatus` / `TailscaleFunnelPrerequisite`。
16. `src/lib/api/client.ts`：6 个新函数，删旧 5 个。
17. 新增 `src/components/settings/tailscale-funnel-settings.tsx`（移植 + auth key 区），删除 `tailscale-settings.tsx`。
18. `web-service-settings.tsx`：删 checkbox / 模式选择 / confirm / hint，按父组件模式接入 funnel（公开地址显示、stopIntent 握手、funnelRefreshVersion）。
19. `src/lib/i18n.tsx`：新增 `settings.webService.funnel.*`（含 states×10 / errors×16 / stages×4 / hints×7 + auth key 文案）en/zh，删除 `settings.tailscale.*` 与 6 个 exposure 键。
20. `AccountsScreen.tsx` 失效键改 `tailscale-funnel-status`；`about/catalog.ts` 删除 "Tailscale (tsnet)" 条目。
21. 测试：删除 `tailscale-settings.test.tsx`；更新 `SettingsScreen.test.tsx` / `AccountsScreen.test.tsx` / `TauriConfig.test.ts` / `settings/web-service-settings.test.tsx`。

## 阶段 5：打包与移除 sidecar

22. `git rm -r sidecar/ai-switch-tsnet src-tauri/binaries`；`tauri.conf.json` 删 `externalBin`。
23. `release.yml`：删 Go setup/test/交叉编译、`SIDECAR_BIN*`、`Stage-ServerArchive` 的 sidecar 参数与 `ai-switch-tsnet_*.zip` 资产。
24. `Dockerfile`：删 sidecar 拷贝与断言、`AI_SWITCH_TSNET_PATH`；新增 Tailscale apt 仓库与 `tailscale` 包；`deploy/docker-entrypoint.sh` 以 `--tun=userspace-networking` 启动 `tailscaled` 并等待 socket。
25. `scripts/install-server.sh`：删 sidecar 校验/安装/环境变量。
26. 脚本测试：`docker-release.test.mjs` / `install-server.test.mjs` / `stage-release-assets.test.mjs` / `create-release-body.test.mjs` 断言更新；`tests/ReleaseWorkflow.test.ts` sidecar 用例改为"无 Go 步骤"用例。
27. `AGENTS.md` 发布检查清单删除 `go test ./...`。

## 阶段 6：验证

- `cd src-tauri && CARGO_TARGET_DIR=target-codex cargo test --lib`（19 个 funnel 测试 + 全套 2254 用例）；
- `pnpm typecheck`、`pnpm test:run`、`pnpm release:manifest:test`；
- 手工冒烟：无 tailscale 时状态显示"未安装 + 安装链接"；安装后一键启用链（登录 → 发布 → 地址显示）。

## 阶段 7：文档

- 本 specs/plans 两篇；
- README / README-EN：移除 sidecar 与私有模式表述，说明系统 tailscale 前置条件；
- docs-site：`deploy/remote-access.md`（中英）重写为 funnel-only、`dev/architecture.md`、`deploy/standalone-server.md`、`deploy/web-service.md`、`guide/installation.md`、`tutorials/remote-and-team.md`、`faq.md` 及英文镜像。
