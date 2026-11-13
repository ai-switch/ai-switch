---
title: Any Upstream for Claude Code
description: "Use the path-based Messages entry to serve Claude Code from OpenAI, Responses, Gemini or Anthropic accounts, with model alias mapping, 1M context, curl verification and the exact protocol boundaries."
---

# Any Upstream for Claude Code

**Goal**: keep Claude Code speaking native Messages while its requests are served by an OpenAI-compatible, Responses or Gemini account.

**You need**: one upstream account in any protocol; Claude Code and AI Switch installed; [Your first request](./first-request) is recommended to get familiar with the UI.

**Definition of done**: Claude Code completes a tool-using turn; live logs show an upstream-dialect request in stage 2 and an Anthropic Messages reply in stage 4.

## The key mechanism: the Messages entry is path-based

Bridging triggers in exactly three cases:

```text
Platform is Codex and path is /responses → Responses family
Path is /v1/messages                     → Claude family (platform ignored)
Path is chat/completions                 → Chat family (platform ignored)
Anything else                            → passthrough
```

The last two are **judged by path only, never by platform**. An Anthropic Messages request can therefore reach any pool — the Claude pool natively, but also Codex, Gemini, Grok and the OpenCode family. The selected account's `interface_format` decides which dialect the request is translated into. That is the entire reason this guide works.

| Local entry | Upstream `openai` | Upstream `openai-responses` | Upstream `anthropic` | Upstream `gemini` |
| --- | --- | --- | --- | --- |
| `/v1/messages` | `ClaudeToChat` | `ClaudeToResponses` | passthrough | `ClaudeToGemini` |
| `/responses` (Codex) | `ResponsesToChat` | `ResponsesToResponses` | `ResponsesToAnthropic` | `ResponsesToGemini` |

The reverse direction is implemented pairwise too: upstream `choices[].delta`, `response.*` or `usageMetadata` frames are replayed as Anthropic `message_start` / `content_block_delta` / `message_delta` / `message_stop` events.

::: tip Matching protocols do not always mean passthrough
Conversely, an `anthropic` upstream on the Messages entry really is pure passthrough (no bridge kind), while Codex → `openai-responses` is still a `ResponsesToResponses` bridge because third-party Responses gateways need a cleaning pass.
:::

## Step 1 — Create a non-Anthropic account

Under **Agents → Claude Code**, click **+** and stay on the "API account" tab:

| Field | Value |
| --- | --- |
| Name | `openai-channel-claude` |
| API Key | Your upstream key |
| Base URL | e.g. `https://your-relay.example.com/v1` |
| **Interface format** | **Match the upstream** — this example uses OpenAI Chat Completions (`openai`) |
| Add to pool after creation | Keep checked |

The four values: `openai` (Chat Completions, `/chat/completions`), `openai-responses` (Responses, `/responses`), `anthropic` (Messages, `/v1/messages`), `gemini` (generateContent).

Only `anthropic` adds a **"Claude auth field"** choice:

- `ANTHROPIC_AUTH_TOKEN` — `Authorization: Bearer`, **what most relays use**
- `ANTHROPIC_API_KEY` — `x-api-key`, the official Anthropic style

Try the first when unsure. The `anthropic` dialect also adds `anthropic-version: 2023-06-01` (unless the client supplied it), appends `?beta=true` to messages paths and applies Claude Code client headers to avoid fingerprint rejection. The `gemini` dialect puts the key in the `?key=` query parameter and uses `:streamGenerateContent?alt=sse` for streaming.

> ✅ **Checkpoint**: the account is in the Claude Code platform pool with status "OK".

## Step 2 — Deal with Claude model names

Claude Code's four `/model` slots only accept fixed aliases such as `claude-sonnet-alias` — a client limitation. Map aliases to real upstream models in "Model mappings":

```text
claude-sonnet-alias  →  gpt-4o
claude-opus-alias    →  claude-opus-4-1
```

The proxy rewrites the alias to `to` per account; **third-party clients and Claude SaaS expose the real `to` name**, never the Claude Code alias. That is why ZCode, WorkBuddy, Qoder CLI and similar clients show different model names than Claude Code does.

::: warning A mismatched alias selects nothing
The `from` must exactly match the model name Claude Code actually sends (including the `-alias` suffix). A miss returns `route_pool.model_unmatched` instead of "trying a request anyway". `GET /v1/models` shows the aggregated pool model list, which confirms whether the alias took effect.
:::

### What about 1M context?

Claude 1M context requires the `anthropic-beta: context-1m-2025-08-07` header. The proxy adds it when any of these holds:

