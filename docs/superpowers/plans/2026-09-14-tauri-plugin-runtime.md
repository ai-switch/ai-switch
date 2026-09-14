# 通用 tauri-plugin-runtime 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `executing-plans` 按任务执行；只有用户明确授权代理委派后，才可选择 `subagent-driven-development`。本文所有步骤使用复选框跟踪，先测试后实现。

**Goal:** 交付可独立打包安装的 `@ai-switch/tauri-plugin-runtime`，提供唯一协议/schema、宿主与插件入口、隔离消息桥、生命周期和声明范围内的 Node 异步接口；不把“通过模拟宿主”误报为“真实 Rust 能力已完成”。

**Architecture:** `/protocol` 是 devkit 和未来 Rust 宿主的唯一契约来源；`/host` 仅调用注入的可信 `HostTransport`，`/plugin` 通过每实例 MessagePort 调用能力，`/node/*` 在其上提供受限 Node 语义。框架、Tauri、实际文件访问、签名安装与商店策略留在适配器/后续项目。

**Tech Stack:** TypeScript 5.9.3、ESM、esbuild 0.28.0、Vitest 5.0.0、Vite 8.3.0（只用于独立测试/示例）、Playwright 1.63.0、JSON Schema draft-07、Ajv 8.20.0 standalone validators。

**Spec:** `docs/superpowers/specs/2026-09-13-aplg-plugin-runtime-design.md`。

**Related plan:** `docs/superpowers/plans/2026-09-14-tauri-plugin-devkit.md`，其中 D1 消费 R1/R2，D3/D4 消费 R4/R5/R6，最终联调需要 R8。

**状态：** R1–R4 已实施并完成本地验证，R5–R8 待实施；未执行 npm 发布。后续任务中的代码仍是目标接口/测试片段。

## Global Constraints

- 工作树固定 `D:\Repos\worktree\ai-switch-plugin-design`，分支 `docs/plugin-architecture`；不另建 worktree，不合并或推送应用分支。
- npm 包名固定 `@ai-switch/tauri-plugin-runtime`，与 devkit 首个实现版本统一为 `0.1.0`；线协议 `aplg/1`、插件 API `1.0.0`、manifestVersion `1` 独立于 npm 版本。
- 首期两个包的 Node 工具链限制为 `^22.12.0 || ^24.0.0 || >=26.0.0`，pnpm `10.12.4`。这是已核验的 Vitest 5 支持范围，不改主应用 Node/Vite/TS 依赖。
- 仅提供 ESM、TypeScript 声明和子入口；导入不访问 `window`、不读凭据、不挂载容器、不建立全局监听。实际 DOM 操作延后到 `mount()` / `connectPlugin()`。
- 不引入 React、Vue、Tauri、ai-switch 源码 alias；插件端不接触管理 token、Tauri internals、任意应用 command、宿主 DOM 或 localStorage。
- 共享 JSON Schema 仅在 runtime 维护，devkit 只能引用。浏览器校验器预生成，不能在运行时使用 `eval` / `new Function` 编译 schema。多个入口必须共享同一个插件连接单例；构建采用单次多入口 ESM splitting 或保留模块，不得逐入口 bundle 出多份 aplg。
- `.aplg` / `aplg.json` 为唯一新格式；无旧 MenuGit `.oplg`、`window.otools`、同步 XHR 或旧原生 ABI 兼容。
- iframe 为 `sandbox="allow-scripts"`，不加 `allow-same-origin`。CSP、资产授权和 Tauri IPC 隔离由真实宿主证明；npm 桥本身不等于完整 OS/浏览器沙箱。
- 控制信封最大 `1 MiB`；文件分块原始字节最大 `256 KiB`；单文件最大 `8 MiB`；同会话最多 `2` 个文件传输；宿主可以收紧但不能由插件放宽。
- 虚拟路径为 `/app`、`/data`、`/mounts/<grantId>`；`node:path` 默认 POSIX，`resolve()` 的虚拟 cwd 固定 `/data`。
- 本计划不改 `src-tauri`，不运行 Cargo。未来 Rust 验证只能在 `src-tauri` 使用 `CARGO_TARGET_DIR=target-codex`，不创建第三个 target。
- 不自动 publish、打 tag、创建密钥、推送或改 GitHub 仓库。npm 发布 workflow 的协调任务由 devkit 计划 D9 拥有；其启用仍需用户明确发布授权及 registry 权限。

## 1. 交付边界与依赖顺序

```text
R1 manifest/schema + 独立包基础
  → R2 wire/session/标准能力契约
  → R3 MessagePort RPC
  → R4 插件客户端与握手
  → R5 宿主挂载、实例隔离、生命周期
  → R6 无 I/O 的 Node 子集
  → R7 异步 fs 客户端与分块
  → R8 tarball/纯宿主/浏览器验收
```

R1/R2 完成并冻结导出后，可以开始 devkit D1；devkit 打包不应迫使 runtime 依赖 devkit。R8 不使用 devkit `/testing`，避免两份计划形成循环依赖。模拟 fixture 只在各包测试目录内部存在；面向第三方的 `/testing` 由 devkit D7 提供。

**本计划的完成标准：** 外部空项目安装 tarball 后，可在严格 CSP 的真实浏览器中通过模拟 Transport 打开插件、调用标准客户端、验证隔离和生命周期。**仍不代表：** Rust 的真实路径授权、客户端/Web 宿主接入、动态安装、原生执行、商店发布已经完成。

## 2. 文件所有权

| 范围 | 路径与职责 |
| --- | --- |
| 包基础 | `packages/tauri-plugin-runtime/{package.json,tsconfig.json,vitest.config.ts,README.md,LICENSE}` |
| 构建 | `packages/tauri-plugin-runtime/scripts/{build.mjs,generate-protocol.mjs,check-generated.mjs,verify-tarball.mjs}` |
| 唯一契约 | `packages/tauri-plugin-runtime/src/protocol/{index.ts,manifest.ts,wire.ts,validation.ts,path-policy.ts,limits.ts}` |
| schema | `packages/tauri-plugin-runtime/src/protocol/schema/{manifest,wire,session,capabilities,fs}.schema.json` |
| 生成物 | `packages/tauri-plugin-runtime/src/protocol/generated/{types.generated.ts,validators.generated.mjs}` |
| 客户端 | `packages/tauri-plugin-runtime/src/plugin/{index.ts,client.ts,connection.ts,errors.ts}` |
| 消息桥 | `packages/tauri-plugin-runtime/src/bridge/{rpc-peer.ts,json-codec.ts,handshake.ts}` |
| 宿主 | `packages/tauri-plugin-runtime/src/host/{index.ts,host.ts,view.ts,event-router.ts}` |
| Node 子集 | `packages/tauri-plugin-runtime/src/node/{path.ts,buffer.ts,events.ts,fs.ts,fs/promises.ts,fs/client.ts,fs/options.ts,fs/transfer.ts,fs/errors.ts}` |
| 测试 | `packages/tauri-plugin-runtime/tests/`；具体路径随任务给出 |
| 无框架宿主演示 | `examples/aplg-plain-host/`；只服务外部可用性验收，不接入应用 |
| 共享夹具 | `fixtures/aplg/protocol-v1/`，包括有效、无效消息和 manifest 的固定 JSON |
| 根接入 | R1 新建 `pnpm-workspace.yaml`，小幅修改 `package.json` / `pnpm-lock.yaml` / `vitest.config.ts`；其后 devkit D1 才修改同一锁文件 |

不在 `src/lib/transport` 或 Rust 中实现假的 APLG 服务，也不扩大现有 Tauri capabilities。`plugin-store` 与 `plugin-example` 的远程改动不属于 runtime 任务。

R1 之后未带完整前缀的 `src/`、`tests/`、`scripts/` 路径均相对 `packages/tauri-plugin-runtime/`；包外路径均已给出完整位置。`/host` 重新导出 `HostTransport`、`HostEvent`、`Unsubscribe` 类型；`/plugin` 导出 `PluginApi`、`CallOptions`，这些 re-export 不新建类型副本。

