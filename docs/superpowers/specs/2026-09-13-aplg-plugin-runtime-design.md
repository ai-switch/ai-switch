# APLG 通用插件运行时与 ai-switch 双模式接入设计

- 日期：2026-09-13
- 状态：总体方向、npm 包名和公开 PR 发布入口已确认；本文同步 `ai-switch/plugin-store` 的职责与信任边界，等待书面规格审阅。已创建远程仓库及贡献文档，runtime、devkit 和自动发布流水线尚未实施或发布。
- 工作树：`D:\Repos\worktree\ai-switch-plugin-design`
- 分支：`docs/plugin-architecture`
- ai-switch 调研基线：`a8387b5`。

## 1. 目标与已确认的取舍

构建可被其他应用复用的插件基础设施，ai-switch 是第一个接入方，而不是协议的所有业务能力提供方。

| 要求 | 设计决策 |
| --- | --- |
| 客户端与网页双模式 | 同一份插件前端、同一套能力协议；适配器选择 Tauri IPC 或 HTTP/WebSocket |
| 简单插件不写 Rust | HTML/JS/TS 插件调用 Node 风格异步 API，由 Rust 宿主执行特权操作 |
| 通用 npm runtime | 发布与 ai-switch、Tauri、React、Vue 无关的运行时；业务、鉴权和传输从宿主注入 |
| 复杂插件可用 Rust | 独立原生进程经版本化 RPC 接入，不向主进程加载第三方动态库 |
| 插件通过 GitHub CI Release 发布 | 公开 `ai-switch/plugin-store` 接收任何人的发布申请 PR；审核合并后由受控 CI 构建、签名并发布 Release，Actions artifact 不作为发布终点 |
| 插件扩展名 | 统一为 `.aplg`；内部使用 ZIP 容器和 `aplg.json` 清单 |
| 架构优先于旧插件兼容 | MenuGit 仅作设计参考；不承诺 `.oplg`、`window.otools`、同步 Noder I/O 或旧 C ABI 兼容 |
| 本轮交付 | 修订设计，使用 gh 创建 plugin-store 并初始化贡献文档和 PR 模板；不实现运行时、不配置自动发布、不执行 npm 或插件 Release 发布 |

“支持 Node API”指明确定义的接口和行为子集，不指完整 Node.js、任意 npm 包或无限制的系统权限。通用 npm 包也不能凭空为普通浏览器增加真实文件系统能力。

## 2. 现状依据

### 2.1 ai-switch

- `src/lib/transport/types.ts` 已统一异步 `call()`、`subscribe()`；`tauri-transport.ts` 与 `web-transport.ts` 分别实现两种承载。
- `src-tauri/src/lib.rs` 和 `src-tauri/Cargo.toml` 已区分 `desktop` 与 `standalone-server`。插件公共能力必须在不启用桌面特性的情况下编译。
- `src-tauri/src/web/auth.rs` 区分主 token 和低权限移动配对 token；新插件入口不能因为复用 `/api/:command` 而绕过该边界。
- `src/components/settings/plugin-management-settings.tsx` 中的 SaaS、生图仍是随主程序发布的内置模块，不是动态代码加载系统。
- `src-tauri/tauri.conf.json` 当前的 CSP 为 `null`；`capabilities/default.json` 面向主窗口。接入第三方代码前必须建立专用容器与可验证的 IPC 隔离。
- 应用发布 workflow 监听 `v*.*.*`。公共 npm 包与插件的 tag 必须使用不同前缀，避免误触发应用发布。

### 2.2 MenuGit

调研路径为 `D:\Repos\xyito\lingyun\MenuGit`，主仓库快照为 `165db14`，其 SDK 快照为 `3f9a024`。

可借鉴插件独立打包、宿主能力桥接、公开 SDK、原生能力分层等经验。`noder/runtime.js` 中的同步 XHR 私有协议、宿主专用命令和动态库 ABI 不作为 APLG 的基础约束。MenuGit 及其 `otools-publish` 插件 workflow 当前上传的是 Actions artifact；APLG 的流程继续走到正式 GitHub Release。

不复制 MenuGit 宿主实现。需要复用第三方代码时单独检查许可证并保留声明；不能因 SDK 使用 MIT 就推定整个参考项目使用相同许可证。

## 3. 架构方案比较

| 方案 | 判断 |
| --- | --- |
| 一个包含 Tauri/Rust 二进制、宿主 UI 和插件 API 的大 npm 包 | 表面安装简单，实际绑定平台和应用，不适合作为通用运行时 |
| 按协议、SDK、Node shim、React、Vue、Tauri、Web 等拆分大量 npm 包 | 边界细，但首期发布、版本协调和接入成本过高 |
| **两个 npm 包 + 可选 Rust 宿主实现 + 应用适配器** | **采用。角色通过子入口分离，平台能力通过协议注入，首期保持小规模包结构** |

运行时指插件页面装载、生命周期、隔离消息桥和能力客户端，不指内嵌 Node/V8/QuickJS。首期不引入额外 JavaScript 服务端执行引擎。

## 4. 总体架构与职责

```text
插件页面：HTML / React / Vue / JS / TS
  ├─ @ai-switch/tauri-plugin-runtime/plugin          生命周期、能力客户端
  └─ node:fs/promises 等           devkit 构建期映射
                  │
          隔离 iframe + MessagePort
                  │
         @ai-switch/tauri-plugin-runtime/host        装载、实例路由、事件分发
                  │
          宿主注入的 HostTransport
           ┌──────┴──────┐
        Tauri IPC     HTTP + WebSocket
           └──────┬──────┘
                  │
            aplg-host（Rust）
  身份校验 / 权限 / VFS / 安装更新 / 能力注册 / 进程监督
                  │
   ┌──────────────┼──────────────────┐
标准能力 Provider   ai-switch 专属 Provider   可选原生插件进程
```

依赖方向为“应用适配器依赖公共运行时/宿主”，公共组件不得反向引用 ai-switch。

### 4.1 npm 包：`@ai-switch/tauri-plugin-runtime`

ESM、TypeScript 声明、浏览器标准 API；框架无关。导入模块本身不启动容器、不读宿主凭据，允许 SSR/构建工具安全导入；实际挂载阶段才要求 DOM。

