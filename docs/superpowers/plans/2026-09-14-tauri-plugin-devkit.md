# 通用 tauri-plugin-devkit 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `executing-plans` 按任务执行；只有用户明确授权代理委派后，才可选择 `subagent-driven-development`。先测试后实现，不在本计划执行中自动推送或发布。

**Goal:** 交付 `@ai-switch/tauri-plugin-devkit`，使外部开发者能够从模板创建插件，完成校验、Node alias 与 bootstrap 构建、可复现 `.aplg` 打包和检查，并能在不依赖 ai-switch 源码的测试宿主中验收。

**Architecture:** devkit 单向依赖 runtime 的公开 `/protocol`、`/plugin`、`/host` 和 `/node/*`；Node 侧负责本地项目、打包与 CLI，浏览器 `/testing` 只提供显式模拟宿主。生产权限、真实 Rust 文件操作、签名信任和 plugin-store 的审核发布不混入 devkit。

**Tech Stack:** Node `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm 10.12.4、TypeScript 5.9.3、Vite 8.3.0、esbuild 0.28.0、Vitest 5.0.0、Playwright 1.63.0、yauzl 3.4.0、yazl 3.3.1、parse5 8.0.1。

**Spec:** `docs/superpowers/specs/2026-09-13-aplg-plugin-runtime-design.md`。

**Prerequisite plan:** `docs/superpowers/plans/2026-09-14-tauri-plugin-runtime.md`。R1/R2 的导出/契约是唯一权威，本文只引用，不维护复制的 manifest/wire schema。

**状态：** 待实施。本文中方法、CLI 和代码片段是目标契约，不表示已发布包可用。

## Global Constraints

- 同一 worktree `D:\Repos\worktree\ai-switch-plugin-design`、分支 `docs/plugin-architecture`；不创建第三个 Rust target，不在此计划调用 Cargo。
- 包名固定 `@ai-switch/tauri-plugin-devkit`，首个实现版本 `0.1.0`；开发时 dependency 为 `@ai-switch/tauri-plugin-runtime: workspace:0.1.0`，`pnpm pack` 后必须变为真实 `0.1.0`，不能将 workspace/source 路径发布出去。
- runtime 的 `Manifest`、`Diagnostic`、`ValidationResult`、`SessionDescriptor`、`HostTransport`、schema 和限额只从其公开子入口引用。CLI、Vite、pack/inspect 共用同一个校验实现。
- `.aplg` 是 ZIP，根清单为 `aplg.json`。首期只允许 `web-v1`，`native:false`、单份 universal 产物；原生 target/签名/商店规则为后续交付，不伪造支持。
- 不依赖应用 React/Vue/Tauri 或 `src/`；主应用 Vite 5 和 TypeScript 版本不升级。devkit 的 Vite peer 限 `^8.3.0`，实际测试版本 `8.3.0`。
- `aplg init` 不自动安装依赖、执行代码、运行 git/gh 或申请权限；`validate/inspect/pack` 不 import 项目 Vite config 或执行生命周期脚本。
- `vite build` 会执行作者配置、插件和依赖，它是显式构建操作，不是安全沙箱。plugin-store 必须在无凭据隔离 job 中运行，不能把 devkit 的静态检查当作恶意代码执行隔离。
- `/testing` 与开发预览默认只提供内存能力，不访问真实 OS 文件、管理 token、宿主 API；不能作为生产权限实现。
- 控制信封 `1 MiB`、文件块 `256 KiB`、单文件 `8 MiB`、并发 `2`；归档压缩大小上限 `128 MiB`、展开大小 `512 MiB`、条目 `10,000`，均引用 runtime `limits`。R2 协议不包含包归档文件内容，ZIP 校验单独做 streaming 预算。
- 公开发布依旧走 CI Release，客户端的安装验签不能被本地 `pack/inspect` 代替；inspect 输出必须明确 `signature: "not-verified"`。
- 本计划 D9 编写两 npm 包的协调 CI/发布文件，但不实际 push/tag/publish、不创建密钥，不改 plugin-store 远程 workflow。包发布权限和 GitHub/npm OIDC 配置另行确认。
- 新增依赖用 pnpm 固定版本和锁文件；所有临时目录/进程在确认范围后清理。Windows 路径不跨 shell 拼接删除。

## 1. 依赖与独立验收点

| 任务 | runtime 前置 | 可单独验收的交付 |
| --- | --- | --- |
| D1 包/CLI/项目验证 | R1/R2 | 无副作用的 source/dist 校验 |
| D2 安全归档检查 | R1/R2 | 不解包执行即可拒绝恶意 ZIP |
| D3 Vite Node alias | R6/R7 | 构建 Node 子集，无真实 Node builtin 泄漏 |
| D4 bootstrap 与产物策略 | R4/R5 + D3 | 插件业务在握手后才运行，资源相对且离线 |
| D5 可复现 pack | D2/D4 | 同一输入输出相同 `.aplg`，不覆盖旧输出 |
| D6 init 模板 | D1/D3/D4/D5 | 生成项目可构建、测试、打包，不产生暗中副作用 |
| D7 testing/开发预览 | R4/R5/R7 + D4 | 真实 iframe + 显式内存 Provider 的开发闭环 |
| D8 外部 tarball / plugin-example 联调 | R8 + D1–D7 | 无仓库 alias 的端到端产物 |
| D9 两 npm 包协调 CI | R8 + D8 | 两包同版验证、候选发布与 provenance 的流程文件 |

D1/D2 不需要等待完整 Node shim；D3 不能在 R6/R7 未导出目标前用 source alias 垫补。两份计划修改根锁文件的任务顺序执行，不产生两个 pnpm-workspace 或两份契约。

## 2. 目录与职责

以下未带前缀的 src/tests 路径均相对 `packages/tauri-plugin-devkit/`：

```text
package.json / tsconfig.json / vitest.config.ts
src/index.ts                         Node 程序化 API
src/cli.ts                           bin 入口，调用 runCli
src/cli/run.ts                       纯参数路由、输出和退出码
src/project/{read,validate,files}.ts  读 JSON、源码/产物检查、文件快照
src/archive/{inspect,pack,paths}.ts   流式 ZIP 检查、可复现归档
src/vite/{index,aliases,bootstrap,artifacts,preview}.ts
src/node-types.d.ts                  仅引用 runtime 类型的 Node ambient adapters
src/init/{index,render}.ts            模板参数校验和文件生成
templates/vanilla-ts/                唯一首期插件模板
templates/github/ci.yml              作者只读 CI，不含签名凭据
src/testing/{index,host,storage,filesystem}.ts
scripts/{build,verify-tarball}.mjs
README.md / LICENSE / THIRD_PARTY_NOTICES.md
tests/                              CLI/项目/归档/构建/模板/浏览器测试
playwright.config.ts
```

包外的 D8 夹具为 `fixtures/aplg/plugin-example/`；它与 runtime 的协议夹具分开，不由 devkit 修改 `fixtures/aplg/protocol-v1/`。D9 拥有 `.github/workflows/tauri-plugin-runtime.yml` 和 `scripts/aplg/{plan-release.mjs,plan-release.test.mjs,publish-npm.mjs}`，调用 D8 拥有的 `scripts/aplg/verify-pair.mjs`；不改现有应用 `release.yml`。

## 3. 公共接口与命令契约

### 3.1 Node API：包根入口

```ts
import type { Manifest, Diagnostic } from "@ai-switch/tauri-plugin-runtime/protocol";
export interface PackFile { path: string; size: number; sha256: string }
export type ProjectReport =
  | { valid: true; manifest: Manifest; manifestSha256: string; files: PackFile[]; diagnostics: Diagnostic[] }
  | { valid: false; diagnostics: Diagnostic[] };