## 3. 两份计划必须共用的接口

### 3.1 `/protocol` 对外导出

生成的数据类型与手写的行为包装均从 `@ai-switch/tauri-plugin-runtime/protocol` 导出：

```ts
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export interface Diagnostic { code: string; path: string; message: string }
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: Diagnostic[] };

export interface Manifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  engines: { aplg: string };
  entry: string;
  activation: "view";
  requires: Record<string, string>;
  optional: Record<string, string>;
  permissions: {
    filesystem: Array<{ root: "plugin-data" | "user-selected"; access: Array<"read" | "write"> }>;
    network: Array<{ origins: string[]; methods: string[] }>;
    native: boolean;
  };
  contributes: { views: Array<{ id: string; title: string }> };
  extensions?: Record<string, JsonValue>;
}

export declare function validateManifest(value: unknown): ValidationResult<Manifest>;
export declare function parseManifest(value: unknown): Manifest;
export declare function validateWireMessage(value: unknown): ValidationResult<WireMessage>;
export declare function validateSessionDescriptor(value: unknown): ValidationResult<SessionDescriptor>;
export declare function normalizeArchivePath(path: string): string;
export declare function validateVirtualPath(path: string): string;
export declare function satisfiesApiRange(version: string, range: string): boolean;
export declare const manifestSchema: object;
export declare const protocolVersion: "aplg/1";
export declare const apiVersion: "1.0.0";
export declare const limits: {
  readonly controlBytes: 1048576;
  readonly fileChunkBytes: 262144;
  readonly fileBytes: 8388608;
  readonly fileTransfers: 2;
  readonly archiveBytes: 134217728;
  readonly archiveExtractedBytes: 536870912;
  readonly archiveEntries: 10000;
};
```

`normalizeArchivePath` 不访问磁盘，只验证包内相对 POSIX 路径；拒绝 `..`/`.` 段、空段、反斜杠、绝对/盘符/UNC 路径、控制字符、`%`、Windows 保留名称/字符、尾随空格或点、非 NFC 名称。不偷偷重写路径；非法路径抛 `E_ARCHIVE_PATH`。归档重复/大小写冲突、symlink 和实际读盘竞态由 devkit/后端另外校验。

`validateVirtualPath` 只接受绝对虚拟字符串路径；允许标准路径规范化但不授予权限，规范化后必须落在三种虚拟根之一；拒绝真实盘符、URL、NUL 和非法挂载 ID。JS 校验不能代替 Rust 的实际路径边界。

### 3.2 会话、宿主传输与消息桥

```ts
export interface CapabilityInfo { version: string; methods: string[] }
export interface SessionInfo {
  protocol: "aplg/1";
  apiVersion: string;
  plugin: { id: string; version: string; packageSha256: string };
  capabilities: Record<string, CapabilityInfo>;
  limits: { controlBytes: number; fileChunkBytes: number; fileBytes: number; fileTransfers: number };
}
export interface SessionDescriptor {
  sessionId: string;
  manifest: Manifest;
  assetUrl: string;
  info: SessionInfo;
}
export type HostOperation = "session.open" | "session.close" | "capability.call"
  | "subscription.open" | "subscription.close" | "request.cancel";
export type HostEvent =
  | { kind: "capability.event"; sessionId: string; subscriptionId: string; seq: number; payload: JsonValue }
  | { kind: "session.closed"; sessionId: string; reason: string }
  | { kind: "transport.state"; state: "connected" | "disconnected" };
export type Unsubscribe = () => void;
export interface HostTransport {
  call<T>(operation: HostOperation, args: JsonObject): Promise<T>;
  subscribe(handler: (event: HostEvent) => void): Promise<Unsubscribe>;
}

export type PluginOperation = Exclude<HostOperation, "session.open" | "session.close">;
export type PluginRequestPayload =
  | { operation: "capability.call"; args: { capability: string; method: string; params: JsonValue } }
  | { operation: "subscription.open"; args: { capability: string; topic: string } }
  | { operation: "subscription.close"; args: { subscriptionId: string } }
  | { operation: "request.cancel"; args: { requestId: string } };
export type WireMessage =
  | ({ protocol: "aplg/1"; kind: "request"; id: string } & PluginRequestPayload)
  | { protocol: "aplg/1"; kind: "result"; id: string; value: JsonValue }
  | { protocol: "aplg/1"; kind: "error"; id: string; error: { code: string; message: string; details?: JsonValue } }
  | { protocol: "aplg/1"; kind: "event"; subscriptionId: string; seq: number; payload: JsonValue }
  | { protocol: "aplg/1"; kind: "connection"; state: "connected" | "disconnected" | "closed" };
```

`WireMessage.request.args` 不是任意透传字典：schema 按 operation 区分四种结构，全部 `additionalProperties:false`，见 R2。插件消息里不接受 `sessionId`、`pluginId`、principal 或 token；父容器依据端口绑定添加真实会话信息。即使插件拿到了自己的 ID，也不能更换身份。

`SessionInfo` 不包含 `sessionId`、访问凭据、真实文件路径、源码仓库密钥。`assetUrl` 仅在可信宿主内部使用，其资产票据不进入公开 `ready()` 返回值。

`HostTransport` 的固定入参/返回值如下，devkit `/testing` 和后续 Rust 接入必须逐项实现同一契约：

| HostOperation | args | 返回 |
| --- | --- | --- |
| `session.open` | `{pluginId}` | SessionDescriptor |
| `session.close` | `{sessionId}` | null |
| `capability.call` | `{sessionId,requestId,capability,method,params}` | JsonValue |
| `subscription.open` | `{sessionId,requestId,capability,topic}` | `{subscriptionId}`（后端 ID） |
| `subscription.close` | `{sessionId,subscriptionId}` | null |
| `request.cancel` | `{sessionId,requestId}` | null |

port 上 `subscription.open` 结果同样为 `{subscriptionId}`，但值由可信 host 替换成稳定逻辑 ID；backend ID 不直接交给插件控制。JSON 表格里的字符串字段都是 string，params 是 JsonValue，sessionId 与 principal 关联只存在于后端。HostTransport 没有物理网络中止接口时，runtime 超时只终止本地等待并发送 best-effort request.cancel，不承诺后端副作用已被撤销。
### 3.3 `/plugin` 与 `/host`

```ts
export interface CallOptions { signal?: AbortSignal; timeoutMs?: number }
export interface PluginApi {
  ready(): Promise<SessionInfo>;
  capabilities: { supports(name: string, range?: string): boolean };
  call<T extends JsonValue>(capability: string, method: string, params?: JsonValue, options?: CallOptions): Promise<T>;
  subscribe(capability: string, topic: string, handler: (payload: JsonValue) => void): Promise<Unsubscribe>;
  onConnectionChange(handler: (state: "connected" | "disconnected" | "closed") => void): Unsubscribe;
  storage: {
    get(key: string): Promise<JsonValue>;
    set(key: string, value: JsonValue): Promise<void>;
    remove(key: string): Promise<void>;
  };
  dialog: {
    pickDirectory(options?: { access?: "read" | "readwrite" }): Promise<{ path: string; access: "read" | "readwrite" } | null>;
  };
}
export declare const aplg: PluginApi;
export declare function connectPlugin(): Promise<SessionInfo>;

export interface PluginView {
  readonly pluginId: string;
  readonly element: HTMLIFrameElement;
  dispose(): Promise<void>;
}
export interface PluginHost {
  mount(options: { pluginId: string; container: HTMLElement }): Promise<PluginView>;
  dispose(): Promise<void>;
}
export declare function createPluginHost(options: {
  transport: HostTransport;
  allowedAssetOrigins?: string[];
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
}): PluginHost;
```

`ready()` 惰性调用 `connectPlugin()`，多次调用共享同一个握手。页面不是 iframe、缺少宿主 nonce、协议不匹配或 10 秒未连接时必须报错；绝不偷偷切换为高权限浏览器模拟模式。devkit 的预览宿主是显式开发工具，不是这个 API 的自动后备。

