---
title: 手机访问与团队自建
description: 四条远程使用路径的操作步骤与安全边界，包含桌面 Web 服务、Tailscale Funnel 公网访问、独立服务器一键安装与 Docker 部署，附环境变量、curl 验证与排错表。
---

# 手机访问与团队自建

**目标**：从另一台设备（手机、另一台电脑）打开 AI Switch，或在一台常开的机器 / NAS / 服务器上给团队跑一份共用实例。

**你需要**：一条已经能在本机跑通的请求链路（见 [跑通第一条请求](./first-request)）；按所选路径准备局域网、Tailscale 账号、Linux 服务器或 Docker 环境。

**验收标准**：浏览器里能打开同一套界面、看到同一批账号，且 `POST /api/:command` 不带令牌时拿不到数据。

## 先选一条路径

桌面端和浏览器用的是**同一份 React 界面**，区别只在传输层：桌面窗口走 Tauri IPC，浏览器走 HTTP + WebSocket，调用的是同一批命令。四种形态没有「功能阉割版」。

| 路径 | 适合 | 对外暴露 | 运维成本 |
| --- | --- | --- | --- |
| **A 桌面 Web 服务** | 临时用手机在同一 Wi-Fi 下切个号 | 局域网，默认仅本机 | 最低，桌面端点几下 |
| **B Tailscale Funnel** | 从外网访问自己的机器，不想自己配端口和证书 | 公网 HTTPS，由 Tailscale 提供 | 低，需要本机装 Tailscale 并有账号 |
| **C 独立服务器** | 无桌面环境的服务器、团队长期共用 | 由 Nginx / Caddy 反代决定 | 中，需要进程守护与 HTTPS |
| **D Docker** | 只有 Docker 的机器，想一次拉起 server 与日志服务 | 由 compose / 反代决定 | 中，一条命令但配置多 |

::: danger 先记住这一条
**访问令牌等价于 shell 权限。** Web API 开放了终端会话命令（创建会话、写入输入、结束会话），拿到令牌的人可以在跑服务的这台机器上执行命令、读取全部账号凭据。令牌按 SSH 私钥的等级保护，不要写进公开仓库、聊天记录或截图。
:::

## 路径 A：桌面端开 Web 服务（最快）

1. 打开桌面端 **设置 → Web 服务**。
2. 「共享服务端口」下拉选 `127.0.0.1`（仅本机）或 `0.0.0.0`（所有网卡），端口默认 `19527`。
3. 确认**访问令牌**：首次生成配置会自动填一个随机 UUID，可以直接用，也可以换成自己的长随机串。
4. 点 **保存**，再点 **启动服务端口**。

浏览器访问 `http://<这台机器的IP>:19527`，首次输入访问令牌；令牌存在浏览器 `localStorage` 的 `ai-switch.webToken` 键下，同一浏览器之后不用重复输入。

三个入口：

| 方法与路径 | 用途 | 鉴权 |
| --- | --- | --- |
| `POST /api/:command` | 所有业务命令，参数放 JSON body | 需要令牌 |
| `GET /ws/events` | 账号状态、用量、终端输出等实时事件 | 需要令牌 |
| `GET /health` | 健康检查 / 反代探活 | **不需要**令牌 |

