# 客户端直连模式实施计划

> 执行方式：使用 executing-plans 技能逐项实施；直接在 main 工作，不创建工作树，不派生子代理。

**目标：** 为 Codex / Claude 的 API 与官方账号提供安全、相互隔离的直连切换。

**架构：** 独立直连服务与按客户端的状态模型，复用配置写入锁和原子替换。官方认证通过平台适配器处理；路由写入只退出本次勾选且成功客户端的直连。

**技术栈：** React、TypeScript、Rust、Tauri、SQLite。

**设计文档：** `docs/superpowers/specs/2026-10-06-client-direct-mode.md`

## 全局约束

- 对用户可见文案统一为「直连模式」。
- 未勾选客户端的配置、认证、状态保持不变。
- AI Rust 验证仅使用 src-tauri/target-codex；不读取或输出真实密钥用于测试。
- 不自动提交、发布或推送，不自动切换用户真实客户端。

## 任务一：认证兼容性与纯配置生成

文件：新增 `src-tauri/src/services/direct_mode_service.rs`、`src-tauri/src/services/direct_mode_auth.rs`；参考 `adapters/route_config/{codex,json_agent}.rs`、`services/codex_oauth/credential.rs`。

- [x] 核对原生 Codex / Claude 当前配置与认证存储契约，包括官方 token 刷新及平台安全存储。仅凭文档推断不足，记录验证依据。
- [x] 先写四种账号组合、原生协议不兼容、字段缺失和路由模型别名的失败测试。
- [x] 运行并确认失败，再实现纯生成器，输出待写文件/认证操作，不接触真实用户目录。
- [x] 测试通过；无法确认的官方认证路径停止并报告，不用 API token 冒充完整登录切换。

## 任务二：可恢复写入及直连状态

文件：新增 `src-tauri/src/models/direct_mode.rs`；修改 `services/config_write_service.rs`、服务/模型注册；按现有数据库迁移约定新增客户端状态存储。

- [x] 先写中途失败、外部修改、认证存储失败、重复切换及敏感信息不外泄测试。
- [x] 实现统一恢复单元，复用 ConfigWriter 与路径锁；敏感备份采用受限权限，不进入普通配置预览。
- [x] 成功后保存 client_key、credential_id、模式及受管字段指纹，不保存明文认证副本在状态表。
- [x] 明确状态持久化失败后的恢复及错误返回，运行全部恢复测试。

## 任务三：路由切回与客户端隔离

文件：修改 `src-tauri/src/services/route_config_service.rs`、对应测试。

- [x] 先写 Codex/Claude 均直连、仅勾选其一的测试，未勾选方配置/认证/状态逐项断言不变。
- [x] 将退出直连纳入选中客户端的写入恢复单元；只有成功才更新模式。
- [x] 验证部分成功结果：成功方切回，失败方保持可识别原状态并返回原因。

## 任务四：命令与账号列表交互

文件：新增 `src-tauri/src/commands/direct_mode_commands.rs`、`src/components/accounts/DirectModeDialog.tsx`；修改命令注册、`src/lib/api/{client,types}.ts`、`src/screens/AccountsScreen.tsx` 和 `tests/AccountsScreen.test.tsx`。如复用 Web API，补对应已授权本机配置写入端点，禁止远端租户任意写本机认证。

- [x] 先写按钮适用范围、首次说明取消/确认、加载状态、直连中标签、失败反馈及恢复路由提示测试。
- [x] 实现薄命令包装，只收账号 ID，返回脱敏结果及重启提示。
- [x] 实现首次确认持久化、客户端独立状态展示及恢复入口。
- [x] 复用本次勾选客户端列表提示将退出的直连客户端，不操作未勾选者。

## 任务五：验证

- [x] 跑新增 Rust 单元/集成测试（CARGO_TARGET_DIR=target-codex）。
- [x] 跑组件测试、pnpm typecheck、pnpm test:run。
- [x] 跑 cargo check 与 cargo test，检查差异格式。
- [x] 用虚构账号/临时目录覆盖四种类型与互切矩阵；实机认证验证需要用户授权，不擅自覆盖真实登录。
- [x] 汇报支持范围、未验证项、测试结果与改动文件。


## 执行记录（2026-10-06）

- 新增独立直连配置生成器、认证存储适配器、可恢复写入服务及按客户端的 SQLite 状态。补充迁移 SHA-384 校验清单，没有改动既有迁移。
- Claude 官方原生 `claudeAiOauth` 导入保留过期时间与 scopes；缺少完整凭据不伪造字段。
- 切回路由按选中的客户端分别处理；同平台仅写 ZCode 时 Codex 文件/认证/状态不变；后台地址重写也保留直连。
- 原生认证刷新由客户端负责，代理读取其当前凭据；切换与代理刷新互斥，保存旧账号刷新结果使用比较后更新，防止覆盖并发编辑。
- 原生客户端退出登录后允许显式切换，但不把其他登录的 token 回写到旧账号。
- 直连写入仅注册为桌面命令，加入 desktopOnlyCommands；Web 仅能读脱敏状态，不能调用直连认证写入。
- 额外覆盖 Claude SDK 自动追加 `/v1/messages` 的地址去重，避免直连出现 `/v1/v1/messages`。
- 全量测试中发现原有 SaaS 环境变量测试并发互扰；该测试单独运行通过，随后所有 Rust 测试以 `--test-threads=1` 完整执行，没有跳过该测试或修改 SaaS 逻辑。
- 数据库损坏测试因新表改变页布局，可直接得到 SQLITE_CORRUPT。调整了检测前提，仍验证账号恢复及损坏库备份；其他 SQL 错误仍导致失败。

### 验证边界

- Windows 上使用临时目录和虚构认证，Codex CLI 0.150.1 的 API / ChatGPT 登录格式识别均通过；Claude Code 2.1.273 的官方 OAuth 格式识别通过。这不是对真实 token 有效性的验证。
- macOS Keychain 适配已实现，接口遵循原生分发客户端的存储契约；当前 Windows 环境没有进行 macOS 实机切换。正式使用前应在 macOS 验证 Keychain 授权提示及登录刷新。
- 自定义 CODEX_HOME / CLAUDE_CONFIG_DIR、Codex 默认 profile、会覆盖认证的进程环境变量会明确拒绝写入，而不是写错位置后宣称成功。
- 未切换用户真实账号，未自动提交、发布或推送。


### 最终验证结果

- `pnpm typecheck`：通过。
- `pnpm test:run`：76 个测试文件、885 项通过。
- `CARGO_TARGET_DIR=target-codex cargo test -- --test-threads=1`（src-tauri）：1836 项通过，11 项按原有配置忽略；包括迁移校验、损坏库恢复及直连新增测试。
- 桌面 `cargo check` 与独立服务端 `cargo check --no-default-features --features standalone-server --bin ai-switch-server`：通过。
- `git diff --check`：通过。
- 最后一次 UI 回归补齐保存偏好 mock 的逐测试重置，并等待路由写入的完整回调；不降低原有“非法配置不能保存”的断言。
- 误建的仓库根目录 target-codex 已确认不存在；本次有效构建均位于 src-tauri/target-codex。