`capabilities.supports` 在 ready 前返回 false；就绪后检查版本和能力是否存在，不声称资源权限已经批准。标准包装映射为 `aplg.storage/get|set|remove` 与 `aplg.dialog/pickDirectory`，不存在时返回 `E_CAPABILITY_UNAVAILABLE`；`storage.get` 的缺失值为 null。

`createPluginHost` 不读 window；`mount` 时默认允许当前页面 origin 的静态资产，桌面接入须显式允许专用 loopback 资产 origin。只允许 HTTPS 或已批准的 loopback HTTP URL，拒绝 javascript/data/file URL。允许来源不表示允许其 Tauri IPC 权限。

## 4. 测试辅助与固定输入

R1 创建 `tests/fixtures/manifest.ts`，后续测试使用工厂而不是共享可变对象：

```ts
import type { Manifest } from "../../src/protocol/index.js";
export function makeManifest(): Manifest {
  return {
    manifestVersion: 1, id: "io.github.example.notes", name: "Notes", version: "0.1.0",
    description: "Notes fixture", license: "MIT", engines: { aplg: "^1.0.0" },
    entry: "dist/index.html", activation: "view", requires: {}, optional: {},
    permissions: { filesystem: [], network: [], native: false },
    contributes: { views: [{ id: "main", title: "Notes" }] },
  };
}
```

R2 创建 `tests/fixtures/session.ts`：`makeSession(overrides?: Partial<SessionDescriptor>): SessionDescriptor`，默认 sessionId `session-a`、plugin 与上述 manifest 一致、digest 为 64 个 `a`、assetUrl 为测试服务器 `http://127.0.0.1:43172/plugin/index.html`、capabilities 空对象，limits 等于协议上限。`overrides` 仅用于测试输入构造，不进入产品 API。

所有以下 PowerShell 命令在 worktree 根执行，除非显式注明工作目录。运行测试前确保对应包已安装、生成器和配置已建立；新模块的首次 RED 应能归因为缺失实现/断言，而不是无关依赖安装失败。每项任务完成后按明确文件路径 stage，并确认暂存集合仅包含该任务；计划中的目录级 git add 只在不存在其他待提交改动时使用。

## Task R1：manifest、路径策略与可独立构建包

**Files:**
- 新建 `pnpm-workspace.yaml`（仅 `packages/*`、`examples/*`）。
- 修改根 `package.json`，只增加 `aplg:runtime:test` / `aplg:runtime:build` 脚本；修改 `vitest.config.ts`，主应用测试排除 `packages/**` 与 `examples/**`。
- 新建 runtime 包基础、`src/protocol/schema/manifest.schema.json`、`manifest.ts`、`path-policy.ts`、`limits.ts`、`index.ts`、`scripts/generate-protocol.mjs` / `check-generated.mjs` / `build.mjs`。
- 测试：`tests/manifest.test.ts`、`tests/path-policy.test.ts`、`tests/fixtures/manifest.ts`。

**Interfaces:** 消费总规格的 `.aplg` 契约；产出第 3.1 节的 manifest/路径导出和生成 schema 的检查命令。devkit D1/D2 依赖这些导出。

- [x] **Step 1：建立最小测试环境并写失败测试。** 使用包内 `vitest.config.ts`（node 环境，`include:["tests/**/*.test.ts"]`，排除 `tests/browser/**`），不继承根 React 配置。

```ts
import { expect, test } from "vitest";
import { validateManifest, normalizeArchivePath } from "../src/protocol/index.js";
import { makeManifest } from "./fixtures/manifest.js";

test("a valid permission-free manifest can be loaded", () => {
  expect(validateManifest(makeManifest()).ok).toBe(true);
});
test.each(["../entry.html", "/entry.html", "dist/../entry.html", "C:/entry.html", "dist/CON.txt"])(
  "rejects nonportable entry %s before loading plugin code", (entry) => {
    expect(validateManifest({ ...makeManifest(), entry }).ok).toBe(false);
  },
);
test("unknown root properties cannot smuggle runtime permissions", () => {
  expect(validateManifest({ ...makeManifest(), allowAll: true }).ok).toBe(false);
});
test("manifest metadata cannot masquerade as a filesystem path", () => {
  expect(() => normalizeArchivePath("dist\\index.html")).toThrow();
});
```

- [x] **Step 2：运行 RED。** `pnpm --dir packages/tauri-plugin-runtime exec vitest run tests/manifest.test.ts tests/path-policy.test.ts`；确认失败指向缺失 schema/validator/path 实现。
- [x] **Step 3：生成并实现最小协议导出。** draft-07 schema 所有对象默认 `additionalProperties:false`，根仅允许第 3.1 节字段；ID 长度 3–160、格式 `^[a-z0-9]+(?:[.-][a-z0-9]+)+$`，SemVer 和 engines range 使用 semver 校验，view ID 不重复，`requires` 与 `optional` 不能重名。`entry` 必须是通过路径策略的 `dist/` 下 `.html` 文件。

网络条目只接受绝对 HTTP/HTTPS origin（不能有凭据、路径、query/hash、通配符）及大写 HTTP 方法数组；它是权限申请而非默认授权。`extensions` 的 key 必须是含命名空间的名称，值须为 JSON；禁止原型污染键。原生开关保留 boolean，devkit 的 web-v1 再拒绝 true。

```ts
export function parseManifest(value: unknown): Manifest {
  const result = validateManifest(value);
  if (!result.ok) {
    throw Object.assign(new Error("Invalid APLG manifest"), {
      code: "E_MANIFEST_INVALID", diagnostics: result.diagnostics,
    });
  }
  return result.value;
}
```

生成器从 JSON Schema 生成 TS 和 Ajv standalone ESM 校验器；生成物纳入 Git。`check-generated.mjs` 在内存/临时输出中重新生成并逐字节比较，不依赖“文件已跟踪”才能发现遗漏。构建将必要 JSON/schema 复制到 dist，schema 导出不触发浏览器动态代码生成。

包工具链依赖固定为：devDependencies `typescript@5.9.3`、`esbuild@0.28.0`、`vitest@5.0.0`、`vite@8.3.0`、`@playwright/test@1.63.0`、`@types/node@22.19.15`、`ajv@8.20.0`、`json-schema-to-typescript@16.0.0`、`@types/semver@7.7.1`；类型辅助依赖 `@types/events@3.0.3`、`@types/path-browserify@1.0.3`；运行时依赖 `semver@7.8.5`、`buffer@6.0.3`、`events@3.3.0`、`path-browserify@1.0.1`。实施时核对锁定版本的安全审计；不能为修包而升级应用根依赖。

`tsconfig` 使用 ES2022、ESNext/Bundler、DOM、strict、声明生成，browser source 不引入 Node globals；Node 构建脚本为 `.mjs`。生成的 `.mjs` 校验器开启 `allowJs` 且不执行 checkJs。构建脚本显式列出已实施入口；随着 R2–R7 完成再增加相应入口，不能导出不存在的文件。所有浏览器入口放在同一个 esbuild.build 调用中，`bundle:true`、`format:"esm"`、`splitting:true`，共享 chunks 保证 `/plugin` 和 `/node/fs/promises` 复用同一连接与传输槽位；包的 sideEffects 仅在验证无顶层动作后设为 false。

包的 scripts 在 R1 固定为下列行为，测试/构建文件与命令必须成对提交：

```json
{
  "generate": "node scripts/generate-protocol.mjs",
  "check:generated": "node scripts/check-generated.mjs",
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "test": "vitest run",
  "build": "node scripts/build.mjs",
  "verify:tarball": "node scripts/verify-tarball.mjs"
}
```

`verify:tarball` 到 R8 才新增到 package scripts，不保留指向不存在文件的命令。esbuild 生成 JS 后以独立 `tsconfig.types.json` 的 `tsc --emitDeclarationOnly` 生成 dist 声明；主 tsconfig 的 noEmit 不得阻止声明输出；R1 文件清单增加 `tsconfig.types.json`，R6 添加独立类型测试配置。类型测试使用 `tsc --noEmit` 的专门 fixtures tsconfig，不假定普通 vitest 会执行 `.test-d.ts`。
- [x] **Step 4：GREEN 与包边界检查。** 运行上述测试、`pnpm --dir packages/tauri-plugin-runtime run typecheck`、`run check:generated`、`run build`；主应用 `pnpm typecheck` / `pnpm test:run` 验证排除规则没有误收集新包。
- [x] **Step 5：只提交本任务文件。**

