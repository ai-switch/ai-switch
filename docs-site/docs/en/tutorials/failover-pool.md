---
title: Build a Pool That Never Stalls
description: "A self-healing AI Switch route pool with three priority tiers, concurrency caps, failure cooldown and auto recovery, plus a full failure drill, badge meanings and error code reference."
---

# Build a Pool That Never Stalls

**Goal**: when the primary account is rate-limited or unreachable, traffic falls through to a backup without the client noticing — and the primary returns to the pool on its own later.

**You need**: at least two working accounts on the same platform (a third is optional); [Your first request](./first-request) completed.

**Definition of done**: after you deliberately break the primary, the next row in the request list names the backup account and the client sees no error; after recovery the primary is selected again.

## Three scheduling rules to know first

Selection is not "pick one at random". The order is fixed:

1. **SQL-level filter**: in the pool, enabled, not archived, `status = ok`, quota empty or greater than zero.
2. **Platform capability + model filter**: some account must support the requested model, otherwise `route_pool.model_unmatched`.
3. **Cooldown bucketing**: rotate within priority tiers, skipping cooling, paused and errored objects.

Priority tiers are **strict**: tier 2 is only used once every tier 1 account is unavailable. Within a tier the list order drives round robin (drag rows in the pool view to change it), and concurrency caps are hard limits — saturated accounts are skipped.

::: warning One pool per platform
Codex, Claude Code and Gemini CLI each have their own pool and their own proxy key. The three tiers in this guide must live **inside one platform**; pools do not back each other up across platforms.
:::

## Step 1 — Split accounts into three tiers

For each account, open "Edit account" → "Advanced" and set **route priority** (1–5, default 3, lower is higher) and **max concurrency** (UI default 5, minimum 1):

| Role | Priority | Suggested cap | Notes |
| --- | --- | --- | --- |
| Primary: cheap, stable, large quota | **1** | Per provider limits; 1–2 for official accounts | Carries all normal traffic |
| Backup: pricier or smaller quota | **3** | Same as primary | Used only when all tier-1 accounts fail |
| Last resort: expensive, emergency only | **5** | 1 | Exists purely to avoid an outage |

Multiple accounts in one tier share load through in-tier round robin. Dragging rows changes the **in-tier** starting point, never crosses priority tiers.

> ✅ **Checkpoint**: the pool list shows tiers 1 / 3 / 5 and all three accounts are "OK".

::: tip Only one account yet?
Configure the failure policy and auto recovery now, then add priorities when a second account arrives. Failover itself needs at least two candidates — with one account it only does same-account retries.
:::

## Step 2 — Tune the failure policy

Edit account → "Advanced" → "Failure handling" → "Failure policy". Defaults suit most cases, but know what each does:

| Field | Default | Effect |
| --- | --- | --- |
| `retry_count` | 2 | Same-account retries before moving on |
| `retry_interval_ms` | 200 | Wait between same-account retries |
| `semantic_error_threshold` | 10 | Same-fingerprint semantic failures before a model is marked `error` |
| `failover_enabled` | `true` | Whether to fall through to other accounts |
| `stream_continue_enabled` | `false` | Auto-continue after a mid-stream disconnect (**a fully billed request**) |
| **Enable failure cooldown** | **Off by default** | When off, failures only increment counters; no cooldown timestamps are written |
| Cooldown seconds | 10 | Fixed window after each transient failure, range 1–86400 |

**Recommendation**: enable cooldown on the primary at 10 seconds to start; leave the backup at defaults. Cooldown is fixed, not escalating — one blip costs seconds, not minutes.

::: warning 401 / 403 never retry on the same account
Retrying an auth failure only trips upstream risk controls faster, so the proxy records the failure and switches accounts immediately. A mistyped key will therefore burn through every account quickly — do not use that as your failure drill.
:::

## Step 3 — Configure auto recovery

The same "Failure handling" section offers three recovery modes:

| Mode | Behaviour | Best for |
| --- | --- | --- |
| `off` (default) | No automatic recovery | Full manual control |
| `scheduled` | Reactivates unconditionally at fixed local times (`HH:MM`) | Providers that reset quota daily — set the time just after the reset |
| `healthcheck` | Runs a real model connectivity test at a fixed interval; **only a pass restores** — default 30 min | Uncertain rate-limit windows |

The scheduler ticks every 30 seconds and handles midnight rollover and machines that slept for days correctly. A good combination: **primary on `healthcheck` (15–30 min), backup on `scheduled` (after quota reset), last resort `off`** — probes consume a little quota and leave a request event in stats, so the last-resort account need not be probed constantly.

::: details Why there are two cooldown levels
Cooldown is **model-level by default**: relays often rate-limit just one model, and cooling the whole account would take down healthy models on the same key. Only `refresh`, `request_build`, `transport`, 401/403, quota exhaustion and missing scopes are recorded straight at **account level**; when every serviceable model on an account becomes unavailable, it escalates to account-level cooldown.