export interface PackResult {
  path: string;
  sha256: string;
  size: number;
  manifest: Manifest;
  manifestSha256: string;
}
export type PackageInspection =
  | { valid: true; manifest: Manifest; sha256: string; size: number; files: PackFile[]; signature: "not-verified"; diagnostics: Diagnostic[] }
  | { valid: false; signature: "not-verified"; diagnostics: Diagnostic[] };
export declare function validateProject(root: string, options?: {
  stage?: "source" | "dist";
  profile?: "web-v1";
}): Promise<ProjectReport>;
export declare function inspectPackage(file: string): Promise<PackageInspection>;
export declare function packProject(root: string, options?: {
  outDir?: string;
  profile?: "web-v1";
}): Promise<PackResult>;
export declare function initProject(directory: string, options: {
  id: string;
  name: string;
  template?: "vanilla-ts";
}): Promise<{ directory: string; files: string[] }>;
```

source 验证不要求已经存在 dist；dist 验证包括完整来源、清单与产物闭环。源 manifest SHA-256 覆盖精确 UTF-8 文件字节，不能格式化后再算。文件列表只输出包内相对路径，日志不输出整个环境或凭据。操作系统 I/O 失败与无效项目分开处理，CLI 见下表。

### 3.2 CLI

| 命令 | 行为 |
| --- | --- |
| `aplg init <directory> --id <id> --name <name>` | 生成 vanilla-ts，目标必须不存在或为空，不覆盖、不安装、不建 Git 仓库 |
| `aplg validate [directory] --stage source|dist --json` | 默认当前目录/source；`--json` 输出结构化 ProjectReport |
| `aplg inspect <file.aplg> --json` | 流式检查结构与摘要，不解包执行、不宣告签名可信 |
| `aplg pack [directory] --out-dir <directory> --json` | 默认当前目录，输出到指定目录或 `<root>/.aplg-output`（均不得位于 dist 内）；不隐式运行 build |
| `aplg --help` / `--version` | 输出帮助/本包版本，无网络或文件改动 |

`--json` 错误输出统一为 `{valid:false,diagnostics:[{code,path,message}]}`；未知命令同样可被 JSON.parse，只有 bin 决定退出码。退出码：0 成功；1 参数、schema、路径、内容或兼容性校验失败；2 I/O 或内部执行错误。`--json` 的 stdout 仅含一个 JSON 对象，诊断可读提示到 stderr；没有指定 `--json` 时显示简洁的人类可读结果。遇到无效选项或未知子命令返回 1，不能“猜测”执行其他操作。

内部可测试签名：`runCli(argv: string[], io: { stdout(text:string):void; stderr(text:string):void }, options: { cwd:string }): Promise<0|1|2>`。只有 bin 入口写 `process.exitCode`，核心 API 不调用 process.exit。

### 3.3 `/vite`

```ts
import type { Plugin } from "vite";
export declare function aplgVite(options?: {
  manifestPath?: string;
  preview?: boolean;
}): Plugin[];
```

默认 manifestPath 为项目根 `aplg.json`；自定义路径必须在项目根内，不可从 URL 下载。插件数组分别处理 alias、bootstrap、产物扫描和开发预览。`preview` 默认 true，但仅对 `vite serve` 添加开发路由，不改变生产 build；关闭时只构建，业务仍须真实宿主握手。

模板使用：

```ts
import { defineConfig } from "vite";
import { aplgVite } from "@ai-switch/tauri-plugin-devkit/vite";
export default defineConfig({ plugins: [aplgVite()] });
```

### 3.4 `/testing`

```ts
import type { HostTransport } from "@ai-switch/tauri-plugin-runtime/host";
import type { Manifest, JsonValue } from "@ai-switch/tauri-plugin-runtime/protocol";
export interface TestHost {
  transport: HostTransport;
  activeSessionIds(): string[];
  emit(sessionId: string, capability: string, topic: string, payload: JsonValue): void;
  disconnect(): void;
  reconnect(): void;
  dispose(): Promise<void>;
}
export declare function createTestHost(options: {
  manifest: Manifest;
  assetUrl: string;
  initialStorage?: Record<string, JsonValue>;
  memoryFiles?: Record<string, Uint8Array>;
}): TestHost;
```

可提供的模拟能力为 `aplg.storage`，与 manifest 声明取交集后才出现在 SessionInfo；只有显式传入 memoryFiles 且 manifest 声明 `aplg.fs` 才增加内存文件能力。不提供 dialog 的假真实路径；缺少需要的能力按 runtime 协商失败。文件、存储按逻辑插件 ID 隔离，同一插件不同 view 可共享其数据，但会话/订阅/传输句柄不能相互冒用。TestHost 方法是测试工具，不属于插件业务 API。

## 4. 测试夹具约定

D1 创建 `tests/support/project.ts`，提供 `withProject(files: Record<string,string|Uint8Array>, run:(root:string)=>Promise<void>):Promise<void>`：使用 `mkdtemp` 创建临时根、写入给定字节，finally 仅在验证目录属于创建的临时根后清理。另提供 `validProjectFiles():Record<string,string>`，固定内容包含：

- `aplg.json`：runtime 有效 manifest 结构，ID `io.github.example.notes`、版本 `0.1.0`、entry `dist/index.html`、requires/optional 空、无权限。
- `package.json`：同版本，type module，build `vite build`，devkit/runtime 使用待测 tarball 替换之前的 `0.1.0`，Vite 固定 `8.3.0`。
- `index.html`：一个 `type="module" src="/src/main.ts"`。
- `src/main.ts`：`document.body.append("ready")`。
- `pnpm-lock.yaml`：从已提交的真实示例安装锁文件读取，作为静态 JSON/文件检查夹具；不把该 fixture 当成新 package.json 的冻结安装证明。所有 build/install/tarball 验收必须在消费者目录显式安装并生成与其真实依赖一致的锁文件，随后执行冻结安装。
- `LICENSE`：MIT 文本。

归档恶意输入由 D2 的 `tests/support/zip-fixtures.ts` 构造，不通过被测 packProject 生成非法路径。该 fixture 模块仅测试使用，提供 `writeZipFixture(file, entries, overrides?)`；entry 字段为 `{ name:string; data:string|Uint8Array; unixMode?:number }`，overrides 可控制声明大小/CRC/重复 central 条目用于反例；默认创建经典 ZIP、flags=0、不带 descriptor，反例字段显式覆盖，不能调用生产 packProject 生成同构预期。

提交前确认 staged 集合只包含本任务文件；若目录里有用户/其他任务改动，按精确路径 stage，不直接扩大到整个目录。下面命令默认在应用 worktree 根执行；独立包命令通过 `pnpm --dir` 明确工作目录。

## Task D1：独立工具包、CLI 与无副作用项目验证

**Files:** 新建 `packages/tauri-plugin-devkit/{package.json,tsconfig.json,vitest.config.ts,LICENSE,README.md}`、`src/{index,cli}.ts`、`src/cli/run.ts`、`src/project/{read,validate,files}.ts`、`scripts/build.mjs`、`tests/{project,cli}.test.ts`、`tests/support/project.ts`；修改根 scripts 与 pnpm-lock，不重新创建 workspace。

**Interfaces:** 消费 R1/R2 `/protocol`；产出 validateProject、runCli 和第 3.1/3.2 节报告。不执行 package scripts、Vite config 或动态 import 项目代码。

- [ ] **Step 1：写失败测试，先验证不执行未信任配置。**

```ts
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { validateProject } from "../src/index.js";
import { withProject, validProjectFiles } from "./support/project.js";