```powershell
git add -- pnpm-workspace.yaml package.json pnpm-lock.yaml vitest.config.ts packages/tauri-plugin-runtime
git commit -m "feat(runtime): 建立公共 manifest 契约与独立包基础"
```

## Task R2：线协议、协商、错误和标准能力契约

**Files:** 新建 `src/protocol/schema/{wire,session,capabilities,fs}.schema.json`、`wire.ts`、`validation.ts`；更新生成器/导出；新建 `fixtures/aplg/protocol-v1/{manifest.valid,request.valid,request.spoofed,session.valid,fs.methods}.json`；测试 `tests/protocol.test.ts`、`tests/fixtures/session.ts`。

**Interfaces:** 产出第 3.2 节全部类型、`validateWireMessage`、`validateSessionDescriptor`；标准 capability 版本均为 `1.0.0`。fs 传输返回值参见 R7，不另创一份 wire 协议。

- [x] **Step 1：写失败测试。**

```ts
import { expect, test } from "vitest";
import { validateWireMessage, validateSessionDescriptor } from "../src/protocol/index.js";
import { makeSession } from "./fixtures/session.js";

test("a plugin cannot choose the session used by the trusted host", () => {
  const message = {
    protocol: "aplg/1", kind: "request", id: "r-1", operation: "capability.call",
    args: { capability: "aplg.storage", method: "get", params: { key: "note" }, sessionId: "victim" },
  };
  expect(validateWireMessage(message).ok).toBe(false);
});
test("an unavailable required capability rejects the descriptor", () => {
  const descriptor = makeSession();
  descriptor.manifest.requires = { "aplg.fs": "^1.0.0" };
  expect(validateSessionDescriptor(descriptor).ok).toBe(false);
});
test("missing optional capabilities do not prevent startup", () => {
  const descriptor = makeSession();
  descriptor.manifest.optional = { "aplg.fs": "^1.0.0" };
  expect(validateSessionDescriptor(descriptor).ok).toBe(true);
});
```

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime exec vitest run tests/protocol.test.ts`。
- [x] **Step 3：实现严格消息与协商。** 四种 request args 的精确键如下，其他键一律拒绝：

| operation | args |
| --- | --- |
| `capability.call` | `{ capability: string, method: string, params: JsonValue }` |
| `subscription.open` | `{ capability: string, topic: string }` |
| `subscription.close` | `{ subscriptionId: string }` |
| `request.cancel` | `{ requestId: string }` |

request ID/订阅 ID 限 1–128 个可打印 ASCII；字符串参数本身按 JSON 大小限额约束，不把 ID 限制误施加到文件文本。数字须 finite、序号为正安全整数；拒绝 NaN、Infinity、BigInt、Date、函数、循环对象和非普通原型对象。JSON 解析后同样拒绝 `__proto__` / `constructor` / `prototype` 污染键。

`SessionDescriptor` 验证 manifest ID/version 与 info 相同，摘要为 64 位小写 hex，protocol 精确匹配，API 范围满足，required capability 的版本/方法可用，limits 正数且不大于协议上限。对标准能力检查其本版本必需方法，未知扩展能力只检查版本/合法 methods 列表。effective capabilities 只能来自 manifest 的 requires/optional，不向未声明的插件暴露隐式能力。资源/方法的实际授权仍由后端复核，不能以名字存在就绕过权限。

统一 `AplgError` 代码集合包括总规格列出的 session/timeout/cancel/limit/protocol 错误，加 `E_INVALID_ARGUMENT`、`E_INVALID_MESSAGE`、`E_HOST_UNAVAILABLE`；Node 文件错误保留后端安全的 `code`、`syscall` 和虚拟 `path`，不转发 stack 或任意 error 对象属性。

- [x] **Step 4：GREEN。** 测试同 session version 不匹配、未知 op、重复能力、错误序号、非法 JSON；运行 `check:generated`。在 README 中列明 JSON Schema 与 capability 版本，不新增 Rust 文件。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime/src/protocol packages/tauri-plugin-runtime/tests fixtures/aplg/protocol-v1
git commit -m "feat(runtime): 定义线协议与能力协商契约"
```

## Task R3：有界 MessagePort RPC 与取消

**Files:** 新建 `src/bridge/{json-codec.ts,rpc-peer.ts}`、`src/plugin/errors.ts`；测试 `tests/rpc-peer.test.ts`。

**Interfaces:** 内部 `createRpcPeer(port: MessagePort, options?: { timeoutMs?: number; maxInflight?: number }): RpcPeer`；`RpcPeer.request(operation,args,options?)`、`onRequest(handler)`、`onEvent(handler)`、`sendEvent(message)`、`close(reason?)`。request 返回 `Promise<JsonValue>`，handler 接收 `{ id, operation, args, signal }` 并返回 `Promise<JsonValue>`。`RpcPeer` 在同文件导出的内部 interface 明确声明 request 返回值和 handler 类型，见本节；只在本包内部导入，不向 devkit 暴露内部类。`onEvent`/`sendEvent` 的参数为 WireMessage 中 kind=event 或 connection 的联合，连接确认复用该通道；R4/R5 不另建第二个 port listener。

- [x] **Step 1：以真实 MessageChannel 写失败测试。**

```ts
import { expect, test } from "vitest";
import { createRpcPeer } from "../src/bridge/rpc-peer.js";

test("closing a peer settles in-flight requests instead of hanging forever", async () => {
  const channel = new MessageChannel();
  const caller = createRpcPeer(channel.port1);
  const callee = createRpcPeer(channel.port2);
  callee.onRequest(async ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const result = caller.request("capability.call", { capability: "example.wait", method: "wait", params: null });
  const rejection = expect(result).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  caller.close();
  await rejection;
  callee.close();
});
```

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime exec vitest run tests/rpc-peer.test.ts`。
- [x] **Step 3：实现每端独立 pending map。** 64 个最大未完成 RPC，默认 30 秒超时；每个 request 生成 UUID；先存 pending 再发消息；每个 resolve/reject 分支在 finally 清理 timer/AbortSignal listener。close 幂等并拒绝所有 pending，终止 receiver handler signal。取消请求只能指向同一个 peer 的活跃 request ID；收到取消确认不等于外部副作用回滚。

```ts
function settlePending(id: string, action: (entry: PendingRequest) => void) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.removeAbortListener();
  action(entry);
}
```

这里 `PendingRequest` 在 `rpc-peer.ts` 定义为 `{ timer: ReturnType<typeof setTimeout>; removeAbortListener(): void; resolve(value: JsonValue): void; reject(error: Error): void }`，`pending` 为该 peer 的 Map。late response、未知 ID 和重复 result 忽略；结构非法消息关闭该 peer，不接受无边界吞错误。使用 UTF-8 编码实际字节数限制，而不是 JS `.length`；序列化前限制深度 64，控制循环和巨大对象扫描。

- [x] **Step 4：GREEN。** 补充可执行测试覆盖 out-of-order response、30 秒超时（fake timer）、已 abort 请求不发送、循环对象/1 MiB+1 拒绝、64 请求上限、handler 抛错脱敏、晚到响应不会恢复已关闭任务。不得自动重发写操作。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime/src/bridge packages/tauri-plugin-runtime/src/plugin/errors.ts packages/tauri-plugin-runtime/tests/rpc-peer.test.ts
git commit -m "feat(runtime): 实现有界消息 RPC 与取消清理"
```

本包内部 RpcPeer 的精确最小定义（不进 package exports）：