That is why the UI has two non-overlapping badges: `Cooling Ns` (whole-account backoff) and `N models unavailable` (some models cooling, errored or paused). Hover the latter for a per-model breakdown.
:::

## Step 4 — Run a failure drill (the important part)

Do not wait for a real incident to discover a misconfiguration.

1. Click **✈** once and note which account served the test (it should be the tier-1 primary).
2. Edit the primary and **temporarily change its Base URL** to `http://127.0.0.1:9/v1` (an address that cannot connect). This produces a `transport` transient failure without consuming upstream quota.
3. Send two or three ordinary requests from the CLI (do not use ✈ — test events pollute the stats).
4. Open Stats and look at the **account name** column in the request list.

> ✅ **Checkpoint**: later requests land on the tier-3 backup, the client reports no error, and the primary row shows a `N errors` label.

5. Restore the primary's Base URL. With `healthcheck`, wait one probe interval — or simply run one explicit ✈ test against that account, which performs a full recovery on success. With `scheduled`, you can also click the `Cooling Ns` badge → "Clear cooldown now" to recover manually.
6. Send another request and confirm the account name is back to the primary.

::: tip Three quota-free manual recovery paths
- Click the `Cooling Ns` badge to adjust the remaining seconds or clear it immediately (account level only)
- Edit drawer → "Failure handling" → "Model status" → `Clear` on a model (clears model-level cooldown and errors)
- One explicit ✈ model connectivity test against a single account restores it on success (consumes one request)
:::

## Step 5 — Read the labels and error codes

Account row labels are the first place to look when debugging:

| UI label | Meaning |
| --- | --- |
| `N errors` | Consecutive transient failures; cleared by the next successful request |
| `Cooling Ns` | Remaining account-level cooldown; click to adjust or clear |
| `N models unavailable` | Count of models cooling + `error` + `paused`; hover for details |
| `Revoked` / `Error` / `Paused` | States `revoked` / `error` / `paused`; not overwritten automatically |

Client-side error codes (all inside the `error.code` of an HTTP **502** body — the proxy does not pass through upstream status codes):

| Code | Meaning | Fix |
| --- | --- | --- |
| `No enabled route credentials in pool` | No usable account in the pool | Check whether all are disabled, archived or not `ok` |
| `route_pool.model_unmatched` | No account maps this model | Add a model mapping |
| `route_pool.model_unavailable` | Accounts support it, but the model is paused or errored on all | Clear it in "Model status" |
| `route_pool.concurrency_exhausted` | All accounts at their concurrency cap | Raise the cap or add an account |
| `route_pool.access_disabled` | Route proxy access disabled on a standalone server | Re-enable it in the panel |

::: warning Cooldown does not automatically mean a failed request
If no usable account remains, the scheduler **picks the cooling account that recovers soonest and tries it once** instead of failing outright. That is deliberate: the backoff window is an estimate and the upstream may already be healthy. But `paused` and `error` are verdicts, hard-excluded to the end — they never take part in this fallback probe.
:::

## Failure classification cheat sheet

| Class | Trigger | Consequence |
| --- | --- | --- |
| Transient | 408 / 401 / 403 / 429 / any 5xx / connection, DNS, TLS or timeout errors | Same-account retry → record failure → cooldown → switch account |
| Permanent | `invalid_grant`, `token has been revoked` and other credential-voiding text | State set to `revoked`, no backoff, **never auto-recovered** |
| None | 400 bad request, 404 route not found | No failure counter, account state untouched |
| Semantic | HTTP 200 whose body is a failure; SSE stream cut before the completion event | Marked failed and accumulated by fingerprint |
| Quota exhausted / missing scopes | Fixed text patterns or `error.code` | Threshold hardcoded to 1 — **one strike sets `error`** |

Outbound requests also have two limits: a 20-second connect timeout and a 180-second read-interval timeout (reset on every successful read). An upstream that connects and then never sends a byte becomes a switchable failure instead of hanging the client forever.

## Three things to remember long term

- **Success clears state, asymmetrically**: a successful forward clears all account-level failure traces, but at model level it deletes **only the model that was hit** — never its siblings. Passing a test on model A says nothing about model B.
- **Archiving hides history**: stats use an `INNER JOIN` against non-archived accounts, so archiving makes historical events disappear immediately; unarchiving brings them back. Do not archive before reconciliation.
- **`paused` is a user decision**: neither scheduled recovery nor success cleanup overrides a manual pause. Only you can clear it.

## What next

- [Reliability and Auto Recovery](/en/guide/reliability): exact rules for failure classes, two cooldown levels, three recovery modes and a full incident timeline
- [Accounts and the Pool](/en/guide/accounts): state machine, priorities, concurrency caps and bulk actions
- [Usage, spend and reconciliation](./usage-and-cost): telling drill traffic apart in stats
- [Model Connectivity Tests](/en/guide/model-test): the same test logic behind explicit recovery