```bash
curl -X POST http://127.0.0.1:19527/api/list_accounts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

> ✅ **检查点**：带令牌返回账号列表；把 `Authorization` 头去掉后同一请求拿不到数据。WebSocket 因为不能自定义请求头，额外支持 `?token=<token>` 查询参数。

::: warning 0.0.0.0 不是无害的开关
选 `0.0.0.0` 后，终端、凭据导出、代理密钥、MCP 与技能安装等全部 Web 命令都可通过**明文 HTTP** 调用，令牌是唯一保护。只在可信局域网里这么做，并自行配防火墙；跨不可信网络请用路径 B 或给反代配 HTTPS。这项放宽只适用于桌面版，独立 server 默认仍拒绝非环回明文 HTTP。
:::

配置文件在 `~/.ai-switch/web-service.json`，字段包括 `host`、`port`、`token`、`routeAccessEnabled`、`tlsEnabled` / `tlsCertPath` / `tlsKeyPath`（后三个界面无控件，只能改文件，且证书与私钥必须同时给）。旧版本里的 `tailscaleEnabled` / `tailscaleExposureMode` 已不再使用。改文件后要重启 Web 服务才生效。

**桌面独占命令有 3 个**：打开证书目录、把会话拉到系统终端应用、通过系统保存对话框导出凭据。浏览器调用会返回「仅桌面可用」。

## 路径 B：Tailscale Funnel 公网访问（推荐给外网访问）

不想自己张罗证书和公网端口，就用 Tailscale Funnel：让官方 Tailscale 在这一步替你做 TLS。做法是先在**这台机器上装好 Tailscale**（<https://tailscale.com/download>），然后在 **设置 → Web 服务 → Tailscale 公网访问** 里点**开启公网访问**：

1. 应用会按需自动启动 Web 服务、运行 `tailscale up`，把 `login.tailscale.com` 授权链接显示出来并自动在浏览器打开；也可以用无界面机器适用的 **auth key** 方式，密钥只用一次、不落盘。
2. 成功后得到公网地址，形如 `https://<machine>.<tailnet>.ts.net`，任何设备用浏览器都能打开，**手机不需要装 Tailscale**。
3. 前提是 tailnet 已启用 **MagicDNS** 与 **HTTPS certificates** 并允许 **Funnel**；缺 MagicDNS 会提示启用，设备未获批准会提示找管理员批准。

应用只清理它自己创建的 Funnel 映射：443 上已有你在应用之外配置的映射时，它会报告**冲突**而不是覆盖。

::: tip 令牌校验不会被跳过
无论走 Tailscale 公网还是局域网明文，AI Switch 自己的令牌校验都照常执行。Tailscale 解决的是「怎么连上」，不是「谁能操作」。
:::

独立服务器走这条路径时，也同样是先在这台机器上装好 `tailscale` CLI（服务器不再携带任何 sidecar）。

> ✅ **检查点**：在另一台设备（手机走蜂窝数据也行）用 Funnel 地址打开面板，输入令牌后能看到与本机一致的账号列表。

## 路径 C：独立服务器（团队自建）

`ai-switch-server` 是不带桌面外壳的服务端二进制：同一个 Rust 核心、同一份 React 界面，只保留 HTTP 与 WebSocket 入口。

### 一键安装（Linux x86_64 / aarch64）

```bash
AI_SWITCH_PORT=19527 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/ai-switch/ai-switch/main/scripts/install-server.sh)"
```

安装器会识别架构、创建 `ai-switch` 系统用户、装到 `/opt/ai-switch`、把令牌与端口写进 `/etc/ai-switch/server.env`，并安装启用 `ai-switch-server.service`。完成后会打印面板地址、服务状态和读取令牌的命令：

```bash
sudo cat /etc/ai-switch/server.env
systemctl status ai-switch-server
```

### 手动运行

