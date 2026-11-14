---
title: Tutorial Hub
description: "Six hands-on AI Switch guides: your first request, Codex on a Chat relay, a self-healing route pool, any upstream for Claude Code, usage and cost reconciliation, and remote or team deployment."
---

# Tutorial Hub

These are not feature reference pages — they are **guides you can follow end to end**. Every one has an explicit definition of done, copy-pasteable commands and a troubleshooting table, so you can confirm the setup actually works.

If you have not installed the app yet, start with [Installation](/en/guide/installation) and [Quick Start](/en/guide/quick-start). The guides assume you can open the AI Switch main window and have at least one working upstream account (a base URL and an API key, from a relay provider or an official API).

<div class="tutorial-grid">
  <a class="tutorial-card" href="./first-request.html">
    <div class="tc-head"><span class="tc-tag">Start</span><span class="tc-time">5 min</span></div>
    <span class="tc-title">Your first request</span>
    <span class="tc-desc">Install the app, add a route account, start the proxy, write CLI config and see the request show up in usage stats.</span>
    <span class="tc-more">Open the guide →</span>
  </a>
  <a class="tutorial-card" href="./codex-with-chat-relay.html">
    <div class="tc-head"><span class="tc-tag">Protocol</span><span class="tc-time">8 min</span></div>
    <span class="tc-title">Run Codex on a Chat relay</span>
    <span class="tc-desc">Only have an OpenAI-compatible third-party key? Bridging makes it work with Codex without touching CLI config.</span>
    <span class="tc-more">Open the guide →</span>
  </a>
  <a class="tutorial-card" href="./failover-pool.html">
    <div class="tc-head"><span class="tc-tag">Advanced</span><span class="tc-time">10 min</span></div>
    <span class="tc-title">Build a pool that never stalls</span>
    <span class="tc-desc">Primary, backup and last-resort tiers plus concurrency caps, cooldown and automatic recovery for invisible failover.</span>
    <span class="tc-more">Open the guide →</span>
  </a>
  <a class="tutorial-card" href="./claude-with-any-upstream.html">
    <div class="tc-head"><span class="tc-tag">Protocol</span><span class="tc-time">8 min</span></div>
    <span class="tc-title">Any upstream for Claude Code</span>
    <span class="tc-desc">The Messages entry can reach any pool — connect Claude Code to OpenAI- or Gemini-speaking accounts.</span>
    <span class="tc-more">Open the guide →</span>
  </a>
  <a class="tutorial-card" href="./usage-and-cost.html">
    <div class="tc-head"><span class="tc-tag">Ops</span><span class="tc-time">7 min</span></div>
    <span class="tc-title">Usage, spend and reconciliation</span>
    <span class="tc-desc">Understand the six metric cards and request list, set custom model prices, and tell real prices from estimates.</span>
    <span class="tc-more">Open the guide →</span>
  </a>
  <a class="tutorial-card" href="./remote-and-team.html">
    <div class="tc-head"><span class="tc-tag">Deploy</span><span class="tc-time">12 min</span></div>
    <span class="tc-title">Phone access and team servers</span>
    <span class="tc-desc">Four paths — Web service, Tailscale Funnel public access, standalone server and Docker. Pick the one that fits.</span>
    <span class="tc-more">Open the guide →</span>
  </a>
</div>

## Pick by scenario

| Your situation | Start here |
| --- | --- |
| First time opening AI Switch, no request sent yet | [Your first request](./first-request) |
| Codex only works with official accounts; relay keys fail | [Run Codex on a Chat relay](./codex-with-chat-relay) |
| The primary account keeps hitting 429 or running out of quota | [Build a pool that never stalls](./failover-pool) |
| Want Claude Code on a cheaper OpenAI or Gemini route | [Any upstream for Claude Code](./claude-with-any-upstream) |
| Several accounts, unsure where the money goes | [Usage, spend and reconciliation](./usage-and-cost) |
| Want it on a phone, or shared by a team | [Phone access and team servers](./remote-and-team) |

## Conventions used across the guides

A few things appear in every guide, so they are defined once here:

- **Local proxy address**: `http://127.0.0.1:19527`. If the port is taken it increments upwards; use the address shown in the UI.
- **Local proxy key**: looks like `sk-ai-switch-<uuid>`, copied from the "Connect to the pool" dialog, **one per platform**. It is only used for local identification and never reaches the upstream.
- **Interface format**: describes which protocol the **upstream** speaks, not the CLI. Pick one of `openai` (Chat Completions), `openai-responses` (Responses), `anthropic` (Messages), `gemini` (generateContent) according to your provider's docs.
- **Route pool**: every platform has its own pool and its own proxy key. Switching platforms means adding accounts and copying a new key.
- **The verification trio**: the ✈ real generation test in the toolbar, live logs in the dropdown menu, and the request list in the Stats view. The first tells you whether the chain works, the second shows how the request was rewritten, the third shows which account served it.

::: tip Where to look when something breaks
The proxy returns HTTP **502** for "all accounts failed" and "no account matches this model" alike. The real clue is in `error.code` inside the response body, for example `route_pool.model_unmatched` or `route_pool.model_unavailable`. When the CLI only shows 502, check live logs or the request list.
:::

## Learn it systematically

Guides answer "how"; the docs answer "why". A good reading order:

1. [What is AI Switch](/en/guide/introduction) — the local proxy, route pool and protocol bridging
2. [Accounts and the Pool](/en/guide/accounts) — priority, concurrency and the state machine
3. [Protocol Routing and Bridging](/en/guide/protocol-routing) — all seven bridge routes and the full forwarding order
4. [Reliability and Auto Recovery](/en/guide/reliability) — failure classes, two cooldown levels, scheduled and health-check recovery
5. [Usage and Request Stats](/en/guide/usage-stats) — the exact definition of every number
6. [FAQ](/en/faq) — platform support, key safety, Tailscale, backups and more

## Still stuck

- Building on the project? The "Developers · Extending" column in the home page footer links to [Architecture](/en/dev/architecture), [Local Setup](/en/dev/local-setup), [Release Process](/en/dev/release) and the [Relay Integration Spec](/en/relay/spec).
- No answer yet? Open a [GitHub Issue](https://github.com/ai-switch/ai-switch/issues) or a [Discussion](https://github.com/ai-switch/ai-switch/discussions) and include the `error.code` and trace id from live logs — that is the fastest way to get a diagnosis.
