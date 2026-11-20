# Codex++ / Magpie 导出 JSON 批量导入设计

日期：2026-11-20
状态：已批准（会话中的实现方案）

## 意图与范围

两版“新增账号 → 批量导入”支持粘贴 Codex++ / Magpie 的导出 JSON，以及通过现有桌面文件选择器导入。自动识别格式，保留 API/OAuth 类型、协议、请求头、模型与身份元数据。继续批量新建账号，不建立本机来源覆盖绑定，不刷新 OAuth、不读取 JSON 中的本地路径、不引入浏览器上传或解密备份功能。

## 公开格式证据

- Codex++ `f6fa88b2318a4518297614b9c9b3833d05ac2ef0`：`apps/codex-plus-manager/src-tauri/src/commands.rs:879,9150` 的 `SettingsExportDocument` / `export_settings`，外层 `{schema:1, exported_at_ms, settings:{relayProfiles:[...]}}`。`authContents` 为 auth.json 字符串。
- Magpie `4716a77ff9f8e6bd7ff64780f81674de0fee805e`：`internal/provider/login_export.go:135,222,244`，Sub2API `{type:"sub2api-data",version:1,exported_at,proxies:[],accounts:[...]}`；CLIProxyAPI 是每账号一个 `{type:"codex"|"claude",email,access_token,refresh_token,expired,...}`。Sub2API 的 `credentials.expires_at` 可为 RFC3339（Codex）或 unix 秒（Claude），Claude `email_address`、空格分隔 `scope`、`account_uuid` / `org_uuid`。
- Magpie 本地 `providers.json` / `logins.json` 明文结构复用既有 reader；完整 `.magpie-backup`（`internal/backup/backup.go`）是 `format:"magpie-backup"` 加密 JSON 信封，明确拒绝并指导先从 Magpie 导出账号 JSON。尚无证据把“分组分享”视为账号导出，不接收不含密钥的 routing-group。

## 方案取舍

选定复用 reader 的纯内存转换层，新增 JSON 外层适配器。独立重写一套转换会让两入口的 OAuth 校验和 key 优先级分叉；调用本机导入服务则会错误读取路径并引入同源覆盖，所以均不采用。

## 接口与行为

- `codex_plus_import_service::prepare_values(settings,gateway,claude_providers)` / `magpie_import_service::prepare_values(providers,logins)` 抽出同步转换；文件读取仅负责取 Value。
- `external_client_json_import_service::prepare_json(&Value)` 返回 `Option<Result<Vec<PreparedExternalEntry>,AppError>>`：None 继续既有格式解析；已识别的版本/形状错误直接返回明确 validation。
- 批量层接收 reader 产出的 API/Official；API 复用 `build_payload`，坏项/unsupported 进入 `RouteCredentialImportResult.failed`，保留合法项继续导入。错误只写固定原因与条目位置，不回显输入原文。
- 输入上限 8 MiB，展开后最多 2000 项，粘贴与文件一致；限制在解析/写库前执行。未知版本、无账号与加密信封给明确信息。
- 原有 CPA/Sub2API 混批格式继续原有解析；新识别只依据确定字段形状，不用文件名猜来源。
- 两版共用模块与测试保持一致；仅对宿主注册与 AccountsScreen 做最小差异接入。

## 验证

真实形状的合成 fixtures；文本/文件一致性、API/OAuth 混合、刷新元数据、Magpie 原生与订阅格式、坏项部分成功、旧格式不误判、超限与错误脱敏；两版 typecheck、前端全套、Rust 串行全套，独立版 server 编译；一次独立评审。没有用户真实安装样本，不把合成 token 测试当作真实登录验证。
