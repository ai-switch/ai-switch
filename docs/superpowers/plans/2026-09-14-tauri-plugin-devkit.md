# 通用 tauri-plugin-devkit 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `executing-plans` 按任务执行；只有用户明确授权代理委派后，才可选择 `subagent-driven-development`。先测试后实现，不在本计划执行中自动推送或发布。

**Goal:** 交付 `@ai-switch/tauri-plugin-devkit`，使外部开发者能够从模板创建插件，完成校验、Node alias 与 bootstrap 构建、可复现 `.aplg` 打包和检查，并能在不依赖 ai-switch 源码的测试宿主中验收。

**Architecture:** devkit 单向依赖 runtime 的公开 `/protocol`、`/plugin`、`/host` 和 `/node/*`；Node 侧负责本地项目、打包与 CLI，浏览器 `/testing` 只提供显式模拟宿主。生产权限、真实 Rust 文件操作、签名信任和 plugin-store 的审核发布不混入 devkit。

**Tech Stack:** Node `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm 10.12.4、TypeScript 5.9.3、Vite 8.3.0、esbuild 0.28.0、Vitest 5.0.0、Playwright 1.63.0、yauzl 3.4.0、yazl 3.3.1、parse5 8.0.1。

**Spec:** `docs/superpowers/specs/2026-09-13-aplg-plugin-runtime-design.md`。

**Prerequisite plan:** `docs/superpowers/plans/2026-09-14-tauri-plugin-runtime.md`。R1/R2 的导出/契约是唯一权威，本文只引用，不维护复制的 manifest/wire schema。

**状态：** D1–D9 已实施并通过 Windows Node 22.22.2 与 Linux Node 22/24 本地验证；协调 CI 与受控发布入口已准备，npm `@ai-switch` scope、两包 trusted publisher 与 GitHub environment `aplg-npm-release` 已配置，两包 **0.1.0 已发布到 npm**。

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

- [x] **Step 1：写失败测试，先验证不执行未信任配置。**

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/project.test.ts tests/cli.test.ts`；先建测试配置和安装依赖，失败点应为待实现行为。
- [x] **Step 3：实现 bounded JSON 读取与规范化结果。** `aplg.json` 最大 256 KiB，UTF-8 解码错误拒绝；保留精确字节计算 SHA。调用 runtime parse/validate，不复制 schema；web-v1 拒绝 native true。源码校验检查根、manifest/package 版本、README/LICENSE、pnpm lock 和声明 profile；dist 阶段追加 D4 的产物检查，D1 尚未实现时显式返回 `E_DIST_VALIDATION_UNAVAILABLE`，不能假成功。

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

- [x] **Step 4：GREEN。** 覆盖非 JSON、非法 UTF-8、版本 mismatch、native=true、源根越界、缺 lock、无副作用与 JSON stdout；执行 `typecheck/test/build`，确认浏览器 `/testing` 与 Node 根入口未串依赖。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit package.json pnpm-lock.yaml
git commit -m "feat(devkit): 建立项目校验与 CLI 基础"
```

## Task D2：不执行/不解包的 `.aplg` 归档检查

**Files:** `src/archive/{inspect,paths,zip-header,crc32}.ts`、`tests/archive-inspect.test.ts`、`tests/support/zip-fixtures.ts`；连接 CLI inspect 和包根 exports。

**Interfaces:** 消费 runtime `normalizeArchivePath` / limits；产出 inspectPackage。不调用 packProject，不信任 archive 的文件扩展名、central directory 尺寸或 CRC 自报值。

- [x] **Step 1：先写恶意 ZIP 行为测试。**

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/archive-inspect.test.ts`。
- [x] **Step 3：使用 yauzl lazyEntries 流式读取，`zip-header.ts` 对 central/local header 的名字、flag、method、offset、长度进行独立 bounded 比对；`crc32.ts` 在流中累计标准 CRC-32 并用已知向量（UTF-8 `123456789` → `0xcbf43926`）与 ZIP fixture 验证，不假定 yauzl 已经检查 CRC。** 文件头大小先限制 128 MiB；entry 计数、解压后实际字节和累计大小逐条统计；大于 512 MiB/10,000 立即停止并关闭流，不能先整体解压到内存。所有输入内容保存在 ZIP 验证器的局部预算内，manifest 最大 256 KiB，HTML 最大 2 MiB，单个需解析的 JS/CSS 文本最大 16 MiB，超过时返回 E_LIMIT_EXCEEDED；其他资源流式散列，不整体载入内存。检查 ZIP 目录项、路径字段、encoding 与 NFC；大小写碰撞、重复项、盘符/UNC/设备路径、非法权限位、symlink、加密、重叠偏移、local/central 路径不一致、CRC 或真实大小 mismatch 均拒绝。目录项只允许零长度、单个尾随 `/`，验证时去掉该末尾分隔符；计入条目/冲突检查但不作为文件输出。首期在既有限额下只接受不带 data descriptor 的经典 ZIP，不接受 ZIP64；D5 使用`yazl.addBuffer` 读取已验证快照字节生成该 profile，避免验证器和打包器对可变长度记录支持不一致。

只接受 `.aplg` 包内 `aplg.json`、`dist/**`、`LICENSE`、可选 `README.md`、`icon.svg`/`icon.png` 与 `THIRD_PARTY_NOTICES.md`。未知顶层路径、源码 `.env`、证书私钥、node_modules、Git 元数据不进入包；web-v1 拒绝 native 目录及可执行/动态库产物。大小写冲突使用 NFC + ASCII 大小写折叠，非 ASCII 名称保留且对平台特有等价规则保守拒绝已知歧义，不能声称覆盖所有文件系统命名等价。

`aplg.json` 必须恰好 1 份且 <=256 KiB；解析、manifest/profile/entry 检查复用 D1/runtime。返回包 SHA-256 与每个实际字节文件的 SHA-256。没有签名输入/信任配置的 inspect 无论结构多完整都只能给 `signature:"not-verified"`。

