---
title: Your First Request
description: "Get a first request through AI Switch in five minutes: add a route account, run a real generation test, start the local proxy, write CLI config, verify with curl and confirm the usage event."
---

# Your First Request

**Goal**: send one real Codex request through the local proxy to your upstream account and see it appear in usage stats.

**You need**: AI Switch installed (see [Installation](/en/guide/installation)); one working upstream account — a base URL and an API key, from a relay provider or an official API; Codex or any tool that can issue an HTTP request.

**Definition of done**: a new row in the Stats request list, showing the account you just added, a successful status and non-empty token and price values.

::: tip How this differs from Quick Start
[Quick Start](/en/guide/quick-start) explains what the five steps are. This guide is a checklist: every step has a "how to confirm" checkpoint, and there is a lookup table from error messages back to causes. Do this once, then read Quick Start for the underlying model.
:::

## Before you start: two different keys

| | Local proxy key | Upstream API key |
| --- | --- | --- |
| Shape | `sk-ai-switch-<uuid>` | The `sk-...` from your provider |
| Where it comes from | Copied from the "Connect to the pool" dialog | Your relay or official dashboard |
| Where it goes | Next to the CLI base URL | The AI Switch add-account dialog |
| Who receives it | Only the local proxy | Sent upstream by the proxy |
| Can it leak | Stripped before forwarding, **never reaches the upstream** | Only present in outbound requests |

The classic symptom of mixing them up is an upstream 401 — you pasted `sk-ai-switch-*` into the upstream account.

## Step 1 — Add a route account

Open AI Switch, click **Codex** under the **Agents** group in the sidebar (it is the default view), click **+** ("Add account") in the toolbar and stay on the **API account** tab.

| Field | What to enter | Common mistake |
| --- | --- | --- |
| Name | Something recognizable, e.g. `relay-primary` | Using `test`, which makes stats useless later |
| API Key | Your upstream key, **one per line** | Pasting multiple lines silently creates multiple accounts |
| Base URL | The address from your provider, e.g. `https://your-relay.example.com/v1` | Missing `/v1` or producing `/v1/v1` |
| Interface format | The protocol the **upstream** supports | Choosing based on the CLI. A `openai` account is still `openai` when used by Codex |
| Model mapping (optional) | CLI model → upstream model, e.g. `gpt-5.5 → gpt-4o` | Omitting it when names differ produces `route_pool.model_unmatched` |

The four formats are `openai` (Chat Completions), `openai-responses` (Responses), `anthropic` (Messages) and `gemini` (generateContent). **If unsure, start with `openai`** — most relay providers use it.

Leave **"Add to pool after creation"** checked (it is on by default) and click **Save account**.

> ✅ **Checkpoint**: the account appears in the pool view with status "OK" and is not in the "Not in pool" view.

::: details If you filled something in wrong
Click "Edit account" at the end of the account row. If the account is in the pool but never selected, check the Advanced section: priority may be set to 5, or the account may be paused manually.
:::

## Step 2 — Verify with a real generation test

**Do not touch CLI config yet.** Click **✈** in the toolbar ("Real generation test of pool routing"), keep `/responses` for Codex, leave the test model blank to use the platform default and click **Start test**.

This is not a ping — the upstream actually generates content. A passing result includes:

- **Model output** — real text returned by the upstream
- **Pool request chain** — pool entry → account hit → upstream endpoint, with a trace id
- Expand "View input / output" for the request JSON and response body

> ✅ **Checkpoint**: the test passes and the chain names the account from Step 1.

A pass means the account, credentials, protocol and model mapping are all correct. If it fails, use the troubleshooting table at the end — **do not edit CLI config on top of a broken chain**.

::: warning Tests also count as usage
Model connectivity tests and real forwards land in the same usage table with the same `metric_type`; the Stats panel does not separate them. Clicking the test repeatedly inflates the request count, and only the "Source" column in the request list distinguishes them. Click once for verification.
:::

## Step 3 — Start the local proxy

Click the green **▶** button ("Start local route proxy"). The status bar changes from "Proxy not running" to an address:

```text
http://127.0.0.1:19527
```

It binds to `127.0.0.1` on port 19527 by default; if the port is taken it scans upwards, so **use the address shown in the UI**.

| Platform | Local path | Protocol |
| --- | --- | --- |
| Codex | `/responses` | OpenAI Responses |
| Claude Code | `/v1/messages` | Anthropic Messages |
| Gemini CLI | `/v1beta/models/{model}:generateContent` | Gemini native |

> ✅ **Checkpoint**: the status bar shows an address and `curl http://127.0.0.1:19527/health` returns a healthy response.

::: tip Clients that require TLS
Settings can enable "local pool HTTPS", which generates and imports a root certificate and binds a second listener at "HTTP port + 1" (commonly 19528). The address written into CLI config is **always the HTTP one** — curl and Node-based CLIs with their own CA bundle cannot read the local root certificate from the system trust store, so writing `https://` breaks them. See [Remote Access and HTTPS](/en/deploy/remote-access).
:::

## Step 4 — Write the CLI config

Click **🔌** ("Connect clients: write the current pool into client config"), tick Codex and click **Write**.