| 子入口 | 使用者 | 职责 |
| --- | --- | --- |
| `/host` | 宿主应用 | 创建容器、握手、生命周期、桥接、事件与资源释放 |
| `/plugin` | 插件作者 | 就绪状态、能力发现、存储、对话框、能力调用及订阅 |
| `/node/fs/promises`、`/node/fs`、`/node/path`、`/node/buffer`、`/node/events` | 构建适配器或插件 | 已声明范围内的 Node 风格 API |
| `/protocol` | 宿主/工具作者 | 协议类型、版本常量、消息和 manifest 的 JSON Schema |

宿主和插件是不同入口、不同运行上下文，不是把宿主对象挂到插件的全局变量上。`/host` 不打包进插件产物；打包体积与依赖检查验证此约束。即使恶意插件自行导入 `/host`，它也不能获得真实凭据和后端授权。

首期不另发独立 SDK 包、框架组件包或 MenuGit 兼容包。React/Vue 宿主只需自行用组件包装 `mount()` / `dispose()`。

### 4.2 npm 包：`@ai-switch/tauri-plugin-devkit`

面向构建阶段的 Node 工具，不进入插件浏览器运行时：

- 提供 `aplg init`、`aplg validate`、`aplg pack`、`aplg inspect` CLI。
- `/vite` 提供插件项目的 Node alias、bootstrap 注入、相对资源路径和产物检查。
- `/testing` 提供模拟宿主、协议夹具和能力契约测试工具；模拟宿主不得作为生产权限实现。
- 生成 GitHub Actions 发布模板；校验入口、能力、版本、产物清单、原生 target 和归档路径。
- 只在插件构建中启用 Node alias，白名单同时接受 `node:fs/promises` / `fs/promises` 等带前缀与不带前缀的标准名称；不创建任意模块 `require`，也不修改宿主、devkit 自身或 Rust 的构建行为。

开发工具以 Node.js 22 或更高版本为基线；浏览器包不要求用户机器安装 Node。运行时不要求运行期执行 `npm install`，所有 JS 依赖由插件构建阶段打包。

### 4.3 Rust crate：`aplg-host`

提供可复用的服务端参考实现：会话、权限、VFS、安装包检查、版本注册、能力分派与原生进程监督。无 Tauri、WebView、ai-switch 模型、应用数据库表等直接依赖。

调用方注入可信身份、数据根目录、元数据持久化和能力 Provider。SQLite 接入、现有出站代理以及 ai-switch 的业务服务属于应用适配器，不写入通用核心。原生进程功能使用可选特性，纯 Web 插件不为此启动辅助进程。

crate 是独立源码/发布单元，不把平台二进制塞进 npm `postinstall`。第三方 Rust 应用可复用它；Electron/Node 或其他后端可以自行实现同一协议，不强制使用 Rust。仅浏览器的宿主只能提供浏览器确实拥有的能力，未提供的真实文件系统能力必须报告不可用。

### 4.4 命名与许可

npm 包名按用户要求固定为 `@ai-switch/tauri-plugin-runtime` 和 `@ai-switch/tauri-plugin-devkit`。名称中的 `tauri` 不改变宿主中立性：浏览器入口仍不依赖 Tauri，其他应用可以实现同一协议。GitHub 的 `ai-switch` 组织权限已确认，但不能据此推定 npm 同名 scope 或包的发布权限；正式 npm 发布前仍需核验并配置。Rust crate `aplg-host` 仍为建议命名，发布前核验注册归属。新公共代码建议延续本仓库 MIT 许可，随包携带许可证和必要的第三方声明；不迁入已有业务模块的实现代码。

## 5. 对外接入体验

以下代码说明设计中的公共接口，不代表仓库已有这些导出。

### 5.1 宿主作者

`createPluginHost({ transport })` 接收宿主实现的两种操作：

- `call<T>(operation, args): Promise<T>`：经过可信宿主身份认证的 APLG 请求。
- `subscribe(handler): Promise<Unsubscribe>`：接收 APLG 事件信封，而非把任意应用事件总线交给插件。

`mount({ pluginId, container })` 返回已启动的视图实例，实例的 `dispose()` 关闭会话和释放资源。安装、卸载、信任发布者等管理员功能不属于插件端 API。

ai-switch 适配器把 APLG 操作封装为现有 `Transport.call("aplg_dispatch", ...)`，把 APLG 事件映射到专用通道；插件端既不知道 `/api/:command`，也不知道 Tauri 内部接口。其他宿主可以换掉整个适配器，而不修改插件。

### 5.2 插件作者

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { aplg } from "@ai-switch/tauri-plugin-runtime/plugin";

