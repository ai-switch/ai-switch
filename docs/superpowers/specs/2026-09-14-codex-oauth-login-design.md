# Codex OAuth 桌面登录设计

## 已确认范围

继续会话 1125 中用户已经选择的方案 1：复用官方 Codex CLI `app-server`，不独立实现 PKCE 或设备码协议。仅桌面端提供入口；放在 Codex「官方账号」区域，与「导入 JSON 文件」同一行，共用批量名称。支持浏览器授权和设备码授权，成功后直接新增官方账号。

## 架构与边界

- 独立 `CodexOAuthRuntime` 作为 Tauri managed state，仅注册桌面命令：`start_codex_oauth`、`get_codex_oauth_status`、`cancel_codex_oauth`。
- 同时只允许一个登录会话。启动立即返回会话 ID，界面轮询状态；后台任务不依赖界面轮询而存活或超时。
- 状态：`starting → waiting → importing → succeeded`，可终止为 `cancelled / failed / expired`。进入原子导入阶段后取消不回滚已完成的账号，返回实际完成状态，防止重复导入。
- 每次启动创建唯一的临时 `CODEX_HOME`，同时作为子进程工作目录，强制 `cli_auth_credentials_store="file"` 和 ChatGPT 登录；不读取或写入用户现有 Codex 凭据，不在仓库内启动 app-server，不绕过管理员策略。
- 优先解析安装在 PATH 的原生 Codex 可执行文件，兼容 npm/pnpm 安装内的原生程序；Windows 不通过 shell 拼接命令，不弹控制台窗口。
- 登录子进程关闭插件、远程插件目录与连接器初始化，避免只为登录下载插件或留下不相关子进程。管理员强制策略仍由官方 CLI 执行。
- JSON-RPC 按官方文档完成 initialize/initialized 和 account/login/start，消费 account/login/completed；取消时发送 account/login/cancel 并停止进程。
- 初始化/登录启动有短超时，整个授权最多 10 分钟。关闭弹窗、退出应用、失败和超时都停止子进程并清理临时目录。

## 凭据与导入

- 只有匹配本次 loginId 的成功通知才能读取临时 auth.json，拒绝 API Key 登录、不完整凭据、超大文件和符号链接。
- 后端读取 access_token、refresh_token、id_token 和 account_id。JWT 仅用于提取邮箱、账户 ID、过期时间、订阅信息和动态 client_id，不把解码等同于验签。
- 浏览器授权 URL 的 client_id、auth.json 字段及 Token audience 用于确定刷新 client_id，不复制参考项目的固定 Client ID。沿用既有路由 Token 刷新逻辑所需的官方 token_endpoint。
- 成功读入凭据后先停止 CLI、关闭管道/进程句柄并清理临时目录，再使用现有仓库 repository 的事务接口创建批量和官方凭据；清理失败不导入，任何失败都不能遗留空批量。沿用当前 JSON 导入的新增语义，不静默覆盖已有账号。
- OAuth 命令只返回状态、登录链接、设备码和导入账号摘要，不返回 Token 或原始 auth.json；错误不回显子进程原始输出、JWT 或授权码。
- 登录链接仅允许官方 HTTPS 域名，不接受任意 scheme、URL 用户信息或非标准端口。

## 界面

- 复用现有 Stone/Blue 样式和全局深色主题，不改动其他页面配色。
- 缺少批量名称时阻止启动；非 Codex 平台不显示入口，Web 模式禁用并说明仅桌面可用。
- 弹窗提供浏览器/设备码二选一、等待提示、重新打开授权页、复制设备码、取消和重试；没有 Token 输入或展示。
- 成功后沿用新增账号的「加入当前分组」「保存后清空」选项并刷新账号/批量列表。
- 支持键盘焦点约束、Escape 取消、可访问名称、错误播报；避免重复启动与过期异步回调更新界面。

## 验证

- Rust：协议握手/通知匹配、CLI 路径和环境隔离、URL 校验、Token 元数据解析、事务回滚、单会话限制、取消/超时/退出清理、敏感内容不出现在状态或错误。
- React：入口范围、必填批量、两种授权、设备码操作、成功回调只一次、取消/卸载、轮询失败及重试。
- 使用本机官方 CLI 做隔离的初始化与浏览器流程启动/取消验证，不自动替用户完成第三方登录。
- 运行类型检查、前端测试、发布脚本测试、Rust 检查/测试和生产构建。Rust 只复用 `src-tauri/target-codex/`。

## 官方依据

- https://developers.openai.com/codex/app-server/
- https://developers.openai.com/codex/auth/

以上页面已于 2026-09-14 获取核对。本次不发布、不打 tag、不推送，保留工作区已有修复。