```ts
type IncomingRequest = PluginRequestPayload & { id: string; signal: AbortSignal };
type PortEvent = Extract<WireMessage, { kind: "event" | "connection" }>;
interface RpcPeer {
  request(operation: PluginOperation, args: JsonObject, options?: CallOptions): Promise<JsonValue>;
  onRequest(handler: (request: IncomingRequest) => Promise<JsonValue>): Unsubscribe;
  onEvent(handler: (event: PortEvent) => void): Unsubscribe;
  sendEvent(event: PortEvent): void;
  close(reason?: Error): void;
}
```

## Task R4：插件端惰性连接、能力与便利 API

**Files:** 新建 `src/plugin/{index.ts,client.ts,connection.ts}`、`src/bridge/handshake.ts`；测试 `tests/plugin-client.test.ts`、`tests/handshake.test.ts`、`tests/browser/handshake.spec.ts`、`tests/browser/fixture-server.mjs` 与 `playwright.config.ts`；更新构建入口 `/plugin`。R4 浏览器父页只手动发握手消息，不依赖尚未实现的 R5 PluginHost。connect 成功移除的仅是窗口握手 listener，MessagePort 的生命周期 listener 由 RpcPeer 管理。

**Interfaces:** 第 3.3 节 `aplg` / `connectPlugin`，以及内部 `createPluginClient(peer: RpcPeer, info: SessionInfo): PluginApi`。桥握手窗口信封使用 `{ channel:"aplg.bootstrap", protocol:"aplg/1", kind:"ready"|"connect", nonce }`；connect 额外包含公开 info，并 transfer 1 个 port。绝不携带 host token。

- [x] **Step 1：真实 peer 对上的 API 行为测试。**

```ts
import { expect, test } from "vitest";
import { createRpcPeer } from "../src/bridge/rpc-peer.js";
import { createPluginClient } from "../src/plugin/client.js";
import { makeSession } from "./fixtures/session.js";

test("storage wrappers use the standard capability without exposing identity", async () => {
  const channel = new MessageChannel();
  const pluginPeer = createRpcPeer(channel.port1);
  const serverPeer = createRpcPeer(channel.port2);
  const descriptor = makeSession();
  descriptor.manifest.requires = { "aplg.storage": "^1.0.0" };
  descriptor.info.capabilities = { "aplg.storage": { version: "1.0.0", methods: ["get", "set", "remove"] } };
  const state = new Map<string, unknown>();
  serverPeer.onRequest(async (request) => {
    if (request.operation !== "capability.call") throw new Error("unexpected test operation");
    const { args } = request;
    const params = args.params as { key: string; value?: null | string };
    if (args.method === "set") { state.set(params.key, params.value); return null; }
    return (state.get(params.key) ?? null) as null | string;
  });
  const client = createPluginClient(pluginPeer, descriptor.info);
  await client.storage.set("note", "hello");
  expect(await client.storage.get("note")).toBe("hello");
  expect(await client.storage.get("missing")).toBeNull();
  pluginPeer.close(); serverPeer.close();
});
```

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime exec vitest run tests/plugin-client.test.ts tests/handshake.test.ts`。
- [x] **Step 3：实现连接状态机和只读公开视图。** 状态 `idle → connecting → connected → closed`；并发 ready 不多次握手，closed 不自动恢复旧 page 的会话。`connectPlugin` 从 URL fragment 的 namespaced 参数 `aplgNonce` / `aplgParentOrigin` 读取握手提示；父窗口与预期 origin 校验成立后才接收 connect，nonce 使用 `crypto.getRandomValues` 产生 32 个随机字节，校验其 base64url 编码，必须只有一个 transferred port。fragment 提示不是后端授权来源。保留原有业务 fragment，将握手提示作为最后一个 `;aplg=` base64url JSON 段附加；成功后仅移除该段，再导入业务模块，避免破坏 hash 路由。父页面 origin 为 null 的承载明确失败，不能放宽为 wildcard 接收。

插件先注册 listener 再向 parent 发 ready；parent origin 不为 `*`。父向 opaque iframe 发送 connect 必须使用 `*`，但只能发送至已绑定 `contentWindow` 且精确匹配 nonce；不能把整个 window message 总线当 RPC。handshake 完成立即移除 listener，并通过 port 回应就绪确认；该确认是一次 `connection:connected` 消息，由 R5 消费，普通业务消息不能替代握手。连接消息按方向/状态验证：host 只接受首次 connected 确认，之后插件发来的 connection 消息不能改变可信 session 状态。host 收到该确认后回发一次 connected；`connectPlugin()` 必须等到该回执才 resolve，确保业务发首个 RPC 时 host 已完成绑定。devkit bootstrap await connect 之后才导入业务入口。

`aplg.subscribe` 返回幂等同步 Unsubscribe：本地先移除回调，再 best-effort 关闭远端订阅；断线事件通知用户重新查询状态，不自动重放非幂等请求。包装层只检查能力与签名，不擅自补批准 grant。

- [x] **Step 4：GREEN。** 在严格 CSP 浏览器 fixture 中验证：顶层页面 connect 返回 `E_HOST_UNAVAILABLE`、错误 parent/source/nonce/端口数被拒绝、重复 ready 不换 port、ready timeout 无泄漏、`supports` 按 semver 行为、未知能力不调用 Transport。生成声明和 SSR import 测试必须在没有 window 的 Node 下通过。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime/src/plugin packages/tauri-plugin-runtime/src/bridge/handshake.ts packages/tauri-plugin-runtime/tests packages/tauri-plugin-runtime/scripts/build.mjs packages/tauri-plugin-runtime/package.json
git commit -m "feat(runtime): 提供插件连接与标准能力客户端"
```

## Task R5：可信宿主容器、实例绑定与事件生命周期

**Files:** 新建 `src/host/{index.ts,host.ts,view.ts,event-router.ts}`、`tests/host.test.ts`、`tests/browser/{host.spec.ts,fixture-server.mjs}`、`tests/browser/fixtures/{host.html,plugin.html,host.ts,plugin.ts}`、`playwright.config.ts`；更新 `/host` 构建入口。

**Interfaces:** 第 3.3 节 `createPluginHost`，消费 R2 `HostTransport`。测试服务器沿用 R4 创建的文件并扩展 host 测试路由，仅用于浏览器 fixture，不是产品资产服务；端口 43171（宿主）与 43172（资产），strict 绑定 loopback。两个独立来源保证不是碰巧同源可访问。

- [ ] **Step 1：先写浏览器行为测试。** fixture host 使用只在测试内的 in-memory Transport：A/B 使用两个不同 plugin ID 的 manifest，`session.open` 每次分配新 session ID、`aplg.storage` 每 plugin ID 独立 Map；两个 manifest 都声明 storage；fixture 页面只有 mount A、mount B、dispose A 按钮，插件显示 get/set 结果。不得通过 mock parent DOM 绕过真实 iframe。

```ts
import { expect, test } from "@playwright/test";

test("two instances cannot read each other's state", async ({ page }) => {
  await page.goto("http://127.0.0.1:43171/");
  await page.getByRole("button", { name: "Mount A" }).click();
  await page.getByRole("button", { name: "Mount B" }).click();
  const a = page.frameLocator('[data-view="a"] iframe');
  const b = page.frameLocator('[data-view="b"] iframe');
  await a.getByRole("textbox", { name: "Value" }).fill("only-a");
  await a.getByRole("button", { name: "Save" }).click();
  await b.getByRole("button", { name: "Read" }).click();
  await expect(b.getByTestId("value")).toHaveText("empty");
  await page.getByRole("button", { name: "Dispose A" }).click();
  await expect(page.locator('[data-view="a"] iframe')).toHaveCount(0);
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime exec playwright test tests/browser/host.spec.ts`；首次用 `pnpm --dir packages/tauri-plugin-runtime exec playwright install chromium` 准备浏览器。失败须归因于没有挂载/会话行为，不是浏览器缺失。
- [ ] **Step 3：实现 host 生命周期。** mount 顺序为“订阅 host 事件 → session.open → 验证 descriptor → 生成 nonce → 注册 listener → 指定 iframe src → 挂载 → 握手/确认”。在任一步失败时调用 session.close、移除 iframe/listener、清理 pending；所有 dispose 幂等。返回前握手成功，任何失败不得留下看似运行中的视图。绑定清理器之前也可能发生超时：session.open 结果迟到时主动 session.close；host.dispose 后迟到的 descriptor 不得被挂载。被移除容器的观察器只覆盖已挂载目标，关闭时断开观察，避免永久监听整个 document。

