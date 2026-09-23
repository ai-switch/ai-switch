# ai-switch 项目约定

## 换行符（务必遵守）
- `.gitattributes` 给 `*.rs/*.mjs/*.ts/*.tsx/*.toml/*.sql/*.yml/*.yaml` 声明 `text eol=lf`，**故意不用** `* text=auto`（会重写 108 个 CRLF markdown 与 `resources/skill-packages`）。`core.autocrlf=false`。
- `*.json` 无属性按原始字节存；`src-tauri/tauri.conf.json` 仓库里是 **CRLF**，编辑工具写文件会 CRLF→LF，改一行产生 76 行假差异。改完 `sed -i 's/$/\r/' <file>` 补回，`git diff --numstat` 应为 `1 1`。
- 数 CR 只信 `tr -dc '\r' < f | wc -c` 或 `git ls-files --eol`。别用 `grep -c $'\r'`（恒 0）、`grep -qU`（只给是否）。

## tokio 写文件
- `write_all` 返回 ≠ 已落盘（1.52 先拷内部缓冲，真正 write 是 blocking 任务）。写完要立刻可读 → 补 `file.flush().await?`。
- 确定性测试：current_thread + `max_blocking_threads(1)` 占住唯一 blocking 线程。

## SQLite 大字段：压缩、迁移、VACUUM
- **`UPDATE` 把行改小 ≠ 文件变小**（页进 freelist 被复用）。真正还空间**只有 `VACUUM`**（独占锁 → **绝不能放启动路径**，必须用户显式触发）。
- 「**双键兼容**」：新键 `xxx_br`（base64 of brotli）+ 旧键 `xxx` 保留，读取端两种都认、优先新键 → 无需 SQL 迁移、可中断、可回滚。
- 老行迁移 = **启动后台任务**：`LIKE '%"旧键"%' AND NOT LIKE '%"新键"%'`（带尾引号才不误匹配）+ 分批 200 行各自事务 + 批间 `yield_now()` + 延迟 10s。桌面 `desktop.rs` 与服务端 `server.rs` **两处都要挂**。
- **「变小才写」守卫**：brotli 头 + base64 膨胀 4/3，短文本压完更大。`(after < before).then_some(...)`。
- 共享实现放 `core/`，再挂 Tauri 命令 + Web 派发；**会让桌面端卡顿的命令加进 `web/handlers/mod.rs::is_sensitive_command`**。复用 `services/brotli_codec.rs` 的 `decode_stored_text()` + `looks_like_base64()`。
- ⚠️ **改存储键要全局找消费点**：Rust 读取端、前端、`scripts/collect-ai-switch-diagnostics.ps1`（内嵌 Python `m.get('response_body')`）、`docs-site/docs/{,en/}guide/usage-stats.md`。漏了会**静默归零**。Python brotli 不在标准库（3.13 有 1.2.0，3.12 没有），解不开返回 `None`，告警走 stdout `brotli-missing`。

## 浏览器端 brotli 解码（vitest/jsdom 坑）
- **jsdom `Blob` 没有 `.stream()`** → 改用 `new DecompressionStream("brotli" as CompressionFormat)` + `writable.getWriter()` + `readable.getReader()`。前端**异步解码**（`useEffect` + `useState`）。

## 后台任务：service 交出 future，调用方按自己的 runtime spawn
- `tokio::spawn` 在无 runtime 的同步上下文会 panic。**Tauri `app.setup()` 不在 Tokio 上下文** → 启动即崩。模式：service 只交出 future，桌面用 `tauri::async_runtime::spawn`，服务端用 `tokio::spawn`。**单元测试抓不到**（自带 runtime），必须真机启动一次。

## 时间戳必须取自同一来源
- 响应/事件流内 `created_at` **只取一次**（缓存进 state 或取上游 `created`），不能各调 `Utc::now()`。跨秒自相矛盾让测试 flaky（1/50 概率）。测试 fixture 要写死 `"created"`。连跑 N 次全 FAIL 时先确认是编译错误（如 `E0061`），别当成修复没生效。