await aplg.ready();
const file = path.join("/data", "preferences.json");
await fs.writeFile(file, JSON.stringify({ enabled: true }), "utf8");
const preferences = JSON.parse(await fs.readFile(file, "utf8"));
```

插件只写 JS/TS。`node:fs/promises` 被 devkit 映射到 APLG shim，文件操作经过宿主身份和权限校验后由 Rust 完成。

`aplg.capabilities.supports(name, range)` 判断可选能力，`aplg.call(capability, method, params)` 调用已获准的方法。ai-switch 的业务扩展使用 `ai-switch.*` 命名空间，不混入 `aplg.*` 标准能力。能力存在和版本满足不代表用户已授予所有资源范围，调用仍可能返回权限错误。

## 6. 协议、身份与生命周期

### 6.1 版本与协商

区分四种版本，不能用 npm 包版本代替其他版本：

1. npm/Rust 实现版本，遵循各自 SemVer。
2. 线协议版本，首期为 `aplg/1`。
3. `aplg.json` 的 `manifestVersion`，首期为 `1`；`engines.aplg` 表示插件 API 契约版本范围。
4. 插件自身版本，以及每项标准/宿主能力的版本。

`session.open` 由宿主读取已安装、已验证的 manifest，返回协议、可用能力、容器资源描述、会话标识、有效授权及限制。协议主版本、必需能力或 API 范围不匹配时，在执行入口脚本前拒绝启动；缺少可选能力不影响其他功能。

同一 JS 包装接口不强制所有宿主提供全部能力。只有通过对应能力契约测试的 Provider 才能宣告支持，不能用空实现“模拟成功”。

协议与 manifest 的 schema 以 `packages/tauri-plugin-runtime/src/protocol/schema/` 为唯一源，供 devkit 和外部宿主使用。TS/Rust 类型由该契约生成并提交，CI 检查生成物与共同夹具一致；普通 Cargo 用户不需要先安装 Node 才能编译公共 crate。

### 6.2 请求边界

宿主侧操作白名单为 `session.open`、`session.close`、`capability.call`、`subscription.open`、`subscription.close`、`request.cancel`。插件消息桥只接受能力调用、订阅和取消；不能转发 `session.open`、安装管理或任意应用 command。

`capability.call` 请求包含协议、请求 ID、会话 ID、能力名、方法和 JSON 参数；`session.open` 尚无会话 ID，只接收可信宿主提供的已安装插件选择和协商信息。会话由后端绑定可信 principal、插件 ID、安装包摘要、版本和授权修订号；身份不从插件参数、URL 或 manifest 自报信息推导。会话 ID 单独不是权限凭据，也不能跨登录主体重用。

`MessagePort` 与具体视图实例一一绑定，宿主根据端口查找会话。插件声明的 `pluginId`、`sessionId`、`origin` 均不能覆盖这份绑定。后端再次检查会话归属、能力、方法、资源范围和实例状态。

### 6.3 返回、事件与中断

- 返回统一错误信封：`code`、面向用户的 `message`、可选 `details` 和 `requestId`；不把宿主堆栈、真实绝对路径或凭据原样传给插件。
- 标准错误包括 `E_CAPABILITY_UNAVAILABLE`、`E_PERMISSION_DENIED`、`E_SESSION_CLOSED`、`E_TIMEOUT`、`E_CANCELLED`、`E_LIMIT_EXCEEDED`、`E_PROTOCOL_MISMATCH`。Node shim 将文件错误映射为 `ENOENT`、`EACCES`、`EEXIST`、`ENOTDIR` 等已支持的 Node 错误。
- 事件必须带会话 ID、订阅 ID 和该订阅内的递增序号，只分发给所属视图。重连后重新建立订阅；首期不承诺断线事件补发，通过重新查询状态恢复，不能伪装成无损恢复。
- 请求 ID 在会话中唯一。超时或重连不得自动重发写文件、删除、执行进程等非幂等操作；取消不保证已经发生的副作用被撤销。
- `dispose()`、停用插件、退出登录、授权撤销或升级都会关闭/失效会话，取消订阅和未完成任务，释放端口与临时资源。已完成的写入不会被自动回滚。

首期插件 JS 的生命周期绑定打开的视图；关闭页面后不承诺 JS 后台持续运行。定时服务或持久后台 JS runtime 不混入第一阶段；既有 SaaS 服务仍由内置模块管理。

## 7. 文件系统与 Node API 子集

### 7.1 采用插件虚拟路径

放弃旧 MenuGit 原路径兼容后，采用跨平台 POSIX 虚拟路径，避免把 Windows/Unix 真实路径差异传播到插件：

| 虚拟根 | 含义 | 默认访问 |
| --- | --- | --- |
| `/app` | 当前插件包内的不可变资源 | 只读 |
| `/data` | 当前 principal 与插件 ID 下的持久数据 | 声明能力并获准后读写，升级保留 |
| `/mounts/<grantId>` | 用户明确授权的宿主文件或目录 | 按 grant 的读写范围和有效期 |

`node:path` 的默认映射为 POSIX 语义，`resolve()` 的虚拟工作目录固定为 `/data`；这不是对 Windows Node 默认路径语义的完整模拟。API 兼容性文档和类型说明必须明确此差异。首期文件接口只接受绝对虚拟字符串路径，不接受宿主绝对路径、文件描述符或 `file://` URL。