关键身份转发必须显式构造，不 spread 插件输入覆盖会话字段：

```ts
// 此分支已经通过 request.operation === "capability.call" 收窄生成的联合类型。
const args = {
  sessionId: boundSessionId,
  requestId: request.id,
  capability: request.args.capability,
  method: request.args.method,
  params: request.args.params,
};
return transport.call("capability.call", args);
```

`boundSessionId` 只来自成功的 session.open；transport 已持有可信 principal，后端仍须复核。端口允许的方法只有 R2 四种；request.cancel 仅能取消该视图已发请求，subscription.close 仅能关闭该视图拥有订阅。

为异步订阅早到事件保留每 session 最多 32 条、最多 2 秒的缓冲，只在确有进行中的 subscription.open 时接收；返回对应 subscriptionId 后交付，其他 ID 丢弃。序号重复/倒退丢弃，缺口通知 connection 状态/重新查询，不伪造补发。

`transport.state=disconnected` 通知客户端；connected 后只重建仍活跃的订阅，不重发 call。插件看到的是宿主分配的稳定逻辑订阅 ID；宿主维护 logical→backend ID 映射。重连更换 backend ID 并将其新序号转换为逻辑订阅内继续递增的序号，旧 backend ID 不再路由。全部活跃订阅重建后发送 connected，调用方重读快照；取消使用稳定 logical ID，不会关闭其他后端订阅。session.closed 直接 dispose。iframe 第二次导航/load、容器卸载、host.dispose、握手超时同样关闭会话；测试覆盖首次真实加载与 about:blank 不误触发关闭。

- [ ] **Step 4：GREEN 与安全反例。** 增加：错误来源 postMessage、伪造 sessionId、父 DOM/localStorage 访问、未知能力调用、跨订阅取消、关闭前慢请求、订阅先事件后响应、重连不重复 set、reload 自动失效、重复 dispose。fixture 的 CSP 使用无 `unsafe-eval` 的本地 script-src，资产 CORS 仅对只读静态资源开放；生产 Tauri IPC 无法在此证明，验收记录明确留给 Rust 接入计划。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime/src/host packages/tauri-plugin-runtime/tests packages/tauri-plugin-runtime/playwright.config.ts packages/tauri-plugin-runtime/scripts/build.mjs packages/tauri-plugin-runtime/package.json
git commit -m "feat(runtime): 隔离插件容器与会话生命周期"
```

## Task R6：无系统 I/O 的 Node 兼容入口

**Files:** `src/node/{path.ts,buffer.ts,events.ts}`、`tests/node-builtins.test.ts`、`tests/types/node-subset.test-d.ts`；包内第三方声明及相应 exports。

**Interfaces:** `/node/path` 默认对象与命名导出只包含 `join/resolve/normalize/dirname/basename/extname/relative/isAbsolute`；`/node/buffer` 导出 Buffer；`/node/events` 导出 EventEmitter 与默认 EventEmitter。不提供 process 全局或 require。

- [ ] **Step 1：写针对可观察语义的测试。**

```ts
import { expect, test } from "vitest";
import path from "../src/node/path.js";
import { Buffer } from "../src/node/buffer.js";
import { EventEmitter } from "../src/node/events.js";