- [x] **Step 4：GREEN。** 加入固定可安装结构成功、空包、缺清单、多个清单、entry 不存在、重复大小写路径、ZIP bomb（实际流上限）、截断、损坏 CRC、local/central 不一致、错误扩展名；验证临时根外没有任何写入。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/archive packages/tauri-plugin-devkit/src/index.ts packages/tauri-plugin-devkit/src/cli packages/tauri-plugin-devkit/tests
git commit -m "feat(devkit): 安全检查 APLG 归档结构"
```

## Task D3：只对插件生效的 Vite Node alias

**Files:** `src/vite/{index,aliases}.ts`、`src/node-types.d.ts`、`tests/vite-aliases.test.ts`、`tests/types/node-imports.ts`、`tests/support/build-project.ts`；添加 `/vite` 与 types-only `/node-types` 出口与构建配置。

**Interfaces:** `aplgVite(options?):Plugin[]` 消费 runtime 子入口；依赖 R6/R7。只有 plugin bundle 重定向，Vite 配置/CLI/Node build scripts 仍使用真实 Node builtin。`src/node-types.d.ts` 仅随 types-only 出口交付，不生成可执行 shim，也不能让 Node config 误解析为浏览器虚拟 fs。

- [x] **Step 1：从真实 Vite 构建写失败测试。** fixture code 使用 `node:path`，构建产物导入浏览器后应返回 POSIX 虚拟路径，而不是 Node/Rollup external stub。`withBuildProject(files,run)` 在 D3 建立：由已构建 runtime 产出本地 tarball，临时 project 的测试专用 package.json 仅安装该 tarball 与固定 Vite，生成真实 lock 后用配置对象调用 aplgVite。它不安装尚未发布的 registry devkit，也不需要 D8 helpers；测试的是当前 devkit 实现 + 已打包 runtime，最终两包隔离安装由 D8 验证。

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/vite-aliases.test.ts`。
- [x] **Step 3：精确 specifier 映射，不正则吞前缀。**

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
- [x] **Step 4：GREEN。** 对 `fs/promises`、`node:fs/promises` 同样工作；对 child_process/net/tls/worker_threads/process/.node 失败；浏览器执行打包后的 path/Buffer 程序并验证结果。测试未配置 aplgVite 的宿主 Vite 构建不受影响。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/vite packages/tauri-plugin-devkit/tests/vite-aliases.test.ts packages/tauri-plugin-devkit/package.json packages/tauri-plugin-devkit/scripts/build.mjs
git commit -m "feat(devkit): 为插件构建适配 Node 子集接口"
```

## Task D4：bootstrap 顺序、相对资源与产物验证

**Files:** `src/vite/{bootstrap,artifacts}.ts`、`src/project/validate.ts`、`tests/{bootstrap,artifact-policy}.test.ts`、`tests/browser/bootstrap.spec.ts`；包内 fixture server 和 Playwright 配置。

**Interfaces:** 消费 R4 `connectPlugin` 与 R5 host；内部 `inspectBuildFiles(root:string,manifest:Manifest):Promise<{files:PackFile[];diagnostics:Diagnostic[]}>`，由 Vite buildEnd/writeBundle 与 `validateProject(stage:"dist")` 共用。不消费项目 Vite config 来“重现”安全检查。

- [x] **Step 1：写握手前后可观察顺序与资源反例。** `tests/browser/bootstrap.spec.ts` 的 fixture host 提供按钮 `Connect plugin`，在点击前不发送 runtime connect；plugin business 入口设置一个可见文本 `business-started`。测试真实打包产物，而非伪造两个函数调用顺序。

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/bootstrap.test.ts tests/artifact-policy.test.ts` 与 `exec playwright test tests/browser/bootstrap.spec.ts`，测试项目显式使用真实 runtime fixture 后端。
- [x] **Step 3：通过虚拟模块注入启动器，而不是多加一个并行 script。** 首期接受一个本地外部 `type=module` 业务入口，零脚本纯 HTML 也允许；拒绝多个入口、内联 JS、classic script、inline handler、remote source。parse5 解析 HTML，移除原业务 script，替换为 Vite 虚拟 bootstrap 入口。启动代码必须使用动态 import：

```ts
import { connectPlugin } from "@ai-switch/tauri-plugin-runtime/plugin";
await connectPlugin();
await import("/src/main.ts");
```

真实入口来自校验后的 HTML 路径，用 JSON.stringify 编码为字符串字面量；不是手拼任意 HTML/script。若用静态 import，ESM 会先执行业务模块，测试必须能抓到。connect 失败显示不含敏感数据的简洁错误，不能直接运行业务作为 fallback。保留模块图，不改插件自己的业务代码以判断运行环境。

强制/校验 `base:"./"`、outDir 为 root 下 `dist`、browser target ES2022、相对 chunk 引用；不允许配置覆盖导致清空项目根外目录。`aplgVite` 不主动删除任何外部目录，若 Vite 配置冲突直接报错。产物 record `dist/aplg-build.json` 记录工具版本、源 manifest SHA、bootstrap 入口和本地产物列表（不包含该 record 自身的摘要，避免自引用）；它只是可复查构建元数据，不是可信签名。

产物扫描使用 parse5、PostCSS/value parser 与 es-module-lexer（均只在 Node 校验侧），覆盖 HTML `src/href/srcset`、CSS `url/@import`、静态和可分析动态模块引用：不得有远程/绝对系统路径、CDN、runtime `/host`、devkit `/testing`、残留 Node builtin、宿主源码路径或外部 sourcemap。允许本地 data:image 与本地资源 fragment；不允许 data/javascript 或远程脚本。扫描不宣称阻止所有运行期计算 URL，真正网络限制仍靠宿主 CSP/Broker。

清单原始字节不得在构建时改变；资源图必须存在、规范路径下且被打包候选列表覆盖。静态资源 CORS/CSP 的正确配置由宿主负责，构建器不能给应用管理 API 设置宽松 CORS。

- [x] **Step 4：GREEN。** 测试 bootstrap 单次注入、零入口、多个入口失败、脚本异常被报告、源 manifest 修改失败、路径逃逸、相对图片/CSS、unicode 文件名规范、外部网络引用失败；通过严格 CSP 的真实 iframe 验证不需 unsafe-eval。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/vite packages/tauri-plugin-devkit/src/project packages/tauri-plugin-devkit/tests packages/tauri-plugin-devkit/playwright.config.ts
git commit -m "feat(devkit): 注入受控启动器并校验离线产物"
```

## Task D5：可复现、安全且不覆盖的 `.aplg` 打包

**Files:** `src/archive/pack.ts`、`src/project/files.ts`、`tests/archive-pack.test.ts`；连接 CLI pack、index.ts、README。

**Interfaces:** packProject 消费 D1 dist 验证、D2 inspectPackage、D4 build record；输出 PackResult。输入根需要已有合法 dist，pack 不自动 build/install、不执行任何源码。

- [x] **Step 1：先写可复现与拒绝覆盖测试。**

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/archive-pack.test.ts`；核心测试先以 `packProject is not a function` 失败，CLI pack 测试先以 `E_COMMAND_UNAVAILABLE` 失败。
- [x] **Step 3：显式白名单快照再归档。** 仅收集 `aplg.json`、`dist/**`、LICENSE 与 D2 允许的可选文档/icon。使用 lstat/realpath/open 的身份比对拒绝 symlink、junction、文件替换、越界；输入快照拷入本次私有临时目录后再压缩，避免在压缩过程中读取可变工作区。不能只用 startsWith 字符串判断根路径，也不能从 Node config import 得到任意 includes。

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

- [x] **Step 4：GREEN。** 覆盖输入排序、时区/mtime 改变、预算边界、缺 entry、并发相同输出、`.env` 不入包、LICENSE 缺失、symlink/junction 拒绝、私有快照竞态、自检二进制拒绝，以及 hard-link 后身份失败的 final/stage 回滚。Windows 本地定向测试、429 项 devkit 全量 Vitest、公共类型与 built bin 测试已通过；本机无 Docker，WSL Ubuntu VHD 无法挂载，因此不虚假声明 Linux 已本地验证，Linux 矩阵由 D9 CI 发布门禁承接。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/archive packages/tauri-plugin-devkit/src/project packages/tauri-plugin-devkit/src/cli packages/tauri-plugin-devkit/src/index.ts packages/tauri-plugin-devkit/tests packages/tauri-plugin-devkit/README.md
git commit -m "feat(devkit): 可复现且不覆盖的 APLG 打包"
```

## Task D6：无副作用的 vanilla-ts 模板与投稿说明

**Files:** `src/init/{index,render}.ts`、`templates/vanilla-ts/{package.json,aplg.json,index.html,src/main.ts,src/styles.css,tsconfig.json,vite.config.ts,README.md,LICENSE,gitignore}`、`templates/github/ci.yml`、`tests/init.test.ts`；连接 CLI init。

**Interfaces:** initProject 第 3.1 节签名；同一模板被 CLI 与 plugin-example 联调使用，不额外发布 generator 包。`aplgVite` 保留原生 HTML/CSS/JS 默认体验；模板选择 TS 只是新项目默认，不强迫现有 JS 示例改为 TS。固定生成 `private:true` 的用户项目，不把作者插件当 npm 公共库。

- [x] **Step 1：写覆盖保护和未执行脚本测试。**

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/init.test.ts`；初始 14 项测试因 `initProject is not a function`/CLI unavailable 按预期失败。
- [x] **Step 3：生成显式、最小项目。** 校验 ID/name，字符串通过 JSON.stringify / HTML escaping 插入，不将 name 当 shell/path。只使用内置模板，目标必须不存在或为空且不为 link；逐文件 exclusive create，失败只清理本次已创建文件，不递归删除用户目标目录。