Rust 把虚拟路径映射到实际文件系统；返回路径相关信息时也不能泄漏宿主原始路径。插件不通过拼接 `C:\`、`/etc` 或 `../` 获得授权范围外的访问权。

### 7.2 双模式语义

- 桌面模式：`/data` 和授权挂载位于桌面 Rust 进程所在电脑。
- 网页模式：相同虚拟路径位于 Rust 服务端机器，不是浏览器访问者电脑。
- `aplg.dialog.pickDirectory()` 返回挂载 grant；桌面由原生选择器实现，Web 由受限的服务器目录选择界面实现，文案明确“服务器目录”。服务端不能弹出无人可见的桌面对话框冒充 Web 选择器。
- 浏览器本机文件上传/下载使用独立的导入导出能力，不返回虚假的宿主文件路径，不与“选择服务器目录”混用。

### 7.3 首期声明的子集

| 模块 | 首期范围 |
| --- | --- |
| `node:fs/promises` | `readFile`、`writeFile`、`appendFile`、`readdir`、`stat`、`mkdir`、`rename`、`copyFile`、`rm`，签名/选项边界如下文所列 |
| `node:fs` | 上述异步操作的回调形式与 `promises`；同步 I/O 明确抛 `ERR_APLG_SYNC_IO_UNSUPPORTED` |
| `node:path` | `join`、`resolve`、`normalize`、`dirname`、`basename`、`extname`、`relative`、`isAbsolute` 的 POSIX 虚拟路径语义 |
| `node:buffer` | 使用受维护的 Buffer 实现并保留许可证；按已测试范围处理字节与 UTF-8/base64 |
| `node:events` | `on`、`once`、`off`、`emit`、`removeAllListeners`，纯 JS 实现 |

文件 API 的首期签名边界：

- `readFile` 接受省略编码、`null`、`"utf8"` 或 `{ encoding }`；无编码返回 Buffer，有 UTF-8 编码返回字符串。
- `writeFile` / `appendFile` 接受字符串或 `Uint8Array`，编码限 UTF-8；写入 flag 分别支持 `w`/`wx`、`a`/`ax`，默认分别为 `w`、`a`。不接收 stream/iterable。
- `readdir` 返回名称数组；`withFileTypes: true` 返回含 `name`、`isFile()`、`isDirectory()` 的 Dirent 子集，不递归遍历。
- `stat` 返回 `size`、`mtimeMs`、`isFile()`、`isDirectory()` 的 Stats 子集，不承诺完整 Node Stats 或 BigInt 字段。
- `mkdir` 仅接受 `recursive`；`rm` 接受 `recursive`、`force`；`rename` 仅允许同一授权根内移动，跨根返回 `EXDEV`；`copyFile` 首期仅支持默认覆盖模式。
- 回调形式使用 Node 的 error-first 约定。发布的是子集类型定义，不把全量 `@types/node` 当作能力承诺；动态访问不支持的方法同样失败。

不支持的导入、选项或签名必须在构建校验或运行时明确报错，不静默忽略。类型、文档与差分测试共同限定支持范围。

首期不支持同步 I/O、动态磁盘 `require()`、`.node` 扩展、`worker_threads`、文件描述符、流、watch、符号链接创建、完整 `process.env` 和 `child_process`。外部进程走后续显式原生能力，不开放任意 shell。

控制消息 JSON 编码上限为 1 MiB；二进制按显式 base64 信封传输，不把 Buffer/BigInt/Date 当作普通 JSON 直接序列化。超过消息上限的文件数据使用会话范围内的分块传输句柄，每块原始字节不超过 256 KiB。`aplg.fs` 的传输方法白名单为 `transfer.openRead`、`transfer.openWrite`、`transfer.pull`、`transfer.push`、`transfer.finish`、`transfer.abort`；分别处理已授权虚拟路径、读写方向、偏移与总长度，Node shim 在内部组装，业务代码不感知分块。`transfer.openWrite` 记录最终 `writeFile`/`appendFile` 模式，暂存内容完整后由 `transfer.finish` 复核授权、配额和创建/覆盖条件并提交，取消清理暂存内容；不能把未完成块当作成功写入。句柄不可跨插件使用，并在会话关闭后失效。`readFile`/`writeFile` 的首期单文件上限为 8 MiB，单插件并发文件传输上限为 2；更大文件返回限制错误，后续以独立流能力扩展，不绕过鉴权复用任意文件 URL。

写入、读出、传输句柄、磁盘配额均由 Rust 限制；JS 限制只改善开发体验，不承担安全边界。

## 8. 隔离、授权与安全要求

### 8.1 UI 与 IPC

默认容器为 `sandbox="allow-scripts"` 的 iframe，不添加 `allow-same-origin`、顶层导航或任意弹窗权限。初始化桥校验 `event.source`、一次性 nonce 和预期视图，只传递该实例的 MessagePort。opaque origin 为 `null`，不能把字符串 origin 校验当作身份认证。

插件资源使用专用资产路径/来源和独立 CSP；禁止直接连接管理 API、外部网络以及执行远程脚本，网络需求通过受控能力层实现。ESM 需要的 CORS 只对不可变插件静态资源开放，不能扩展到管理 API 或任意宿主文件。

桌面参考适配器使用独立的 loopback 只读资产服务来源，不启用现有完整 Web 管理服务。该来源不授予 Tauri remote IPC 权限；资产访问票据只允许读取指定包摘要下的资源，不授予能力调用或任意文件访问。监听器只绑定 loopback、校验 Host 和资产路径，随插件容器需求启动/回收。Web 适配器可复用既有 HTTP 服务的专用静态资产路由，仍使用 opaque iframe 和独立 CSP。

不能仅凭 iframe sandbox、全局变量隐藏或窗口标签断言安全。上线门槛是三种桌面 WebView 及支持的浏览器中，插件尝试直连 Tauri command、管理 HTTP/WS、宿主 DOM/localStorage 和其他实例均被拒绝。若某承载无法证明 IPC 隔离，则不向它开放第三方插件，不能降级为主页面执行脚本。

iframe 不是进程级资源沙箱，不承诺隔离死循环或所有渲染器崩溃；重计算应移出 UI，宿主保留停止/禁用插件的恢复入口。

### 8.2 权限模型

- 区分“提供了什么能力”和“允许访问哪些资源”。manifest 申请权限，宿主批准并存储 grant，Rust 每次调用复核。
- 默认拒绝未声明能力、未知方法、跨插件存储和读取宿主凭据。外部目录通过 grant 授权，不能靠把绝对路径写进 manifest 授权。
- 路径检查必须处理 `..`、大小写碰撞、符号链接、Windows junction/reparse point 和创建/访问竞态；使用受限根下的安全打开策略，不能只检查一次字符串前缀或 canonicalize 后再任意打开。`rename`、`copyFile` 必须分别校验来源和目标，不能只授权其中一端。
- 目录挂载默认不授权 ai-switch 数据库、令牌和凭据文件；扩大普通目录范围不能隐式开放这些敏感资源。
- 网络能力限制协议、目标、方法和响应体大小，每次重定向重新校验；服务端防范 DNS 重绑定和到 loopback/内网的 SSRF。访问内网需要单独的管理员批准，不随普通互联网权限开放。
- 插件管理和 `aplg_dispatch` 在 ai-switch 首期均为主管理员权限入口；移动配对 token、SaaS 用户会话不得调用。以后向其他主体开放时重新设计主体与资源隔离，不只放松路由白名单。
- 主 token 留在受信宿主，不能下发给 iframe、写入资源 URL 或放入插件日志。现有共享主 token 仍代表一个管理主体，不能声称已获得独立多人/租户隔离。
- 权限扩大、原生执行或发布者变更必须重新确认；停用/撤销授权对既有会话生效。

安全敏感日志只记录插件 ID、包摘要、请求 ID、操作、结果与耗时，路径使用虚拟路径，内容和凭据脱敏。

## 9. 复杂插件的原生扩展

该能力作为后续单独交付的 `native-stdio-v1` profile，不是简单插件或 npm runtime 的前置条件。

- 原生插件是独立可执行程序，不是 Tauri plugin，也不是主进程内动态库。
- 建议 Rust 实现，协议不限制语言。使用 UTF-8、逐行 JSON-RPC 2.0；stdout 只传协议，stderr 传日志，每行信封不超过 1 MiB，超限即中止该进程会话。
- 宿主使用结构化 argv 启动，不通过 shell 拼接命令。执行目标只能来自已校验包清单，不能由插件传任意系统可执行路径。
- 双向 RPC 支持初始化、插件方法、事件、取消和关闭；原生进程调用宿主能力时仍绑定原实例与授权，不提供“任意宿主 invoke”。
- 原生版本随包不可变；每个活动插件会话由宿主管理对应进程，崩溃、超时、停用时终止并清理子进程树。首个 profile 的进程随视图生命周期运行，不承诺独立后台常驻服务。
- Web 模式在 Rust 服务端运行原生程序，根据服务端 target triple 选产物，不根据浏览器 UA 选择。
- 未提供匹配平台、架构或 ABI/运行库条件的产物时明确不可用，不能尝试加载“同系统其他架构”的产物。

独立进程提供故障隔离而非恶意代码沙箱。原生代码可能直接使用 OS 文件/网络接口；未实施可靠 OS 沙箱时，整个 profile 只允许明确授信的原生插件，并在启用前说明其进程账户权限。不能把经过 Broker 的权限清单误当成对进程直接系统调用的限制。

不实现 MenuGit 的 `otools_plugin_invoke`/`free`/`bind_host` ABI 适配，不引入同步 XHR，也不在首期同时引入 WASM 和真实 Node 进程三套后端。

## 10. `.aplg` 包与清单

```text
example-1.2.3.aplg               ZIP，扩展名不作为真实性凭据
├─ aplg.json                    唯一运行时清单
├─ dist/index.html              本地入口与打包后的静态资源
├─ dist/assets/
├─ icon.svg
├─ LICENSE
└─ native/                      可选，后续原生 profile 使用
   └─ <target-triple>/plugin[.exe]
