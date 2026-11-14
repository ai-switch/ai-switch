# Tailscale 公网访问：从 tsnet sidecar 迁移到系统 CLI Funnel

## 背景

AI Switch 原来的"安全网络"由内置 Go sidecar（`sidecar/ai-switch-tsnet`）实现。它基于 Tailscale 的 `tsnet` 库，在桌面进程之外以用户态方式加入 tailnet，再反向代理到本地 Web 服务，支持两种模式：

- **私有 tailnet**：只有自己 tailnet 内的设备能访问（`ListenTLS`）；
- **公网 Funnel**：任何人可访问的 HTTPS 地址（`ListenFunnel`）。

同源仓库 `lingyun/codeg-plus` 已经换成另一套方案：**不打包任何 Tailscale 组件**，直接驱动用户系统上已安装的 `tailscale` CLI，用 `tailscale funnel` 把本地 Web 服务发布到 `https://<机器名>.<tailnet>.ts.net`。

本次改造的目标是把集成方式与交互对齐 codeg-plus。

## 决策

| 维度 | 旧方案（tsnet sidecar） | 新方案（系统 CLI Funnel） |
| --- | --- | --- |
| Tailscale 来源 | 随应用打包的 Go sidecar（含 userspace WireGuard） | 用户系统已安装的 `tailscale` CLI，零打包零下载 |
| 暴露模式 | 私有 tailnet + 公网 Funnel | 仅公网 Funnel（`--https=443`） |
| 登录 | OAuth 浏览器流程 + auth key | OAuth（流式捕获授权链接）+ auth key |
| 持久化 | `web-service.json`（tailscaleEnabled / exposureMode）+ 明文 `auth-key` 文件 | DB `app_metadata` KV（`desiredEnabled` + `owned` 映射） |
| 部署面 | 桌面、裸机 systemd、Docker 均内置 sidecar | 依赖系统 tailscale；Docker 镜像安装官方 apt 包 |

### 已确认的取舍

1. **移除私有 tailnet 模式**（完全对齐 codeg-plus）。私有模式的消失意味着"不开公网端口、只在 tailnet 内访问"这一能力不再提供。
2. **保留 auth key 登录通道**（偏离 codeg-plus 的扩展）。无人值守的服务器仍可粘贴 auth key 登录；key 经 `up --authkey` 一次性使用，不落盘。
3. **Docker 镜像内置 tailscale**（偏离 codeg-plus 的扩展）。镜像安装 Tailscale 官方 apt 包，entrypoint 以 `--tun=userspace-networking` 启动 `tailscaled`，因此容器内仍可启用公网访问，无需 `/dev/net/tun` 或额外 capabilities。

## 架构

```
系统 tailscale CLI（PATH / 已知安装路径发现，不打包不下载）
  ├─ status --json                                 状态与 MagicDNS 主机名（8s 超时）
  ├─ funnel status --json                          ServeConfig 精确校验
  ├─ up --timeout=120s                             OAuth 登录（流式捕获授权链接）
  ├─ up --authkey=<key> --timeout=60s              auth key 登录（一次性）
  ├─ funnel --bg --https=443 --yes http://127.0.0.1:<port>   发布
  └─ serve --https=443 off                         清理（无 --yes，外部配置出现时拒绝）

FunnelManager（AppState 持有，src-tauri/src/web/tailscale_funnel/）
  ├─ Runtime：加载态 / 偏好 / auth 链接 / 错误 / generation / 在途 operation
  ├─ 偏好持久化：app_metadata KV，key = web_service_tailscale_funnel
  │   内容 = { desiredEnabled: bool, owned: { hostname, port } | null }
  └─ Executor trait：SystemExecutor（真实 CLI）/ FakeCli（测试）
```

## 核心纪律（照搬 codeg-plus）

- **exit 0 不算成功**：`funnel --bg` 可能成功退出却没有建立映射，因此发布后必须重新读取 `funnel status --json`，逐项校验 ServeConfig：443 上有 HTTPS 监听、根路径 `Proxy` 指向当前后端端口、`AllowFunnel` 为该主机开启、没有其他占用 443 的配置。
- **只清理自己记录的映射**：只有偏好里记录的 `OwnedMapping` 会被 `serve --https=443 off` 移除；外部（用户手工配置的）443 配置一律报冲突，绝不触碰。清理时不带 `--yes`，一旦出现外部 handler 就让命令自行拒绝。
- **generation 守卫**：每次取消/发起都会递增 `generation`；授权回调与任务完成只有在 generation 未变时才写回运行态。这让取消操作安全，也避免陈旧的授权链接或错误重新出现。
- **流式捕获授权链接**：stdout/stderr 按 4KB 分块读取，只扫描完整的空白分隔 token（URL 可能跨多次读取），128KB 上限，去重后立即回调——用户界面在 `up` 仍在等待时就能显示并打开登录页。原始 stderr 永不回显给界面（可能含密钥）。
- **非交互自动恢复遇登录即自取消**：没人盯着屏幕，出现授权链接就立刻取消等待。
- **live_port 门槛**：Web 服务未运行或令牌为空时绝不发布地址，避免把 funnel 指向一个死端口。
- **bind host 限制**：只有 `0.0.0.0` 或 `127.0.0.1` 才能启用（funnel 代理到 `127.0.0.1`）。

