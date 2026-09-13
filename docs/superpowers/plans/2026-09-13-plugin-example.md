# 公开示例插件项目实施计划

> **执行方式：** 沿用已创建的隔离 worktree，按 `executing-plans` 与 `test-driven-development` 在当前会话顺序执行，不委派子代理。用户已明确要求创建并发布 `ai-switch/plugin-example`。

**Goal:** 创建可通过 GitHub 模板复用、可独立预览和测试的无权限 `.aplg` 文本统计示例源码项目。

**Architecture:** 使用原生 HTML/CSS/JavaScript + Vite，纯函数负责 Unicode 码点和行数统计，DOM 层仅呈现输入结果。提供 `aplg.json` 但不依赖尚未发布的 runtime/devkit，不伪造宿主能力或商店发布成功。

**Tech Stack:** Node.js >=22.12、pnpm 10.12.4、Vite 8.3.0、Node 内置测试运行器、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-09-13-aplg-plugin-runtime-design.md`，本任务仅落实纯 UI 示例与外部源码仓库入口，不实施公共运行时。

## 全局约束

- 远程目标固定 `https://github.com/ai-switch/plugin-example`，公开、默认 `main`、设为 template repository。
- 本地独立仓库放在当前 worktree 的 `.codex-run/plugin-example/`；应用源码和版本配置不改动。
- 插件使用 `.aplg` 与 `aplg.json` 契约，ID 为 `io.github.ai-switch.plugin-example`，初始版本 `0.1.0`。
- 不导入未发布的 `@ai-switch/tauri-plugin-runtime` / `@ai-switch/tauri-plugin-devkit`；文档说明正式打包与宿主握手尚未接通。
- 无 Rust、无网络调用、无文件/剪贴板/持久存储权限；不创建任何 Cargo target。
- 所有样例页面资源本地打包；Vite `base: "./"`，不使用 CDN/外部字体/宿主源码 alias。
- CI 只做安装、测试和构建，权限仅 `contents: read`，不发布包、不请求密钥、不自动向商店提交 PR。
- 无权限文本统计是现有纯 UI 插件设计的最小示例，不为示例另造打包器、runtime 或 shim。

## Task 1：用失败测试定义文本统计行为

**Files:** 创建 `tests/analyze-text.test.mjs`，随后创建 `src/analyze-text.js`。

**Interfaces:** `analyzeText(text: string): { characters: number; nonWhitespace: number; lines: number }`。

- [x] 使用 Node `test` + `assert.deepEqual` 编写独立手算样例。每个断言均针对统计行为：

```js
const cases = [
  ["", { characters: 0, nonWhitespace: 0, lines: 0 }],
  ["Hello world", { characters: 11, nonWhitespace: 10, lines: 1 }],
  ["你好🙂", { characters: 3, nonWhitespace: 3, lines: 1 }],
  ["a\r\nb\rc\n", { characters: 7, nonWhitespace: 3, lines: 4 }],
  [" \t\n", { characters: 3, nonWhitespace: 0, lines: 2 }],
  ["e\u0301", { characters: 2, nonWhitespace: 2, lines: 1 }],
];
```

- [x] 测试动态导入，模块缺失时由明确断言报告“统计模块尚未实现”，确认 RED，而非误将语法/依赖错误当作 RED。
- [x] 最小实现使用 `Array.from(text)` 计算码点、过滤 Unicode 空白、用 `/\r\n|\r|\n/u` 拆行；空字符串返回零行。明确码点不是字素簇，避免把组合字符计数误称为视觉字符数。
- [x] 执行 `node --test tests/*.test.mjs`，确认 GREEN。

## Task 2：构建可运行页面与文档

**Files:** `package.json`、`pnpm-lock.yaml`、`vite.config.js`、`index.html`、`src/main.js`、`src/styles.css`、`aplg.json`、`.gitignore`、`README.md`、`LICENSE`。