```

纯 JS 插件只需要一份平台无关 `.aplg`。原生插件按 target triple 发布资产；同一插件版本的各目标包必须具有相同逻辑 ID、权限与能力声明，仅目标产物清单及摘要不同。`package.json` 只服务构建，不是另一个运行时权限来源。

### 10.1 最小文件能力插件清单

```json
{
  "manifestVersion": 1,
  "id": "io.github.example.notes",
  "name": "Notes",
  "version": "1.2.3",
  "description": "A portable notes plugin",
  "license": "MIT",
  "engines": { "aplg": "^1.0.0" },
  "entry": "dist/index.html",
  "activation": "view",
  "requires": { "aplg.fs": "^1.0.0" },
  "optional": {},
  "permissions": {
    "filesystem": [
      { "root": "plugin-data", "access": ["read", "write"] }
    ],
    "network": [],
    "native": false
  },
  "contributes": {
    "views": [ { "id": "main", "title": "Notes" } ]
  }
}
```

`permissions.filesystem[].root` 首期只接受 `plugin-data` 和 `user-selected`，分别表示 `/data` 与通过交互授权挂载的资源；声明 `user-selected` 本身不创建 grant。`/app` 只允许读取自身包，不能写入。

ID 为稳定的小写命名空间标识，不因显示名或 GitHub 仓库改名变化。官方登记将 ID 与核验过的维护者、源码仓库身份绑定；分发信任另绑定 plugin-store 的仓库身份与签名密钥。不能凭自报 ID、维护者数组或商店共用公钥冒用其他已登记插件。

`requires` 不满足则不能启动，`optional` 只用于功能降级。首期贡献点仅为独立页面和显式打开动作，不允许注册任意 HTTP 路由、访问数据库表或把插件代码直接注入算力池/账务热路径。宿主可以将 `contributes.views` 映射为侧栏或工具列表。

第三方扩展字段只能放入命名空间化的 `extensions` 对象。未识别的扩展字段不能扩大权限。正式包禁止远程入口、`devUrl`、运行时 CDN 依赖和安装脚本。

### 10.2 归档校验

安装前校验清单 schema、版本、入口、资源清单、大小及签名关联。解包拒绝绝对路径、路径穿越、符号链接、大小写/规范化后重复项、设备路径和越界入口；解包不执行任何脚本。

参考宿主默认最大压缩包 128 MiB、解包总量 512 MiB、文件数 10,000、单插件持久数据 64 MiB；这些是宿主可收紧的资源策略，并在会话中报告。升级临时空间需要容纳暂存和保留版本；空间不足时在切换前失败。变更这些限制不自动放宽对插件已授予的权限。

## 11. 安装、运行与更新

后端注册表是安装状态的权威来源；npm runtime 只镜像展示状态，不以浏览器 localStorage 决定哪个插件被信任或启用。

安装记录包含：插件 ID、版本、包摘要、源码仓库 ID/源码 commit、分发仓库 ID/商店 commit、签名 key ID、来源 Release、启用状态、授权修订、数据版本、当前及上一个可用版本。源码作者身份与分发签名身份不能合并为一个含糊的“发布者”。使用 ID/版本/摘要管理不可变目录，不原地覆盖正在使用的文件。

```text
Release 发现
  → 校验来源、签名、摘要、版本与能力要求
  → 下载到暂存区并安全解包
  → 展示/确认新增权限
  → 停止受影响的旧会话和原生进程
  → 在同文件系统内切换当前版本记录
  → 完成启动检查后标记可用
  → 失败则恢复旧版本记录并重新打开旧版
