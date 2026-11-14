# Beta 更新频道实施与验收记录

依据 [设计文档](../specs/2026-11-15-beta-update-channel-design.md)，在用户批准的专用 beta 分支方案上实现。

## 范围

- 默认关闭的 `beta_updates_enabled` 设置。
- 桌面 `check_update` 命令与可复用 Tauri Update 资源元数据。
- 手动检查、每小时自动检查、频道切换与更新资源清理。
- 预发布清单发布到单文件 beta 分支，正式发布规则不变。
- 本轮不提交、不推送、不打 tag、不发布。前一轮已提交的 Tailscale 改造不是本轮范围。

## 实施任务

1. 设置模型、视图、默认值和反序列化兼容性：`src-tauri/src/models/settings.rs`，`settings_service.rs` 的往返测试和完整配置夹具。
2. 更新检查：`commands/update_commands.rs`，在 `commands/mod.rs` 与 `desktop.rs` 注册。Beta 关闭仅稳定源；开启则分别检查并按 SemVer 比较可安装候选。
3. 前端边界：`client.checkUpdate()` 重建 stock Update，`commandSupport.ts` 将新命令设为桌面专属，配置类型与测试夹具增加可选布尔值。
4. 更新页及自动提示：开关保存使用完整最新设置，保存成功广播频道变化；旧候选/迟到响应不混入新频道；替换和退出释放资源；下载安装继续走插件。
5. 发布：`scripts/publish-beta-manifest.mjs` 校验清单，首次建立/后续快进单文件 beta 分支，重跑旧版本不倒退，失败仅 warning。`release.yml` 在预发布完成后调用；脚本测试纳入 `release:manifest:test`。
6. 使用说明：同步中英文桌面更新与发布流程文档，明确 opt-in 不是白名单、首次安装要求以及 RC → 正式版步骤。
7. 独立代码审查与完整验证。

## 收尾裁决

- 原批准方案的「Beta 只检查 RC 源」会让测试者无法收到正式版。因此 Beta 开启改为比较 RC/稳定两个源；正式发布不写 beta 分支的决定保留。多一次只读请求，稳定用户行为不变。
- 实际 Cargo.lock 使用 `tauri-plugin-updater 2.10.1`，以锁定版本接口和编译结果为准，不因为探索资料提到其他版本而升级依赖。
- `semver` 已在依赖图中，声明为 desktop 专用直接依赖以正确比较数值预发布标识，不影响独立服务器的桌面依赖隔离。
- 所有测试 Git 推送只针对临时本地裸仓库，不触碰远端。

## 关键回归场景

- 稳定频道绝不请求 Beta 源。
- `0.19.0-rc.1` / `0.19.0` / `0.19.1` 正确排序，`rc.10` 高于 `rc.2`。
- 无 Beta 清单时若稳定源有更新，仍提供稳定更新；两源失败不显示「最新」。
- Beta → 稳定切换后，即使检查失败也不会留下 RC 安装按钮。
- 保存失败可见且不改变持久化开关；检查期间不能修改频道。
- 后台旧请求迟到被丢弃并释放；提示关闭、候选替换、卸载释放资源。
- 用真实 JS Update 验证 host rid 继续用于插件下载与资源关闭。
- 临时 Git 测试首发、快进、重复不新增提交、旧 RC 重跑不倒退、tag/清单不匹配拒绝、正式版不写 beta、调用方 HEAD/索引不变以及网络失败 warning。

## 验证命令

```bash
pnpm typecheck
pnpm test:run
pnpm release:manifest:test
pnpm build
pnpm --dir docs-site docs:build
# Rust 只复用仓库规定的 AI 验证目录
cd src-tauri
CARGO_TARGET_DIR=target-codex cargo check
CARGO_TARGET_DIR=target-codex cargo test
CARGO_TARGET_DIR=target-codex cargo check --no-default-features --features standalone-server --bin ai-switch-server
```

本轮自动测试不代替真实 RC 下载/安装和远端 GITHUB_TOKEN 权限验证。只有用户明确要求发布时才进行那些操作。

## 验收结果

- 一次独立审查发现并已修复 3 个 P2 边界问题，均由失败回归测试验证：跨页面频道保存的迟到检查、安装失败后处理延后的频道变化、首次 Beta 分支发布的推送重试。
- 最终 `pnpm test:run`：90 个测试文件，1102 项通过。
- 最终 `pnpm release:manifest:test`：64 项通过，包含 8 项临时本地裸 Git 发布测试。
- `pnpm typecheck`、`pnpm build`、文档站构建、工作流 YAML 与 `git diff --check` 通过。
- 独立服务器 `--no-default-features --features standalone-server` 编译通过。
- 最终完整 Rust 串行测试：2261 项通过，12 项原本忽略，main 和 doctests 通过。
- 默认并行 Rust 全套曾失败一项既有视频回调测试 `callback_delivery_never_follows_redirects_to_another_target`。该文件未改，单独运行和完整串行复测均通过；未修改或跳过该用例，保留失败日志，不能将默认并行运行称作通过。
- 构建仍有现存 chunk 体积及 Rust unused/dead-code 警告。
- 本功能尚未提交或推送；未创建远端 Beta 分支、未发布版本、未真实下载安装更新。
