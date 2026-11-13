---
title: Usage, Spend and Reconciliation
description: "Understand AI Switch's six metric cards and request list, configure custom model prices, distinguish upstream prices from local estimates and no-price rows, and run a monthly reconciliation."
---

# Usage, Spend and Reconciliation

**Goal**: be able to explain every number in the Stats panel, calibrate local estimates, and know why they are not a bill.

**You need**: some real traffic (ideally two accounts and at least one estimated-price model); [Your first request](./first-request) completed.

**Definition of done**: you can identify the price source of any request, turn a "no price" row into a priced one with a custom price file, and explain why Stats and local session usage cannot be added together.

## Start with one mental model

Every forward — **success or failure** — writes one row to `usage_events`:

```text
metric_type = 'request'   amount = 1   unit = 'count'
input_tokens / output_tokens / cache_tokens
price_usd_micros / price_cny_micros / price_currency / price_source
source_label: route_proxy | route_pool_model_test | route_pool
```

Prices are integer **micros** (1 USD = 1,000,000 micros) to avoid floating-point accumulation error while keeping six decimal places. USD and CNY have separate columns, and `price_currency` records which currency the upstream reported.

::: warning Manual tests are in the same stats
Model connectivity tests (`route_pool_model_test`) and real forwards (`route_proxy`) share the table and the same `metric_type`; **the Stats panel does not separate them**. Clicking ✈ often inflates the request count, and only the "Source" column in the request list tells them apart.
:::

## Step 1 — Read the four windows and six cards

Switch the bottom view to Stats and pick a time range:

| Option | Start point |
| --- | --- |
| Today | Local time, today at 00:00:00 |
| This week | Monday 00:00:00 local time (Sunday counts as last week) |
| This month | The 1st at 00:00:00 |
| All time | No lower bound |

The SQL is a single `AND ue.created_at >= ?` — **a start point with no end point**. All four options are cumulative values since a moment in time, not bucketed statistics.

| Card | Definition | Easy to misread |
| --- | --- | --- |
| Requests | Sum of `metric_type = 'request'` events | Includes manual tests |
| Input tokens | Sum of `input_tokens` | `NULL` when the upstream omitted usage; shown as `-`, **never reverse-engineered from character counts** |
| Output tokens | Sum of `output_tokens` | Same |
| Cache tokens | Sum of `cache_tokens` | Most upstreams report one combined number, not read/write split |
| Total tokens | Sum of `input + output`, **plus legacy `token` events** | **Excludes cache tokens**; may slightly exceed input+output because of legacy rows |
| Total cost (USD) | All currencies converted to USD micros | CNY converted at a **fixed 7.1 rate** — a reference figure when currencies are mixed |

::: tip Small amounts get extra decimals
The total-cost card adds decimal places automatically so a real sub-cent charge does not round to `$0.00`. Each row in the request list shows the **original amount in the original currency** (`$` for USD, `¥` for CNY, six decimals) — that number is the precise one.
:::

## Step 2 — Audit row by row in the request list

Below the cards, the request list is sorted by `created_at DESC, id DESC`, **20 rows per page**, refreshing every **5 seconds** while the panel is open.

Each row: time, **account name**, status, path, model, total tokens, price, source and details. Three columns are especially useful:

- **Account name** — instant proof that priorities are right; during failover this switches to the backup
- **Model** — shown as `requested->upstream` when they differ, which is the evidence that mapping took effect
- **Price** — "est." means a local estimate; `-` means no price at all

Expand "Details" for account id, input/output/cache tokens, price, time, plus two raw blocks: the upstream response preview (first 2 KiB for successes, 16 KiB for failures) and the full `metadata_json`. The latter includes `target_url`, `status`, `success`, `duration_ms`, `trace_id`, `error_message`, `requested_model` / `upstream_model` and more.

::: details Two keys if you query the database yourself
Newly written rows store the response preview in `metadata_json.response_body_br` (brotli-compressed then base64); rows written before that upgrade use plaintext `response_body`. Reading only `response_body` makes every compressed row look like "no response body" — diagnostic scripts must recognize both.
:::

## Step 3 — Distinguish the three price sources

`price_source` tells you how to read an amount:

| Value | Meaning | UI |
| --- | --- | --- |
| `upstream` | The upstream response carried an explicit price | Displayed normally |
| `estimated` | Computed locally from tokens and the price table | Suffix "est." |
| `NULL` | No price at all | Displays `-` |

Priority is strict: **an upstream price always wins and is never overwritten**. Estimation only happens when both price columns are empty. Official Anthropic, OpenAI and Gemini APIs return token counts but no price, so those requests are almost always "est.".

Price parsing also has alias fallbacks: `price_usd_micros` / `cost_usd_micros` / `cost_micros` are already micros, while `price_usd` / `cost_usd` are multiplied by 1,000,000. A generic `price` / `cost` object is currency-detected first (`usd`/`dollar`/`$` → USD, `cny`/`rmb`/`yuan`/`¥` → CNY).

::: warning Unknown models are not free
A model missing from the price table is **not treated as zero** — `price_source` stays `NULL`, the amount is excluded from the total, and the panel separately reports how many requests went unpriced. That keeps "missing price data" distinguishable from "genuinely free".
:::

## Step 4 — Configure a custom price table

Relay discounts and models not yet in the built-in table can be overridden in `~/.ai-switch/model-prices.json`:

```json
{
  "claude-opus-5": { "input_per_mtok": 4.0, "output_per_mtok": 20.0 },
  "claude-sonnet": { "input_per_mtok": 1.5, "output_per_mtok": 7.5 },
  "my-relay/gpt-4o": { "input_per_mtok": 0.8, "output_per_mtok": 2.4 }
}
```

Units are **USD per million tokens**. Keys can be full model ids or model families (`claude-sonnet` matches every Sonnet). The built-in table matches by family, with cache tokens priced by Anthropic's published rule: **cache write = input price × 1.25, cache read = input price × 0.1**.

Before matching, model ids are normalized: vendor prefixes are stripped (`anthropic/claude-opus-5-aws` → `claude-opus-5-aws`) and `[1m]` suffixes removed; **longest pattern wins**, so `claude-haiku-4-5` is not captured by the broader `claude`.

> ✅ **Checkpoint**: send one more request and the row that showed `-` now shows an "est." amount.

::: tip A missing file is normal
Not creating this file is not an error. A malformed file **silently falls back to the built-in table**, and negative or invalid numbers are discarded instead of polluting totals. If a change "did nothing", check the JSON syntax and the model name first.
:::

Estimates are still estimates: upstreams usually report a single cache token number without splitting reads and writes, so estimation uses the cheaper read price and errs on the conservative side.

## Step 5 — Run a monthly reconciliation

1. **Pick the window**: Stats → "This month". Remember it has a start point but no end point; do not treat it as a bucket.
2. **Filter test traffic**: use the "Source" column to set aside `route_pool_model_test` and `route_pool` rows — those are manual tests, not business traffic.
3. **Group by account**: the account name column identifies the credential that served traffic; compare it with each provider's billing dashboard.
4. **Separate three amount classes**: `upstream` (real price), "est." (local estimate), `-` (no price). **Only the first can be compared directly with a bill.**
5. **Check the rate**: the total-cost card converts CNY to USD at a fixed 7.1, so mixed currencies drift from the real bill; per-row original-currency amounts are more accurate.
6. **Do not add platforms together**: stats queries are isolated by `platform`, with no cross-platform aggregate view. Record each platform separately.
7. **Do not archive accounts**: archiving immediately removes that account's historical events from stats because of the `INNER JOIN`. Leave archiving until reconciliation is done.

::: warning Account-row success rates use a different definition
Request counts and success rates on account rows only include `route_proxy` and `route_pool_model_test`, and are **all-time cumulative** — they do not follow the Stats time selection. The same account can therefore show different numbers in "Today" Stats and in the account list. Not a bug.
:::

## Step 6 — Read local session usage correctly

The lower half of Stats, "Local session usage", reads CLI session files **read-only** — AI Switch never modifies or deletes them:

| Client | Path | Env override |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |

The two formats need completely different counting rules: Claude Code must deduplicate by `message.id` (continuations and context compaction rewrite the same message into multiple files — without dedup, a real dataset inflated by 93%); Codex's `total_token_usage` is a **session cumulative value**, so only the last one counts (summing them inflated a real file 350×). Session cost is **always an estimate**, and cache write/read get separate cards.

::: danger Do not add the two sets of numbers
Route stats show "traffic through this proxy"; session usage shows "all CLI spend on this machine". A Claude Code request that went through the proxy is recorded **by both**, so they are two perspectives, not two parts of a sum.
:::

The first scan can take over a hundred seconds (per-file mtime+size caching brings warm scans to about 1 second); refresh is **60 seconds** (route stats refresh every 5). Above 50,000 files the scan truncates and the panel explicitly says the numbers are incomplete.

## Step 7 — When the database grows

`response_body` / `response_body_br` are the largest items and are never cleaned up automatically. Since success, duration, token and price values are already separate columns, **deleting response previews does not change any stat**.

Settings → "Usage history storage → Clear cached response content" offers 7 / 30 / 90 days or "All". It runs in batches with independent transactions, is interruptible and resumable, and only rewrites `metadata_json` — rows and all other fields stay intact.

::: warning Clearing is not shrinking
Deletion turns bytes into SQLite free pages for reuse. Actually returning space to the filesystem requires the "Optimize database" action (`VACUUM`). Run that after clearing to see the file size drop.
:::

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Price shows `-` | Upstream reported no price and the model is absent from the built-in table | Add `~/.ai-switch/model-prices.json` |
| Tokens show `-` | Upstream response had no usage block | Intentional — AI Switch never infers tokens from character counts; use an upstream that reports usage |
| Every amount is "est." | The upstream (official APIs) reports tokens but no price | Normal; calibrate with a custom price table |
| Total cost far from the bill | Fixed 7.1 CNY rate + estimates + test traffic | Check per-row original-currency amounts and exclude test sources |
| Total tokens exceeds input+output | Legacy standalone `token` events are included | Existing definition, not a double-count bug |
| Request count unexpectedly high | Frequent ✈ connectivity tests | Check the "Source" column, test less |
| Historical numbers vanished after archiving | Stats `INNER JOIN` non-archived accounts | Unarchive |
| Session usage spins on first open | Cold scan over thousands of jsonl files | Wait once; subsequent scans use the cache |
| File size unchanged after clearing previews | Free pages not returned | Run "Optimize database" (VACUUM) |

## What next

- [Usage and Request Stats](/en/guide/usage-stats): full definitions of every table and SQL aggregate
- [Reliability and Auto Recovery](/en/guide/reliability): how failed requests are marked and recorded
- [Model Connectivity Tests](/en/guide/model-test): field differences between test and forward events
- [Build a pool that never stalls](./failover-pool): spotting failover by account name during reconciliation