## 生命周期

| 事件 | 行为 |
| --- | --- |
| 应用启动（Tauri setup / 服务器启动） | `initialize`：Web 服务未运行则清理崩溃残留的映射 |
| Web 服务成功 bind | `restore`：偏好仍要公网访问则自动重发（非交互），否则只清理 |
| 用户点"开启公网访问" | 一键链：启动 Web 服务 → 登录（OAuth 或 auth key）→ 发布 → 轮询确认 |
| 用户点"关闭公网访问"/取消/离开页面 | 取消在途任务 + `desiredEnabled=false` + 清理自有映射 |
| Web 服务停止 | `shutdown`：取消任务 + 清理；失败则中止停止，让界面重新对账 |
| 应用退出 | `RunEvent::Exit` → 同上（best effort；硬杀由启动时 `initialize` 兜底） |
| 独立服务器 | 启动 `initialize`、bind 后 `restore`、退出 `shutdown` |

## 前端交互

`TailscaleFunnelSettings` 移植自 codeg-plus，并保留 auth key 输入区：

- 状态行（stage > processing > state > loading）、前置条件提示、授权链接展示与复制/打开按钮；
- **一键启用链**：必要时先调父组件启动 Web 服务 → 需要登录则发起登录并轮询直到授权链接出现（桌面端自动打开一次）→ 发布 → 轮询直到确认；
- **auth key 通道**：`needsLogin` 时可选粘贴 key 一次性登录，随后自动发布；该通道**不**捕获授权链接（无效 key 会让 `up` 退回交互登录，必须表现为失败的 key 而非弹出登录页）；
- 轮询：在途时 2s，已启用/期望启用时 10s，页面不可见时跳过；窗口 focus 时刷新；
- 卸载清理：只有当本次页面**确实发起过**操作（`mutated`）才取消；背景自动恢复留待其自然结束；
- 父组件（Web 服务设置）通过 `stopIntent` 握手让面板在停止请求发出前同步中止自己的流程，避免与 shutdown 竞争。

## 敏感命令门控

原逻辑：Web 服务运行在非回环地址、或启用了 HTTPS、或 Tailscale 已连接且提供 HTTPS 地址时，才开放敏感命令。

新逻辑（`sensitive_commands_enabled_for_runtime`）：

- 未配置/未请求 funnel（`None`）时，本地回环 HTTP 保持完整可用——与旧行为一致；
- funnel 已确认启用（`enabled`）时开放（funnel 地址必然是 HTTPS，TLS 终止在 Tailscale 边缘）；
- 连接中、出错、冲突时保持关闭。

## 移动端配对

`MobilePairingPayload` 形状不变（`v` / `publicUrl` / `privateUrl` / `pairingCode` / `expiresAt`），移动端无需同步改版：

- 门槛从"sidecar connected + serving"改为"funnel enabled"；
- `publicUrl` 取自 funnel 的确认地址，`privateUrl` 恒为 `null`；
- 保留公网地址可达性探测（`remote_probe`）与"仍然生成"（`force`）通道。

## 移除清单

- `sidecar/ai-switch-tsnet/`（Go 源码、go.mod/go.sum、README、测试）、`src-tauri/binaries/`；
- Rust：`tailscale_service.rs`、`tailscale_sidecar.rs`、`tailscale_types.rs`；`WebServiceConfig` 的 4 个 tailscale 字段；`paths.rs` 的 `tailscale_dir`；
- 旧命令 4 个 + 新命令 6 个；
- CI：Go 安装/测试/交叉编译、sidecar 路径与资产；
- Docker：sidecar 拷贝与断言、`AI_SWITCH_TSNET_PATH`（改为安装 tailscale 包）；
- `scripts/install-server.sh`：sidecar 校验、安装与环境变量；
- 前端：`tailscale-settings.tsx`、`settings.tailscale.*` i18n、`about/catalog.ts` 的 "Tailscale (tsnet)" 条目。

## 风险与说明

- **auth key 经进程参数传递**（本机 `ps` 可见）——与 Tailscale 官方 CI 用法一致的取舍；key 不再落盘，重启后由系统 `tailscaled` 自持连接。
- **移除 sidecar 后** Windows 更新器的 exe 锁问题消失，更新链路更简单。
- **Docker 内 funnel** 需 tailnet 启用 MagicDNS 与 HTTPS 证书（文档写明）；userspace 网络模式无需 TUN 设备或 NET_ADMIN。
- **私有 tailnet 访问消失**：这是一次能力缩减，需要向用户说明。
