---
title: Docker
description: Run the AI Switch standalone server and SaaS in containers — multi-arch images, Redis as the log queue, PostgreSQL as the log store, and the overrides for tokens, ports and the SaaS switches.
---

# Docker

The Docker image reuses the standalone server already packaged in the GitHub Release, so no Rust compilation happens locally and the desktop WebKitGTK dependency is not needed. It is the way to run the standalone server and its SaaS panel together on a machine that only has Docker.

## One-click server and SaaS startup

By default, Redis is the log queue, PostgreSQL is the log store, and SaaS is enabled automatically:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Inside the container, the default log queue and store use `redis://redis:6379` and `postgresql://ai_switch:change-me@postgres:5432/ai_switch_logs?sslmode=disable`, via `SAAS_LOGS_REDIS_URL` and `SAAS_LOGS_POSTGRES_URL`. SaaS settings store only environment-name references and do not persist connection strings in the database.

`deploy/docker-compose.yml` brings up three services — Redis, PostgreSQL and AI Switch — with their data in the `redis-data`, `postgres-data` and `ai-switch-data` named volumes. `ai-switch-data` is mounted at `/home/ai-switch/.ai-switch` inside the container and holds the accounts, routes and usage data.

## Images

Images are published to `ijry/ai-switch` on Docker Hub for `linux/amd64` and `linux/arm64`:

| Tag | Meaning |
| --- | --- |
| `0.10.3` | Full version, pinned to one release |
| `0.10` | Follows the newest patch in that `major.minor` |
| `latest` | The newest stable release; `-rc`, `-beta` and `-alpha` prereleases never take it |

Pin the full version or `major.minor` in production rather than tracking `latest`. The image is assembled by CI from the release archives instead of compiling source — see the [release process](/en/dev/release) for how it is built and pushed.

## Common overrides

Almost everything in `deploy/docker-compose.yml` can be overridden by environment variable:

- `AI_SWITCH_PORT`: host port mapping, default `19527`.
- `AI_SWITCH_DOCKER_IMAGE`: image reference, default `ijry/ai-switch:latest`; pin a release with `ijry/ai-switch:0.10.3` or `ijry/ai-switch:0.10`.
- `AI_SWITCH_TOKEN`: when unset, the entrypoint generates and prints a container-local token; set it explicitly for restarts.
- `AI_SWITCH_SAAS_ENABLE`: default `1`; set `0` to run only the standalone server, with no log queue or store either.
- `AI_SWITCH_SAAS_ACTIVATION_CODE`, `AI_SWITCH_SAAS_INSTANCE_ID`, `AI_SWITCH_SAAS_SITE_NAME`, `AI_SWITCH_SAAS_PUBLIC_BASE_URL`.
- `AI_SWITCH_SAAS_LOGS_QUEUE`, `AI_SWITCH_SAAS_LOGS_STORE`, defaulting to `redis` and `postgres`.
- `AI_SWITCH_SAAS_LOGS_REDIS_URL_ENV`, `AI_SWITCH_SAAS_LOGS_POSTGRES_URL_ENV`, defaulting to references to `SAAS_LOGS_REDIS_URL` and `SAAS_LOGS_POSTGRES_URL`.

## Recovering a lost token

When `AI_SWITCH_TOKEN` is not set explicitly, the entrypoint prints the token it generated to the container log:

```bash
docker logs <container> | grep AI_SWITCH_TOKEN
```

If it was set through an environment variable, read it back from there:

```bash
docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep AI_SWITCH_TOKEN
```

The remaining environment variables — listen address, TLS, frontend directory and so on — are documented in [Standalone Server](/en/deploy/standalone-server) under "Environment variables" and apply unchanged inside the container.

## Next steps

- For the full meaning of these variables outside a container, see [Standalone Server](/en/deploy/standalone-server).
- To reach it from outside your network, see [Remote Access and HTTPS](/en/deploy/remote-access).
- For browser-side UI and endpoint details, see [Web Service Mode](/en/deploy/web-service).
