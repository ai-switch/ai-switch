# Plugin → standalone sync (v0.1.6–v0.1.8 features) — 2026-11-17

## Scope

Ported the recent plugin (otools-ai-switch) changes that postdate the
standalone's shared-file baseline (499d9bc) into `open/ai-switch`, preserving
standalone-only deltas (shared-listener web service, keep-login Codex config
writing, imagegen inline naming, multi-group queries, port 19527):

- **Traffic visualization**: route proxy active-attempt registry (epoch UUID +
  sequence + RAII guards + generation cancel), `RouteProxyLiveLog.client_key`,
  account summaries with live request counts, snapshot/event RPC, three-column
  single-screen TrafficScreen, TrafficDialog, geometry/simulation libs, i18n
  keys, nav entry (Network icon), CodexChannelsScreen → AccountsScreen entry.
- **Key suffix recognition**: `split_route_proxy_client_key` per-account keys
  (`base.client`), strict `resolve_platform_with_client` (plugin HEAD
  semantics), video-route suffix handling, registry event emission.
- **Official client logos**: WorkBuddy/WorkBuddy AI, CodeBuddy CLI, ZCode,
  Qoder CLI/CN verified artwork in `public/brand/`, `AgentLogo` local-asset
  map, `agent-logo-sources.md`, LICENSES additions, THIRD_PARTY_NOTICES
  "Agent identification artwork" section.
- **Client setup / pinned write footer** and usage overview panel sync.
- **Account selection strip**: header select-all checkbox removed; the
  operation strip keeps its conditional visibility (appears only with ≥1
  selected account; 全选 / 反选 / 取消选择 buttons).

## Transport wiring (standalone-specific)

- Tauri commands: `get_route_proxy_pool_member_ids`,
  `get_route_proxy_active_attempts`, `list_route_proxy_account_summaries`
  registered in `desktop.rs` **and** the web dispatcher
  (`web/handlers/mod.rs`), so the command-contract test passes for both
  transports.
- Active-attempt events emit through `EventEmitter::Tauri`; tests adapted to
  the tokio broadcast `WebEventBroadcaster` (`subscribe`/`try_recv`,
  `{"channel", payload}`).
- The shared web listener keeps its admin diagnostic override: a panel-token
  caller with `x-ai-switch-platform` now resolves via
  `with_platform_scope` (the plugin's own trusted-caller pattern) instead of
  the removed header fallback; public callers stay strict
  (`key_invalid` / `platform_unresolved` → 401).
- `ImageGenerationService::execute` uses platform scope instead of the
  `x-ai-switch-platform` header, matching the plugin's
  routes-without-header-bypass change.

## Verification

- Focused frontend tests (8 files / 409 tests) passed for AccountsScreen,
  AgentLogo, TrafficDialog, TrafficScreen, trafficState, trafficLayout,
  usageMetadata, useTrafficGeometry.
- `cargo test --lib`: first full run surfaced 3 failures (imagegen URL
  download, chatgpt-token header fallback, shared-listener admin
  diagnostics) — all traced to the strict-resolve semantics change and fixed
  as above. Final run: **2287 passed, 0 failed, 12 ignored** (includes the
  ported `resolve_platform_rejects_a_chatgpt_token…`,
  `codex_login_uses_explicit_local_key…`,
  `public_proxy_platform_header_cannot_bypass…`,
  `native_image_generation_routes_without_header_bypass…` tests).
- `pnpm typecheck` clean; `pnpm build` succeeded (only the pre-existing
  ocrad.js eval warnings); command-contract **9/9 passed**.
- Full frontend suite re-run for final confirmation.

No commit, push, publication, installation or release packaging was
performed — sync only.