test("relative resolve uses the plugin data root rather than host cwd", () => {
  expect(path.resolve("notes", "../note.txt")).toBe("/data/note.txt");
});
test("binary data roundtrips UTF-8 and base64", () => {
  expect(Buffer.from("你好", "utf8").toString("base64")).toBe("5L2g5aW9");
});
test("once is removed before a subsequent emit", () => {
  const emitter = new EventEmitter();
  let calls = 0;
  emitter.once("changed", () => calls++);
  emitter.emit("changed"); emitter.emit("changed");
  expect(calls).toBe(1);
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime exec vitest run tests/node-builtins.test.ts`。
- [ ] **Step 3：包装受维护 JS 实现，不抄写完整 Node 标准库。** `path-browserify` 的 resolve 必须显式加 `/data` 绝对前缀，避免其访问不存在的 process.cwd；仅导出承诺的方法。Buffer/events 使用已锁版本，esbuild 正确转为浏览器 ESM，保留许可证；测试声明不把 Node 原生文件类型误混入浏览器类型。

```ts
export const resolve = (...parts: string[]) => posix.resolve("/data", ...parts);
```

`posix` 为该模块的 `path-browserify` 导入，不由调用方注入。path 字符串操作不授予 filesystem 访问权；即使 resolve 到 `/etc`，实际 fs 客户端和 Rust 必须拒绝。

- [ ] **Step 4：GREEN。** 对表列方法使用真实 `node:path.posix` 的固定输入差分，虚拟 cwd 单独判定；验证打包代码中没有 process 依赖、父页面污染或自动 polyfill 全局 Buffer。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime/src/node packages/tauri-plugin-runtime/tests packages/tauri-plugin-runtime/package.json packages/tauri-plugin-runtime/scripts/build.mjs packages/tauri-plugin-runtime/THIRD_PARTY_NOTICES.md
git commit -m "feat(runtime): 提供受限 Node 纯 JS 接口"
```

## Task R7：异步文件 API、回调包装与安全分块客户端

**Files:** `src/node/fs.ts`、`src/node/fs/{promises.ts,client.ts,options.ts,transfer.ts,errors.ts}`；测试 `tests/{fs-client,fs-options,fs-transfer,fs-callbacks}.test.ts`、`tests/support/memory-fs-provider.ts`；更新 R2 fs schema/夹具与 exports。

**Interfaces:** 内部 `createFsClient(call: CapabilityCall, session: () => Promise<SessionInfo>): FsPromises`；`CapabilityCall` 与 `PluginApi.call` 签名相同；`/node/fs/promises` 单例使用真实 `aplg.call` / `aplg.ready`，不导出模拟磁盘。FsPromises 单例在 `await aplg.ready()` 后惰性创建，`fs.promises` 与独立 `/node/fs/promises` 必须引用同一个实例；不要让每种导入拥有两份并发计数。`FsPromises` 提供总规格所列 9 项方法，精确重载和返回如下：

| 方法 | 选项/返回 |
| --- | --- |
| `readFile(path, options?)` | null/省略编码 → Buffer；`"utf8"` / `{encoding:"utf8"}` → string |
| `writeFile(path,data,options?)` | string/Uint8Array；utf8，flag `w/wx`；Promise<void> |
| `appendFile(path,data,options?)` | string/Uint8Array；utf8，flag `a/ax`；Promise<void> |
| `readdir(path,options?)` | 省略/false → string[]，`withFileTypes:true` → `{name,isFile(),isDirectory()}[]` |
| `stat(path)` | `{size,mtimeMs,isFile(),isDirectory()}` |
| `mkdir(path,{recursive?}?)` | recursive false → void；true → string（首次创建路径）或 void，与支持范围的 Node 行为一致 |
| `rename(from,to)` | Promise<void>，虚拟授权根不同时 `EXDEV` |
| `copyFile(from,to)` | 默认覆盖，Promise<void>，双方都须授权 |
| `rm(path,{recursive?,force?}?)` | Promise<void> |

标准 `aplg.fs` 后端方法/DTO 在 `fs.schema.json` 定义：

```ts
interface ReadTransfer { handle: string; size: number }
interface WriteTransfer { handle: string }
interface DataChunk { offset: number; dataBase64: string }
// transfer.openRead  {path} -> ReadTransfer
// transfer.openWrite {path,size,mode:"w"|"wx"|"a"|"ax"} -> WriteTransfer
// transfer.pull      {handle,offset,length} -> DataChunk
// transfer.push      {handle,offset,dataBase64} -> {written:number}
// transfer.finish    {handle} -> null
// transfer.abort     {handle} -> null
// stat               {path} -> {kind:"file"|"directory",size,mtimeMs}
// readdir            {path} -> {name,kind:"file"|"directory"}[]
// mkdir              {path,recursive} -> {createdPath:string|null}
// rename/copyFile    {from,to} -> null
// rm                 {path,recursive,force} -> null
```

上述注释即固定的 method contract，生成 schema 对每个 DTO 做校验；所有文件字节统一经过 transfer，即使小文件也不另开未经定义的读写通道。外部调用取消来自会话失效/通用 RPC，首期文件选项不接受未列出的 signal/stream/fd。

- [ ] **Step 1：以独立内存 Provider 测真实客户端行为。** `createMemoryFsProvider()` 在测试文件提供 `{ call: CapabilityCall; session():Promise<SessionInfo>; readCommitted(path):Uint8Array|undefined; failNext(method,code):void; activeTransfers():number }`；这是测试 backend，不出现在公共 exports。

```ts
import { expect, test } from "vitest";
import { createFsClient } from "../src/node/fs/client.js";
import { createMemoryFsProvider } from "./support/memory-fs-provider.js";

test("writeFile commits complete UTF-8 data before readFile returns it", async () => {
  const provider = createMemoryFsProvider();
  const fs = createFsClient(provider.call, provider.session);
  await fs.writeFile("/data/note.txt", "你好", "utf8");
  expect(await fs.readFile("/data/note.txt", "utf8")).toBe("你好");
  expect(Array.from(provider.readCommitted("/data/note.txt")!)).toEqual([228, 189, 160, 229, 165, 189]);
});
test("an interrupted transfer leaves no partially committed file", async () => {
  const provider = createMemoryFsProvider();
  provider.failNext("transfer.push", "E_SESSION_CLOSED");
  const fs = createFsClient(provider.call, provider.session);
  await expect(fs.writeFile("/data/note.txt", "x", "utf8")).rejects.toMatchObject({ code: "E_SESSION_CLOSED" });
  expect(provider.readCommitted("/data/note.txt")).toBeUndefined();
  expect(provider.activeTransfers()).toBe(0);
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime exec vitest run tests/fs-client.test.ts tests/fs-options.test.ts tests/fs-transfer.test.ts tests/fs-callbacks.test.ts`。
- [ ] **Step 3：实现输入校验和分块。** 先 `ready()`、核对 capability、选项、虚拟路径和本地 size，再占用大小为协商 fileTransfers 的信号量。写入先 open，按 offset 顺序 push，全部确认后 finish；任意失败在 finally best-effort abort 并释放槽位。读取验证服务端总 size、每块 offset/长度/base64、总字节一致后 finish，不能无限接受“永不 EOF”的回复。

8 MiB+1、超过协商大小、负/错 offset、重复块、非法 base64、返回 `written` 不等于已发字节都失败。进度检查使用原始字节而不是 base64 长度；消息仍受 1 MiB 限额。取消/超时不自动重试 open/push/finish，特别是 append。错误恢复和 data buffer 释放在 finally 中执行。

回调式 `fs` 接口用同一 FsPromises 实现，回调恰好调用一次，并通过 Promise 链保证异步。同步接口 `readFileSync/writeFileSync/appendFileSync/readdirSync/statSync/mkdirSync/renameSync/copyFileSync/rmSync` 为明确抛 `ERR_APLG_SYNC_IO_UNSUPPORTED` 的函数；不把同步 API 返回值改成 Promise。其他未支持 named exports 在构建失败，默认对象也不伪造不存在的方法。

- [ ] **Step 4：GREEN。** 补充分块边界 0/256KiB/256KiB+1/8MiB、并发两项、第三项等待后关闭、`wx`/`ax` 已存在报 `EEXIST`、`force` 不等于忽略授权、跨根 rename、空目录、非目录 readdir、cb 成功/错误各一次、无编码 Buffer、无多余选项。对声明范围使用真实 Node 临时目录差分测试；测试 Provider 的通过只证明 JS 适配，真实 Rust symlink/junction/账户权限仍需后续计划。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime/src/node packages/tauri-plugin-runtime/src/protocol packages/tauri-plugin-runtime/tests packages/tauri-plugin-runtime/package.json packages/tauri-plugin-runtime/scripts/build.mjs fixtures/aplg/protocol-v1
git commit -m "feat(runtime): 实现 Node 异步文件客户端与有界传输"
```

## Task R8：包出口、纯宿主演示与可分发验收

**Files:** `package.json` exports/files、`scripts/{build,verify-tarball}.mjs`、`README.md`、`THIRD_PARTY_NOTICES.md`；`examples/aplg-plain-host/{package.json,index.html,src/main.ts,src/memory-transport.ts,plugin/index.html,plugin/main.ts,vite.config.ts,README.md}`；`tests/browser/packaged-host.spec.ts`；共享检查脚本 `scripts/aplg/check-package-boundaries.mjs`。

**Interfaces:** 外部使用只允许 npm 子入口，不使用 `src/`、仓库 alias、workspace symlink 或 devkit 的测试实现。runtime 的最终 exports 为 `/host`、`/plugin`、`/protocol`、`/node/fs/promises`、`/node/fs`、`/node/path`、`/node/buffer`、`/node/events`、`/package.json`；根 `.` 只导出版本信息与公共类型，不能把全部宿主和 Node 能力聚合导致插件误引入。

- [ ] **Step 1：写真实 tarball 安装验收。** `verify-tarball.mjs` 创建 `os.tmpdir()` 下独立消费者目录，安装本地 `.tgz`，执行下面的 Node 脚本和浏览器构建；在 finally 验证路径属于自己创建的临时目录后清理。外部项目无 workspace 和根 node_modules 回退。

```js
import assert from "node:assert/strict";
import { createPluginHost } from "@ai-switch/tauri-plugin-runtime/host";
import { aplg } from "@ai-switch/tauri-plugin-runtime/plugin";
import path from "@ai-switch/tauri-plugin-runtime/node/path";
import { validateManifest } from "@ai-switch/tauri-plugin-runtime/protocol";
assert.equal(typeof createPluginHost, "function");
assert.equal(typeof aplg.ready, "function");
assert.equal(path.resolve("notes.txt"), "/data/notes.txt");
assert.equal(validateManifest({ manifestVersion: 99 }).ok, false);
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-runtime run verify:tarball`；验证失败在缺失 exports/声明/依赖隔离，而非 npm 网络错误。
- [ ] **Step 3：完成构建、声明和独立示例。** package `files` 仅为 dist、README、LICENSE、THIRD_PARTY_NOTICES，`publishConfig.access:public`、无 postinstall。esbuild 单次多入口构建浏览器 ESM 并共享 chunks，不自动注入 Node 全局；生成声明保留相同子入口路径。package-boundaries 脚本检查产物 imports 与依赖图，拒绝 `@tauri-apps`、React/Vue、ai-switch `/src`、真实 `node:fs` / `node:child_process`、source-root 绝对路径和密钥文件进入 runtime 包。

演示宿主提供只在内存的 `aplg.storage`、一个仅在 requires 声明 storage 且不申请系统文件/网络权限的插件和明确“模拟宿主，仅内存数据”的标识；真实 `aplg.fs` 不可用，不伪造磁盘能力。静态页面通过 R5 的 transport 接入，验证 iframe mount、存储、清理。示例 package 使用独立 Vite 8，不升级主应用 Vite 5。

- [ ] **Step 4：执行完整验收。**

```powershell
pnpm --dir packages/tauri-plugin-runtime run check:generated
pnpm --dir packages/tauri-plugin-runtime run typecheck
pnpm --dir packages/tauri-plugin-runtime test
pnpm --dir packages/tauri-plugin-runtime run build
pnpm --dir packages/tauri-plugin-runtime run verify:tarball
pnpm --dir packages/tauri-plugin-runtime exec playwright test
pnpm typecheck
pnpm test:run
```

浏览器 fixture 通过 Playwright webServer 启动并在测试结束自动关闭；等待监听就绪而非固定 sleep。测试 Windows/Linux 至少两种 Node 承载与 Chromium/WebKit 浏览器；浏览器缺失先安装，不跳过后声称双模式全通过。产出 tarball 仅用于本地/CI 检查，不运行 `pnpm publish`。记录检查得到的大小与依赖，不预报“零依赖”或具体体积。

- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-runtime examples/aplg-plain-host scripts/aplg pnpm-lock.yaml
git commit -m "test(runtime): 验收独立安装与无框架宿主接入"
```

## 5. 验收矩阵与未包含的交付

| 规格要求 | 本计划任务 | 明确的外部依赖 |
| --- | --- | --- |
| 唯一 schema、版本与公共包 | R1/R2/R8 | Rust 生成类型/serde 交叉验收由 Rust 计划消费相同 schema/夹具 |
| 插件生命周期、RPC、事件 | R3/R4/R5 | 真实 transport 认证与租户身份由宿主实现 |
| 文件、存储、dialog API | R4/R7 | 本计划只实现客户端；原生选择器/Web 服务器目录授权由 Rust/宿主计划 |
| Node 无 I/O 子集 | R6 | Node 全量行为、同步 I/O、动态 require 不在范围 |
| npm 可独立使用 | R8 | 两包协调 CI/OIDC 发布由 devkit D9，真正推送/tag/publish 另需授权 |
| iframe 安全 | R5/R8 | 不把普通浏览器测试替代 Tauri IPC、CSP 与 OS 沙箱验证 |
| 插件分发 | 仅导出格式常量 | 安装验签、回滚、商店 PR/Release/索引属于独立计划 |

## 6. 与 devkit 的交接检查点

- R1/R2 合并到同一 worktree 后固定 `/protocol` 导出、method DTO、schema 版本与 fixture digest；devkit 不改这些文件。
- R4 交付 `connectPlugin()`，D4 的 bootstrap 只调用该函数；不能在 devkit 重新实现 postMessage 握手。
- R6/R7 交付 `/node/*`，D3 alias 只重定向包名；不把 Rust capability 实现复制到 devkit。
- R8 tarball 必须独立可安装。只有 runtime 包通过自身验收后，才能把 devkit 的端到端失败归因于工具链而不是使用源码 alias 遮掩包导出问题。
- 实施过程中更改上述公共接口，先修订两份计划和共同夹具，再继续下一任务；不得在实现者之间靠口头约定不同名字。

## 执行记录（2026-09-14）

### R1

- 先写 manifest、路径与安全 JSON 反例测试，确认缺失实现时失败，再实现并通过 61 项测试。
- 使用 JSON Schema 生成 TypeScript 和 Ajv standalone ESM；生成物校验不依赖 Git tracking，可检测文件被改动。
- `typecheck`、`check:generated`、`build`、无 window 的 SSR import、冻结依赖安装通过。
- 应用 `pnpm typecheck` 通过；`pnpm test:run` 为 74 文件 / 803 测试通过。首次 120 秒调用超时后检查了残留进程，再以更长限时完整复验。
- 根直接依赖声明和版本未变；pnpm 的 workspace 锁文件补充了 Vite 5 的可选 lightningcss peer snapshot，已单独核对并通过应用回归。
- 只安装本批实际需要的工具和 semver；Node shim/Playwright 依赖在对应后续任务添加，避免未使用依赖提前进入包。
- 当前只导出根版本/类型及 `/protocol`；没有占位的 host/plugin/fs 实现，也未修改 Rust 或执行发布。

### R2

- 新增 wire/session/host-event/standard capability/fs schema 与生成类型，宿主身份字段不允许从插件消息传入；仅接受四种插件侧操作。
- 能力协商验证 ID/version/API、必需/可选能力、标准方法集合、声明范围和限额；`aplg.*` 为受保留的标准命名空间，扩展使用自己的命名空间。
- 增加 standard storage/dialog/fs DTO 校验、canonical base64、UTF-8 包含信封的 1 MiB 边界、256 KiB 块上限、虚拟路径和跨 grant rename 规则；这只是契约验证，不是实际文件执行。
- 增加安全错误信封和共享固定 JSON 夹具。fs timestamps 保留合法的 epoch 前数值；asset URL 保留业务 hash 路由，为后续 bootstrap 恢复提供条件。
- 针对缺失方法、timestamp/标准命名空间/hash 路由问题分别确认 RED 后实现 GREEN；最终 runtime 为 8 文件 / 100 测试通过。
- `typecheck`、`check:generated`、`build`、冻结安装、生产依赖审计和构建 ESM 的 Node/SSR smoke test 通过。应用最终回归再次为 74 文件 / 803 测试通过。
- 额外导出的 `validateHostEvent`、`validateCapabilityRequest/Result`、`standardCapabilities` 与安全 error 工具用于后续 host/RPC/Node 客户端复用，不复制第二套 schema。
- protocol-only 构建当前未压缩 JS 约 691 KiB，主要为完整 Ajv standalone 校验器；后续 R8 应实测包边界/体积并按需拆分，不能在此阶段宣称“轻量完成”或已可安装运行插件。
- 未运行 Cargo，未实现 R3 之后的通信/容器/Node 行为；devkit 尚未开始；未推送、打 tag 或发布。

### R3

- 先写真实 MessageChannel 的 codec/RPC 失败测试，再实现有限大小 JSON 字符串传输、request/reply 关联、错误脱敏和关闭清理。
- 默认最多 64 个出站和入站活跃请求、30 秒超时；可收紧消息字节限额。超时/取消只 best-effort 通知同一 peer 的活跃请求，不重发业务调用。
- close 幂等，清除 timer/AbortSignal listener、拒绝 pending、终止 handler signal；remote close/无效 frame 同样完成清理。
- 重复活跃请求失败关闭；保存最近 1024 个已见 ID 作为有界重复检测。它不是无限历史去重或跨重连的幂等性保证。
- JSON 字符串 codec 避免直接把任意对象挂到 MessagePort；迟到/未知/重复 reply 不会结算其他请求。
- R3 新增 31 项测试，runtime 合计 10 文件 / 131 测试通过；类型检查、生成物检查和构建通过。
- RPC 内部增加 rpc-types.ts 来集中类型；CallOptions 暂属内部类型，R4 的 /plugin 将重新导出。还未导出公共 plugin 或 host 入口，不宣称可装载插件。

### R4

- 先写客户端/握手/SSR 失败测试，再实现 `/plugin` 惰性单例入口、connectPlugin、公开只读 SessionInfo、能力发现、call/subscribe/storage/dialog。
- 同一初始连接仅握手一次；校验 exact parent/source/origin、32 字节 nonce、协议、公有 info 和单 MessagePort，父子端双向 connected 确认后才 ready。hash 路由在握手后恢复，不传宿主 token。
- 连接失败/退出页面/remote close 清理监听与等待；断线不自动重发调用。早到事件有数量和时间界限，重复/倒退事件忽略，迟到订阅在断线后释放；能力包装拒绝不支持选项与非法结果。
- 真实 Chromium iframe 与严格 CSP 浏览器夹具验证 14 项，runtime 单元测试为 13 文件 / 153 项通过。测试父窗口仅实现协议夹具，不是提前实现 R5。
- 首轮浏览器测试中 Connect 按钮 selector 匹配两个元素，按 exact role 修正测试；CSP 验证改为页面自身按钮触发执行，而非 DevTools evaluate，证实页面 new Function 和 parent DOM 访问均被阻止。
- 浏览器下载安装调用曾超时；核验并停止本任务下载 helper 后，已安装的 Chromium 可用，后续浏览器测试真实执行。fixture server 与本任务下载 helper 均未遗留运行进程。
- 类型、生成物、build、构建后 `/plugin` SSR import、冻结安装通过；应用 `pnpm typecheck` 与 74 文件 / 803 项测试通过。只新增包内 Playwright devDependency，应用依赖未改。
- 本批只验证 Windows/Chromium，未宣称 WebKit、Tauri IPC 或真实 Rust 能力已验收。runtime 产物采用一次多入口 splitting，共享 chunk，`/host` 与 `/node/*` 仍未导出；devkit 未开始；未推送、发布或打 tag。