## 发布（详见 docs-site/docs/dev/release.md）
- 版本号改 4 处：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock`（CI 只校验前两者）。
- tag `vX.Y.Z` 且是默认分支祖先。发布说明取 tag commit body：中文条目 → 空行 → 独占一行 29 个 `-` → 空行 → 英文条目。body 别处不要出现 12+ 连续 `-`/`*`/`_`。
- CI 不查 `cargo fmt`，`client_home.rs:55` 既有格式差异别顺手修。
- **Docker 独立 `.github/workflows/docker.yml`**：`release.yml` 末尾派发。tag 从 `steps.release.outputs.tag` 推导，**不能用 `github.ref_name`**。
- **镜像仓库 `ijry/ai-switch`**（Docker Hub）。`DOCKERHUB_TOKEN` 是个人 PAT → 推 `ai-switch/*` 会 `insufficient_scope`。默认值散落 9 处，改则一起改。
- **Windows pwsh 掩盖步骤失败**：退出码取最后一条命令，中间 native 命令失败被吞 → 多命令步骤拆成一命令一步。
- `gh` 本机未登录；从 GCM 取 `gho_` token。仓库公开，可未认证查 CI。本机 proxy 访问不了 Docker Hub（502），看 CI 日志。

## 本机构建
- `pnpm` 直接敲坏（shim 把 MSYS 路径交原生 node）。用 corepack：`C:/nvm4w/nodejs/node.exe "C:/nvm4w/nodejs/node_modules/corepack/dist/pnpm.js" ...`。前端测试：`C:/Users/Admin/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe node_modules/vitest/vitest.mjs run [file]`。
- **cargo 测试/构建**：Git Bash 内联设 MSVC + Rust 环境（PATH/LIB/LIBPATH/INCLUDE，详见 2026-09-22 日志），**必须 `dangerouslyDisableSandbox: true`**。`CARGO_TARGET_DIR=target-codex`。
  - `cargo build --release` 随机 `os error 5`（杀软干扰）→ **循环重试**，别清 target。重试必须判退出码 `rc=${PIPESTATUS[0]}`，不能只判产物存在。
- 检查服务端编译必须带 `--bin ai-switch-server`，不带会编桌面 `src/main.rs`（`desktop` feature 门控）→ E0425。
- `bundle.createUpdaterArtifacts: true` 需 `TAURI_SIGNING_PRIVATE_KEY`，未设只产 NSIS 包。
- Git for Windows `curl` 不认 `/tmp/x`（当 `D:\tmp\x`）；`curl -o` 给相对或 `D:/...`。

## 文档站 docs-site
- 自己的 workspace 根（`docs-site/pnpm-workspace.yaml` `packages: ['.']`）。**别删**。构建 `pnpm --dir docs-site docs:build`。
- **新增页面必跑 `docs:build`**：frontmatter `description` 里裸冒号会构建失败（改用 `；`/`—`）。新增页面改 4 处：`docs/` 与 `docs/en/` 两个 md + `config.mts` 的 `zhSidebar`/`enSidebar`（键必须带 `/en/` 前缀）。

## 测试
- 打真实表的手写 SQL 要配跑真实迁移的测试，手搓 schema 会掩盖 DDL 漂移。
- 性能/压缩守卫的样本形状决定测试意义：重复字符会把「长距离窗口在工作」和「相同字符压到近零」混为一谈。

## git 仓库结构与环境风险
- 本仓库是 **submodule**，`.git` 指向 `D:/Repos/xyito/.git/modules/open/ai-switch`。
- **本机有删 git 元数据的外部进程**（清空 `refs/`/`logs/`/`*.pack`/松散对象，症状 `fatal: not a git repository: (NULL)`）。恢复：重建 `refs/{heads,tags,remotes/origin}` 目录 + `git fetch origin` + `git update-ref refs/heads/main <reflog 顶端 sha>`。
- ⚠️ **`git stash` 会触发该删除 —— 本仓库避免使用 `git stash`。** `refs/` 三级及以上引用建完即消失，二级正常。
- 远程 `git@github.com:ai-switch/ai-switch.git`，用 `~/.ssh/id_rsa`。**不要设 `GIT_SSH_COMMAND`**（会让 ls-remote/fetch/push 静默返回空且 exit 0）。`packed-refs` 可能过期，以 `git ls-remote origin` 为准。
- Git for Windows 不认 MSYS `/tmp/...`；传路径用 `cygpath -m` 或 `D:/...`。

## 干净副本对照（`git worktree add --detach`）
- 判定失败是「我引入的」还是「既有/flaky」：**必须先在干净副本连跑多次复现**再下结论。副本缺 gitignore 产物，需从主树 `cp` sidecar exe 与 `dist/`。用独立 `CARGO_TARGET_DIR=target-pristine`。`git worktree list` 显示路径可能多一层，按输出去 `cd`。
