# @ai-switch/tauri-plugin-devkit

APLG 插件的 Node 开发工具包。单向依赖 `@ai-switch/tauri-plugin-runtime` 公共协议入口，不依赖 AI Switch 应用源码或 Tauri。

> 当前为 **0.1.0 开发实现，尚未发布到 npm**。D1/D2 已交付项目源码校验、只读归档 inspect 和 CLI。pack、Vite alias/bootstrap、init 模板、浏览器 testing 和 CI 发布仍在后续任务，不要把这些目标当作现成功能。

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
aplg inspect <file.aplg> [--json]
aplg --help
aplg --version
```

`--stage=source` 也支持；`--` 后只作为目录参数解析。默认目录为当前工作目录。重复选项、未知选项或多余位置参数直接失败，不猜测执行其他操作。

- **0**：成功。
- **1**：参数/内容/路径/兼容性校验失败。缺少项目、必需元数据，或者请求尚未实现的命令也返回 1。
- **2**：OS I/O 或内部错误。程序化 API 对此抛出安全错误（如 `code:E_IO`），不返回“内容无效”的假诊断；CLI 不显示 native stack、真实绝对路径或原始 OS 错误文本。

指定 `--json` 时 stdout 只有一个 `ProjectReport` 或 `PackageInspection` JSON 对象，stderr 可有简洁提示。报告中的 manifest 是作者提供的元数据，请勿将敏感信息写入清单。人类可读诊断会转义终端控制字符。

D1 的 `--stage dist` **始终失败并给出 `E_DIST_VALIDATION_UNAVAILABLE`**。`init` / `pack` 返回 `E_COMMAND_UNAVAILABLE`，不创建文件、不解包、不隐式 build。后续 D3–D9 完成前不发布此开发切片。

## D2 的只读归档检查

```ts
import { inspectPackage } from "@ai-switch/tauri-plugin-devkit";

const archive = await inspectPackage("./notes-0.1.0.aplg");
if (archive.valid) {
  console.log(archive.manifest.id, archive.sha256, archive.size, archive.files);
}
console.log(archive.signature); // 始终 "not-verified"
```

`aplg inspect file.aplg --json` 与程序化 API 复用同一个检查器。只读归档、不创建解包目录、不写出成员、不 import 或执行 JS。成功表示本节的结构/字节检查通过，**不是**签名可信、代码安全、已授权或可以直接安装。

### 支持的 web-v1 ZIP 子集

- 文件扩展名必须精确为 `.aplg`。单盘经典 ZIP，stored/deflate 两种压缩方法；不接受 ZIP64、加密、data descriptor、自解压前缀、未引用记录/空洞、重叠内容、尾部附加内容。central 条目顺序可以不同于 local 顺序。
- 自行读取 EOCD 与每个 central/local header，比较名字原始字节、版本、flags、method、CRC、尺寸、时间和 offset；再与 yauzl lazyEntries 的解析结果核对。允许无歧义 ASCII 或带 UTF-8 flag 的严格 UTF-8 名称；不隐式把反斜杠、CP437 或 Unicode extra-field 名字改写成另一条路径。
- entry 的名字/extra/comment 元数据分别最多 4 KiB。extra field 仅允许标准 `0x5455` 时间戳（兼容 yazl）；Unicode path override、ZIP64、NTFS/security/vendor extra 一律拒绝。DOS/Unix 创建器以外的权限编码不接受。
- 路径复用 runtime 的 portable/NFC 规则，阻止盘符/UNC/设备名/`..`、尾随点空格、大小写碰撞、文件与目录冲突；进一步保守拒绝已知兼容字符、8.3 短名、控制/方向字符歧义。支持正常非 ASCII 名称；并不宣称穷尽所有文件系统名称等价规则。
- 只允许 `aplg.json`、`dist/**`、`LICENSE` 和可选 README/THIRD_PARTY_NOTICES/icon.svg/icon.png。清单恰好一份，LICENSE 非空，声明 HTML entry 必须是已有文件；目录项使用一个尾随 `/`、stored、零尺寸/CRC，只计入条目数、不输出为 PackFile。
- 拒绝符号链接、特殊文件/权限位、可执行权限的文件、native 目录、依赖/Git/隐藏元数据、常见私钥/源码/source-map/可执行及动态库文件名。流内额外识别 MZ/ELF/Mach-O 等常见原生头部与 PEM 私钥标记。该保守检查**不是病毒或秘密扫描器**，可能拒绝同样前缀的合法二进制；改名/静态检查不能证明任意内容无害。

### 流式预算与结果

压缩包最多 **128 MiB**、展开总量 **512 MiB**、条目 **10,000**，均引用 runtime limits。清单最多 **256 KiB**、HTML **2 MiB**、JS/CSS **16 MiB**；已知超限的 header 在读 body 前失败，实际解压数据也独立计数。高压缩比与伪造声明不能绕过计数；目录也占条目名额。

每次只检查一个成员：从只读 FileHandle 经有界 reader 提供压缩数据，stream/pipeline 解压、逐块 CRC-32/ISO-HDLC 与 SHA-256、检查长度和 deflate 消费字节数。除有界清单外不缓存整份成员。校验整个文件与每个实际字节文件的 hash；返回 `files` 仅含相对路径并稳定排序，读取前后核查文件和路径 identity/尺寸/mtime/ctime。更换/截断/改写会失败；普通文件检查仍不替代 D5 的独立可信快照和安装端原子操作。

成功、结构失败、解压失败或 I/O 错误都释放流和唯一自有句柄。结构/内容错误返回 `valid:false, signature:"not-verified"`；OS I/O 仍为安全异常，CLI 退出 2，不泄漏真实路径或错误栈。

D2 **不扫描 HTML/CSS/JS 的离线资源图或运行行为**。例如含 Node import 的文本可以作为字节通过 inspect，但尚不能通过后续 D3/D4 的构建/产物政策。正式打包 D5、签名/安装和商店审核是不同边界。已验证真实 yazl `addBuffer` 输出（有/无时间戳 extra），不是用被测 packProject 产生所有成功夹具；恶意 ZIP 由独立头部构造器生成。
## 开发验证

从仓库根目录：

```sh
pnpm aplg:devkit:test
pnpm --dir packages/tauri-plugin-devkit typecheck
pnpm --dir packages/tauri-plugin-devkit build
pnpm --dir packages/tauri-plugin-devkit test:types
pnpm --dir packages/tauri-plugin-devkit test:built
```

测试包括真实临时目录、无副作用配置反例、部分读取/截断/改写、JSON 歧义、恶意 ZIP/解压预算/句柄回收、真实 yazl 输出、CLI stdout/exit codes、构建后 Node import/CLI 和公共类型。不修改开发者项目；测试临时目录在 finally 中复核路径/身份/所有权后删除。

`vite:^8.3.0` 为 optional peer，纯 CLI 不要求安装 Vite。其余计划依赖已按固定版本写入锁文件，D1 使用 runtime 与 jsonc-parser，D2 增加 yauzl 流式读取；其余由后续工具阶段消费。devkit 构建将 registry 依赖保持 external，不把 Node 工具代码混入 runtime 浏览器图。

对外打包应使用 `pnpm pack` 将 `workspace:0.1.0` 转换成真实 `0.1.0`。该版本目前未发布；不要用 npm pack 直接分发带 workspace: 的源码 package.json。D8 将负责两包在仓库外的完整 install/build/pack/browser 验收，D9 才提供授权发布流程。本任务不推送、不发布。

## License

MIT。见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