- The client appended `[1M]` to the model name (Claude Code's convention); the suffix is stripped before mapping
- **The account serving the request** has "1M" checked on that mapping (`supports_1m`) — deliberately account-scoped, so one account without 1M support does not suppress the suffix for the whole pool
- The platform is Codex and the mapped upstream model is declared or inferred as 1M

Mappings with "1M" checked also expose an extra `alias[1m]` variant in the model list.

## Step 3 — Test, then write Claude Code config

Click **✈** for a real generation test, keep `/v1/messages` and pick the alias from Step 2. On success, expand "View input / output" to confirm the request was rewritten into the upstream dialect and the reply came back as Messages.

Then click **🔌**, tick Claude Code and click **Write**. It edits `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:19527",
    "AI_SWITCH_ROUTE_PROXY": "1",
    "AI_SWITCH_ROUTE_PROXY_API_KEY": "sk-ai-switch-..."
  },
  "aiSwitch": {
    "routeProxy": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:19527",
      "platform": "claude",
      "apiKey": "sk-ai-switch-..."
    }
  }
}
```

The local proxy key can also be sent in an `x-api-key` header. It exists only to identify the platform locally, is stripped before forwarding, and the upstream sees the account's real key.

```bash
claude
```

> ✅ **Checkpoint**: `claude` completes a tool-using turn with no protocol-shape errors.

## Step 4 — Verify the bridge with curl

```bash
curl -N -X POST http://127.0.0.1:19527/v1/messages \
  -H "Authorization: Bearer sk-ai-switch-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-alias",
    "max_tokens": 64,
    "stream": true,
    "messages": [{ "role": "user", "content": "Say hi in three words" }]
  }'
```

`-N` lets you watch Anthropic-style SSE events arrive frame by frame. Set `stream` to `false` for a single JSON response.

> ✅ **Checkpoint**: the reply uses `message_start` / `content_block_delta` / `message_stop`, not upstream `choices` or `response.*` frames.

## Optional — Pin a request to one account

The "Connect to the pool" dialog has a model-list mode switch at the top:

| Mode | List shape | Selection |
| --- | --- | --- |
| Aggregated | `claude-sonnet-alias` | Rotates through the pool |
| Precise | `openai-channel-claude/gpt-4o`, `official/model` | The first pins that API account; the second rotates among all official accounts |

Prefixes are sanitized account names (spaces, `/` and `:` become `-`, non-Latin characters are kept, truncated to 32 chars; collisions get the first 6 chars of the account id). Three things to remember:

- The proxy **accepts prefixed names in any mode**, so switching back to aggregated does not invalidate already-written config.
- If a prefix cannot be resolved, the whole string is treated as a model name — so vendor-path names like `z-ai/glm-5.3` are unaffected.
- **Claude Code's four `/model` slots are unaffected**: they hold a single alias rather than a list and keep rotating. Gemini native paths put the model in the URL and do not parse prefixes either.

Renaming an account requires rewriting client config — the old prefix no longer resolves.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `route_pool.model_unmatched` | The alias mapping's `from` does not match the emitted name | Check the `/model` slot value and add `alias → to` |
| Upstream 404 | Wrong interface format, or base URL missing `/v1` | Re-pick the dialect and verify the base URL from provider docs |
| 401 / 403 | Invalid key, or wrong auth field on an `anthropic` account | For `anthropic`, switch between `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` |
| `1m context is fully available…` | Upstream requires an explicit 1M declaration | Check "1M" on the mapping, or let the client use the `[1M]` suffix |
| Tool results look malformed | Upstream does not support Claude's `tool_use` shape | Bridging converts both ways; inspect live-log stages 2 and 4 to confirm |
| Streaming stalls | Disconnect after the first byte | Enable "auto continuation" in the account failure policy (off by default) |
| Client only sees HTTP 502 | The proxy does not pass through upstream status codes | Read `error.code` in the body and the live logs |
| `route_proxy.platform_unresolved` | No proxy key and no platform header | Add `Authorization: Bearer` or `x-ai-switch-platform: claude` |

::: tip Non-2xx bodies pass through verbatim
Upstream errors are not reverse-converted — you see the original error body. That is intentional for debugging. Outbound requests already force `accept-encoding: identity`, so gzip/br/zstd replies cannot turn into mojibake in the middle.
:::

## Boundary: do not expect Gemini CLI to do this

Gemini CLI sends `/v1beta/models/{model}:generateContent`, which is neither `/responses` nor `/v1/messages`, so it matches none of the three bridge branches and falls through to **passthrough**. This is the current capability boundary: **Gemini CLI can only route to `gemini`-dialect accounts**, and the model-test dialect validation hardcodes the same rule.

Also, only creation endpoints are bridged. `/v1/models` and `/models` are answered locally from the aggregated pool list (`owned_by` is always `ai-switch`), never forwarded upstream, and only accept `GET`.

## What next

- [Protocol Routing and Bridging](/en/guide/protocol-routing): the full bridge matrix, model mapping, 1M declaration, tool namespace flattening and forwarding order
- [Run Codex on a Chat relay](./codex-with-chat-relay): the symmetric route on the other side
- [Platform Support Matrix](/en/guide/platform-support): which native config file each of the 7 platforms writes
- [Model Connectivity Tests](/en/guide/model-test): what each field in the test result means
