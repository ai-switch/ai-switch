---
title: Run Codex on a Chat Relay
description: "You have an OpenAI Chat Completions relay key but Codex only speaks Responses API. This guide wires the ResponsesToChat bridge end to end, with model mapping, real generation tests, live logs and troubleshooting."
---

# Run Codex on a Chat Relay

**Goal**: run Codex — including tool calls and streaming — through a relay account that only supports Chat Completions, without changing a single line of Codex config.

**You need**: an OpenAI-compatible (`/chat/completions`) upstream account; Codex and AI Switch installed; [Your first request](./first-request) completed is helpful but not required.

**Definition of done**: Codex completes a tool-using turn; live logs show a Chat Completions request body in stage 2 and a Responses-shaped reply in stage 4.

## Why editing the config cannot work

Codex always sends a Responses API request (`POST /responses`, with `input`, `tools` and `response.*` events). A Chat relay only accepts `POST /chat/completions` (`messages`, `tools`, `choices[].delta`). Point the base URL at it and you get a 404 or 400 — **this is a protocol shape problem, not a key problem**.

AI Switch inserts a local layer: the entry keeps speaking Responses, and when the selected account uses the `openai` dialect the route becomes `ResponsesToChat`. The request is rewritten into Chat Completions and the upstream answer (including SSE frames) is replayed as a Responses event sequence. Of the seven bridge routes, this is the most commonly used.

```text
Codex ── /responses ──> local proxy ── /chat/completions ──> relay
      <── response.* ──              <── choices[].delta ───
```

Only creation endpoints are bridged. Paths like `/models` are answered directly with the aggregated pool model list and never forwarded upstream.

## Step 1 — Create the account with the upstream protocol

In **Agents → Codex**, click **+**, stay on the "API account" tab:

| Field | Value |
| --- | --- |
| Name | `chat-relay-codex` |
| API Key | The key from your relay |
| Base URL | e.g. `https://your-relay.example.com/v1` |
| **Interface format** | **OpenAI Chat Completions (`openai`)** |
| Add to pool after creation | Keep checked |

::: warning The field people get wrong
"Interface format" describes which protocol the **upstream account** speaks, not which one Codex speaks. A Chat Completions relay is `openai` even when the client is Codex. Choosing `openai-responses` sends the request to an upstream `/responses` path that does not exist, producing a 404.
:::

> ✅ **Checkpoint**: the account appears in the pool showing Chat Completions as its interface format.

## Step 2 — Add a model mapping (usually required)

The model Codex requests by default (e.g. `gpt-5.5`) rarely matches what the relay actually offers (`gpt-4o`, `claude-sonnet-4`, …). Add one entry under "Model mappings":

```text
gpt-5.5  →  gpt-4o
```

Skip this only when the upstream model name is identical to the CLI's.

::: tip Mapping also decides routing
The proxy first checks whether any account in the pool supports the requested model; if none does it returns `route_pool.model_unmatched` and **does not blindly send a request**. Mapping is therefore not just renaming — it is how selection finds a candidate. Several accounts mapped to the same alias rotate between each other.
:::

> ✅ **Checkpoint**: the model list in the 🔌 dialog contains `gpt-5.5` (aggregated mode lists client-visible aliases, not upstream names).

## Step 3 — Prove the chain with a real generation test

Click **✈** ("Real generation test of pool routing"), keep `/responses`, pick the alias from Step 2 and click **Start test**.

Expand "View input / output" to see the bridge in action:

| Stage | What you should see |
| --- | --- |
| Sent to proxy | Responses shape: `input`, possibly `tools` |
| Sent upstream | A `messages` array, `model` replaced by the mapped name |
| Raw upstream reply | `choices[0].message` or `choices[0].delta` |
| Returned to client | Responses shape: `output` / `response.completed` |

> ✅ **Checkpoint**: the test passes, the chain names `chat-relay-codex` and the upstream endpoint is `/chat/completions`.

On failure the error tells you which link broke: `transport` is networking, `upstream_status` is a non-2xx from upstream, `request_build` is request construction during bridging, `response_transform` is the reverse conversion.

## Step 4 — Write Codex config and run it

Click **🔌**, tick Codex and click **Write**. It edits `~/.codex/config.toml`:

```toml
model_provider = "ai-switch"

[model_providers.ai-switch]
base_url = "http://127.0.0.1:19527/v1"
wire_api = "responses"
experimental_bearer_token = "sk-ai-switch-..."
```

Note `wire_api = "responses"` — **Codex always speaks Responses**. Translation happens inside the proxy; the client never needs to know the upstream is Chat-shaped. The write uses snapshots and atomic replacement, preserving your other settings.

```bash
codex
```