```

- 下载失败、断网、签名不符、解包错误、权限被拒绝均不破坏正在使用的旧版本。
- 采用每插件安装锁和原子状态提交，防止多网页或桌面/Web 同时更新产生混合版本；崩溃恢复依据事务记录清理未提交暂存版本。
- 同版本不同摘要视为冲突，不静默替换；生产更新不覆盖已发布版本。
- 首期不执行自动数据迁移脚本。插件应保持相邻版本数据向后兼容；宿主在首次运行新版前快照其受管 `/data`，回滚可恢复快照并告知新版产生的数据会丢失。外部挂载、网络副作用无法回滚，不能声称整个插件运行具有事务性。
- 停用保留数据；卸载默认保留数据，删除数据需要单独明确确认。
- 更新管理记录可存入 ai-switch 现有 SQLite，但公共 crate 通过持久化接口访问，不依赖应用内部表结构。

## 12. 三条独立的发布流水线

### 12.1 通用 npm 包

公共包版本不跟随 ai-switch 应用版本。首期 runtime 与 devkit 使用相同发布版本，devkit 明确依赖对应 runtime 范围；协议/API 版本独立协商。

同仓库采用 `tauri-plugin-runtime-vX.Y.Z` tag，不会命中现有应用的 `v*.*.*` workflow：

1. 校验 tag、两个包版本和依赖范围一致，使用锁文件安装依赖。
2. 执行类型检查、单元测试、协议测试、Node 子集测试及构建。
3. `pnpm pack` 生成 tarball，在仓库外的测试目录只从 tarball 安装；测试导入、类型、子入口、静态宿主挂载和无 Tauri/ai-switch 依赖。
4. 检查发布文件白名单、许可证、source map 内容、密钥和意外原生产物。
5. 使用 GitHub Actions 的 npm trusted publishing/OIDC 发布并生成 provenance，不在仓库保存长期 npm token。
6. 两个包按依赖顺序发布至临时候选 dist-tag，全部成功后才提升稳定 dist-tag；失败时保留原稳定版本，重试前校验已发布版本的完整性。npm 不提供多包原子事务，不能声称“两包同时原子发布”。候选 dist-tag 仅控制默认安装，不阻止按版本范围解析已发布版本；接入项目应使用锁文件，不能依赖 dist-tag 获得事务隔离。
7. 在 GitHub Release 附加包 tarball、校验值、API 兼容说明和变更说明；GitHub Release 是 npm 发布结果的记录，不替代 npm registry。

首次公开发布前需要维护者创建/确认 npm scope 与 package、配置 trusted publisher 的仓库/workflow 身份和受保护发布环境。未完成配置时 CI 失败关闭，不降级到不受控账号或临时密钥发布。

### 12.2 `.aplg` 插件：公开 PR 驱动的 plugin-store

#### 12.2.1 仓库角色

官方仓库为 [ai-switch/plugin-store](https://github.com/ai-switch/plugin-store)，GitHub 仓库数字 ID 为 `1368481641`。本轮已使用 `gh` 创建为公开仓库，默认分支 `main`，允许 Fork。

任何人都可以提交插件登记或新版本 PR；这不代表任何人可以直接发布。源码保留在作者自己的公开 GitHub 仓库，plugin-store 存放登记、固定版本发布申请、受控构建/签名逻辑和索引。它通过自己的 GitHub Releases 分发 `.aplg`，不是只收录外部下载链接，也不接收提交到 Git 的插件二进制。

```text
插件作者的公开源码仓库
  aplg.json + JS/TS/资源 + 锁文件 + 许可证
                │ 固定完整 commit
                ▼
ai-switch/plugin-store 的发布申请 PR
  entry.json + versions/<version>.json
                │ 校验、身份与源码审查、维护者批准
                ▼
受控模板构建 → 产物验收 → 独立签名/发布 job
                │
                ▼
plugin-store 的 GitHub Release + 可校验插件索引
```

普通插件作者不需要配置商店发布密钥，也不需要在自己的仓库设置签名或 Release 凭据。两种 npm 包和通用协议不硬编码该仓库；“官方源是 plugin-store”属于 ai-switch 适配器的产品策略，不限制其他宿主选择自己的分发服务。

#### 12.2.2 PR 登记契约

使用以下追加式结构，字段说明已同步到远程仓库的 `plugins/README.md`：

```text
plugins/<plugin-id>/entry.json
plugins/<plugin-id>/versions/<version>.json
```

- `entry.json` 包含 `schemaVersion: 1`、`id`、`name`、GitHub 用户名数组 `maintainers`、`repository`（`owner/repo`）、`repositoryId` 和 `license`。维护者列表只是一项待核验声明，不是授权凭据。
- 每份版本记录包含 `schemaVersion: 1`、`pluginId`、`version`、`source.repository`、`source.repositoryId`、完整 40 位 `source.commit`、仓库内相对根路径 `source.path`、原始 `aplg.json` 精确字节的 `source.manifestSha256`、`build.profile`、`targets` 和非空字符串 `notes`。
- 每份版本记录完整快照源码仓库信息，不能只引用可被更新的当前登记记录。校验仓库数字 ID、插件 ID、文件名版本、源码 manifest 与权限声明一致。
- 首期 profile 为 `web-v1`，目标为 `["universal"]`，使用配套 devkit 定义的受控 Web 构建模板；不接受任意 shell 命令、外部 workflow 路径或上传凭据。后续 `native-stdio-v1` profile 另行审查目标矩阵，当前不能以 `web-v1` 夹带原生代码绕过审核。
- 首次登记核验源码/资源发布权限、ID 归属和维护者身份。已有 ID 的更新需现有维护者授权；源码转移、维护者变更和接管申请单独审查，不能在版本 PR 中悄悄替换。
- 版本记录一经发布不可原地覆盖；修复新增 SemVer。存在问题的版本通过审核后的撤回状态停止推荐，不替换同版本资产或抹除审计来源。

这些元数据是发布申请，不取代 `.aplg` 内的 `aplg.json`。自动化实施时为登记及版本记录增加独立 JSON Schema，不能把运行时 manifest schema 当作商店记录 schema。

#### 12.2.3 审核、构建与发布隔离

```text
任何人的 Fork PR
  → 无发布凭据的格式、身份、来源和静态清单检查
  → 维护者审查固定源码及能力/权限变化
  → 通过必需检查和审核后合并 main
  → 从已审核 main 提交解析新增版本申请
  → 在隔离构建 job 中获取固定源码 commit 并构建
  → 验收 manifest、归档、能力、版本和目标产物
  → 独立签名/发布 job 上传 Draft Release
  → 必需资产完整后发布 Release
  → 生成并发布新的签名索引快照