- [x] npm scripts 为 `dev: vite --host 127.0.0.1`、`build: vite build`、`preview: vite preview --host 127.0.0.1`、`test: node --test tests/*.test.mjs`；仅 devDependency `vite: 8.3.0`。
- [x] `index.html` 提供可见 label 的 textarea、字符码点/非空白码点/行数三项结果、示例/清空按钮与屏幕阅读器状态；`main.js` 监听输入并调用真实 `analyzeText`，使用 `textContent` 输出，不把输入作为 HTML。
- [x] 使用系统字体、可见 focus、响应式单列/三列布局、明暗模式和无动画设计；不引入设计资产依赖。
- [x] `aplg.json` 包含 `manifestVersion:1`、固定 ID/版本、`engines.aplg:"^1.0.0"`、`entry:"dist/index.html"`、`activation:"view"`、空 `requires/optional`、空文件与网络权限、`native:false`、单个 main view。
- [x] README 说明开发命令、计数定义、数据不离开页面、runtime/devkit 待发布状态，以及通过 plugin-store 的 `entry.json` / 固定 commit 版本记录提交 PR 的流程。不得把此项目宣称为已通过真实宿主兼容性验收。
- [x] `pnpm install` 生成锁文件；执行测试与生产构建，核对 dist 资源路径相对且无外部依赖。

## Task 3：只读 CI 与公开 GitHub 模板

**Files:** `.github/workflows/ci.yml`。

- [x] workflow 触发 `push` 到 main 与 `pull_request`；只读权限、checkout 禁止持久保存凭据，不使用 `pull_request_target`。
- [x] actions 固定已查证的完整 commit；使用 Node 22、pnpm 10.12.4，执行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build`。
- [x] 使用浏览器在桌面与移动宽度验证输入、示例、清空与无外部网络；只启动 headless 浏览器，不打开可见窗口。
- [x] 本地初始化 `main`，只提交源码/文档/锁文件，排除 node_modules、dist 和日志；用 `gh repo create ai-switch/plugin-example --public --source ... --remote origin --push` 建仓发布，再设为 template。
- [x] `gh` 核验 public/main/template、文件集合、CI 结果。无 release workflow、无 `.aplg` 发布、无商店 PR，不能虚报这些工作完成。

## Task 4：收尾

- [x] 更新设计规格第 13/14 节，把新示例仓库与“最小宿主示例”明确区分。
- [x] 标记本计划执行结果，在应用 worktree 仅提交设计和本计划，不推送应用分支。
- [x] 回报示例仓库链接、已验证命令、CI 状态及尚未发布的 runtime/devkit 边界。

## 执行结果

- 示例源码仓库：`https://github.com/ai-switch/plugin-example`，公开、默认 `main`、已设为 GitHub Template。
- 初始源码提交：`c30cd40d8d6fafba15acbeb0b866f72fff0229c1`。
- CI：`https://github.com/ai-switch/plugin-example/actions/runs/34767087191`，结论 `success`；冻结安装、7 个测试和 Vite 生产构建均通过。
- 本地验证：先确认 7 项缺失实现断言失败，再实现并全部通过；`pnpm audit --audit-level high` 未发现已知漏洞。
- Headless Edge 验证：Unicode/行数输入结果、清空、示例填充、焦点恢复、375px 窄屏无横向溢出、明暗截图；无页面异常和外部网络请求。
- 浏览器测试中首次通用 label selector 同时匹配 region 与 textbox，改用实际 `textbox` role 后完成验证，未因测试选择器修改生产页面。
- 示例不导入尚未发布的 runtime/devkit，不执行真实宿主桥接，不发布 `.aplg`/GitHub Release，不自动提交 plugin-store PR。
- 本地示例源码保留在 `.codex-run/plugin-example/`，所有依赖、dist 和日志均被忽略，未提交到远程。
- 2026-09-14 收尾时，已校验范围的临时清理命令被执行策略拒绝，未换用其他路径/工具重试删除。Headless 浏览器已正常关闭；loopback 预览进程 PID `3432`（端口 `41783`）和 `.codex-run/plugin-example/{node_modules,dist}`、`.codex-run/plugin-example-validation/` 暂时保留。该清理限制不影响源码、构建与 CI 验证结果。