Ask Codex to do something that triggers a tool call (for example "read package.json in this directory and summarize it"). Tool calls are where bridging most often goes wrong.

> ✅ **Checkpoint**: Codex reads the file, gets the result, and reports no tool-related errors.

## Step 5 — Confirm all four stages in live logs

Open **Live logs** from the toolbar dropdown and re-send a request:

1. **Original client request** — Responses format
2. **Rewritten upstream request** — `messages` and flattened `tools`
3. **Raw upstream response** — Chat Completions format
4. **Final response to client** — `response.*` events

Several less visible but important things also happen on this route:

- **Custom tool compatibility is automatic**: third-party gateways usually reject Codex custom tools and OpenAI-hosted tools (`web_search`, `code_interpreter` and five others). Codex + `openai` dialect + Responses path automatically rewrites custom tools into plain function tools, strips hosted tools, and restores them on the way back; a `tool_choice` pinned to a stripped tool is relaxed to `"auto"`.
- **Tool namespaces are flattened**: Responses supports `namespace` groups while Chat only has a flat function list, so tools become `namespace__tool` and are restored from the same mapping on return.
- **Reasoning content is backfilled**: reasoning models such as DeepSeek and MiMo require `reasoning_content` on assistant messages carrying tool calls, otherwise they return 400. The proxy caches and restores it across multi-round tool calls so the model does not lose its plan.
- **Streaming is replayed**: upstream `choices[].delta` frames become `response.created` → `response.output_text.delta` → `response.completed`, and the upstream `[DONE]` marker is stripped because Responses does not use it.
- **Fingerprint and compression**: outbound requests get Codex client headers (including `x-codex-window-id`) and force `accept-encoding: identity`, so an upstream gzip response cannot turn into mojibake downstream.

::: warning Non-2xx responses are not converted
When the upstream errors, the body is **passed through verbatim** — you see the original error, not a rewritten Responses shape. That is intentional: debugging needs the original text. A client-side error body that "does not look like Responses" is therefore normal.
:::

## Optional — Verify with curl, bypassing the CLI

```bash
curl -N -X POST http://127.0.0.1:19527/responses \
  -H "Authorization: Bearer sk-ai-switch-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "input": "Say hello in five words",
    "stream": true
  }'
```

`-N` disables buffering so you can watch `response.output_text.delta` arrive frame by frame. Set `stream` to `false` for a single JSON response.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Upstream 404 / route not found | Interface format set to `openai-responses`, or wrong base URL | Switch to `openai`; check whether the provider's base URL already includes `/v1` |
| `route_pool.model_unmatched` | No model mapping, or the alias is misspelled | Add `CLI model → upstream model`, exactly matching the request's `model` |
| `This account only allows Codex official clients` | Relay validates client fingerprints | Headers are added automatically; if the account has a custom `User-Agent`, spoofing yields to it — remove the custom UA |
| 401 / 403 | Invalid key, restricted key missing scopes, or exhausted quota | Verify the key; restricted keys missing `api.responses.write` can work with the Chat Completions format instead — see [Reliability and Auto Recovery](/en/guide/reliability) |
| `custom tool not supported` from upstream | Gateway rejects Codex custom tools | Compatibility is automatic on this route; check that `responses_custom_tool_compat` was not disabled in the account config |
| Model "forgets" the plan across tool rounds | Upstream requires `reasoning_content` | The proxy backfills it; make sure no intermediary strips the field |
| Only HTTP 502 visible | The proxy does not pass through upstream status codes | Read `error.code` and stage 3 of live logs for the upstream text |
| Streaming stalls halfway | Disconnect after the first byte | Enable "auto continuation" in the account failure policy; it is off by default because a continuation is a fully billed request |
| Codex cannot read the local root certificate | You wrote `https://` into base URL manually | Use `http://`; the HTTPS endpoint is only for clients that require TLS and trust the local CA |

## Boundaries: what this route does not cover

- **Gemini CLI is not bridged.** It sends `/v1beta/models/{model}:generateContent`, which is neither `/responses` nor `/v1/messages`, so it falls through to passthrough and can only reach `gemini`-dialect accounts.
- **The Messages entry is path-based, not platform-based.** `/v1/messages` can reach any pool — see [Any upstream for Claude Code](./claude-with-any-upstream).
- **Matching protocols do not always mean passthrough.** Codex → `openai-responses` is still a `ResponsesToResponses` bridge, because third-party Responses gateways need a cleaning pass.

## What next

- [Protocol Routing and Bridging](/en/guide/protocol-routing): the full bridge matrix and forwarding order
- [Model Connectivity Tests](/en/guide/model-test): what every field in the test result means
- [Build a pool that never stalls](./failover-pool): add accounts so this route survives rate limits
- [Usage, spend and reconciliation](./usage-and-cost): how bridged requests are priced