```

PR 检查运行在 `pull_request` 的只读上下文，不在带权限的 `pull_request_target` 中 checkout/执行 PR 代码。静态来源读取仅允许经校验的 GitHub 仓库、固定提交和相对路径，不接受任意网络 URL。CI 读取 PR 中的版本字段时将其当作数据，不插入 shell 代码。workflow/action 固定可信提交或明确受保护版本，工具链与打包器版本由维护者配置，投稿元数据不能自行替换。

合并不是把第三方源码变成可信代码。构建 job 使用临时 GitHub-hosted runner、最低权限 token、`persist-credentials: false`，没有商店写权限、OIDC 签名权限或密钥；不复用可能被 PR 污染的高权限缓存。签名/发布 job 只运行维护者控制的代码和受控打包验证器，不执行插件的生命周期脚本、npm install、原生程序或任意解包后代码。

发布 job 只消费对应已审核 main SHA、workflow 和 run ID 的构建结果，不能从某个同名 artifact 或任意 PR workflow_run 自动获得发布资格。`web-v1` 产物内 `aplg.json` 必须与审核时的源码清单摘要一致，防止构建脚本悄悄扩大权限。归档路径和大小限制在签名前再次验证。

发布 workflow、签名策略、维护者配置需要额外 CODEOWNERS/规则集审批；发布 environment 设置审批与最小权限。在实施自动化时配置这些强制门禁，不能仅依赖贡献文档中的文字。GitHub 的提交作者字段、PR author 或版本文件里的 `maintainers` 数组都不能单独证明发布授权。

同一 PR 可以申请多个插件版本，但各插件使用独立并发锁与发布事务，局部失败不得把未验证版本写入索引。纯 JS profile 不安装 Rust、不编译 ai-switch。以后原生 profile 只发布声明且通过验证的 target；任一承诺目标失败就不发布该插件版本的稳定 Release。

#### 12.2.4 Release、签名与索引

发布 job 在已批准的商店提交上创建 `plugin-<id>-v<version>` tag，不依赖用户手工打商店 tag，也不会触发应用仓库的版本流程。Release 至少包含 `.aplg`、`release.json`、`release.json.sig` 和可读说明；同版本不同摘要必须拒绝覆盖。重跑只允许核对完全一致的既有发布结果，不能覆盖旧资产。

`release.json` 分开记录：

- 插件身份、版本、API/能力要求和审批过的源 manifest 摘要。
- `source`：实际源码仓库名称/数字 ID、commit 和插件根路径。
- `distribution`：`ai-switch/plugin-store`、仓库 ID `1368481641`、商店提交、发布 tag、workflow 和 run ID。
- 商店签名 key ID，以及每个资产的文件名、target、大小和 SHA-256。

商店使用独立 Ed25519 密钥签署 `release.json` 精确 UTF-8 字节，资产摘要由已签名清单关联，不在归档中放自引用哈希。密钥只在受保护的签名/发布 environment 中可用，不复用应用更新私钥，不交给投稿者或源码构建 job。商店签名表示受控来源、审核链与完整性，不证明代码无恶意；原生执行仍需宿主单独授信。

ai-switch 固定官方分发仓库身份及受信公钥。源码作者身份单独从已审查登记记录获取，不能误把所有插件都解释为由同一个源码作者维护。公钥的首次配置来自明确批准的官方配置，不能下载同一 Release 附带的公钥后自行建立信任；密钥轮换需旧可信密钥背书或管理员确认。仓库转移和发布者变更也不能静默继承信任。

在插件 Release 完整可用之后生成带单调递增序号、生成时间和有效期的签名索引，包含插件、版本、权限摘要、分发资产指针和撤回状态。索引快照使用独立 `index-<sequence>` Release；客户端按索引命名空间发现和验签，不能把 GitHub 全仓库的 `releases/latest` 当作所有插件或索引的最新版本。记录已接受的序号，拒绝索引回退；索引过期时提示更新发现不可用，不在失去可信元数据后静默安装。更新索引失败可重试，不能撤掉已完成插件 Release 或宣称尚未发布版本可安装。

第一版提供轻量官方列表、已安装列表和 PR 发布入口，不建设独立在线商店、付费系统或评分后台。本地目录/未签名 `.aplg` 仅用于显式开发模式，不进入正式信任库，Web 公开部署默认关闭开发模式。

#### 12.2.5 当前已建立与尚未实施的部分

已建立：公开仓库、MIT LICENSE、README、CONTRIBUTING、登记格式说明和 `.github/PULL_REQUEST_TEMPLATE.md`。初始化文档提交为 `b39cfbb`，当前可以正常 Fork 和提交 PR。

尚未实施：登记 schema/自动校验、构建 profile、身份自动核验、强制审核规则、CODEOWNERS/发布 environment、签名密钥配置、插件/索引 Release workflow。当前 PR 合并不会自动构建或发布；仓库公开不意味着已经启用上述强制安全门禁。它们属于第 15 节第三阶段的独立交付。

### 12.3 ai-switch 应用

继续使用既有版本文件、应用 tag 和发布规则。runtime/plugin tag 不更新应用版本、不生成应用 tag、不触发应用发布。只有把新的运行时依赖集成进宿主时，才按正常应用发布流程发布 ai-switch。

后续公共 Rust crate 有自己的 SemVer 和独立的受保护发布 job，不隐式从 npm `postinstall` 或插件构建触发发布。

## 13. 仓库落点与接入范围

下列 ai-switch 内目录是后续实施建议，本轮只修订本设计文档；独立的 plugin-store 已创建，但其中只有说明、登记契约、PR 模板和许可证：

```text
packages/tauri-plugin-runtime/               两侧运行时、Node shim、协议/schema
packages/tauri-plugin-devkit/                CLI、Vite 适配、测试工具、模板
examples/aplg-plain-host/                    无 ai-switch 依赖的外部使用样例
fixtures/aplg/                              兼容性、安全和归档夹具
src-tauri/crates/aplg-host/                  无 Tauri 依赖的通用 Rust 宿主
src/plugins/                               ai-switch UI、Transport 与内置项
src-tauri/src/plugins/                      ai-switch 身份/存储/业务 Provider
.github/workflows/tauri-plugin-runtime.yml  公共 npm 包流水线
```

独立仓库的落点如下；除已注明的初始文档外均为后续实施目录，不在应用仓库再维护一份插件发布 workflow：

```text
ai-switch/plugin-store/
  README.md                                已建立
  CONTRIBUTING.md                          已建立
  LICENSE                                  已建立
  plugins/README.md                        已建立，登记契约
  .github/PULL_REQUEST_TEMPLATE.md         已建立
  plugins/<id>/entry.json                  插件登记记录
  plugins/<id>/versions/<version>.json     版本发布申请
  schemas/store-entry.schema.json          登记 schema
  schemas/store-version.schema.json        版本申请 schema
  scripts/                                受控校验、构建分派、发布、索引逻辑
  .github/workflows/validate-pr.yml        PR 静态校验
  .github/workflows/release-plugin.yml     审核后构建与隔离签名发布
  .github/workflows/release-index.yml      签名索引生成与重试