全部运行参数来自环境变量，没有命令行参数也没有配置文件：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_SWITCH_HOST` | `127.0.0.1` | 非环回地址默认拒绝明文 HTTP |
| `AI_SWITCH_PORT` | `19527` | 无法解析时静默回退 19527 |
| `AI_SWITCH_TOKEN` | 无 | **必填，至少 16 字符**，缺失或过短拒绝启动 |
| `AI_SWITCH_STATIC_DIR` | 无 | 前端 `dist` 目录，需含 `index.html` |
| `AI_SWITCH_TLS_CERT_PATH` / `AI_SWITCH_TLS_KEY_PATH` | 无 | 证书链 / 私钥 PEM，必须成对 |
| `AI_SWITCH_ALLOW_INSECURE_HTTP` | 无 | 有可信 HTTPS 反代时显式设 `1` 才允许非环回明文 |

服务器本身不再有 Tailscale 相关变量；需要远程访问时，在本机自行安装 `tailscale` CLI（见路径 B）。

```bash
export AI_SWITCH_HOST=127.0.0.1
export AI_SWITCH_TOKEN="$(openssl rand -hex 32)"
export AI_SWITCH_STATIC_DIR=/opt/ai-switch/dist
/opt/ai-switch/ai-switch-server
# AI Switch server listening on http://127.0.0.1:19527
```

推荐把 HTTPS 交给 Nginx / Caddy 终止，服务本身保持 `127.0.0.1`，把请求反代过来即可（此时不需要配证书路径）。前端资源也可以直接放在二进制同级的 `web/` 目录，连 `AI_SWITCH_STATIC_DIR` 都不用设。

::: warning 三个容易踩的坑
- **数据目录不可通过环境变量指定**：服务始终用运行账号主目录下的 `~/.ai-switch`。`AI_SWITCH_DATA_DIR` 在代码里**没有实现**，设了不会生效；要换位置请用运行账号的主目录或容器卷。
- **独立 server 不做敏感命令降级**：凭据导出、密钥读取、MCP 与技能安装在令牌校验通过后都能调用，令牌是唯一访问控制。
- **多人共享意味着共享一切**：同一实例下所有人看到同一份账号、同一份用量、同一批会话，**没有按用户隔离的权限模型**。
:::

> ✅ **检查点**：`GET /health` 返回健康；`POST /api/list_accounts` 不带令牌失败、带令牌成功；浏览器能打开面板并看到与服务器数据目录一致的账号。

## 路径 D：Docker

```bash
docker compose -f deploy/docker-compose.yml up -d
```

默认会拉起 Redis（日志队列）、PostgreSQL（日志存储）与 AI Switch 三个服务，数据落在 `redis-data`、`postgres-data`、`ai-switch-data` 三个命名卷，其中 `ai-switch-data` 挂到 `/home/ai-switch/.ai-switch`，是账号、路由与用量数据的归属地。

镜像在 Docker Hub 的 `ijry/ai-switch`，支持 `linux/amd64` 与 `linux/arm64`：

| Tag | 说明 |
| --- | --- |
| `0.10.3` | 锁定具体发布 |
| `0.10` | 跟随该 minor 下最新补丁 |
| `latest` | 最新正式版，预发布不会占用 |

常改的覆盖参数：

```bash
AI_SWITCH_PORT=19527 \
AI_SWITCH_DOCKER_IMAGE=ijry/ai-switch:0.10 \
AI_SWITCH_TOKEN="$(openssl rand -hex 32)" \
AI_SWITCH_SAAS_ENABLE=0 \
docker compose -f deploy/docker-compose.yml up -d
```

- `AI_SWITCH_SAAS_ENABLE=0`：只启动独立 server，不再需要 Redis / PostgreSQL。
- 镜像内置了 Tailscale 并在启动时运行 `tailscaled --tun=userspace-networking`，因此容器里也能用 Tailscale 公网访问（需要 tailnet 已启用 MagicDNS 与 HTTPS 证书）；它不再附带任何内置 sidecar。
- `AI_SWITCH_TOKEN` 不设置时 entrypoint 会生成并在容器日志里打印：`docker logs <容器名> | grep AI_SWITCH_TOKEN`。**跨重启请显式设置**。
- 其他变量（`AI_SWITCH_HOST`、TLS、静态资源目录等）与独立服务器一致。

> ✅ **检查点**：`docker compose ps` 三个服务都在跑，浏览器打开宿主 `19527` 端口能看到界面并输入令牌。

## 面板与算力池共用一个端口

无论 A / C / D，默认只有一个端口 `19527`，上面跑着两类流量，用**两套不同凭据**鉴权：

| 流量 | 路径 | 凭据 |
| --- | --- | --- |
| 面板 | `/api/*`、`/ws/*`、`/health`、前端页面 | Web 访问令牌 |
| 模型 API | `/models`、`/v1/*`、`/v1beta/*`、`/messages`、`/responses` | 算力池路由代理 key（`sk-ai-switch-*`） |

两者不能互相替代。独立服务器里如果关掉了「算力池路由接入」，模型 API 返回 `route_proxy.access_disabled`，面板与健康检查不受影响。

## 安全清单

- 令牌必须设置且足够随机；桌面 Web 服务会拒绝空令牌或过短令牌启动，独立 server 要求至少 16 字符。
- 令牌轮换要手动做：改完重启服务，所有浏览器都要重新输入新令牌。
- 在共享 / 公共设备访问后退出并清理站点数据（令牌在 `localStorage`）。
- 默认只监听 `127.0.0.1`；绑 `0.0.0.0` 前先确认防火墙与网络可信度。
- 公网暴露用 Tailscale Funnel 就够了，TLS 由 Tailscale 提供；如果不用它、直接把服务放到公网，请自己配 HTTPS 反代，别让裸 HTTP 直接对外。
- `~/.ai-switch` 里的 SQLite 保存着 API Key 与账号凭据，按凭据目录对待：收紧权限、加密备份、不要放进公开仓库或明文同步盘。

## 排错表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| 浏览器打不开 | 服务没启动 / host 还是 `127.0.0.1` / 防火墙 | 核对状态条或 `systemctl status`，改绑定地址，放行端口 |
| 面板打开但命令全失败 | 令牌没带或已轮换 | 重新输入令牌；WebSocket 用 `?token=` 或 Bearer 头 |
| 独立 server 拒绝启动 | `AI_SWITCH_TOKEN` 缺失或短于 16 字符；TLS 只给了半个路径 | 设长随机令牌；证书与私钥成对提供 |
| 非环回地址起不来 | 独立 server 默认拒绝明文 HTTP | 配 HTTPS 反代，或显式设 `AI_SWITCH_ALLOW_INSECURE_HTTP=1`（仅限可信边界） |
| 页面白屏 / 静态资源 404 | 找不到 `index.html` | 设 `AI_SWITCH_STATIC_DIR`，或把前端放到二进制同级 `web/` |
| 浏览器里某命令提示「仅桌面可用」 | 命中桌面独占命令 | 到桌面端执行；或改用等价的 Web 命令 |
| 开启公网访问卡在登录 | 本机未登录 Tailscale | 完成浏览器授权，或用 auth key 连接 |
| 提示「未安装 Tailscale」 | 本机没有 `tailscale` CLI | 从 <https://tailscale.com/download> 安装后刷新 |
| 公网访问报冲突 | 443 上已有应用之外配置的 Funnel 映射 | 到 Tailscale 里处理该映射，再回应用重试 |
| 开启后敏感命令 404 | Funnel 尚未建立可用链路 | 等链路就绪；环回直连仍可用 |
| 忘记 Docker 令牌 | 未显式设置时由 entrypoint 生成 | `docker logs <容器名> \| grep AI_SWITCH_TOKEN` |
| 忘记 systemd 令牌 | 写在 env 文件里 | `sudo cat /etc/ai-switch/server.env` |
| 换了数据目录变量没生效 | `AI_SWITCH_DATA_DIR` 未实现 | 用运行账号主目录或容器卷控制 |

## 下一步

- [Web 服务模式](/deploy/web-service)：三个入口、配置文件字段、敏感命令闸门
- [独立服务器](/deploy/standalone-server)：完整环境变量表、构建命令、静态资源解析顺序
- [Docker 部署](/deploy/docker)：compose 服务、镜像 tag、SaaS 开关
- [远程访问与 HTTPS](/deploy/remote-access)：Tailscale、Funnel 与本地算力池 HTTPS
- [架构总览](/dev/architecture)：桌面 IPC 与浏览器 HTTP 怎么复用同一套命令
