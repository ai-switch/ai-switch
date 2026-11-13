---
title: Phone Access and Team Servers
description: "Four remote paths for AI Switch with step-by-step setup and security boundaries: desktop Web service, Tailscale private net, standalone server one-line install and Docker deployment, plus env vars and troubleshooting."
---

# Phone Access and Team Servers

**Goal**: open AI Switch from another device (a phone or another computer), or run one shared instance on an always-on machine, NAS or server for a team.

**You need**: a request chain that already works locally (see [Your first request](./first-request)); depending on the path, a LAN, a Tailscale account, a Linux server or Docker.

**Definition of done**: the browser shows the same UI and the same accounts, and `POST /api/:command` without a token returns no data.

## Pick a path first

Desktop and browser use the **same React UI**; only the transport differs — Tauri IPC in the desktop window, HTTP + WebSocket in the browser, calling the same set of commands. There is no stripped-down web version.

| Path | Best for | Exposure | Ops cost |
| --- | --- | --- | --- |
| **A Desktop Web service** | Temporarily switching an account from a phone on the same Wi-Fi | LAN, localhost only by default | Lowest, a few clicks on desktop |
| **B Tailscale private net** | Reaching your own machine from outside without opening a public port | Private net / optional Funnel | Low, needs a Tailscale account |
| **C Standalone server** | Headless server, a team sharing one long-running instance | Decided by an Nginx / Caddy reverse proxy | Medium, needs supervision and HTTPS |
| **D Docker** | A machine with only Docker; server plus log services in one command | Decided by compose / reverse proxy | Medium, one command but more knobs |

::: danger Remember this one thing
**The access token is equivalent to shell access.** The Web API exposes terminal session commands (create session, write input, close session), so anyone holding the token can run commands on the host and read every stored credential. Protect it like an SSH private key — never put it in a public repo, a chat message or a screenshot.
:::

## Path A — Desktop Web service (fastest)

1. Open desktop **Settings → Web service**.
2. In "Shared service port", pick `127.0.0.1` (this machine only) or `0.0.0.0` (all interfaces); the default port is `19527`.
3. Confirm the **access token**: a random UUID is filled in automatically when the config is first generated; keep it or replace it with your own long random string.
4. Click **Save**, then **Start service port** as needed.

Open `http://<this-machine-IP>:19527` in a browser and enter the token once. It is stored in `localStorage` under `ai-switch.webToken`, so the same browser does not ask again.

Three entry points:

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `POST /api/:command` | All business commands, arguments in the JSON body | Token required |
| `GET /ws/events` | Live events: account state, usage, terminal output | Token required |
| `GET /health` | Health check / reverse-proxy probe | **No token** |