```

新增 pnpm workspace、包清单、锁文件和 Cargo 依赖属于实施阶段，不在设计阶段提前改动。runtime/devkit 源码先在现有应用仓库维护，通过依赖边界和独立发布保持可提取性；plugin-store 按用户要求独立建仓，只管理登记、发布申请、索引与分发流程。具体插件源码留在各自公开源码仓库，不把商店变成插件源码 monorepo。

ai-switch 的最小接入点：

- 在设置中增加外部插件安装/启停/权限/更新状态，保留 SaaS 和生图开关。
- 独立页面容器消费 `contributes.views`，不允许插件直接修改主导航树、React state 或全局样式。
- 桌面命令和 Web dispatcher 都调用同一 `aplg-host` 服务入口；授权来源由外层可信适配器提供。
- APLG 事件复用现有物理传输，但有独立的信封和实例路由；不复制第二套 Web token 管理和重连实现。
- ai-switch 业务能力经过单独审查注册 `ai-switch.*`。首期不导出凭据读取、任意 SQL、内部 AppState 或无约束的算力池代理钩子。
- 内置 SaaS/生图可以使用统一管理项描述，但不强行转换为外部 `.aplg`，不承诺第三方插件拥有它们的核心服务权限。

## 14. 验证与验收要求

| 验证面 | 必须证明的结果 |
| --- | --- |
| 真正通用 npm 包 | 外部最小 HTML 宿主只安装发布 tarball 即可挂载纯 UI 插件；不依赖仓库 alias、ai-switch 源码、React/Vue 或 Tauri |
| npm 子入口 | `/host`、`/plugin`、Node shim、类型与 schema 都能从 tarball 导入，插件构建不携带宿主适配器/密钥 |
| 协议一致性 | TS 与 Rust 使用同一组 schema/夹具验证正常、错误、取消、能力不匹配、事件和会话过期 |
| Node 子集 | 在同一套虚拟根映射的临时目录内，将声明的签名/选项与真实 Node 的对应行为做差分测试；明确排除已记录的 VFS 差异 |
| 双模式 | 同一包在桌面及 standalone-server+浏览器运行，文件确实落在对应 Rust 执行端；Web 选择服务器目录而非访客本机路径 |
| 无桌面依赖 | 公共 crate 和 standalone-server 在关闭 desktop 特性时通过检查与测试 |
| 权限与隔离 | 越界路径、symlink/junction、伪造身份、跨实例事件、直接 IPC/HTTP、令牌窃取、未授权网络及低权限 token 全部被拒绝 |
| 资源与中断 | 大文件分块、总量/并发限制、取消、断网、关闭页面、授权撤销不会泄漏句柄或自动重复非幂等写入 |
| 发布与安装 | 任何人可通过 PR 申请；发布身份与权限不可自报绕过；PR/构建 job 无发布凭据；纯 JS CI 不依赖 Rust；只有审核后完整 `.aplg` 与签名 Release 才进入索引，篡改、回退和不完整发布被拒绝 |
| 更新恢复 | 并发更新、进程占用、磁盘不足、启动失败及崩溃恢复保持旧版可用，明确受管数据与外部副作用的回滚差异 |
| 原生 profile | 在后续交付中验证目标匹配、无主进程内加载、崩溃隔离、进程树清理和可信执行提示 |
| 既有功能 | 插件关闭/未安装时，SaaS、生图、账号管理与双模式传输行为不变 |

所有未来 AI Rust 检查复用本工作树的 `src-tauri/target-codex/`：在 `src-tauri` 工作目录设置 `CARGO_TARGET_DIR=target-codex`。公共 crate、样例和原生测试也复用该目录，不创建根 `target`、crate 自己的 `target` 或第三个临时 target。只有本地 dev 使用 `src-tauri/target/`。

本轮未实施 runtime 或发布自动化，因此不运行应用测试或 Cargo 构建；检查设计文档格式、示例 JSON、内部一致性、Git 改动范围，以及远程仓库可见性、文档、PR 入口和实际 workflow/Release 状态。

## 15. 分阶段交付与实施边界

本规格是架构总纲，不作为一个巨大任务一次实现。书面审阅后，分别为以下独立交付编写详细实施计划：

1. **通用契约与 npm 可复用性**：manifest/protocol、runtime 角色入口、devkit、无 ai-switch 的模拟宿主和纯 UI 插件；从实际 tarball 验证外部接入。
2. **Rust 能力与双模式安全接入**：可信会话、权限、VFS、Node 异步子集、隔离资产服务及 ai-switch 两种传输；用同一文件插件完成两端验收。
3. **正式发布和插件管理闭环**：独立 plugin-store 的公开 PR 登记、身份审核、隔离构建、签名 Release 与索引，npm trusted publishing、安全安装、更新恢复、管理 UI；未完成安全与发布验收前不开放生产第三方安装。
4. **原生扩展 profile**：独立 Rust 进程、RPC、平台矩阵与可信执行策略，独立验收，不阻塞简单插件生态。

不列入上述交付：旧 MenuGit 二进制兼容、完整 Node、同步 I/O、WASM、持久后台 JS、独立在线商店/付费分发/评分系统、SaaS 多租户插件安装、核心账务/代理热路径插件化。以后出现明确需求时新增专门设计，不以兼容开关偷偷加入公共核心。

## 16. 结论

APLG 应是“可复用的运行时与协议 + 可替换的能力宿主”，而不是“把 ai-switch 的插件代码包装为 npm 包”。以两个 npm 包和一个独立 Rust 宿主为起点，插件作者只需 Web 技术即可开发普通插件，其他应用无需采用 ai-switch 的业务结构即可接入。`.aplg`、异步能力边界和可信发布机制构成新的明确契约；MenuGit 的历史兼容不再限制该契约。
