---
title: Docker 部署
description: 用容器运行 AI Switch 独立服务器与 SaaS：多架构镜像、Redis 日志队列、PostgreSQL 日志存储，以及 token、端口和 SaaS 开关的常见覆盖参数。
---

# Docker 部署

Docker 镜像直接复用 GitHub Release 里已经打包好的 standalone server，不在本机编译 Rust，也不需要桌面端依赖的 WebKitGTK。它适合把独立服务器和 SaaS 面板一起跑在一台只装了 Docker 的机器上。

## 一键启动 server 与 SaaS

默认会启动 Redis 作为日志队列、PostgreSQL 作为日志存储，并自动开启 SaaS：

```bash
docker compose -f deploy/docker-compose.yml up -d
```

容器内日志队列与存储默认使用 `redis://redis:6379` 和 `postgresql://ai_switch:change-me@postgres:5432/ai_switch_logs?sslmode=disable`，对应环境变量是 `SAAS_LOGS_REDIS_URL` 和 `SAAS_LOGS_POSTGRES_URL`。SaaS 设置只保存环境名引用，不在数据库里落库连接串。

`deploy/docker-compose.yml` 会构建 Redis、PostgreSQL 和 AI Switch 三个服务，数据分别落在 `redis-data`、`postgres-data` 和 `ai-switch-data` 三个命名卷里；`ai-switch-data` 挂载到容器的 `/home/ai-switch/.ai-switch`，是账号、路由和用量数据的归属地。

## 镜像

镜像发布在 Docker Hub 的 `ijry/ai-switch`，支持 `linux/amd64` 与 `linux/arm64`：

| Tag | 说明 |
| --- | --- |
| `0.10.3` | 完整版本，锁定到具体发布 |
| `0.10` | 跟随该 `major.minor` 下的最新补丁 |
| `latest` | 最新正式版；`-rc`、`-beta`、`-alpha` 预发布不会占用它 |

生产环境建议锁定完整版本或 `major.minor`，而不是 `latest`。镜像由 CI 从 Release 归档组装而成，不编译源码；构建与推送流程见[发布流程](/dev/release)。

## 常见覆盖参数

`deploy/docker-compose.yml` 里的绝大部分配置都可以用环境变量覆盖：

- `AI_SWITCH_PORT`：宿主映射端口，默认 `19527`。
- `AI_SWITCH_DOCKER_IMAGE`：镜像地址，默认 `ijry/ai-switch:latest`；固定版本可用 `ijry/ai-switch:0.10.3` 或 `ijry/ai-switch:0.10`。
- `AI_SWITCH_TOKEN`：不设置时 entrypoint 会生成并打印一个容器本地令牌；跨重启请显式设置。
- `AI_SWITCH_SAAS_ENABLE`：默认 `1`，设为 `0` 只启动独立 server，日志队列与存储也不再需要。
- `AI_SWITCH_SAAS_ACTIVATION_CODE`、`AI_SWITCH_SAAS_INSTANCE_ID`、`AI_SWITCH_SAAS_SITE_NAME`、`AI_SWITCH_SAAS_PUBLIC_BASE_URL`。
- `AI_SWITCH_SAAS_LOGS_QUEUE`、`AI_SWITCH_SAAS_LOGS_STORE`，默认分别为 `redis` 和 `postgres`。
- `AI_SWITCH_SAAS_LOGS_REDIS_URL_ENV`、`AI_SWITCH_SAAS_LOGS_POSTGRES_URL_ENV`，默认分别引用 `SAAS_LOGS_REDIS_URL` 和 `SAAS_LOGS_POSTGRES_URL`。

## 忘记令牌怎么办

未显式设置 `AI_SWITCH_TOKEN` 时，entrypoint 启动后会在容器日志里打印生成的令牌：

```bash
docker logs <容器名> | grep AI_SWITCH_TOKEN
```

显式通过环境变量设置过的，查看环境变量：

```bash
docker inspect <容器名> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep AI_SWITCH_TOKEN
```

其他环境变量（监听地址、TLS、前端资源目录等）的完整说明见[独立服务器](/deploy/standalone-server)的「环境变量」一节，容器里同样适用。

## 下一步

- 想了解这些环境变量在非容器部署下的完整含义，见[独立服务器](/deploy/standalone-server)。
- 想从外网访问，见[远程访问与 HTTPS](/deploy/remote-access)。
- 想了解浏览器端的界面与接口细节，见 [Web 服务模式](/deploy/web-service)。