模板 package scripts：`dev:vite`、`typecheck:tsc --noEmit`、`test:node --test tests/*.test.mjs`、`build:pnpm typecheck && vite build`、`plugin:validate:aplg validate --stage dist`、`plugin:pack:aplg pack`。模板还应包含 `tests/example.test.mjs` 和 `src/example.js` 的最小纯逻辑例子，避免生成一个会因没有测试文件而失败的 test script；它们列入模板文件清单。默认清单无权限，不自动使用 filesystem/network。模板的 `node-types` 声明由 types-only 出口加载，不产生 JS import。模板 browser tsconfig 为 ES2022/DOM、ESNext/Bundler、strict、allowJs/checkJs、上述 node-types；只 include src，测试与 Vite 配置使用独立 Node 配置，避免全量 Node 声明污染插件。

模板 dependencies 使用 `@ai-switch/tauri-plugin-runtime:0.1.0`；devDependencies 为同版 devkit、固定 Vite/TS；真实 registry 尚无版本时，D8 测试通过 tarball override，不把未发布版本误写成“当前可从 npm 安装”。init 不生成虚假 lock：README 明确第一次 `pnpm install` 生成并提交锁文件，此前 source 校验提示缺锁，随后 CI 用冻结安装。

生成 `.gitignore` 排除 dist/node_modules/.aplg-output/*.aplg/.env。README 清楚说明虚拟文件能力由宿主提供，模板与真实权限没有自动关系；投稿指向 plugin-store 的固定源码 commit、manifest SHA 和维护者核验流程。模板 `.github/workflows/ci.yml` 从 `templates/github/ci.yml` 生成；只读 CI template 固定 action 提交，不含签名、商店 token、`pull_request_target` 或自动批准 PR。

- [x] **Step 4：GREEN。** `init.test.ts` 14 项覆盖 Unicode/恶意 HTML、ID/name/template 校验、覆盖保护、symlink、并发、失败清理、只读 CI；CLI 与既有回归通过。模板 tarball 实际包含 `gitignore` 源文件并由 bundled init 输出 `.gitignore`；外部 runtime/devkit tarball 使用 pnpm override 安装后，生成项目的 test/typecheck/typecheck:node/build/validate/pack 全部通过。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/init packages/tauri-plugin-devkit/src/cli packages/tauri-plugin-devkit/src/index.ts packages/tauri-plugin-devkit/templates packages/tauri-plugin-devkit/tests/init.test.ts
git commit -m "feat(devkit): 生成最小插件模板与贡献指引"
```

## Task D7：显式模拟宿主与本地开发预览

**Files:** `src/testing/{index,host,storage,filesystem}.ts`、`src/vite/preview.ts`、`tests/{test-host,preview-policy}.test.ts`、`tests/browser/preview.spec.ts`；添加 `/testing` export。

**Interfaces:** 第 3.4 节 createTestHost；消费真实 runtime `createPluginHost` / HostTransport，不调用 runtime 私有 RpcPeer。模拟 filesystem 实现 R7 的同一标准 DTO，但数据在内存，不访问 Node fs 或浏览器本机磁盘。

- [x] **Step 1：写会话归属、显式启用和清理测试。**

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit exec vitest run tests/test-host.test.ts tests/preview-policy.test.ts` 与 `exec playwright test tests/browser/preview.spec.ts`。
- [x] **Step 3：实现框架无关的模拟 Transport。** session.open 校验插件 ID、manifest/capability 协商；closed session 的任何操作失败；capability.call 只路由明确声明的模拟 methods。所有 event/transfer handle 按 session 归属检查；disconnect/reconnect 仅改变连接状态并通知 runtime，不自动重放调用。memoryFiles 的 /data 持久性仅限当前 TestHost 生命周期，dispose 清空全部。

`/testing` 必须浏览器可打包，无 Node builtin 引用；Vite preview 的 Node 静态服务只服务项目根受控源文件，不把任意 fs 路径暴露成 URL。开发壳用醒目标识“模拟宿主 / 内存数据”，不提示连接到了 ai-switch。

开发路由为 `/__aplg_preview__/`；`vite serve` 的终端提示该 URL，默认不打开浏览器。只绑定 loopback、校验 Host，拒绝配置 `host:0.0.0.0` 或 LAN 暴露预览壳；禁止在生产 build 中包含该路由和 mock 数据。开发 iframe 与 host 通过 runtime 桥通信，不授予 allow-same-origin。开发 HTML 顶层访问时显示指向 `/__aplg_preview__/` 的明确提示，不能因握手失败自动跳过 bootstrap 运行插件。

Vite HMR 的 WebSocket 会与严格插件 connect-src 冲突：首期 preview 明确关闭 iframe HMR 和 Vite client 注入，文件变化触发宿主 dispose + 完整重新挂载；更新后的业务再次握手。不为方便开发而把管理 API 或所有网络来源加入 CSP。公开 npm 包不含 quick-dev 宿主私有命令。

- [x] **Step 4：GREEN。** browser 验证生成插件预览能 ready、输入操作、重载新会话、旧句柄失效；未提供 fs 时文件调用明确失败；显式 memoryFiles 的读写不触碰 OS；清空 host 后句柄和订阅释放；生产 bundle 没有 `/testing` 或 preview。通过被测 runtime 真正执行，不靠 mock “已经连接”返回值。
- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit/src/testing packages/tauri-plugin-devkit/src/vite/preview.ts packages/tauri-plugin-devkit/tests packages/tauri-plugin-devkit/package.json packages/tauri-plugin-devkit/scripts/build.mjs
git commit -m "feat(devkit): 提供显式内存测试宿主与开发预览"
```

## Task D8：双 tarball 外部验收与 plugin-example 迁移准备

**Files:** `scripts/verify-tarball.mjs`、`tests/cli-e2e.test.ts`、`tests/browser/packaged-example.spec.ts`；`fixtures/aplg/plugin-example/`；根 `scripts/aplg/verify-pair.mjs` 由本任务创建，D9 仅调用；文档 `README.md`。

**Interfaces:** runtime R8 的 tarball 与 devkit tarball；验收消费者不读取 packages/src、不共享 pnpm workspace symlink。`verify-pair.mjs` 的 CLI 为 `node scripts/aplg/verify-pair.mjs --runtime <runtime.tgz> --devkit <devkit.tgz>`，退出 0 表示安装、构建、打包与浏览器夹具通过。

- [x] **Step 1：先写真实子进程 CLI 测试。** 将 root 外临时目录作为 cwd，安装两个 tarball（通过 pnpm overrides 将 devkit 的 runtime 精确依赖指向本地 runtime tgz），运行 bin，而非直接 import 源码函数。

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

- [x] **Step 2：RED。** `pnpm --dir packages/tauri-plugin-devkit run verify:tarball`；消费者的 Node resolve 不可回退应用 node_modules，否则验收无效。
- [x] **Step 3：完成发布文件和实际项目闭环。** exports 为根 Node API、`/vite`、`/testing`、types-only `/node-types`、`/package.json`；`bin.aplg = dist/cli.js`，保留 shebang。files 为 dist、templates、README、LICENSE、第三方声明；不包含 tests、私有截图、workspace lock、用户环境、密钥。产物用 esbuild 分入口，Node API 不捆 Vite；browser testing 不引入 Node fs/process。`src/node-types.d.ts` 随 dist 复制，文件内无顶层 import/export，使 ambient module 声明被 TypeScript 正确加载；其内部只重导出 runtime 子集类型。runtime 和 Vite 都保持 public package external，不内嵌第二份 runtime 单例；消费者 bundler 对 public exports 做唯一解析。

外部验收顺序：install tarballs → `aplg init` → 显式 pnpm install → typecheck/test/build → validate dist → pack → inspect → 浏览器使用真实 runtime host 加载打包产物。解包仅在测试中安全临时目录，经 D2 校验后按路径策略写入，不用于生产安装器。

从 `https://github.com/ai-switch/plugin-example` 的固定已核验源码 commit 读取示例（当前基线 `c30cd40d8d6fafba15acbeb0b866f72fff0229c1`），在 `fixtures/aplg/plugin-example` 保存必要源码和 LICENSE，并记录来源。将 Vite 配置改用 aplgVite、增加两个公共包和 plugin:validate/pack scripts，保留已有 7 个文本行为测试。通过本地 tarball 验证，不依赖当时尚未发布的 npm 版本。

示例远程迁移属于后续明确授权操作：本任务只准备已验证改动与需要的版本值，不自动 push/PR。公共包真正发布后再更新远程依赖和 README 状态；不能先让公开 example 指向不存在的包导致 CI 失败。

- [x] **Step 4：GREEN。**

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

- [x] **Step 5：提交。**

```powershell
git add -- packages/tauri-plugin-devkit fixtures/aplg/plugin-example scripts/aplg/verify-pair.mjs pnpm-lock.yaml
git commit -m "test(devkit): 验收双包外部安装与示例打包"
```

## Task D9：两 npm 包协调 CI 与显式授权发布入口

**Files:** `.github/workflows/tauri-plugin-runtime.yml`、`scripts/aplg/{plan-release.mjs,plan-release.test.mjs,publish-npm.mjs}`；调用 D8 verify-pair 与 R8 package boundary 检查；修改两包 README 的发布说明。

**Interfaces:** `planRelease(input): ReleasePlan` 在 `plan-release.mjs` 导出；`input` 为 `{tag, runtime:{name,version}, devkit:{name,version,runtimeDependency}}`；输出 `{version,order:[runtimeName,devkitName],stableTag:"latest"}`。非法名称/版本/依赖/tag 抛 `E_RELEASE_PLAN`。只允许稳定 SemVer；预发布流程另行设计，不把 beta 意外推到 latest。

- [x] **Step 1：写无网络纯发布计划测试。**

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

- [x] **Step 2：RED。** `node --test scripts/aplg/plan-release.test.mjs`。
- [x] **Step 3：实现协调验证 workflow，不改应用发布触发器。** 普通 PR/main push 只执行两包 typecheck/test/build/pack/verify-pair，Windows+Ubuntu Node 22/24 矩阵；浏览器测试在 Ubuntu 跑 Chromium/WebKit。action 固定核验过的完整 commit；根普通 PR 没有 npm/OIDC/Release 写权限，checkout 不持久保存凭据。CI 不自动执行未审阅外部插件源码仓库。

tag 触发仅 `tauri-plugin-runtime-v*`；保护 environment `aplg-npm-release`，publication job 显式请求 `id-token:write` 和必要 Release 权限，执行前验证 tag/SHA 来自审核代码，两包 tarball/manifest/声明已验收。npm CLI 必须满足当时 trusted publishing 要求，并在 workflow 固定受支持版本；缺 scope/package/trusted publisher 配置即失败关闭，不临时回退明文 token。配置这些外部权限不属于无授权自动操作。

`publish-npm.mjs` 默认 dry-run，只有显式 `--execute` 且有效 GitHub/OIDC 环境才执行。release planner 读取经过安全检查的 tarball 中 package.json，确认 pnpm 已将 workspace dependency 改成精确版本；源码 package 的 workspace 字符串不能直接拿去做 registry 发布。输入只接受校验后的 tarball 绝对路径、tag 和 source SHA；无插件提供的 shell 字符串。对已发布版本先核对 registry dist.integrity 与本次 tarball sha512；相同则幂等跳过，冲突则失败，不能 unpublish/覆盖。

按 order 将两包 publish 到 candidate tag，两个 registry 结果都确认后再更新 latest。任何 publish 失败不提升 latest；latest 提升本身不是多包事务，执行前保存两个旧 dist-tag 指向，第二步失败尝试恢复已改标签并报告部分结果，不宣称原子性。恢复失败需要人工处置，不重写历史包版本。候选 dist-tag 不隔离按版本范围安装，README 必须提示使用锁文件。

实际调用 npm publish 时固定使用已验证支持 OIDC 的 npm CLI，并加 `--ignore-scripts` 与 provenance 选项；只上传已验证 tarball，不重新打包源码。发布包使用 provenance，GitHub Release 附两个 tarball、SHA256 清单与版本说明；manifest 指明 npm/协议/API 各自版本。源验证 job 的 artifact 只允许来自同 run/commit，发布 job 不执行包生命周期脚本。实际用户说“发布”之前不创建 tag 或调用 execute。

- [x] **Step 4：GREEN 与非发布演练。** `node --test scripts/aplg/plan-release.test.mjs`、workflow 静态校验、两包 dry-run、假 registry HTTP 服务模拟已存在/冲突/第一包成功第二包失败/latest 部分更新；验证脚本未调用真实 registry publish。真实 npm OIDC 和 GitHub Release 只有显式发布任务才验收，记录为外部待启用门槛，不以 dry-run 假称已发布。
- [x] **Step 5：提交流程代码，不推送/tag。**

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

## 7. 执行记录

### D1（2026-09-15）

- 新建 `@ai-switch/tauri-plugin-devkit@0.1.0` 独立 Node ESM 包，只导出根 `validateProject`、相关报告类型及 package.json；bin 为 aplg。依赖 runtime 的公开 `/protocol`，没有复制 schema、源码 alias 或反向 runtime→devkit 依赖。
- 先写 read/project/cli 失败测试，再实现 `project/{read,files,errors,types,validate}` 和 `cli/run`。最终 **3 文件 / 91 项测试**通过；构建后 **3 项 Node import/真实 CLI/旧 dist 清理测试**及 NodeNext 公共类型检查通过。Node 根类型使用 ES2022 + Node lib，不要求 DOM 全局。
- 源码校验仅打开五个固定元数据文件：aplg.json/package.json 各 256 KiB、README/LICENSE 各 1 MiB、pnpm lock 4 MiB；不 import Vite config，不读取 node_modules/.env/source，不运行作者 scripts，不生成 dist。source 文件列表是读取元数据快照，不是 D5 归档白名单。
- 严格 UTF-8 解码和 jsonc-parser AST 检查拒绝 BOM、注释、尾逗号、重复/转义等价键、不安全对象键、非有限数。先用 scanner 匹配花/方括号并限制 64 层，再构造 AST。审查复现错误括号使简单深度计数失效、AST 栈溢出的输入，已先建回归再修为类型匹配的容器栈。
- 文件读取逐级 lstat 检查祖先 symlink/junction、拒绝非普通文件，open 后核查 dev/ino/mode/size，至多 64 KiB 分块、保留精确字节 hash，读取后复核路径/identity/size/mtime/ctime。真实文件测试覆盖部分读取、增大、截断、等长改写与句柄关闭；不将普通 Node fs 检查宣传为原子目录授权或恶意文件系统沙箱。
- 复用 runtime manifest/API range 语义；校验 package.version 与 manifest 精确一致、web-v1 native=false、必需文档/锁文件。profile 只作为校验选项，不向 manifest 引入重复字段。D1 只检查 lock 非空/UTF-8/大小，不声称依赖冻结匹配。
- CLI 支持 help/version、validate、source/dist 参数、JSON 单对象 stdout、诊断 stderr；参数/内容/路径错误退出 1，I/O/internal 退出 2。不会设置全局 cwd/核心 API process.exit；只有 bin 设置 exitCode。转义终端控制字符，不回显原始 OS 错误/绝对路径；`--` 后参数不误当 --json，驱动器相对路径/URL 不被猜测成项目目录。
- dist 明确返回 E_DIST_VALIDATION_UNAVAILABLE；init/inspect/pack 返回 E_COMMAND_UNAVAILABLE 且不创建/执行任何内容。`/testing`、`/vite`、`/node-types` 未提前导出。最终发布前仍须完成 D2–D9，不发布此开发切片。
- 计划依赖均固定版本加入锁文件，Vite 8 为 optional peer；主应用 Vite/TS/React 依赖未升级。devkit 的多入口构建使用 platform=node/packages=external 并安全清理 package-local dist，不把 Node 代码混入 runtime 浏览器图。
- `tests/fixtures/plugin-example/pnpm-lock.yaml` 原样摘自已提交的 plugin-example `c30cd40d8d6fafba15acbeb0b866f72fff0229c1`，两文件 SHA-256 相同；夹具 README 明确这不是 validProjectFiles package.json 的冻结安装证明。此次只读校验现有 plugin-example 本地 checkout 成功，没有改动它或远端仓库。
- 实际执行 pnpm pack，检查 **15 个包文件**、runtime dependency 精确为 `0.1.0`、无 workspace:、Vite peer optional，已清理临时 tarball。此项是发布元数据/文件检查，不替代 D8 仓库外消费者安装/构建/浏览器完整验收。临时外部 pack 清理命令曾被工具策略拒绝，未执行；改为仓库内显式 staging、只删除确切文件与空目录，未递归删除外部路径。
- devkit typecheck/test/build/公共 types/构建后测试、pnpm 冻结安装通过；runtime **26 文件 / 364 项单元测试**、typecheck/类型检查和真实 tarball **Chromium/WebKit 共 8 项**复验通过；主应用 typecheck 与 **74 文件 / 803 项测试**通过。R8 的 Windows 验收已完成，Linux/Node 24 缺口在 D9 后续状态中补跑并解除。
- 新增中文 README、依赖许可说明和根 aplg:devkit:test/build 入口；本任务在同一 worktree 顺序执行并本地提交。不调用 Cargo、不改 Rust、不创建/推送 tag、不发布 npm、不改 plugin-store/plugin-example workflow。
### D2（2026-09-15）

- 按 TDD 先写独立 ZIP 字节构造器、路径/头部/CRC/压缩限额与 CLI 失败测试，再实现 archive/{inspect,source,zip-header,paths,content,crc32,errors,types}。包根增加 inspectPackage/PackageInspection，CLI 增加 inspect；D1 的源码与归档共用 project/manifest，继续只调用 runtime 公共 schema/版本/路径/限额。
- 单次只读 FileHandle 配合自有 yauzl RandomAccessReader，先检查 128 MiB 压缩大小，独立读取 EOCD/central/local 头部并与 yauzl lazyEntries 逐条复核。拒绝 ZIP64、多盘、加密、data descriptor、未知/重复 extra、非法版本/flags、损坏长度/offset、记录重叠、前后附加数据和未引用空洞；支持 stored/deflate、无歧义 ASCII/严格 UTF-8、yazl 的 0x5455 时间戳。已验证 central 与 local 条目顺序可以不同。
- 路径复用 runtime normalizeArchivePath；NFC + ASCII 大小写规则并保守检查非 ASCII casefold/兼容字符、8.3/方向控制歧义、文件/目录祖先冲突。路径注册只保留显式条目并按分隔后的组件排序比较邻居，不为 10000 个深层路径缓存所有祖先字符串，避免内存放大；不宣称覆盖所有文件系统名称等价。
- 限定顶层 aplg.json、dist、LICENSE、可选文档/icon；目录只能单个末尾斜线/零数据/CRC，计入条目但不返回为文件。拒绝 links/special/可执行文件权限、源码/map、隐藏/Git/node_modules、native/动态库/可执行及常见私钥文件名；流中检查 MZ/ELF/Mach-O 等原生标记、跨块 PEM 私钥标记。该保守策略不是完整恶意代码/秘密扫描器，已在 README 声明误拒和检测边界。
- raw member stream 经独立 inflate/pipeline 逐块核查实际尺寸、总展开量、CRC-32 与 SHA-256，deflate 消费字节数必须与压缩长度一致，拒绝隐藏尾部 payload。展开总量 512 MiB/10000 条目，manifest 256 KiB、HTML 2 MiB、JS/CSS 16 MiB；声明和实际流预算均测试，除清单外不缓存整个成员。成功返回整个包及每文件精确字节 hash，路径稳定排序。
- 输出始终 signature:"not-verified"。结构不等于签名、运行代码安全、授权或安装成功；D2 只读、不落盘解包、不执行 JS，不做 D3/D4 的 HTML/CSS/JS 离线资源图检查。D5 pack、真实签名/安装与商店仍未交付。
- 输入读取前后核查 dev/ino/mode/size/mtime/ctime 和路径组件，失败会销毁流并关闭唯一自有句柄；错误分别为可读结构诊断、OS I/O 异常与内部执行异常（CLI 1/2），不复制原始 ZIP 异常里的恶意路径或 OS stack。测试涵盖成功、CRC/清单/压缩失败、早停、读错误、截断、并发改时间、junction 及输出目录无写入。额外复现了关闭时只等待首个 OS read、未等待完整部分读取范围的竞态，已改为跟踪整个 range Promise 后关闭句柄。
- 恶意 ZIP 由独立 bitwise CRC 与手写 local/central 生成，不借 packProject 构造同源预期；正向额外使用真实 yazl addBuffer（含/不含 extra）、空文件/目录、Unicode 资源、乱序 central 互操作性。CRC 以 123456789 → cbf43926 和 Node zlib.crc32 独立对照。
- 最终 devkit **7 文件 / 252 项测试**通过（相对 D1 净增 161 项，原 inspect-unavailable 用例替换为真实功能用例）；构建后 **4 项**公共 import/真实进程 CLI/清理/实际 ZIP 测试、typecheck 与无 DOM NodeNext 公共类型检查通过。无新增依赖/锁文件变更，pnpm 冻结安装通过。
- runtime **26 文件 / 364 项单元测试**、生成物一致性、typecheck 和独立 tarball 的 **Chromium/WebKit 共 8 项**复验通过；主应用 typecheck 与 **74 文件 / 803 项回归**通过。并行运行应用回归时 runtime generator 测试曾超过默认 5 秒，检查生成物已还原后串行单测/全量复跑通过；没有放宽超时或修改 runtime 代码掩盖失败。
- 本批验证为 Windows Node 22.22.2；Linux/Node 24 与真实 Rust/Tauri/Web 的既有缺口在 D9 后续状态中部分解除（Linux Node 22/24 已补跑），真实 Rust/Tauri/Web 接入仍未实施。本任务不调用 Cargo、不推送/tag/npm publish。
### D3（2026-09-15）

- 先用真实 Vite 构建写失败测试，再实现 `/vite` 的 aplgVite、node-aliases 与 AST Node 用法检查。fs/promises、fs、path、buffer、events 的裸名/`node:` 前缀精确映射至 runtime 公开出口，不匹配 path-helper 等相似名称，不进行字符串改写或全局 polyfill。
- 新建 `src/vite/node-specifiers.mjs` 同源列表，生成 `src/node-types.d.ts`，声明逐项 re-export runtime，不复制完整 Node 签名；buffer 不伪造 default。`/node-types` 仅 types 条件，无运行 JS；Node 配置/CLI tsconfig 排除此 ambient 文件，浏览器 tsconfig 不包含 @types/node。
- TS 的 types 指令在包自引用环境不会像普通 import 那样解析当前包名，故本地测试 include 实际 dist 声明，另在仓库外消费者按 npm 布局放置已构建包并使用 `types:["@ai-switch/tauri-plugin-devkit/node-types"]`，确认公开子入口、Buffer 身份/重载与拒绝 watch/stream/fd/global process。此为 D3 声明包结构验证，不冒充 D8 双 tarball 安装。
- AST 使用已固定 Vite 8.3 的 parseSync，识别 JS/TS 的函数/块/循环/catch/class/switch 作用域、参数/解构/import 绑定；跳过纯类型语法并检查运行期 decorators、动态 import 参数。反例推动修复了解构全局、作用域泄漏、re-export 名称被当 global 的误判。静态 literal require 交由 Vite 转换，计算/别名/宿主 require 明确诊断。
- Node builtin、`.node`、Tauri/devkit/runtime host 入口及可识别的相对/绝对安装路径绕行在导入与模块检查中拒绝。输出 chunk 静态/动态 imports 再检查，防止用户 external 配置跳过 resolve/transform 后遗留真实 Node 模块。所有检查仅限可解析图，不宣传为恶意代码沙箱。
- 验证 Vite 的 Node config 仍能用真实 fs/path，未启用 aplgVite 的宿主 SSR 构建保持原状，显式 SSR/server 环境跳过 adaptation。runtime 排除出 dev prebundle，保留已打包共享 chunks；真实 Vite dev transform 验证同一 alias，不放宽容器/权限。
- `withBuildProject` 在 os.tmpdir 仓库外安装真实 runtime tgz + 固定 Vite 8.3，生成与输入匹配的 package-lock 后 npm ci，所有 install 禁用 scripts；测试用 D3 本地 hook/固定 Vite 驱动，不使用 runtime src alias。普通 ESM、静态 CJS、transitive dependency、external 和原生 addon 反例均覆盖。
- Chromium/WebKit 实际执行产物，验证虚拟 `/data` path、UTF-8 Buffer、EventEmitter once、裸名/前缀 fs promises 同例、缺宿主 E_HOST_UNAVAILABLE。全局 Buffer/require 设置抛错 getter，process 保持浏览器 undefined；runtime 上游 semver 的 typeof process 探测不等于访问 OS，也不能用抛错 getter 扭曲正常浏览器条件。
- 首轮把 Rolldown 自带 virtual runtime 的 Node 二进制 helper 当作作者代码误拒，查明后仅豁免精确 `\0rolldown/runtime.js`（浏览器未用 helper 由 bundler tree-shake）；保留对普通依赖/作者代码的检查。runtime 本身为已验证浏览器 bundle，不递归用作者规则重审其上游不可达 fallback。
- 首轮加载临时安装 Vite 的 native Rolldown DLL 导致 Windows 进程存续期间清理锁文件；改用 D3 计划规定的测试工具 Vite 驱动。原测试退出后仅删除已确认的自有 DLL 文件/空目录；一次失败的 dev optimizer 晚写入也在进程退出后按精确路径清理。后续全套成功运行无临时根/测试服务残留，未修改/放宽生产目录清理规则。
- 新增 82 项测试，devkit 合计 **10 文件 / 334 项**（其中含真实 Chromium/WebKit 2 项），构建后 **5 项**测试、Node/public browser 类型、生成物一致性、typecheck、build 均通过。test 先构建本包，保证新 checkout 的已构建声明可用。未新增依赖/锁文件变化；根应用 Vite/TS 无升级。
- pnpm pack 实测包含 30 个文件，runtime workspace 依赖转成精确 0.1.0、/vite 与 types-only /node-types 导出正确，无源文件/测试输出混入；清理本地临时 tgz。此项不替代 D8 外部双包完整验收（D8 已单独通过）。
- runtime **26 文件 / 364 项**、typecheck 和独立 tarball **8 项 Chromium/WebKit**复验通过；主应用 typecheck 与 **74 文件 / 803 项**通过。Windows Node 22.22.2 以外 Linux/Node24 的既有验证缺口未解除。
- 当前 `/vite` 只做 D3 adaptation；manifestPath 明确返回 APLG_OPTION_UNAVAILABLE，preview 预留但不创建 provider，不注入握手 bootstrap、不宣称 dist/离线产物合格。D4/D7、pack/init、真实 Rust/Tauri/Web、签名安装与商店发布仍待实施。README 已说明这些边界。
- 本任务顺序本地实施/提交，无 subagent、Cargo、新 target、推送、tag、npm publish 或远程 plugin-store/plugin-example 修改。
### D4（2026-09-15）

- 先建立 bootstrap/资源/路径/record 失败测试，再实现 Vite 受控启动器与 Node 只读产物检查。源码 HTML 经 parse5 检查后，用虚拟模块替换唯一 module 业务 script；先 await connectPlugin，后动态 import 校验过的本地入口，不静态抢跑、不并列追加脚本。纯静态零业务脚本 HTML 同样注入只负责宿主握手的 bootstrap，business 字段为 null。
- 连接失败/业务异常输出固定安全文字，不回显原始异常、路径或凭据，也不回退直跑。重复安装 hook、多个 HTML/业务脚本、classic/inline/importmap、inline handler/style、base、活动嵌入文档等明确拒绝。支持带/不带 ./ 的正常 HTML 相对 src，不与 ESM bare specifier 规则混淆。
- config/buildStart/renderStart 校验 base ./、项目本地 dist、ES2022、ESM/动态分块、无 source map，并在清理前检查目录/junction 与后续配置变更。source manifest 以原始字节 SHA 检查构建期间不变；manifestPath 可为项目内规范相对路径。单独 validateProject 的根源码契约仍为 aplg.json，必须与记录的源清单一致，不给任意项目配置执行权。
- 禁用未经检查的 publicDir 复制，在 buildStart 读取/检查 public 路径、links、白名单和预算后显式 emit，纳入同一 record/资源图。公共输入总缓冲上限 128 MiB，record 上限 1 MiB，文件/条目总预算引用 runtime。公共与生成输出碰撞、秘密文件及非法资源在 emit/写出前失败。
- 产物记录 dist/aplg-build.json 保存格式/工具版本、源 manifest 路径/精确 hash、HTML/bootstrap/business 路径和排序文件 hash（不包含自身摘要）；生成快照与落盘重新扫描共用资源政策。检查记录格式、来源、文件列表/尺寸/字节 hash、入口 script、动态边及不允许 business 静态可达的约束。产物修改、资源缺失、清单改变和伪造不一致记录均失败。
- HTML/SVG URL/实体/srcset、CSS url/import/image-set/转义、JS static/dynamic imports、字面量 URL/Worker、require/source-map comment 分别用 parse5、PostCSS/value-parser、es-module-lexer、Acorn AST 检查。补充固定 **acorn@8.18.0** 生产依赖，以免纯 Node CLI 为额外语法检查加载 optional Vite；仅新增该依赖与锁条目，不升级主应用依赖。
- 远程/CDN/协议相对或系统绝对路径、bare/Node/宿主模块、encoded traversal、source-root 绝对路径、source maps、非法 UTF-8/非规范文件名与未知文件集合被拒绝；普通图片/CSS/Unicode/fragment 与限定 data:image 有正向测试。已构建非压缩输出只移除经过语法定位的来源注释，不文本替换业务代码。
- `validateProject(stage:"dist")` 与 CLI 现已检查已有产物并返回包候选文件，不再返回 unavailable；仍不隐式 build/安装/运行 config。源码 stage 保持 D1 五文件读模型。D3 alias-only 回归改为单独驱动其 hook，其完整公开 aplgVite 的时序由本批 D4 集成测试证明，避免旧“无宿主直跑”测试与新行为互相矛盾。
- 安全边界有显式测试：record 是未签名元数据，攻击者同时修改脚本与 record 可以保持静态图自洽；静态资源策略不能证明任意脚本真的握手，不能阻止所有 computed fetch/eval/外部构建 hook。不得作为签名、来源认证、权限或 OS/浏览器沙箱。真实生成器行为以浏览器测试验证；D5/D8/安装端仍须独立验证。
- 包内 **12 文件 / 410 项**测试（相对 D3 增加 76 项）通过；typecheck、Node/浏览器公共类型、生成物校验、build 与构建后 **5 项**通过。无框架真实宿主/独立 runtime tarball、严格 CSP、两来源 opaque iframe 的 **7 场景 × Chromium/WebKit = 14 项**通过，覆盖握手门控、无重复副作用、拒绝连接、业务异常、无宿主、静态 HTML、挂载清理。审查发现“静态 HTML 完全不注入客户端”会使 R5 mount 等待到超时，先补实际浏览器失败测试后改为 handshake-only bootstrap，验证静态页也能正常挂载。
- 首轮 RED 的未受保护输出配置曾写入本 worktree 的 packages/outside 两个测试资产，已核对内容并按精确文件/空目录删除。初版 Playwright webServer 在 Windows 强制终止时未执行 finally，遗留一次外部 fixture 目录；后续改为资产入内存后、宣布 ready 前清理，复跑不再创建残留。对早期外部临时目录的递归清理命令被工具策略拒绝，不绕过限制；残留路径为 `C:\Users\Admin\AppData\Local\Temp\aplg-tarball-10URSa`，与工作树代码无关。
- runtime **26 文件 / 364 项**、typecheck 和独立 tarball **8 项 Chromium/WebKit**复验通过；主应用 typecheck 与 **74 文件 / 803 项**回归通过。本批测试工具和业务构建为 Windows Node 22.22.2，Linux/Node 24 缺口在 D9 后续状态中补跑。
- README、第三方许可和整体设计状态同步；本任务只本地提交，不运行 Cargo、不新建 target、不推送/tag/npm publish、不修改远程 plugin-example/plugin-store。D5 可复现打包与 D6 init 已交付；D7 模拟宿主、D8 双包消费与 D9 授权发布仍未交付。

### D5（2026-09-16）

- 已完成可复现且不覆盖的 `.aplg` pack：私有稳定快照、固定 ZIP 元数据、自检、hard-link no-clobber、并发/竞态回滚和 CLI pack；提交 `d22b74c`。
- D5 核心、CLI、全量 devkit 回归和公共类型验证已通过；后续 D6 全量测试总数为 **15 个文件 / 443 项 Vitest**。

### D9 后续状态（2026-09-18）
- D9 已本地提交，devkit 计划 D1–D9 全部实施完成。Windows Node 22.22.2 与 Linux（Podman `node:22-bookworm-slim` / `node:24-bookworm-slim`）下两包 typecheck/test/build/pack、`verify-pair`、Chromium/WebKit、发布计划与假 registry 演练均通过。
- Linux Node 22 实测：devkit **17 文件 / 463 项 Vitest**、typecheck、公共/浏览器类型、built package **8 项**、node-types、外部 tarball E2E、Chromium/WebKit **26 项**与 `verify-pair` 4 项均通过。Linux Node 24 实测：同一套 typecheck/test/types/built/node-types/tarball E2E 与浏览器 26 项通过，`verify-pair` 4 项通过。
- Podman 环境本身：machine 存储已迁至 D 盘（C 盘保留 junction），machine 内 `/etc/containers/registries.conf` 配置了 `docker.m.daocloud.io`、`docker.1ms.run`、`docker.1panel.live` 三个国内镜像；Playwright 浏览器持久化到 Podman 卷并在两个 Node 版本间复用。
- GitHub environment `aplg-npm-release` 已创建并限定 `tauri-plugin-runtime-v*` tag；npm `@ai-switch` scope 已存在且 `ijry` 为 owner，两包均已配置 GitHub Actions trusted publisher（workflow `tauri-plugin-runtime.yml`，environment `aplg-npm-release`）。
- 两包 **0.1.0 已发布到 npm**（bootstrap，用一次性 granular token），并已用 registry 安装做端到端复验：真实安装、CLI `init`、`pnpm install`、Vite build、`validate --stage dist` 与 `pack` 均通过。
- 尚未打 tag、尚未触发 GitHub Release；`publish-npm` 默认 dry-run。

### D9（2026-09-18）

- 按 TDD 实现纯发布计划器 `planRelease`：只接受稳定 SemVer、固定包名、完全一致的 runtime/devkit 版本和精确 runtime 依赖；非法 tag/版本/依赖统一抛 `E_RELEASE_PLAN`，stable dist-tag 固定为 `latest`，调用方不能覆盖。计划测试通过。
- 实现默认 dry-run 的 `publish-npm.mjs`：校验 gzip tarball 内真实 `package.json`，核对已发布 integrity，相同则幂等跳过、冲突则失败；`--execute` 才按 runtime → devkit 顺序以 `latest` 发布。假 registry 演练覆盖 dry-run、幂等/冲突、顺序发布与失败后重跑，全程未调用真实 registry publish。
- 新增 `.github/workflows/tauri-plugin-runtime.yml`：普通 PR/main push 只在 Windows/Ubuntu Node 22/24 做 typecheck/test/build/pack/verify-pair/发布逻辑测试；只有 `tauri-plugin-runtime-v*` tag 进入受保护 environment `aplg-npm-release`，使用 OIDC `id-token: write`、固定 action commit、checkout 不持久凭据，并校验 tag 属于默认分支。
- 首次推送后 CI 立即失败：workflow 中 `pnpm/action-setup` 的固定 SHA 不存在（`Unable to resolve action`），实际校验发现该哈希从未对应任何 commit。已改为真实 `v4` tag 解引用后的 commit `b906affcce14559ad1aafd4ab0e942779e9f58b1`，并用 GitHub API 逐个核对四个固定 action SHA 均可解析。
- 首次推送后 CI 暴露三处缺陷并已修复：(1) `pnpm/action-setup` 的固定 SHA 从未对应任何 commit，已改为真实 `v4` tag 解引用后的 commit；(2) `.gitattributes` 漏声明 `*.mjs`，Windows runner checkout 出 CRLF 导致 `validators.generated.mjs` 字节比对失败，已加 `*.mjs text eol=lf` 并补生成物换行符守卫测试；(3) Playwright 浏览器安装排在测试之后且仅限 ubuntu，devkit 的 `vitest run` 内含真实 Chromium/WebKit 用例因而必然失败，已把安装提前并按平台区分 `--with-deps`。
- 补齐 npm trusted publishing 的两处硬性前提：(1) 两包 `package.json` 原先没有 `repository` 字段，而 npm 要求 `repository.url` 与托管 workflow 的 GitHub 仓库精确一致，已补 `repository.url` 与 `directory` 并加 `release-metadata` 测试；(2) 原发布脚本先用 `aplg-candidate` 发布、再用裸 `fetch` PUT 提升 `latest`，但 npm 的 OIDC 只认证 `npm publish`/`npm stage publish`，裸 dist-tag PUT 在 CI 中必然 401，已改为 `npm publish --tag latest` 直接发布并移除 candidate/promote 与回滚分支。
### D8（2026-09-18）

- 按 TDD 新增真实双 tarball 外部消费者：`pnpm pack` 生成 runtime/devkit 发布包，在 `os.tmpdir()` 安装，断言无 workspace symlink、devkit 发布元数据无 `workspace:`，并运行打包后的 CLI `init → install → Vite build → validate --stage dist → pack → inspect`。
- 修复 devkit 发布元数据契约：`pnpm pack` 会把 `workspace:0.1.0` 解析为 `0.1.0`，测试已锁定这一行为；外部消费者不再依赖未发布的 registry 版本。
- 新增 `fixtures/aplg/plugin-example`，来自固定上游 commit `c30cd40d8d6fafba15acbeb0b866f72fff0229c1`，保留 LICENSE、manifest、源码和 7 个文本行为测试；仅本地迁移 Vite 配置、公共依赖和 `plugin:validate`/`plugin:pack` 脚本，不修改远程仓库。
- 新增 `scripts/aplg/verify-pair.mjs` 与 `packaged-example-runner.mjs`：外部安装两个 tarball、跑上游测试、aplgVite 构建、dist 校验、pack、inspect；解包经 inspect 校验的产物，在受控 loopback host 中用真实 runtime host 加载，并在 Chromium/WebKit 验证握手、文本统计、不透明 iframe 与父页面/存储隔离。
- Windows Node 22.22.2 本地完整 `verify-pair` 通过：runtime/devkit 两个真实 tarball、7 个上游行为测试、4 个 Chromium/WebKit 打包产物浏览器测试；不调用 Cargo、不推送/tag/npm publish、不修改远程 plugin-example/plugin-store。

### D7（2026-09-18）

- 按 TDD 完成浏览器安全 `/testing`：先以缺失导出和 preview 策略测试取得 RED，再实现 `createTestHost`、内存 storage/filesystem 与独立 `/testing` export。宿主不引用 Node builtin 或真实 OS 文件；storage 只在 manifest 声明后广告，fs 只在声明且显式传入 `memoryFiles` 时广告，session/subscription/transfer handle 按归属隔离，关闭 session 或 dispose 后旧句柄失效。
- 实现 `aplgVite({preview:true})` 的 `/__aplg_preview__/`：仅 `serve` 生效、强制 loopback、校验 Host、关闭 HMR 并移除 Vite client 注入；preview client 通过 runtime 公共 `HostTransport` 完成真实握手，沙箱 iframe 不授予 `allow-same-origin`。为 opaque iframe 的模块请求增加仅 `Origin: null` 的受限 CORS 响应头，不开放 LAN 或管理 API。
- 修复 preview 专用别名边界：只允许精确 virtual ID 和精确 runtime host 入口，普通插件源文件带 `?aplg-preview` 不能绕过 Node/host 导入策略；新增回归测试证明绕过会失败。
- browser 验收覆盖 Chromium/WebKit：真实 handshake 与业务启动、disconnect/reconnect、重新挂载新会话、无 `memoryFiles` 时 `E_CAPABILITY_UNAVAILABLE`、显式内存文件读写、非 loopback Host 拒绝、无 `/@vite/client`、无 `unsafe-inline/eval`，以及生产产物不含 preview/mock。
- Windows Node 22.22.2 本地回归通过：devkit **17 文件 / 462 项 Vitest**、typecheck、公共/浏览器类型、built package **7 项**、node-types 检查和 Chromium/WebKit **26 项**浏览器测试。Linux/Node 24 未在本地执行；不调用 Cargo、不推送/tag/npm publish、不修改远程 plugin-example/plugin-store。

### D6（2026-09-16）

- 按 TDD 先写 14 项 init 测试并观察缺失 API 的 RED，再实现 `src/init/{index,render}.ts`、内置 `vanilla-ts` 模板和 CLI init；公共根入口新增 `initProject` 及 `InitProjectOptions/InitProjectResult`。
- 初始化不执行 npm/pnpm、git/gh、Vite config 或构建；目标通过逐级路径检查和独占 `.aplg-init.lock` 归属，文件逐一 exclusive create。并发只有一个成功；失败只按 identity 清理本次创建内容。
- 模板包含私有 package、manifest、Vite/aplgVite、浏览器/Node 分离 tsconfig、纯 JS 单元测试、README、LICENSE、`.gitignore` 和固定 commit 的只读 GitHub CI；不生成 lockfile/node_modules/.git。源模板使用 `gitignore` 避免 npm 忽略隐藏文件，渲染目标仍为 `.gitignore`。
- 外部 tarball 消费验证在 Windows Node 22.22.2 通过：安装 runtime/devkit 本地 tarball override，使用已安装 devkit CLI init，再运行生成项目的 test、typecheck、Node config typecheck、build、validate、pack；devkit 全量 **15 文件 / 443 项 Vitest**、built package **7 项**、公共类型、browser types、node-types 和 Chromium/WebKit **14 项**均通过。npm dry-run 文件清单确认 `templates/vanilla-ts/gitignore` 随包发布。
- 本机 Docker 不可用且 WSL Ubuntu VHD 无法挂载，未虚假声明 Linux 验收；不调用 Cargo、不推送/tag/npm publish、不修改远程 plugin-example/plugin-store。