AI Switch edits `~/.codex/config.toml`, adding a model provider named `ai-switch` and selecting it, plus a `~/.codex/ai-switch-model-catalog.json` catalog. Every write takes a snapshot, writes atomically, detects concurrent edits and supports guarded rollback — **your existing settings are preserved**.

| Platform | File |
| --- | --- |
| Codex | `~/.codex/config.toml` |
| Claude Code | `~/.claude/settings.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Grok | `~/.grok/settings.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| OpenClaw | `~/.openclaw/openclaw.json` |
| Hermes | `~/.hermes/config.yaml` |

Then just run:

```bash
codex
```

> ✅ **Checkpoint**: the "Config write result" list shows the target path with a success status, and `codex` starts and holds a conversation.

::: details Prefer to configure it yourself?
Switch to the "Other agents" tab in the 🔌 dialog and copy two values: the **Base URL** (current proxy address) and the **API Key** (the local proxy key, masked by default — click the eye icon to reveal it). The proxy key can go in `Authorization: Bearer`, `x-api-key`, `x-goog-api-key`, or the `key` / `api_key` query parameter. Note there is **one key per platform** — copy it again after switching tabs.
:::

## Step 5 — Confirm independently with curl

```bash
curl -X POST http://127.0.0.1:19527/responses \
  -H "Authorization: Bearer sk-ai-switch-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "input": "Reply with exactly: ai-switch-ok",
    "stream": false
  }'
```

```powershell
$key = "sk-ai-switch-YOUR_KEY"
$body = @{ model = "gpt-5.5"; input = "Reply with exactly: ai-switch-ok"; stream = $false } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:19527/responses `
  -H "Authorization: Bearer $key" -H "Content-Type: application/json" -d $body
```

`model` must be a model supported by an account in the pool (use the pre-mapping name). `GET /models` returns the aggregated, deduplicated list of client-visible models; that path is answered locally and never forwarded upstream.

> ✅ **Checkpoint**: a 2xx response with model output and no `error.code`.

## Step 6 — Confirm in Stats

Switch the bottom view to **Stats**, pick "Today" and look at the six metric cards and the **request list** below.

| Look at | Expect | What it proves |
| --- | --- | --- |
| Requests | ≥ 1 | The forward actually happened |
| Account name | The account you added | Priority and selection are right |
| Status / path | Success / `/responses` | The entry protocol is correct |
| Model | The mapped upstream name (`requested->upstream`) | Model mapping took effect |
| Price | An amount, possibly marked "est." | Pricing data is flowing |

> ✅ **Final check**: the curl request from Step 5 appears in the request list with account, model and tokens filled in.

Stats refreshes every 5 seconds; the request list shows 20 rows per page. Cost is a **reference figure**: when the upstream does not report a price, AI Switch estimates it from a local price table (marked "est."), and CNY is converted to USD at a fixed rate of 7.1. Your provider's billing dashboard is authoritative. See [Usage and Request Stats](/en/guide/usage-stats).

## Troubleshooting

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| `Proxy not running` | ▶ not clicked, or port conflict | Start it; check the actual port in the status bar |
| `No enabled route credentials in pool` | No usable account in the pool | Move the account in from "Not in pool", or unpause it |
| `route_pool.model_unmatched` | No account supports the requested model | Add a `from → to` model mapping |
| `route_pool.concurrency_exhausted` | Every account is at its concurrency cap | Raise the cap or add an account |
| `route_proxy.key_invalid` | Wrong key copied, or from another instance | Re-copy the key for the current platform from the connect dialog |
| `route_proxy.platform_unresolved` | No proxy key and no platform header | Add `Authorization: Bearer` or an `x-ai-switch-platform` header |
| Upstream 401 / 403 | Bad upstream key, missing scope, or the local key was pasted into the account | Verify the key; for restricted keys see [Reliability and Auto Recovery](/en/guide/reliability) |
| `This account only allows Codex official clients` | Relay checks client fingerprints | AI Switch adds Codex client headers automatically; if the account has a custom `User-Agent`, that spoofing yields to it — remove the custom UA |
| Client only sees HTTP 502 | The proxy does not pass through upstream status codes | Read `error.code` in the body, or the live logs; do not guess from 502 |
| Price shows `-` | Upstream did not report a price and the model is not in the built-in table | Add `~/.ai-switch/model-prices.json`, see [Usage and cost](./usage-and-cost) |

Live logs (original request / rewritten upstream request / raw upstream response / final response) are in the toolbar dropdown and are far more useful than the client view when debugging bridging. They are an in-memory ring buffer of 100 entries, never written to disk.

## What next

- Add a second account and set priorities so rate limits fall through automatically → [Build a pool that never stalls](./failover-pool)
- Only have a Chat relay key and want Codex → [Run Codex on a Chat relay](./codex-with-chat-relay)
- Configure other CLIs → [Platform Support Matrix](/en/guide/platform-support); each platform has its own pool and proxy key
- Manage from a browser or phone → [Phone access and team servers](./remote-and-team)
- Understand the whole forwarding chain → [Protocol Routing and Bridging](/en/guide/protocol-routing)