```bash
curl -X POST http://127.0.0.1:19527/api/list_accounts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

> ✅ **Checkpoint**: with the token you get the account list; removing the `Authorization` header returns no data. WebSockets cannot set custom headers, so `?token=<token>` is also accepted.

::: warning 0.0.0.0 is not a harmless switch
With `0.0.0.0`, every Web command — terminal, credential export, proxy keys, MCP and skill installs — is reachable over **plaintext HTTP**, with the token as the only protection. Only do this on a trusted LAN and configure a firewall yourself; across untrusted networks use path B or terminate HTTPS at a reverse proxy. This relaxation applies to the desktop build only — the standalone server still refuses non-loopback plaintext HTTP by default.
:::

Config lives at `~/.ai-switch/web-service.json` with fields `host`, `port`, `token`, `routeAccessEnabled`, `tailscaleEnabled`, `tailscaleExposureMode`, and `tlsEnabled` / `tlsCertPath` / `tlsKeyPath` (the last three have no UI controls and must be edited in the file; cert and key must be supplied together). Restart the Web service after editing the file.

**Three desktop-only commands**: open the certificate directory, pull a session into the system terminal app, and export credentials through the system save dialog. Browser calls return "Desktop only".

## Path B — Tailscale private net (recommended for outside access)

If you do not want a public port or certificates to manage, enable **secure networking** (Tailscale) in Settings and set **access mode** to "Private only". Choose "Public access" (Funnel) only when you genuinely need to share a public URL.

When the desktop build keeps its loopback listener and exposes through Tailscale, the sensitive-command gate follows the external link state: loopback HTTP is usable while Tailscale is off, usable again after public-mode HTTPS exposure completes, and temporarily closed (404 "Web command is not available") while no usable external link exists.

::: tip Token checks are never skipped
Whether over Tailscale private net or Funnel, AI Switch's own token validation still applies. Tailscale solves "how do I connect", not "who is allowed to act".
:::

On a standalone server this path needs the Tailscale sidecar: place `ai-switch-tsnet` next to the binary, or point `AI_SWITCH_TSNET_PATH` at it.

> ✅ **Checkpoint**: on another device in the same tailnet, open the Tailscale hostname/IP, enter the token and see the same account list as on the host.

## Path C — Standalone server (team self-hosting)

`ai-switch-server` is the headless server binary: the same Rust core, the same React UI, HTTP and WebSocket only.

### One-line install (Linux x86_64 / aarch64)

```bash
AI_SWITCH_PORT=19527 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/ai-switch/ai-switch/main/scripts/install-server.sh)"
```

The installer detects the architecture, creates an `ai-switch` system user, installs into `/opt/ai-switch`, persists token and port to `/etc/ai-switch/server.env`, and installs, enables and starts `ai-switch-server.service`. It prints the panel URL, service status and the command to read the token:

```bash
sudo cat /etc/ai-switch/server.env
systemctl status ai-switch-server
```

### Manual run

All runtime parameters come from environment variables — there are no CLI flags and no config file:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_SWITCH_HOST` | `127.0.0.1` | Non-loopback addresses refuse plaintext HTTP by default |
| `AI_SWITCH_PORT` | `19527` | Unparseable values silently fall back to 19527 |
| `AI_SWITCH_TOKEN` | none | **Required, at least 16 chars**; missing or short values refuse startup |
| `AI_SWITCH_STATIC_DIR` | none | Frontend `dist` directory, must contain `index.html` |
| `AI_SWITCH_TLS_CERT_PATH` / `AI_SWITCH_TLS_KEY_PATH` | none | Cert chain / private key PEM, must be supplied together |
| `AI_SWITCH_TSNET_PATH` | none | Tailscale sidecar path |
| `AI_SWITCH_ALLOW_INSECURE_HTTP` | none | Set to `1` explicitly when a trusted HTTPS reverse proxy is in front |

```bash
export AI_SWITCH_HOST=127.0.0.1
export AI_SWITCH_TOKEN="$(openssl rand -hex 32)"
export AI_SWITCH_STATIC_DIR=/opt/ai-switch/dist
/opt/ai-switch/ai-switch-server
# AI Switch server listening on http://127.0.0.1:19527
```

The recommended layout terminates HTTPS at Nginx / Caddy, keeps the server on `127.0.0.1` and proxies requests to it (no cert paths needed in that case). Frontend assets can simply live in a `web/` directory next to the binary, removing the need for `AI_SWITCH_STATIC_DIR`.

::: warning Three easy traps
- **The data directory cannot be set via environment variable**: the server always uses `~/.ai-switch` for the running user. `AI_SWITCH_DATA_DIR` is **not implemented** and silently does nothing; use the service account's home directory or a container volume.
- **The standalone server does not downgrade sensitive commands**: credential export, key reads, MCP and skill installs are all available once the token check passes. The token is the only access control.
- **Sharing means sharing everything**: everyone on one instance sees the same accounts, the same usage history and the same sessions. **There is no per-user permission model.**
:::

> ✅ **Checkpoint**: `GET /health` is healthy; `POST /api/list_accounts` fails without a token and succeeds with one; the browser shows the accounts from the server's data directory.

## Path D — Docker

```bash
docker compose -f deploy/docker-compose.yml up -d
```

By default this starts Redis (log queue), PostgreSQL (log storage) and AI Switch, with data in the `redis-data`, `postgres-data` and `ai-switch-data` named volumes. `ai-switch-data` mounts at `/home/ai-switch/.ai-switch` — that is where accounts, routing and usage data live.

Images are published as `ijry/ai-switch` on Docker Hub for `linux/amd64` and `linux/arm64`:

| Tag | Meaning |
| --- | --- |
| `0.10.3` | Pinned to an exact release |
| `0.10` | Latest patch within that minor |
| `latest` | Latest stable; pre-releases never take this tag |

