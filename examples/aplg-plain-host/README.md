# APLG 无框架宿主演示

**模拟宿主，仅内存数据。** 使用原生 HTML/TypeScript 和公共 npm 子入口，不使用 React、Vue、Tauri、devkit 或应用源码 alias。

## 本地运行

需要 Node `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm `10.12.4`。在仓库根目录：

```sh
pnpm install --frozen-lockfile
pnpm --dir packages/tauri-plugin-runtime build
pnpm --dir examples/aplg-plain-host typecheck
pnpm --dir examples/aplg-plain-host build
pnpm --dir examples/aplg-plain-host preview
```

打开 `http://127.0.0.1:43181`，点击「打开插件」。插件资产来自另一个 loopback 来源 `http://127.0.0.1:43182`。两端口可通过 `APLG_HOST_PORT` / `APLG_ASSET_PORT` 覆盖；不要监听公网。Ctrl+C 关闭示例服务。

开发入口使用构建后的静态页面，而非 Vite HMR，避免把 dev server 的 WebSocket、源码服务和较宽 CSP 误当作隔离方案。修改后重新 build/preview。

## 结构与边界

- `src/main.ts`：`createPluginHost()`、挂载/关闭按钮和资源计数。
- `src/memory-transport.ts`：注入 `HostTransport`；只实现 `aplg.storage.get/set/remove`，数据限定当前视图会话，返回值为快照。
- `plugin/aplg.json`：仅声明 storage；系统文件、网络权限均为空，`native:false`。`entry` 对应示例构建目录的 `dist/plugin/index.html`。
- `plugin/main.ts`：只从 `@ai-switch/tauri-plugin-runtime/plugin` 使用 `aplg`，不接触宿主 DOM/localStorage，也不导入真实 Node 模块。
- `scripts/serve.mjs`：按 Vite manifest 的各页依赖图提供静态文件，插件端不提供宿主页/宿主独占 JS。两端均无 inline/eval CSP；只有插件资产端开放 CORS，以便 opaque iframe 加载 ESM。
- 视图使用 `sandbox="allow-scripts"`，没有 `allow-same-origin`。
- 每会话至多 32 个 key、每个 JSON 值至多 64 KiB，示例至多 4 个并发视图；页面只打开一个。关闭/刷新即丢弃数据。

`packageSha256` 的全零值是**显式模拟身份**，不是文件哈希或签名；这里没有 `.aplg` 归档生成、安装、验签、持久存储或真实认证。真实 `aplg.fs` 不可用。实际 Tauri/Web 宿主仍需独立完成身份、资产访问、CSP/IPC 隔离、OS 授权和资源回收。不要将此内存 Transport 用作生产权限系统。

## 独立 npm 安装验收

本目录的 `workspace:*` 只方便仓库内开发，**不作为独立安装成功的证据**。执行：

```sh
pnpm --dir packages/tauri-plugin-runtime exec playwright install chromium webkit
pnpm --dir packages/tauri-plugin-runtime verify:tarball
```

验收会在仓库外 `os.tmpdir()` 创建消费者，将此示例的依赖替换为真实 `.tgz`，用 npm 安装（不执行 install scripts），然后运行 SSR、公共类型、Vite 8 构建和 Chromium/WebKit 测试。无 workspace、源码 alias 或根 node_modules 回退；成功/失败都会校验所有权后清理消费者、tarball 与服务。

如要把示例复制到其他仓库：先独立打包 runtime，将 dependency 改为本地 `.tgz` 路径后 `npm install`，或等正式 npm 发布后使用固定 registry 版本。当前 **没有发布到 npm**，不要假设 `npm install @ai-switch/tauri-plugin-runtime` 已可用。

本示例是宿主接入教学，不替代 `ai-switch/plugin-example` 远程插件模板，也不会修改或发布该仓库。
