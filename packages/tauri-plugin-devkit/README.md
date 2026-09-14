# @ai-switch/tauri-plugin-devkit

APLG 插件的 Node 开发工具包。单向依赖 `@ai-switch/tauri-plugin-runtime` 公共协议入口，不依赖 AI Switch 应用源码或 Tauri。

> 当前为 **0.1.0 开发实现，尚未发布到 npm**。D1 只交付项目源码校验和 CLI 基础。归档 inspect/pack、Vite alias/bootstrap、init 模板、浏览器 testing 和 CI 发布仍在后续任务，不要把这些目标当作现成功能。

## 使用已构建的本地包

需要 Node `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm `10.12.4`。从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm aplg:devkit:build
node packages/tauri-plugin-devkit/dist/cli.js --help
node packages/tauri-plugin-devkit/dist/cli.js validate /path/to/plugin --json
```

根目录的 build/test 入口会先构建 runtime，确保 devkit 消费真实公共出口，而非源码 alias。直接在 devkit 目录运行前也需先完成 runtime build。

```ts
import { validateProject } from "@ai-switch/tauri-plugin-devkit";

const report = await validateProject("./my-plugin", {
  stage: "source", // 默认 source
  profile: "web-v1", // 首期仅支持此 profile
});
if (report.valid) {
  console.log(report.manifest.id, report.manifestSha256, report.files);
} else {
  console.error(report.diagnostics);
}
```

包根入口是 **Node-only ESM**；导入本身不会读取项目、执行 CLI 或访问浏览器 DOM。公共报告类型直接复用 runtime 的 `Manifest` / `Diagnostic`。`/vite`、`/testing` 和 `/node-types` 尚未导出，内部 `src`/`dist` 路径不是公共接口。

## D1 的 source 校验范围

只读以下五个固定文件，不遍历/导入项目源码、`vite.config.*`、`node_modules` 或 `.env`：

| 文件 | 上限 | 检查 |
| --- | --- | --- |
| `aplg.json` | 256 KiB | 严格 UTF-8/JSON、runtime manifest/schema/路径规则、API 范围、native=false |
| `package.json` | 256 KiB | 严格 UTF-8/JSON、对象及 version 字符串、与 manifest 版本精确一致 |
| `README.md` | 1 MiB | 普通文件、有效 UTF-8、非空 |
| `LICENSE` | 1 MiB | 普通文件、有效 UTF-8、非空 |
| `pnpm-lock.yaml` | 4 MiB | 普通文件、有效 UTF-8、非空 |

- JSON 使用严格 AST 解析，拒绝注释、尾逗号、BOM、重复（含转义等价）键、不安全对象键、非有限数字、超过 64 层的嵌套；语法错误报告行/列，不回显任意输入片段。
- profile 是校验选项，不向 runtime manifest 添加私有 profile 字段。`web-v1` 不接受 `permissions.native:true`；网络/文件权限的合法声明仍按 runtime 契约检查，不因此授予权限。
- source **不要求 dist 已存在**，也不证明入口源码、构建配置或依赖可运行。
- 锁文件存在并非冻结安装已验证：D1 不解析其依赖图或执行 pnpm。作者须先真实安装、提交匹配的锁文件，再在 CI 中执行冻结安装。
- 成功报告的 `files` 是本次已读元数据文件的相对路径、大小和 SHA-256，**不是可直接打包的归档文件白名单**；D4/D5 才会生成产物候选列表。manifest SHA 覆盖精确字节，包括空白和换行，不重新格式化后再算。
- 不执行 package scripts、Vite config、build、安装依赖或网络请求。静态检查不等于恶意代码沙箱、签名验证、OS 权限授权或可发布承诺。

文件读取逐级 lstat，拒绝符号链接/junction/非普通文件；open 后复核 identity/size，并用至多 64 KiB 读取块，读后再次核查 identity、size、mtime/ctime 和路径组件。POSIX 使用可用的 no-follow/non-blocking 标志；这些检查减少并检测路径竞态，**不宣称普通 Node fs 能提供原子目录级授权或对抗任意并发恶意文件系统**。后续归档操作必须使用经验证的独立快照，不能把 D1 返回的 hash 当作未变化的文件句柄。

## CLI 输出与退出码

```sh
aplg validate [directory] [--stage source|dist] [--json]
aplg --help
aplg --version
```

`--stage=source` 也支持；`--` 后只作为目录参数解析。默认目录为当前工作目录。重复选项、未知选项或多余位置参数直接失败，不猜测执行其他操作。

- **0**：成功。
- **1**：参数/内容/路径/兼容性校验失败。缺少项目、必需元数据，或者请求尚未实现的命令也返回 1。
- **2**：OS I/O 或内部错误。程序化 API 对此抛出安全错误（如 `code:E_IO`），不返回“内容无效”的假诊断；CLI 不显示 native stack、真实绝对路径或原始 OS 错误文本。

指定 `--json` 时 stdout 只有一个 `ProjectReport` JSON 对象，stderr 可有简洁提示。报告中的 manifest 是作者提供的元数据，请勿将敏感信息写入清单。人类可读诊断会转义终端控制字符。

D1 的 `--stage dist` **始终失败并给出 `E_DIST_VALIDATION_UNAVAILABLE`**。`init` / `inspect` / `pack` 返回 `E_COMMAND_UNAVAILABLE`，不创建文件、不解包、不隐式 build。后续 D2–D7 完成前不发布此开发切片。

## 开发验证

从仓库根目录：

```sh
pnpm aplg:devkit:test
pnpm --dir packages/tauri-plugin-devkit typecheck
pnpm --dir packages/tauri-plugin-devkit build
pnpm --dir packages/tauri-plugin-devkit test:types
pnpm --dir packages/tauri-plugin-devkit test:built
```

测试包括真实临时目录、无副作用配置反例、部分读取/截断/改写、JSON 歧义、CLI stdout/exit codes、构建后 Node import/CLI 和公共类型。不修改开发者项目；测试临时目录在 finally 中复核路径/身份/所有权后删除。

`vite:^8.3.0` 为 optional peer，纯 CLI 不要求安装 Vite。其余计划依赖已按固定版本写入锁文件，D1 运行路径实际只使用 runtime 与 jsonc-parser，其余由后续工具阶段消费。devkit 构建将 registry 依赖保持 external，不把 Node 工具代码混入 runtime 浏览器图。

对外打包应使用 `pnpm pack` 将 `workspace:0.1.0` 转换成真实 `0.1.0`。该版本目前未发布；不要用 npm pack 直接分发带 workspace: 的源码 package.json。D8 将负责两包在仓库外的完整 install/build/pack/browser 验收，D9 才提供授权发布流程。本任务不推送、不发布。

## License

MIT。见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