Common overrides:

```bash
AI_SWITCH_PORT=19527 \
AI_SWITCH_DOCKER_IMAGE=ijry/ai-switch:0.10 \
AI_SWITCH_TOKEN="$(openssl rand -hex 32)" \
AI_SWITCH_SAAS_ENABLE=0 \
docker compose -f deploy/docker-compose.yml up -d
```

- `AI_SWITCH_SAAS_ENABLE=0`: start only the standalone server; Redis / PostgreSQL are no longer needed.
- If `AI_SWITCH_TOKEN` is unset, the entrypoint generates one and prints it to the container log: `docker logs <container> | grep AI_SWITCH_TOKEN`. **Set it explicitly if it must survive restarts.**
- Other variables (`AI_SWITCH_HOST`, TLS, static asset directory, …) behave exactly as on the standalone server.

> ✅ **Checkpoint**: `docker compose ps` shows the services running; opening the host's port 19527 shows the UI and accepts the token.

## One port, two kinds of traffic

For A / C / D there is a single port (19527 by default) carrying two traffic classes with **two different credentials**:

| Traffic | Paths | Credential |
| --- | --- | --- |
| Panel | `/api/*`, `/ws/*`, `/health`, frontend pages | Web access token |
| Model API | `/models`, `/v1/*`, `/v1beta/*`, `/messages`, `/responses` | Route proxy key (`sk-ai-switch-*`) |

They are not interchangeable. On a standalone server, disabling "route proxy access" makes the model API return `route_proxy.access_disabled` while the panel and health check keep working.

## Security checklist

- Set a long, random token; the desktop Web service refuses empty or short tokens, and the standalone server requires at least 16 characters.
- Token rotation is manual: restart the service after changing it, and every browser must enter the new token.
- On shared or public devices, log out and clear site data (the token lives in `localStorage`).
- Loopback `127.0.0.1` is the default; verify firewall and network trust before binding `0.0.0.0`.
- Prefer a Tailscale private net for outside access; if public exposure is unavoidable, terminate HTTPS — never expose raw HTTP directly.
- The SQLite database inside `~/.ai-switch` holds API keys and account credentials: tighten permissions, encrypt backups, and keep it out of public repos and plaintext sync folders.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Browser cannot connect | Service not started / host still `127.0.0.1` / firewall | Check the status bar or `systemctl status`, change the bind address, open the port |
| Panel opens but commands fail | Token missing or rotated | Re-enter the token; WebSockets accept `?token=` or a Bearer header |
| Standalone server refuses to start | `AI_SWITCH_TOKEN` missing or shorter than 16 chars; only one TLS path supplied | Set a long random token; provide cert and key together |
| Non-loopback address fails | Standalone server refuses plaintext HTTP by default | Put an HTTPS proxy in front, or set `AI_SWITCH_ALLOW_INSECURE_HTTP=1` inside a trusted boundary |
| Blank page / static 404 | No `index.html` found | Set `AI_SWITCH_STATIC_DIR`, or put frontend assets in `web/` next to the binary |
| "Desktop only" for a command | A desktop-only command was called | Run it on desktop, or use the equivalent Web command |
| Sensitive commands 404 under Tailscale | No usable external link yet | Wait for the link; loopback direct access still works |
| Forgot the Docker token | Generated by the entrypoint when unset | `docker logs <container> \| grep AI_SWITCH_TOKEN` |
| Forgot the systemd token | Stored in the env file | `sudo cat /etc/ai-switch/server.env` |
| Data directory override did nothing | `AI_SWITCH_DATA_DIR` is not implemented | Control it via the service account's home directory or a container volume |

## What next

- [Web Service Mode](/en/deploy/web-service): three entry points, config fields and the sensitive-command gate
- [Standalone Server](/en/deploy/standalone-server): full env var table, build commands, static asset resolution order
- [Docker](/en/deploy/docker): compose services, image tags and the SaaS switch
- [Remote Access and HTTPS](/en/deploy/remote-access): Tailscale, Funnel and local pool HTTPS
- [Architecture](/en/dev/architecture): how desktop IPC and browser HTTP reuse the same commands