test("source validation reads metadata without importing a project's build config", async () => {
  const files = validProjectFiles();
  files["vite.config.js"] = "import {writeFileSync} from 'node:fs'; writeFileSync(new URL('./executed.txt', import.meta.url),'bad'); export default {};";
  await withProject(files, async (root) => {
    const before = await readFile(join(root, "aplg.json"));
    const report = await validateProject(root, { stage: "source" });
    expect(report.valid).toBe(true);
    await expect(access(join(root, "executed.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "aplg.json"))).toEqual(before);
  });
});
test("source and package versions must agree", async () => {
  const files = validProjectFiles();
  const pkg = JSON.parse(files["package.json"] as string);
  pkg.version = "0.2.0";
  files["package.json"] = JSON.stringify(pkg);
  await withProject(files, async (root) => {
    const report = await validateProject(root);
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === "E_VERSION_MISMATCH")).toBe(true);
  });
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/project.test.ts tests/cli.test.ts`；先建测试配置和安装依赖，失败点应为待实现行为。
- [ ] **Step 3：实现 bounded JSON 读取与规范化结果。** `aplg.json` 最大 256 KiB，UTF-8 解码错误拒绝；保留精确字节计算 SHA。调用 runtime parse/validate，不复制 schema；web-v1 拒绝 native true。源码校验检查根、manifest/package 版本、README/LICENSE、pnpm lock 和声明 profile；dist 阶段追加 D4 的产物检查，D1 尚未实现时显式返回 `E_DIST_VALIDATION_UNAVAILABLE`，不能假成功。

```ts
const manifestBytes = await readBoundedFile(manifestPath, 256 * 1024);
const manifestValue = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
const parsed = validateManifest(manifestValue);
if (!parsed.ok) return { valid: false, diagnostics: parsed.diagnostics };
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
```

`parseStrictJson(text:string):unknown` 在 `src/project/read.ts` 通过严格 AST 解析并拒绝重复键；`readBoundedFile(path,maxBytes):Promise<Uint8Array>` 在 `src/project/read.ts` 使用 open/stat/分块读取上限，拒绝 symlink/非普通文件；读前后检测文件 identity/size 变化。使用 `jsonc-parser@3.3.1` 的严格 JSON AST（拒绝注释/trailing comma）检查每个对象的重复键后再读取值；不要用 JSON.parse 最后值覆盖来接受两个 id/version/permissions。AST 遍历深度限制 64，解析诊断位置转成 runtime Diagnostic。

使用固定依赖：runtime `workspace:0.1.0`；dependencies `yauzl@3.4.0`、`yazl@3.3.1`、`parse5@8.0.1`、`jsonc-parser@3.3.1`、`postcss@8.5.28`、`postcss-value-parser@4.2.0`、`es-module-lexer@3.0.2`；devDependencies 使用 runtime 相同 TS/esbuild/Vitest/Playwright 与 `vite@8.3.0`，另固定 `@types/yauzl@3.4.0`、`@types/yazl@3.3.1`，不要用任意 any 遮盖 ZIP 类型。peerDependencies `vite:^8.3.0` 并标记 optional，纯 CLI 使用者不被强迫安装 Vite。

CLI bin 只调用 `runCli(process.argv.slice(2), io, {cwd:process.cwd()})`，测试直接调用 runCli 捕获输出和退出码；help/version/unknown command 不读取插件代码。先实现 validate，其余已声明命令在相应任务完成前明确未支持，最终发布前不可保留未实现分支。

- [ ] **Step 4：GREEN。** 覆盖非 JSON、非法 UTF-8、版本 mismatch、native=true、源根越界、缺 lock、无副作用与 JSON stdout；执行 `typecheck/test/build`，确认浏览器 `/testing` 与 Node 根入口未串依赖。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit package.json pnpm-lock.yaml
git commit -m "feat(devkit): 建立项目校验与 CLI 基础"
```

## Task D2：不执行/不解包的 `.aplg` 归档检查

**Files:** `src/archive/{inspect,paths,zip-header,crc32}.ts`、`tests/archive-inspect.test.ts`、`tests/support/zip-fixtures.ts`；连接 CLI inspect 和包根 exports。

**Interfaces:** 消费 runtime `normalizeArchivePath` / limits；产出 inspectPackage。不调用 packProject，不信任 archive 的文件扩展名、central directory 尺寸或 CRC 自报值。

- [ ] **Step 1：先写恶意 ZIP 行为测试。**

```ts
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectPackage } from "../src/index.js";
import { withProject } from "./support/project.js";
import { writeZipFixture } from "./support/zip-fixtures.js";

test.each(["../outside.txt", "C:/outside.txt", "dist/CON.txt"])(
  "inspection rejects unsafe archive entry %s without extracting it", async (name) => {
    await withProject({}, async (root) => {
      const file = join(root, "bad.aplg");
      await writeZipFixture(file, [{ name, data: "bad" }]);
      const report = await inspectPackage(file);
      expect(report.valid).toBe(false);
      expect(report.signature).toBe("not-verified");
    });
  },
);
test("symlinks cannot redirect a later installer outside its root", async () => {
  await withProject({}, async (root) => {
    const file = join(root, "link.aplg");
    await writeZipFixture(file, [{ name: "dist/link", data: "../../secret", unixMode: 0o120777 }]);
    expect((await inspectPackage(file)).valid).toBe(false);
  });
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/archive-inspect.test.ts`。
- [ ] **Step 3：使用 yauzl lazyEntries 流式读取，`zip-header.ts` 对 central/local header 的名字、flag、method、offset、长度进行独立 bounded 比对；`crc32.ts` 在流中累计标准 CRC-32 并用已知向量（UTF-8 `123456789` → `0xcbf43926`）与 ZIP fixture 验证，不假定 yauzl 已经检查 CRC。** 文件头大小先限制 128 MiB；entry 计数、解压后实际字节和累计大小逐条统计；大于 512 MiB/10,000 立即停止并关闭流，不能先整体解压到内存。所有输入内容保存在 ZIP 验证器的局部预算内，manifest 最大 256 KiB，HTML 最大 2 MiB，单个需解析的 JS/CSS 文本最大 16 MiB，超过时返回 E_LIMIT_EXCEEDED；其他资源流式散列，不整体载入内存。检查 ZIP 目录项、路径字段、encoding 与 NFC；大小写碰撞、重复项、盘符/UNC/设备路径、非法权限位、symlink、加密、重叠偏移、local/central 路径不一致、CRC 或真实大小 mismatch 均拒绝。目录项只允许零长度、单个尾随 `/`，验证时去掉该末尾分隔符；计入条目/冲突检查但不作为文件输出。首期在既有限额下只接受不带 data descriptor 的经典 ZIP，不接受 ZIP64；D5 使用`yazl.addBuffer` 读取已验证快照字节生成该 profile，避免验证器和打包器对可变长度记录支持不一致。

只接受 `.aplg` 包内 `aplg.json`、`dist/**`、`LICENSE`、可选 `README.md`、`icon.svg`/`icon.png` 与 `THIRD_PARTY_NOTICES.md`。未知顶层路径、源码 `.env`、证书私钥、node_modules、Git 元数据不进入包；web-v1 拒绝 native 目录及可执行/动态库产物。大小写冲突使用 NFC + ASCII 大小写折叠，非 ASCII 名称保留且对平台特有等价规则保守拒绝已知歧义，不能声称覆盖所有文件系统命名等价。

`aplg.json` 必须恰好 1 份且 <=256 KiB；解析、manifest/profile/entry 检查复用 D1/runtime。返回包 SHA-256 与每个实际字节文件的 SHA-256。没有签名输入/信任配置的 inspect 无论结构多完整都只能给 `signature:"not-verified"`。

- [ ] **Step 4：GREEN。** 加入固定可安装结构成功、空包、缺清单、多个清单、entry 不存在、重复大小写路径、ZIP bomb（实际流上限）、截断、损坏 CRC、local/central 不一致、错误扩展名；验证临时根外没有任何写入。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/archive packages/tauri-plugin-devkit/src/index.ts packages/tauri-plugin-devkit/src/cli packages/tauri-plugin-devkit/tests
git commit -m "feat(devkit): 安全检查 APLG 归档结构"
```

## Task D3：只对插件生效的 Vite Node alias

**Files:** `src/vite/{index,aliases}.ts`、`src/node-types.d.ts`、`tests/vite-aliases.test.ts`、`tests/types/node-imports.ts`、`tests/support/build-project.ts`；添加 `/vite` 与 types-only `/node-types` 出口与构建配置。

**Interfaces:** `aplgVite(options?):Plugin[]` 消费 runtime 子入口；依赖 R6/R7。只有 plugin bundle 重定向，Vite 配置/CLI/Node build scripts 仍使用真实 Node builtin。`src/node-types.d.ts` 仅随 types-only 出口交付，不生成可执行 shim，也不能让 Node config 误解析为浏览器虚拟 fs。

- [ ] **Step 1：从真实 Vite 构建写失败测试。** fixture code 使用 `node:path`，构建产物导入浏览器后应返回 POSIX 虚拟路径，而不是 Node/Rollup external stub。`withBuildProject(files,run)` 在 D3 建立：由已构建 runtime 产出本地 tarball，临时 project 的测试专用 package.json 仅安装该 tarball 与固定 Vite，生成真实 lock 后用配置对象调用 aplgVite。它不安装尚未发布的 registry devkit，也不需要 D8 helpers；测试的是当前 devkit 实现 + 已打包 runtime，最终两包隔离安装由 D8 验证。

```ts
import { build } from "vite";
import { expect, test } from "vitest";
import { aplgVite } from "../src/vite/index.js";
import { validProjectFiles } from "./support/project.js";
import { withBuildProject } from "./support/build-project.js";

test("unsupported system builtins fail at build time", async () => {
  const files = validProjectFiles();
  files["src/main.ts"] = 'import { spawn } from "node:child_process"; spawn("sh");';
  await withBuildProject(files, async (root) => {
    await expect(build({ root, configFile: false, plugins: [aplgVite({ preview: false })] }))
      .rejects.toThrow(/APLG_UNSUPPORTED_NODE_MODULE/);
  });
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/vite-aliases.test.ts`。
- [ ] **Step 3：精确 specifier 映射，不正则吞前缀。**

```ts
const aliases = new Map([
  ["fs/promises", "@ai-switch/tauri-plugin-runtime/node/fs/promises"],
  ["fs", "@ai-switch/tauri-plugin-runtime/node/fs"],
  ["path", "@ai-switch/tauri-plugin-runtime/node/path"],
  ["buffer", "@ai-switch/tauri-plugin-runtime/node/buffer"],
  ["events", "@ai-switch/tauri-plugin-runtime/node/events"],
]);
const bare = source.startsWith("node:") ? source.slice(5) : source;
if (aliases.has(bare)) return this.resolve(aliases.get(bare)!, importer, { skipSelf: true });
```

`source/importer/this.resolve` 位于 Vite resolveId hook。用 `node:module` 的 builtinModules 在 Node 插件层识别未支持 builtin 并抛清晰诊断；不把名为 `path-helper` 的普通 npm 包重定向。拒绝 `.node`、动态磁盘 require、未支持 process globals。对依赖图中的 builtin 也应用同一规则，不只扫描作者入口。

不通过批量替换字符串改代码，不 alias 宿主源码，不伪造 `@tauri-apps`。runtime 的 `/host` 和 devkit `/testing` 是插件包禁用导入，专用开发壳例外且必须不进入生产图。依赖可能运行期从字符串访问不支持 API，静态检查只能覆盖可解析图，不宣传为安全沙箱。

TypeScript 与 Vite 必须有一致的导入契约。D3 生成 `src/node-types.d.ts`，为支持的 `node:fs/promises`、`fs/promises`、fs、path、buffer、events 声明 ambient module；所有成员 re-export runtime 的公共子集声明，不复制 Node 全量签名。例如：

```ts
declare module "node:fs/promises" {
  export * from "@ai-switch/tauri-plugin-runtime/node/fs/promises";
  import fs from "@ai-switch/tauri-plugin-runtime/node/fs/promises";
  export default fs;
}
```

通过 types-only `/node-types` 出口提供；浏览器 tsconfig 设置 `types:["@ai-switch/tauri-plugin-devkit/node-types"]`，不引入全量 `@types/node`。Vite 配置使用单独 Node tsconfig。类型测试须证明支持的重载可用、未支持的 `watch`/stream/fd 不能编译；运行时 alias 与 `.d.ts` 重导出表由同一个 specifier 映射生成，避免各写一份。
- [ ] **Step 4：GREEN。** 对 `fs/promises`、`node:fs/promises` 同样工作；对 child_process/net/tls/worker_threads/process/.node 失败；浏览器执行打包后的 path/Buffer 程序并验证结果。测试未配置 aplgVite 的宿主 Vite 构建不受影响。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/vite packages/tauri-plugin-devkit/tests/vite-aliases.test.ts packages/tauri-plugin-devkit/package.json packages/tauri-plugin-devkit/scripts/build.mjs
git commit -m "feat(devkit): 为插件构建适配 Node 子集接口"
```

## Task D4：bootstrap 顺序、相对资源与产物验证

**Files:** `src/vite/{bootstrap,artifacts}.ts`、`src/project/validate.ts`、`tests/{bootstrap,artifact-policy}.test.ts`、`tests/browser/bootstrap.spec.ts`；包内 fixture server 和 Playwright 配置。

**Interfaces:** 消费 R4 `connectPlugin` 与 R5 host；内部 `inspectBuildFiles(root:string,manifest:Manifest):Promise<{files:PackFile[];diagnostics:Diagnostic[]}>`，由 Vite buildEnd/writeBundle 与 `validateProject(stage:"dist")` 共用。不消费项目 Vite config 来“重现”安全检查。

- [ ] **Step 1：写握手前后可观察顺序与资源反例。** `tests/browser/bootstrap.spec.ts` 的 fixture host 提供按钮 `Connect plugin`，在点击前不发送 runtime connect；plugin business 入口设置一个可见文本 `business-started`。测试真实打包产物，而非伪造两个函数调用顺序。

```ts
import { expect, test } from "@playwright/test";

test("business entry runs only after the runtime handshake", async ({ page }) => {
  await page.goto("http://127.0.0.1:43271/bootstrap-fixture");
  const plugin = page.frameLocator("iframe");
  await expect(plugin.getByText("business-started", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect plugin" }).click();
  await expect(plugin.getByText("business-started", { exact: true })).toBeVisible();
});
```

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";
import { aplgVite } from "../src/vite/index.js";
import { validateProject } from "../src/index.js";
import { validProjectFiles } from "./support/project.js";
import { withBuildProject } from "./support/build-project.js";

test("a production HTML entry cannot depend on a remote script", async () => {
  await withBuildProject(validProjectFiles(), async (root) => {
    await build({ root, configFile: false, plugins: [aplgVite({ preview: false })] });
    await writeFile(join(root, "dist/index.html"), '<script type="module" src="https://example.invalid/app.js"></script>');
    const report = await validateProject(root, { stage: "dist" });
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === "E_EXTERNAL_RESOURCE")).toBe(true);
  });
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/bootstrap.test.ts tests/artifact-policy.test.ts` 与 `exec playwright test tests/browser/bootstrap.spec.ts`，测试项目显式使用真实 runtime fixture 后端。
- [ ] **Step 3：通过虚拟模块注入启动器，而不是多加一个并行 script。** 首期接受一个本地外部 `type=module` 业务入口，零脚本纯 HTML 也允许；拒绝多个入口、内联 JS、classic script、inline handler、remote source。parse5 解析 HTML，移除原业务 script，替换为 Vite 虚拟 bootstrap 入口。启动代码必须使用动态 import：

```ts
import { connectPlugin } from "@ai-switch/tauri-plugin-runtime/plugin";
await connectPlugin();
await import("/src/main.ts");
```

真实入口来自校验后的 HTML 路径，用 JSON.stringify 编码为字符串字面量；不是手拼任意 HTML/script。若用静态 import，ESM 会先执行业务模块，测试必须能抓到。connect 失败显示不含敏感数据的简洁错误，不能直接运行业务作为 fallback。保留模块图，不改插件自己的业务代码以判断运行环境。

强制/校验 `base:"./"`、outDir 为 root 下 `dist`、browser target ES2022、相对 chunk 引用；不允许配置覆盖导致清空项目根外目录。`aplgVite` 不主动删除任何外部目录，若 Vite 配置冲突直接报错。产物 record `dist/aplg-build.json` 记录工具版本、源 manifest SHA、bootstrap 入口和本地产物列表（不包含该 record 自身的摘要，避免自引用）；它只是可复查构建元数据，不是可信签名。

产物扫描使用 parse5、PostCSS/value parser 与 es-module-lexer（均只在 Node 校验侧），覆盖 HTML `src/href/srcset`、CSS `url/@import`、静态和可分析动态模块引用：不得有远程/绝对系统路径、CDN、runtime `/host`、devkit `/testing`、残留 Node builtin、宿主源码路径或外部 sourcemap。允许本地 data:image 与本地资源 fragment；不允许 data/javascript 或远程脚本。扫描不宣称阻止所有运行期计算 URL，真正网络限制仍靠宿主 CSP/Broker。

清单原始字节不得在构建时改变；资源图必须存在、规范路径下且被打包候选列表覆盖。静态资源 CORS/CSP 的正确配置由宿主负责，构建器不能给应用管理 API 设置宽松 CORS。

- [ ] **Step 4：GREEN。** 测试 bootstrap 单次注入、零入口、多个入口失败、脚本异常被报告、源 manifest 修改失败、路径逃逸、相对图片/CSS、unicode 文件名规范、外部网络引用失败；通过严格 CSP 的真实 iframe 验证不需 unsafe-eval。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/vite packages/tauri-plugin-devkit/src/project packages/tauri-plugin-devkit/tests packages/tauri-plugin-devkit/playwright.config.ts
git commit -m "feat(devkit): 注入受控启动器并校验离线产物"
```

## Task D5：可复现、安全且不覆盖的 `.aplg` 打包

**Files:** `src/archive/pack.ts`、`src/project/files.ts`、`tests/archive-pack.test.ts`；连接 CLI pack、index.ts、README。

**Interfaces:** packProject 消费 D1 dist 验证、D2 inspectPackage、D4 build record；输出 PackResult。输入根需要已有合法 dist，pack 不自动 build/install、不执行任何源码。

- [ ] **Step 1：先写可复现与拒绝覆盖测试。**

```ts
import { readFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { packProject, inspectPackage } from "../src/index.js";
import { withBuiltProject } from "./support/built-project.js";

test("changing input mtimes does not change the package bytes", async () => {
  await withBuiltProject(async (root) => {
    const first = await packProject(root, { outDir: join(root, "out-a") });
    await utimes(join(root, "dist/index.html"), new Date(0), new Date(0));
    const second = await packProject(root, { outDir: join(root, "out-b") });
    expect(await readFile(second.path)).toEqual(await readFile(first.path));
    expect((await inspectPackage(second.path)).valid).toBe(true);
  });
});
test("a repeated output path never replaces an existing package", async () => {
  await withBuiltProject(async (root) => {
    const options = { outDir: join(root, "out") };
    const first = await packProject(root, options);
    const before = await readFile(first.path);
    await expect(packProject(root, options)).rejects.toMatchObject({ code: "E_OUTPUT_EXISTS" });
    expect(await readFile(first.path)).toEqual(before);
  });
});
```

`withBuiltProject(run)` 在 D5 新建 `tests/support/built-project.ts`，由 D3 withBuildProject + 真实 Vite build/aplgVite 生成产物后调用 run；不能手写“看起来正确”的 build record 代替主要正向测试。

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/archive-pack.test.ts`。
- [ ] **Step 3：显式白名单快照再归档。** 仅收集 `aplg.json`、`dist/**`、LICENSE 与 D2 允许的可选文档/icon。使用 lstat/realpath/open 的身份比对拒绝 symlink、junction、文件替换、越界；输入快照拷入本次私有临时目录后再压缩，避免在压缩过程中读取可变工作区。不能只用 startsWith 字符串判断根路径，也不能从 Node config import 得到任意 includes。

确定性设置：条目按包内 UTF-8 字节顺序排序；统一非可执行 regular file mode `0644`；固定 DOS 时间 `1980-01-01 00:00:00`（按 ZIP 字段直接控制，不随机器时区变化）；无 comment/机器路径/当前时间字段；压缩参数固定，包含原始 manifest 字节。相同工具链/锁定压缩器版本与输入保证字节一致，跨实现版本不承诺相同压缩字节。

输出名 `${id}-${version}.aplg`。先在 outDir 写唯一临时文件（以 `.staged.aplg` 结尾，使 inspect 的扩展名约束一致），关闭并经 inspectPackage 自校验，再用同文件系统的原子 hard-link no-clobber 建立最终路径，成功后移除临时链接；若平台无法实现 no-clobber 则失败，不能用覆盖式 rename 补救。失败只清理自己创建的临时文件，已有包保持不变。输出目录不得位于 dist 或指向 symlink；项目内默认 `.aplg-output` 不在输入白名单。

```ts
const inspection = await inspectPackage(stagedArchivePath);
if (!inspection.valid) {
  throw Object.assign(new Error("Generated package failed validation"), {
    code: "E_PACKAGE_INVALID", diagnostics: inspection.diagnostics,
  });
}
```

`stagedArchivePath` 为本次在 outDir 新建的临时文件；验收成功才建立最终路径。packResult 的 package hash 与 inspection 实际 hash 一致，source manifest hash 从读到的精确字节生成。

- [ ] **Step 4：GREEN。** 测试输入排序、时区/mtime 改变、超大包/条目、缺 entry、并发相同输出、`.env` 不入包、LICENSE 缺失、symlink/junction 拒绝、失败不留下最终路径、二进制篡改 inspect 失败。Windows/Linux 矩阵验证相同夹具归档字节。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/archive packages/tauri-plugin-devkit/src/project packages/tauri-plugin-devkit/src/cli packages/tauri-plugin-devkit/src/index.ts packages/tauri-plugin-devkit/tests packages/tauri-plugin-devkit/README.md
git commit -m "feat(devkit): 可复现且不覆盖的 APLG 打包"
```

## Task D6：无副作用的 vanilla-ts 模板与投稿说明

**Files:** `src/init/{index,render}.ts`、`templates/vanilla-ts/{package.json,aplg.json,index.html,src/main.ts,src/styles.css,tsconfig.json,vite.config.ts,README.md,LICENSE,gitignore}`、`templates/github/ci.yml`、`tests/init.test.ts`；连接 CLI init。

**Interfaces:** initProject 第 3.1 节签名；同一模板被 CLI 与 plugin-example 联调使用，不额外发布 generator 包。`aplgVite` 保留原生 HTML/CSS/JS 默认体验；模板选择 TS 只是新项目默认，不强迫现有 JS 示例改为 TS。固定生成 `private:true` 的用户项目，不把作者插件当 npm 公共库。

- [ ] **Step 1：写覆盖保护和未执行脚本测试。**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initProject } from "../src/index.js";
import { withProject } from "./support/project.js";

test("initialization refuses a nonempty directory without changing its files", async () => {
  await withProject({ "keep.txt": "unchanged" }, async (root) => {
    await expect(initProject(root, { id: "io.github.example.demo", name: "Demo" }))
      .rejects.toMatchObject({ code: "E_TARGET_NOT_EMPTY" });
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("unchanged");
  });
});
```

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/init.test.ts`。
- [ ] **Step 3：生成显式、最小项目。** 校验 ID/name，字符串通过 JSON.stringify / HTML escaping 插入，不将 name 当 shell/path。只使用内置模板，目标必须不存在或为空且不为 link；逐文件 exclusive create，失败只清理本次已创建文件，不递归删除用户目标目录。

模板 package scripts：`dev:vite`、`typecheck:tsc --noEmit`、`test:node --test tests/*.test.mjs`、`build:pnpm typecheck && vite build`、`plugin:validate:aplg validate --stage dist`、`plugin:pack:aplg pack`。模板还应包含 `tests/example.test.mjs` 和 `src/example.js` 的最小纯逻辑例子，避免生成一个会因没有测试文件而失败的 test script；它们列入模板文件清单。默认清单无权限，不自动使用 filesystem/network。模板的 `node-types` 声明由 types-only 出口加载，不产生 JS import。模板 browser tsconfig 为 ES2022/DOM、ESNext/Bundler、strict、allowJs/checkJs、上述 node-types；只 include src，测试与 Vite 配置使用独立 Node 配置，避免全量 Node 声明污染插件。

模板 dependencies 使用 `@ai-switch/tauri-plugin-runtime:0.1.0`；devDependencies 为同版 devkit、固定 Vite/TS；真实 registry 尚无版本时，D8 测试通过 tarball override，不把未发布版本误写成“当前可从 npm 安装”。init 不生成虚假 lock：README 明确第一次 `pnpm install` 生成并提交锁文件，此前 source 校验提示缺锁，随后 CI 用冻结安装。

生成 `.gitignore` 排除 dist/node_modules/.aplg-output/*.aplg/.env。README 清楚说明虚拟文件能力由宿主提供，模板与真实权限没有自动关系；投稿指向 plugin-store 的固定源码 commit、manifest SHA 和维护者核验流程。模板 `.github/workflows/ci.yml` 从 `templates/github/ci.yml` 生成；只读 CI template 固定 action 提交，不含签名、商店 token、`pull_request_target` 或自动批准 PR。

- [ ] **Step 4：GREEN。** 测试 Unicode 名称、恶意 HTML/name/ID、目标已有文件、symlink 根、并发 init、输出树不含 node_modules/.git、版本一致、生成项目真实安装后 typecheck/test/build/validate/pack 通过（在 D8 tarball 验收集中运行）。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/init packages/tauri-plugin-devkit/src/cli packages/tauri-plugin-devkit/src/index.ts packages/tauri-plugin-devkit/templates packages/tauri-plugin-devkit/tests/init.test.ts
git commit -m "feat(devkit): 生成最小插件模板与贡献指引"
```

## Task D7：显式模拟宿主与本地开发预览

**Files:** `src/testing/{index,host,storage,filesystem}.ts`、`src/vite/preview.ts`、`tests/{test-host,preview-policy}.test.ts`、`tests/browser/preview.spec.ts`；添加 `/testing` export。

**Interfaces:** 第 3.4 节 createTestHost；消费真实 runtime `createPluginHost` / HostTransport，不调用 runtime 私有 RpcPeer。模拟 filesystem 实现 R7 的同一标准 DTO，但数据在内存，不访问 Node fs 或浏览器本机磁盘。

- [ ] **Step 1：写会话归属、显式启用和清理测试。**

```ts
import { expect, test } from "vitest";
import { createTestHost } from "../src/testing/index.js";
import { validManifest } from "./support/test-host-fixture.js";
import type { SessionDescriptor } from "@ai-switch/tauri-plugin-runtime/protocol";

test("memory filesystem is not advertised unless explicitly configured", async () => {
  const host = createTestHost({ manifest: validManifest(), assetUrl: "http://127.0.0.1:43272/plugin.html" });
  const session = await host.transport.call<SessionDescriptor>("session.open", { pluginId: "io.github.example.notes" });
  expect(session.info.capabilities["aplg.fs"]).toBeUndefined();
  await host.dispose();
  expect(host.activeSessionIds()).toEqual([]);
});
```

`tests/support/test-host-fixture.ts` 的 `validManifest()` 返回 D1 同一有效清单；测试不要从 runtime 私有 tests 导入它。

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/test-host.test.ts tests/preview-policy.test.ts` 与 `exec playwright test tests/browser/preview.spec.ts`。
- [ ] **Step 3：实现框架无关的模拟 Transport。** session.open 校验插件 ID、manifest/capability 协商；closed session 的任何操作失败；capability.call 只路由明确声明的模拟 methods。所有 event/transfer handle 按 session 归属检查；disconnect/reconnect 仅改变连接状态并通知 runtime，不自动重放调用。memoryFiles 的 /data 持久性仅限当前 TestHost 生命周期，dispose 清空全部。

`/testing` 必须浏览器可打包，无 Node builtin 引用；Vite preview 的 Node 静态服务只服务项目根受控源文件，不把任意 fs 路径暴露成 URL。开发壳用醒目标识“模拟宿主 / 内存数据”，不提示连接到了 ai-switch。

开发路由为 `/__aplg_preview__/`；`vite serve` 的终端提示该 URL，默认不打开浏览器。只绑定 loopback、校验 Host，拒绝配置 `host:0.0.0.0` 或 LAN 暴露预览壳；禁止在生产 build 中包含该路由和 mock 数据。开发 iframe 与 host 通过 runtime 桥通信，不授予 allow-same-origin。开发 HTML 顶层访问时显示指向 `/__aplg_preview__/` 的明确提示，不能因握手失败自动跳过 bootstrap 运行插件。

Vite HMR 的 WebSocket 会与严格插件 connect-src 冲突：首期 preview 明确关闭 iframe HMR 和 Vite client 注入，文件变化触发宿主 dispose + 完整重新挂载；更新后的业务再次握手。不为方便开发而把管理 API 或所有网络来源加入 CSP。公开 npm 包不含 quick-dev 宿主私有命令。

- [ ] **Step 4：GREEN。** browser 验证生成插件预览能 ready、输入操作、重载新会话、旧句柄失效；未提供 fs 时文件调用明确失败；显式 memoryFiles 的读写不触碰 OS；清空 host 后句柄和订阅释放；生产 bundle 没有 `/testing` 或 preview。通过被测 runtime 真正执行，不靠 mock “已经连接”返回值。
- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/testing packages/tauri-plugin-devkit/src/vite/preview.ts packages/tauri-plugin-devkit/tests packages/tauri-plugin-devkit/package.json packages/tauri-plugin-devkit/scripts/build.mjs
git commit -m "feat(devkit): 提供显式内存测试宿主与开发预览"
```

## Task D8：双 tarball 外部验收与 plugin-example 迁移准备

**Files:** `scripts/verify-tarball.mjs`、`tests/cli-e2e.test.ts`、`tests/browser/packaged-example.spec.ts`；`fixtures/aplg/plugin-example/`；根 `scripts/aplg/verify-pair.mjs` 由本任务创建，D9 仅调用；文档 `README.md`。

**Interfaces:** runtime R8 的 tarball 与 devkit tarball；验收消费者不读取 packages/src、不共享 pnpm workspace symlink。`verify-pair.mjs` 的 CLI 为 `node scripts/aplg/verify-pair.mjs --runtime <runtime.tgz> --devkit <devkit.tgz>`，退出 0 表示安装、构建、打包与浏览器夹具通过。

- [ ] **Step 1：先写真实子进程 CLI 测试。** 将 root 外临时目录作为 cwd，安装两个 tarball（通过 pnpm overrides 将 devkit 的 runtime 精确依赖指向本地 runtime tgz），运行 bin，而非直接 import 源码函数。

```ts
import { expect, test } from "vitest";
import { runPackedCli, withInstalledTarballs } from "./support/tarball-consumer.js";

test("published CLI JSON is consumable without workspace dependencies", async () => {
  await withInstalledTarballs(async (consumer) => {
    const result = await runPackedCli(consumer, ["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
    const unknown = await runPackedCli(consumer, ["not-a-command", "--json"]);
    expect(unknown.code).toBe(1);
    expect(() => JSON.parse(unknown.stdout)).not.toThrow();
  });
});
```

`tests/support/tarball-consumer.ts` 提供 `withInstalledTarballs(run)` 和 `runPackedCli(root,args):Promise<{code:number;stdout:string;stderr:string}>`；使用 Node spawn/execFile 的 argv 数组，不拼接未信任 shell。Windows 的 pnpm 包装执行采用已验证的 CLI 路径；不得把路径枚举交给 cmd 作删除。输出断言针对真实 package bin。

- [ ] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit run verify:tarball`；消费者的 Node resolve 不可回退应用 node_modules，否则验收无效。
- [ ] **Step 3：完成发布文件和实际项目闭环。** exports 为根 Node API、`/vite`、`/testing`、types-only `/node-types`、`/package.json`；`bin.aplg = dist/cli.js`，保留 shebang。files 为 dist、templates、README、LICENSE、第三方声明；不包含 tests、私有截图、workspace lock、用户环境、密钥。产物用 esbuild 分入口，Node API 不捆 Vite；browser testing 不引入 Node fs/process。`src/node-types.d.ts` 随 dist 复制，文件内无顶层 import/export，使 ambient module 声明被 TypeScript 正确加载；其内部只重导出 runtime 子集类型。runtime 和 Vite 都保持 public package external，不内嵌第二份 runtime 单例；消费者 bundler 对 public exports 做唯一解析。

外部验收顺序：install tarballs → `aplg init` → 显式 pnpm install → typecheck/test/build → validate dist → pack → inspect → 浏览器使用真实 runtime host 加载打包产物。解包仅在测试中安全临时目录，经 D2 校验后按路径策略写入，不用于生产安装器。

从 `https://github.com/ai-switch/plugin-example` 的固定已核验源码 commit 读取示例（当前基线 `c30cd40d8d6fafba15acbeb0b866f72fff0229c1`），在 `fixtures/aplg/plugin-example` 保存必要源码和 LICENSE，并记录来源。将 Vite 配置改用 aplgVite、增加两个公共包和 plugin:validate/pack scripts，保留已有 7 个文本行为测试。通过本地 tarball 验证，不依赖当时尚未发布的 npm 版本。

示例远程迁移属于后续明确授权操作：本任务只准备已验证改动与需要的版本值，不自动 push/PR。公共包真正发布后再更新远程依赖和 README 状态；不能先让公开 example 指向不存在的包导致 CI 失败。

- [ ] **Step 4：GREEN。**

```powershell
pnpm --dir packages/tauri-plugin-runtime run build
pnpm --dir packages/tauri-plugin-devkit run typecheck
pnpm --dir packages/tauri-plugin-devkit test
pnpm --dir packages/tauri-plugin-devkit run build
pnpm --dir packages/tauri-plugin-devkit run verify:tarball
pnpm --dir packages/tauri-plugin-devkit exec playwright test
pnpm typecheck
pnpm test:run
```

确认两个 tarball 都不含 workspace:/绝对路径引用，声明可被外部 TS 项目消费；Vite source alias 未用于联调；纯 JS 构建无 Cargo。此处验证的是新契约的包内页面与 JS 桥，不替代 Tauri/真实 Rust 后端的集成测试。

- [ ] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit fixtures/aplg/plugin-example scripts/aplg/verify-pair.mjs pnpm-lock.yaml
git commit -m "test(devkit): 验收双包外部安装与示例打包"
```

## Task D9：两 npm 包协调 CI 与显式授权发布入口

**Files:** `.github/workflows/tauri-plugin-runtime.yml`、`scripts/aplg/{plan-release.mjs,plan-release.test.mjs,publish-npm.mjs}`；调用 D8 verify-pair 与 R8 package boundary 检查；修改两包 README 的发布说明。

**Interfaces:** `planRelease(input): ReleasePlan` 在 `plan-release.mjs` 导出；`input` 为 `{tag, runtime:{name,version}, devkit:{name,version,runtimeDependency}}`；输出 `{version,order:[runtimeName,devkitName],candidateTag:"aplg-candidate",stableTag:"latest"}`。非法名称/版本/依赖/tag 抛 `E_RELEASE_PLAN`。只允许稳定 SemVer；预发布流程另行设计，不把 beta 意外推到 latest。

- [ ] **Step 1：写无网络纯发布计划测试。**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { planRelease } from "./plan-release.mjs";

const input = {
  tag: "tauri-plugin-runtime-v0.1.0",
  runtime: { name: "@ai-switch/tauri-plugin-runtime", version: "0.1.0" },
  devkit: { name: "@ai-switch/tauri-plugin-devkit", version: "0.1.0", runtimeDependency: "0.1.0" },
};
test("app version tags can never publish runtime packages", () => {
  assert.throws(() => planRelease({ ...input, tag: "v0.1.0" }), { code: "E_RELEASE_PLAN" });
});
test("package version mismatch blocks both package publications", () => {
  assert.throws(() => planRelease({ ...input, devkit: { ...input.devkit, version: "0.2.0" } }), { code: "E_RELEASE_PLAN" });
});
test("runtime is published before its exact-version devkit consumer", () => {
  assert.deepEqual(planRelease(input).order, ["@ai-switch/tauri-plugin-runtime", "@ai-switch/tauri-plugin-devkit"]);
});
```

- [ ] **Step 2：RED。** `node --test scripts/aplg/plan-release.test.mjs`。
- [ ] **Step 3：实现协调验证 workflow，不改应用发布触发器。** 普通 PR/main push 只执行两包 typecheck/test/build/pack/verify-pair，Windows+Ubuntu Node 22/24 矩阵；浏览器测试在 Ubuntu 跑 Chromium/WebKit。action 固定核验过的完整 commit；根普通 PR 没有 npm/OIDC/Release 写权限，checkout 不持久保存凭据。CI 不自动执行未审阅外部插件源码仓库。

tag 触发仅 `tauri-plugin-runtime-v*`；保护 environment `aplg-npm-release`，publication job 显式请求 `id-token:write` 和必要 Release 权限，执行前验证 tag/SHA 来自审核代码，两包 tarball/manifest/声明已验收。npm CLI 必须满足当时 trusted publishing 要求，并在 workflow 固定受支持版本；缺 scope/package/trusted publisher 配置即失败关闭，不临时回退明文 token。配置这些外部权限不属于无授权自动操作。

`publish-npm.mjs` 默认 dry-run，只有显式 `--execute` 且有效 GitHub/OIDC 环境才执行。release planner 读取经过安全检查的 tarball 中 package.json，确认 pnpm 已将 workspace dependency 改成精确版本；源码 package 的 workspace 字符串不能直接拿去做 registry 发布。输入只接受校验后的 tarball 绝对路径、tag 和 source SHA；无插件提供的 shell 字符串。对已发布版本先核对 registry dist.integrity 与本次 tarball sha512；相同则幂等跳过，冲突则失败，不能 unpublish/覆盖。

按 order 将两包 publish 到 candidate tag，两个 registry 结果都确认后再更新 latest。任何 publish 失败不提升 latest；latest 提升本身不是多包事务，执行前保存两个旧 dist-tag 指向，第二步失败尝试恢复已改标签并报告部分结果，不宣称原子性。恢复失败需要人工处置，不重写历史包版本。候选 dist-tag 不隔离按版本范围安装，README 必须提示使用锁文件。

实际调用 npm publish 时固定使用已验证支持 OIDC 的 npm CLI，并加 `--ignore-scripts` 与 provenance 选项；只上传已验证 tarball，不重新打包源码。发布包使用 provenance，GitHub Release 附两个 tarball、SHA256 清单与版本说明；manifest 指明 npm/协议/API 各自版本。源验证 job 的 artifact 只允许来自同 run/commit，发布 job 不执行包生命周期脚本。实际用户说“发布”之前不创建 tag 或调用 execute。

- [ ] **Step 4：GREEN 与非发布演练。** `node --test scripts/aplg/plan-release.test.mjs`、workflow 静态校验、两包 dry-run、假 registry HTTP 服务模拟已存在/冲突/第一包成功第二包失败/latest 部分更新；验证脚本未调用真实 registry publish。真实 npm OIDC 和 GitHub Release 只有显式发布任务才验收，记录为外部待启用门槛，不以 dry-run 假称已发布。
- [ ] **Step 5：提交流程代码，不推送/tag。**

```powershell
git add -- .github/workflows/tauri-plugin-runtime.yml scripts/aplg packages/tauri-plugin-runtime/README.md packages/tauri-plugin-devkit/README.md
git commit -m "ci(aplg): 增加双包校验与受控发布入口"
```

## 5. 规格覆盖与后续交付

| 规格 | 本计划 | 不可混淆的边界 |
| --- | --- | --- |
| 通用开发工具 | D1–D8 | 不复制 runtime/协议，不依赖 ai-switch |
| Node alias、bootstrap | D3/D4 | 接口语义与 handshake 归 runtime；动态恶意行为由宿主隔离 |
| 安全 `.aplg` 包 | D2/D5 | 结构检查不是来源信任、安装授权或 OS 沙箱 |
| 模板/示例/开发预览 | D6–D8 | 内存 Provider 不是真实 Rust filesystem；远程示例修改需单独授权 |
| npm CI Release | D9 | 外部 scope/OIDC/environment 配置与实际发布需授权，不在写代码时默默执行 |
| plugin-store | 文档/模板对接 | PR 身份审核、签名密钥、真实插件 Release/索引在商店独立计划实现 |
| 原生扩展 | 明确拒绝 web-v1 夹带 native | Rust runner、target matrix、原生 profile 不在本计划 |

## 6. 双计划最终完成条件

- runtime R1–R8 与 devkit D1–D9 的已实施任务各自有 RED/GREEN 和独立提交；未执行的外部发布门槛明确列出，不把文档复选框当测试结果。
- `verify-pair` 从两个真实 tarball 创建外部消费者，完成模板/示例构建、包检查与真实 iframe 握手；不使用应用或 monorepo 源码 alias。
- 公共 schema/DTO/API 名称一致；devkit 任何行为需要新协议字段时回到 runtime 契约评审，不在 devkit 隐藏塞字段。
- 应用 typecheck/test 没有因 workspace 和测试发现范围改变而回归；两包生成物未混入主应用构建。
- README/模板不承诺当前不存在的 Rust 能力、npm 版本、签名或商店自动发布。真正的双模式系统级完成条件仍由 Rust+ai-switch 与 plugin-store 后续计划承担。
