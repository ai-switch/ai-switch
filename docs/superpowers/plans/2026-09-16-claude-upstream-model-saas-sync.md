# Claude 真实上游模型与 SaaS 自动同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude Code 继续使用 alias 槽位，同时让 Claude 第三方客户端和 Claude SaaS 统一对外暴露真实上游 `to` 模型，并在算力池变化后安全同步 SaaS 模型目录。

**Architecture:** 先在模型能力服务中引入带上下文的匹配模式，区分原生 alias、第三方 `from/to` 和 SaaS 已解析上游模型；再以独立的 SaaS 模型同步服务维护模型身份、价格状态和生命周期。SaaS 请求通过内部 `SaasUpstream` 路由上下文进入现有通用代理，避免二次 alias 改写；配置适配器和前端分别消费统一的第三方模型目录。

**Tech Stack:** Rust、Tokio、SQLx SQLite migrations、Axum/Tauri、Serde JSON、React 18、TypeScript、Vitest、Rust 单元/集成测试。

**Spec:** `docs/superpowers/specs/2026-09-16-claude-upstream-model-saas-sync-design.md`

## Global Constraints

- 直接在 `main` 工作，不创建或切换分支、worktree。
- 文档使用中文；本计划和实现说明均不创建持久化 CHANGELOG。
- AI 调试和测试只能复用 `src-tauri/target-codex/`；在 `src-tauri` 中运行 Cargo 时设置 `CARGO_TARGET_DIR=target-codex`，不创建其他 target 目录。
- 严格执行 TDD：每个生产代码改动前先写一个会因目标行为缺失而失败的测试，并实际运行确认失败。
- 不删除或改动未跟踪的 `.workbuddy/`、`dev.pid`、`screenshot.png`。
- 非 Claude 平台保持现有公开模型名、价格和代理协议行为；本次自动模型生命周期同步只启用 Claude SaaS。
- Claude SaaS 永远使用裸 `to`，`model` 与 `upstream_model` 相同；第三方精确模式才使用 `{prefix}/{to}`。
- 新发现 SaaS 模型必须先进入 `pending_pricing` 且 `enabled=0`，不得因价格字段为 0 自动开放。
- 完成每个任务后运行该任务列出的最小测试集，再创建一个独立 Git 提交。

---

## 文件与职责地图

| 文件 | 职责 | 本计划中的变更 |
| --- | --- | --- |
| `src-tauri/src/services/route_model_capability.rs` | 模型映射匹配、目录生成、能力聚合 | 增加匹配上下文、修复 `from` 优先级、保留真实 `to` 能力 |
| `src-tauri/src/services/route_proxy_service.rs` | 候选筛选、模型改写、代理请求 | 支持 `SaasUpstream` 内部上下文 |
| `src-tauri/src/saas/migrations/0006_claude_model_sync.sql` | SaaS 模型生命周期和同步元数据 | 新建 migration |
| `src-tauri/src/saas/domain/model_sync.rs` | 从 Claude 算力池生成并合并 SaaS 模型 | 新建同步服务 |
| `src-tauri/src/saas/domain/groups.rs` | SaaS 分组、模型、价格 API | 接入同步状态、Claude `to` 校验和启用状态 |
| `src-tauri/src/saas/domain/mod.rs` | SaaS 操作分发 | 增加 `groups.sync` |
| `src-tauri/src/saas/billing/mod.rs` | 价格、账号许可、reservation | 只接受 active/enabled 模型并在预留前兜底同步 |
| `src-tauri/src/saas/proxy/mod.rs` | SaaS 入口、模型列表、协议限制 | 允许 Claude Responses，传递上游匹配上下文 |
| `src-tauri/src/services/route_credential_service.rs` | 账号增删改、导入、状态/归档 | 提交后触发 best-effort SaaS 同步 |
| `src-tauri/src/services/route_pool_service.rs` | 算力池成员和模式 | 成员/模式变化后触发同步 |
| `src-tauri/src/adapters/route_config/workbuddy.rs` | WorkBuddy/CodeBuddy 模型记录 | Claude 使用 `/v1/responses` |
| `src-tauri/src/services/route_config_service.rs` | 组装第三方客户端模型目录 | 使用真实 `to` 能力和 1M 窗口 |
| `src/screens/AccountsScreen.tsx` | 账号映射编辑 | 模板行完整保留能力字段 |
| `src/saas/types.ts`、`src/saas/api.ts` | SaaS 前端类型和操作名 | 增加同步状态和 `groups.sync` |
| `src/saas/admin/Groups.tsx` | SaaS 分组定价界面 | 自动模型候选、状态标识、重试同步 |
| `src-tauri/src/saas/domain/tests.rs`、`billing/tests.rs`、`proxy/tests.rs` | SaaS 后端回归测试 | 覆盖同步、计费和协议 |
| `tests/saas/admin.test.tsx`、`tests/AccountsScreen.test.tsx` | 前端回归测试 | 覆盖状态显示和能力字段保留 |

---

### Task 1: 建立带上下文的模型匹配与真实上游目录

**Files:**
- Modify: `src-tauri/src/services/route_model_capability.rs`
- Test: `src-tauri/src/services/route_model_capability.rs` 的现有 `#[cfg(test)]` 模块

**Interfaces:**
- Produces `ModelMatchMode::{NativeAlias, ClientFacing, SaasUpstream}`。
- Produces `model_matches(platform, capability, requested, mode) -> bool`。
- Produces `resolve_mapping_target(mappings, requested, mode) -> Option<String>`。
- Keeps `client_facing_model_catalog_entries(platform, members, mode)` as the only third-party Claude directory entry point。
- `supports_requested_model`、`supports_requested_capability` 等旧调用点改为通过 `ClientFacing` wrapper，避免非 Claude 调用点失去原有行为。

- [ ] **Step 1: 写失败测试，先覆盖匹配优先级和 SaaS 上游语义**

在现有测试 helper 旁新增以下测试；测试使用当前 `parse_model_capability` 和 `member`/`capability` helper，不新造测试专用生产逻辑：

```rust
#[test]
fn client_facing_prefers_explicit_from_over_an_earlier_to_match() {
    let capability = parse_model_capability(
        r#"{"model_mappings":[
            {"from":"A","to":"B"},
            {"from":"B","to":"C"}
        ]}"#,
    );

    assert_eq!(
        resolve_mapping_target(&capability.mappings, "B", ModelMatchMode::ClientFacing),
        Some("C".to_string())
    );
}

#[test]
fn saas_upstream_preserves_a_real_to_and_only_uses_fallback_when_needed() {
    let capability = parse_model_capability(
        r#"{"model_mappings":[
            {"from":"A","to":"B"},
            {"from":"claude-model","to":"catch-all"}
        ]}"#,
    );

    assert!(model_matches(
        "claude", &capability, Some("B"), ModelMatchMode::SaasUpstream
    ));
    assert_eq!(
        resolve_mapping_target(&capability.mappings, "B", ModelMatchMode::SaasUpstream),
        Some("B".to_string())
    );
    assert_eq!(
        resolve_mapping_target(
            &capability.mappings,
            "unknown-model",
            ModelMatchMode::SaasUpstream
        ),
        Some("catch-all".to_string())
    );
}
```

- [ ] **Step 2: 运行测试确认它因接口/行为缺失而失败**

Run from `src-tauri`:

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_model_capability
```

Expected: FAIL because `ModelMatchMode` and the mode-aware matching functions do not yet exist, or because the current combined `from/to` lookup returns `B` instead of `C`。

- [ ] **Step 3: 实现最小匹配上下文和目标解析**

在 `route_model_capability.rs` 中：

1. 定义 `ModelMatchMode`，派生 `Debug, Clone, Copy, PartialEq, Eq`。
2. 将现有单一匹配逻辑拆成 `model_matches` 和带模式的 `resolve_mapping_target`。
3. `ClientFacing` 的顺序必须是精确 `from`、再精确 `to`、最后 fallback。
4. `SaasUpstream` 只接受非 fallback 的 `to`；如果没有具体 `to`，才返回 fallback 的 `to`。
5. 保留 Claude `[1m]` 后缀归一化逻辑，但第三方目录不得把 `[1m]` 拼进模型 ID。
6. 为目录贡献增加 Claude 1M 能力的内部聚合字段：聚合模式使用 AND，精确模式按单成员计算；只有全体贡献支持 1M 时才把第三方上下文窗口写成 `1_000_000`。
7. `supports_image_input` 继续使用现有 AND 合并；Codex 的 context-window 最大值规则不变。

- [ ] **Step 4: 运行纯模型测试确认通过并检查格式**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_model_capability
cargo fmt --check
```

Expected: 新增测试及该模块原有测试 PASS。若 `cargo fmt --check` 报告提交前已存在的无关文件差异，只记录，不在本任务扩大格式化范围；本任务修改的文件必须格式通过。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/services/route_model_capability.rs
git commit -m "fix: 区分 Claude 模型 alias 与上游匹配上下文"
```

---

### Task 2: 增加 SaaS 模型生命周期字段和幂等同步服务

**Files:**
- Create: `src-tauri/src/saas/migrations/0006_claude_model_sync.sql`
- Create: `src-tauri/src/saas/domain/model_sync.rs`
- Modify: `src-tauri/src/saas/domain/mod.rs`
- Modify: `src-tauri/src/saas/domain/groups.rs`
- Modify: `src-tauri/src/saas/repository/mod.rs` 的测试 fixture
- Test: `src-tauri/src/saas/domain/model_sync_tests.rs`（若当前模块采用内嵌测试，则放在 `model_sync.rs`）

**Interfaces:**
- Produces `GroupModel` 的 `enabled`、`sync_state`、`managed_by_pool`、`last_seen_at`、`updated_at` 字段。
- Produces `SaasModelSyncResult { changed, source_fingerprint, last_success_at, last_error }`。
- Produces `reconcile_group_connection(&mut SqliteConnection, group_id) -> Result<SaasModelSyncResult, AppError>`。
- Produces `ensure_group_current(pool, group_id) -> Result<(), AppError>` 和 `sync_group(pool, group_id) -> Result<Value, AppError>`。
- `source_fingerprint` 由排序后的成员 ID、成员 `config_json`、账号状态/归档状态和平台模式组成，使用仓库已有 `sha2` 依赖计算 SHA-256。

- [ ] **Step 1: 写 migration 和同步服务的失败测试**

先在测试中准备一个 Claude 核心分组和两个账号：一个映射 `claude-sonnet-alias → provider-sonnet`，另一个映射 `claude-opus-alias → provider-sonnet`；将两个账号放进同一分组。测试以下行为：

```rust
#[tokio::test]
async fn claude_sync_deduplicates_to_and_starts_new_models_as_pending() {
    let pool = repository::test_pool().await;
    repository::insert_claude_sync_fixture(&pool).await;

    let result = crate::saas::domain::model_sync::sync_group(&pool, "claude-saas")
        .await
        .expect("sync");

    assert_eq!(result["models"][0]["model"], "provider-sonnet");
    assert_eq!(result["models"][0]["upstreamModel"], "provider-sonnet");
    assert_eq!(result["models"][0]["syncState"], "pending_pricing");
    assert_eq!(result["models"][0]["enabled"], false);

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM saas_group_models WHERE group_id='claude-saas'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn claude_sync_preserves_price_and_reactivates_a_returning_to() {
    // Arrange an existing provider-sonnet row with explicit prices and enabled=1,
    // remove it from the current pool, sync to stale, then add the mapping back.
    // Assert prices are unchanged and sync_state returns to active.
}
```

The second test must contain concrete SQL setup and assertions for all three price columns; it must not only assert a row count.

- [ ] **Step 2: 运行同步测试确认失败**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib saas::domain::model_sync
```

Expected: FAIL because migration columns, Claude fixture helper, and `model_sync` module are absent。

- [ ] **Step 3: 添加 `0006` migration 和数据结构**

`0006_claude_model_sync.sql` 必须创建：

```sql
ALTER TABLE saas_group_models ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1));
ALTER TABLE saas_group_models ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE saas_group_models ADD COLUMN managed_by_pool INTEGER NOT NULL DEFAULT 0 CHECK(managed_by_pool IN (0,1));
ALTER TABLE saas_group_models ADD COLUMN last_seen_at INTEGER;
ALTER TABLE saas_group_models ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX saas_group_models_public_state
    ON saas_group_models(group_id, sync_state, enabled, model);
CREATE TABLE saas_group_model_sync (
    group_id TEXT PRIMARY KEY REFERENCES route_pool_groups(id),
    source_fingerprint TEXT NOT NULL,
    last_success_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL
);
```

在 `GroupModel` 和 SQL 查询中增加对应列；所有新插入/更新记录都写 `updated_at=repository::now()`。测试 fixture 增加 Claude 核心分组、成员和映射，不能复用 Codex 的 `gpt-test` 映射来伪造 Claude 行。

- [ ] **Step 4: 实现 `model_sync` 的 desired-state reconciliation**

实现顺序固定为：

1. 读取核心分组和当前有效账号；
2. 计算 `source_fingerprint`；指纹相同且没有失败记录时直接返回；
3. 用 `catalog_members` 和 `client_facing_model_catalog_entries("claude", ..., Aggregate)` 生成唯一裸 `to`；
4. 对每个 desired `to`，优先匹配已有 `model == to`，再匹配 `upstream_model == to`，最后迁移唯一旧 alias 行；
5. 新行写 `pending_pricing`、`enabled=0`、价格 0；
6. 当前不存在的 managed 行写 `stale`，不删除；重新出现时恢复 `active`，不改变 `enabled` 和价格；
7. 写入 `saas_group_model_sync` 成功指纹和时间；失败时记录 `last_error` 并返回错误；
8. 同步不能覆盖管理员价格或显式 enabled 状态。

- [ ] **Step 5: 运行同步测试和 migration 测试**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib saas::domain::model_sync
cargo test --lib database::test_support
```

Expected: 新增的 pending/stale/恢复/价格保留测试 PASS。

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/saas/migrations/0006_claude_model_sync.sql src-tauri/src/saas/domain/model_sync.rs src-tauri/src/saas/domain/mod.rs src-tauri/src/saas/domain/groups.rs src-tauri/src/saas/repository/mod.rs
git commit -m "feat: 增加 Claude SaaS 模型自动同步状态"
```

---

### Task 3: 接入 SaaS 分组、计费和模型列表

**Files:**
- Modify: `src-tauri/src/saas/domain/groups.rs`
- Modify: `src-tauri/src/saas/domain/mod.rs`
- Modify: `src-tauri/src/saas/billing/mod.rs`
- Modify: `src-tauri/src/saas/proxy/mod.rs`
- Modify: `src-tauri/src/saas/domain/tests.rs`
- Modify: `src-tauri/src/saas/billing/tests.rs`
- Modify: `src-tauri/src/saas/proxy/tests.rs`

**Interfaces:**
- `admin(pool, "groups.sync", {"groupId": String})` 调用 `sync_group`。
- `GroupInput.models[]` 接受可选 `enabled`；Claude 后端要求 `model == upstreamModel`。
- `group_json` 返回 `syncState`、`enabled`、`managedByPool`、`lastSeenAt`，并返回 `sourceFingerprint`、`lastSyncAt`、`lastSyncError`。
- `billing::reserve`/`reserve_image` 在查询价格前确保分组同步，并只查询 `sync_state='active' AND enabled=1`。

- [ ] **Step 1: 写失败测试，覆盖 Claude SaaS 的公开身份和 fail-closed**

在 `saas/domain/tests.rs` 增加：

```rust
#[tokio::test]
async fn claude_group_rejects_an_alias_public_model() {
    let pool = repository::test_pool().await;
    repository::insert_claude_sync_fixture(&pool).await;
    let mut payload = repository::claude_group_payload();
    payload["models"][0]["model"] = json!("claude-sonnet-alias");
    payload["models"][0]["upstreamModel"] = json!("provider-sonnet");

    let error = admin(&pool, "groups.save", payload).await.expect_err("alias must fail");
    assert_eq!(error.code(), "saas.validation");
}
```

在 `billing/tests.rs` 增加：

```rust
#[tokio::test]
async fn pending_or_stale_saas_model_cannot_create_a_reservation() {
    let pool = repository::test_pool().await;
    let principal = repository::claude_principal(&pool).await;
    let error = crate::saas::billing::reserve(
        &pool, &principal, "provider-sonnet", 10, 10
    ).await.expect_err("unpriced model must fail closed");
    assert_eq!(error.code(), "saas.model_not_allowed");
}
```

在 `saas/proxy/tests.rs` 增加对 `/v1/models` 的断言：pending/stale 不出现在 `data`，active/enabled 且有可用账号的裸 `to` 出现。

- [ ] **Step 2: 运行 SaaS 测试确认失败**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib saas::domain
cargo test --lib saas::billing
cargo test --lib saas::proxy
```

Expected: FAIL，因为 `groups.sync`、状态字段、Claude 模型校验和 active/enabled 查询还不存在。

- [ ] **Step 3: 实现 SaaS domain 接口和模型过滤**

1. 在 `domain::admin` 增加 `"groups.sync"` 分支。
2. `groups.list`/`groups.catalog`/普通用户 `groups` 进入前调用 `ensure_group_current`；管理员保留 pending/stale，普通用户只序列化 active+enabled。
3. `GroupModel` 序列化字段使用 camelCase；Claude 的 `model` 和 `upstreamModel` 后端强制相等。
4. `groups.save` 在保存价格时保留同步字段，新增模型只有 payload 明确 `enabled=true` 且状态允许时才启用。
5. 删除 stale 记录只删除该组的历史价格行，不触碰 route pool。

- [ ] **Step 4: 接入计费和 `/v1/models`**

在 `billing::reserve` 和 `reserve_image` 中先调用同一数据库连接上的 `reconcile_group_connection`，然后用以下条件查询价格：

```sql
WHERE group_id=?
  AND model=?
  AND sync_state='active'
  AND enabled=1
```

仍然把 reservation 的公共 `model` 和价格快照保存为用户请求值；Claude 的 `upstream_model` 使用同一个裸 `to`。在 `saas/proxy/mod.rs` 的 models 分支过滤同样的状态，并继续调用 `permitted_accounts_for_model` 验证当前至少有一个可用账号。

入口条件改为：Claude 允许 `anthropic || responses`，仍拒绝 Claude 的 Chat Completions；Codex/Gemini 原有条件不变。

- [ ] **Step 5: 运行 SaaS 测试确认通过**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib saas::domain
cargo test --lib saas::billing
cargo test --lib saas::proxy
```

Expected: 现有账务、图片计费、模型白名单和新增 Claude 状态测试全部 PASS。

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/saas/domain/groups.rs src-tauri/src/saas/domain/mod.rs src-tauri/src/saas/billing/mod.rs src-tauri/src/saas/proxy/mod.rs src-tauri/src/saas/domain/tests.rs src-tauri/src/saas/billing/tests.rs src-tauri/src/saas/proxy/tests.rs
git commit -m "feat: 让 Claude SaaS 使用真实上游模型并安全计费"
```

---

### Task 4: 将 SaaS 已解析模型安全传入通用代理

**Files:**
- Modify: `src-tauri/src/services/route_proxy_service.rs`
- Modify: `src-tauri/src/saas/proxy/mod.rs`
- Test: `src-tauri/src/services/route_proxy_service.rs` 现有测试模块

**Interfaces:**
- `ProxyAppState` 增加 `model_match_mode: ModelMatchMode`，默认 `ClientFacing`。
- Produces `ProxyAppState::with_model_match_mode(mode) -> ProxyAppState`，仅 SaaS 内部调用。
- `filter_candidates_for_model`、模型体改写和 capability 过滤都读取该模式。

- [ ] **Step 1: 写失败测试，复现映射链二次改写**

新增一个代理级纯测试，直接构造两个候选账号：

```rust
#[test]
fn saas_upstream_mode_does_not_rewrite_b_when_another_mapping_uses_b_as_from() {
    let mappings = vec![
        ModelMapping { from: "A".into(), to: "B".into(), ..Default::default() },
        ModelMapping { from: "B".into(), to: "C".into(), ..Default::default() },
    ];

    let body = br#"{"model":"B","messages":[]}"#;
    assert_eq!(
        apply_model_mappings_with_mode(body, &mappings, ModelMatchMode::SaasUpstream),
        body
    );
}
```

再增加一个 fallback 测试：`unknown-model` 在 `SaasUpstream` 下改写为 `catch-all`，具体 `to` `B` 不改写。

- [ ] **Step 2: 运行 route proxy 测试确认失败**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_proxy_service
```

Expected: FAIL，因为当前 `apply_model_mappings` 没有模式参数，且 SaaS 调用仍使用默认匹配。

- [ ] **Step 3: 实现内部匹配模式传递**

1. 给 `ProxyAppState` 增加默认 `ClientFacing` 模式和 `with_model_match_mode` builder。
2. 将 `filter_candidates_for_model`、`filter_candidates_for_capability`、`apply_model_mappings` 的内部版本增加 `ModelMatchMode` 参数；保留公开 `apply_model_mappings` wrapper 使用 `ClientFacing`，避免其他测试和调用点无意义改动。
3. `SaasUpstream` 模式下，具体 `to` 命中时把模型原样保留；仅无具体 `to` 时使用 fallback 目标。
4. `saas/proxy/mod.rs` 在 `with_access_scope` 后继续调用 `with_model_match_mode(ModelMatchMode::SaasUpstream)`，图片请求也使用同一模式。
5. 日志里的 requested model 保持 SaaS 用户提交的裸 `to`，每账号的 model state key 使用最终上游目标。

- [ ] **Step 4: 运行 route proxy 与 SaaS 回归测试**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_proxy_service
cargo test --lib saas::proxy
cargo test --lib saas::billing
```

Expected: 映射链、fallback、精确前缀、SaaS access scope 和原有重试测试全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/services/route_proxy_service.rs src-tauri/src/saas/proxy/mod.rs
git commit -m "fix: 防止 SaaS 上游模型被二次映射"
```

---

### Task 5: 在算力池变更后触发 SaaS 同步

**Files:**
- Modify: `src-tauri/src/services/route_credential_service.rs`
- Modify: `src-tauri/src/services/route_pool_service.rs`
- Modify: `src-tauri/src/saas/domain/model_sync.rs`
- Modify: `src-tauri/src/services/route_credential_service.rs` 和 `route_pool_service.rs` 的现有测试模块

**Interfaces:**
- Produces `model_sync::best_effort_sync_platform(pool, platform) -> Result<(), AppError>`。
- 该 helper 在主事务提交后调用，失败只记录 `eprintln!`/已有日志入口，不改变主操作返回值。
- 同步只查 Claude SaaS 分组；其他平台调用直接返回成功，不触碰既有手工模型。

- [ ] **Step 1: 写失败测试，验证账号映射和成员变化自动刷新 SaaS**

测试流程：

1. 建立 Claude SaaS 分组和一条已启用、已定价的 `provider-sonnet`；
2. 调用现有 `RouteCredentialService::update` 把唯一账号的 `to` 改为 `provider-opus`；
3. 断言 SaaS 行变为 `provider-sonnet=stale`，并出现 `provider-opus=pending_pricing`；
4. 调用 `RoutePoolService::set_group_members` 移除账号；
5. 断言所有 managed 行都为 stale，且价格仍在数据库中。

- [ ] **Step 2: 运行 route service 测试确认失败**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_credential_service
cargo test --lib services::route_pool_service
```

Expected: FAIL，因为现有服务提交后没有调用 SaaS 同步。

- [ ] **Step 3: 实现提交后 best-effort hook**

在各服务成功提交数据库写入、即将返回结果之前调用：

```rust
if let Err(error) = crate::saas::domain::model_sync::best_effort_sync_platform(
    pool,
    platform.as_str(),
).await {
    eprintln!("Claude SaaS model sync failed for {}: {}", platform.as_str(), error);
}
```

只在会改变 Claude 模型身份/可用性的路径调用：账号创建、更新、复制、导入、删除、归档、恢复、状态变化、成员替换/移动和模型模式变化。冷却倒计时本身不改变模型身份，不触发全量同步；公开查询和计费前的兜底检查仍会过滤冷却账号。

避免在事务尚未 commit 时调用同步，避免 SQLite 嵌套写事务；批量操作只在批量事务完成后同步一次。

- [ ] **Step 4: 运行自动同步回归测试**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_credential_service
cargo test --lib services::route_pool_service
cargo test --lib saas::domain
```

Expected: 映射变化、成员移除、批量导入和已有价格保留测试 PASS。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/services/route_credential_service.rs src-tauri/src/services/route_pool_service.rs src-tauri/src/saas/domain/model_sync.rs
git commit -m "feat: 在算力池变更后同步 Claude SaaS 模型"
```

---

### Task 6: 修正 WorkBuddy 端点并完成第三方配置目录能力

**Files:**
- Modify: `src-tauri/src/adapters/route_config/workbuddy.rs`
- Modify: `src-tauri/src/services/route_config_service.rs`
- Modify: `src-tauri/src/services/route_model_capability.rs`（若 Task 1 的 1M 字段尚未完成则在此收口）
- Modify: `src-tauri/src/adapters/route_config/workbuddy.rs` 的测试模块
- Modify: `tests/AccountsScreen.test.tsx`
- Modify: `src/screens/AccountsScreen.tsx`

**Interfaces:**
- Claude WorkBuddy/CodeBuddy `model_url` 返回 `{base}/v1/responses`；Codex 仍返回 `{base}/v1/chat/completions`。
- `is_ours` 同时能识别旧的受管 Chat URL 和新的 Responses URL，以便下一次写入替换旧记录而不是追加重复项。
- `resolve_client_models` 继续只对需要模型清单的第三方适配器提供 `to` 目录；Claude Code 原生配置仍走 alias env plan。

- [ ] **Step 1: 写失败测试**

在 WorkBuddy 测试模块增加：

```rust
#[test]
fn claude_workbuddy_uses_responses_but_codex_keeps_chat_completions() {
    let claude = claude_adapter();
    let codex = codex_adapter();
    let claude_json = render(claude.as_ref(), None, &["provider-sonnet"]);
    let codex_json = render(codex.as_ref(), None, &["gpt-5.6-sol"]);

    assert_eq!(claude_json["models"][0]["url"], format!("{BASE_URL}/v1/responses"));
    assert_eq!(codex_json["models"][0]["url"], format!("{BASE_URL}/v1/chat/completions"));
}
```

在 `AccountsScreen.test.tsx` 增加一条：编辑 Claude 模板映射后，`supports_image_input` 和 `capabilities` 仍存在于保存 payload；测试必须从真实用户事件触发，不直接调用内部 helper。

- [ ] **Step 2: 运行前端和 WorkBuddy 测试确认失败**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib adapters::route_config::workbuddy
pnpm vitest run tests/AccountsScreen.test.tsx
```

Expected: WorkBuddy Claude URL 断言 FAIL；前端测试在当前模板重建丢字段时 FAIL。

- [ ] **Step 3: 实现端点和能力字段保留**

1. `WorkBuddyAdapter::model_url` 按 `self.platform` 分支；Claude 使用 `/responses`，Codex 使用 `/chat/completions`。
2. `is_ours` 对旧 Chat URL 只在 Claude adapter 且 key/代理地址匹配时接纳，render 时统一替换为 Responses URL。
3. `AccountsScreen.tsx` 模板行更新改为 `{...existing, from, to, label, supports_1m}`，再显式更新需要变化的字段；不能重新构造只含四个字段的对象。
4. 复查 `resolve_client_models` 的 `context_window` 使用真实 `base_id=to`；Claude `supports_1m` 只有聚合全 true 才写 1M 窗口。

- [ ] **Step 4: 运行适配器和前端回归测试**

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib adapters::route_config::workbuddy
pnpm vitest run tests/AccountsScreen.test.tsx tests/ConfigWriteTargetsDialog.test.tsx
pnpm typecheck
```

Expected: 两种 WorkBuddy URL、第三方真实模型名、能力字段保留和现有 Codex 行为全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/adapters/route_config/workbuddy.rs src-tauri/src/services/route_config_service.rs src/screens/AccountsScreen.tsx tests/AccountsScreen.test.tsx
git commit -m "feat: 修正 Claude 第三方端点并保留模型能力"
```

---

### Task 7: 完成 SaaS 管理端模型状态和同步操作

**Files:**
- Modify: `src/saas/types.ts`
- Modify: `src/saas/api.ts`
- Modify: `src/saas/admin/Groups.tsx`
- Modify: `tests/saas/admin.test.tsx`
- Modify: `tests/saas/fixtures.ts`（如 fixture 类型需要扩展）

**Interfaces:**
- `AdminOperation` 增加 `groups.sync`。
- `ModelPrice` 增加 `enabled`, `syncState`, `managedByPool`, `lastSeenAt`。
- `SaasGroup` 增加 `sourceFingerprint`, `lastSyncAt`, `lastSyncError`。
- 管理端调用 `adminCall("groups.sync", {groupId})` 并在成功后重新加载该页数据。

- [ ] **Step 1: 写失败前端测试**

在 `tests/saas/admin.test.tsx` 增加三条行为测试：

1. Claude 分组显示 `provider-sonnet`，不显示 `claude-sonnet-alias`；
2. `pending_pricing` 行显示待定价提示且默认未勾选；
3. 点击“重新同步”后调用 `adminCall` 的 `groups.sync`，成功后重新加载列表。

断言应检查用户可见文本和真实 `adminCall` 调用参数，不能只测组件内部 state。

- [ ] **Step 2: 运行前端测试确认失败**

```powershell
pnpm vitest run tests/saas/admin.test.tsx
```

Expected: 当前组件没有状态字段、真实 `to` 只在手工 catalog 中出现，也没有 `groups.sync` 按钮，测试 FAIL。

- [ ] **Step 3: 实现类型和管理界面**

1. 更新 `src/saas/types.ts` 的接口和 `AdminOperation` union，与 Rust camelCase JSON 完全一致。
2. `GroupEditor` 打开时使用同步后的模型候选；Claude 的 public model 输入改为只读且值等于 `upstreamModel`。
3. pending 行可以编辑价格，但保存前必须显式勾选/启用；stale 行可恢复或删除历史价格。
4. `GroupsPanel` 显示 active/pending/stale 标签、最近同步错误和“重新同步”按钮。
5. `groups.sync` 成功后同时刷新 `groups.list` 和当前编辑器的 catalog，失败显示 `ActionFeedback`。

- [ ] **Step 4: 运行前端测试和类型检查**

```powershell
pnpm vitest run tests/saas/admin.test.tsx
pnpm typecheck
```

Expected: SaaS 状态、重试、只读 Claude 模型名和现有分组定价行为全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/saas/types.ts src/saas/api.ts src/saas/admin/Groups.tsx tests/saas/admin.test.tsx tests/saas/fixtures.ts
git commit -m "feat: 在 SaaS 管理端展示并重试模型同步"
```

---

### Task 8: 集成验证、文档同步和最终审查

**Files:**
- Modify: `docs-site/docs/guide/protocol-routing.md`
- Modify: `docs-site/docs/en/guide/protocol-routing.md`（若英文路径存在，以实际对应文件为准）
- Modify: `docs-site/docs/guide/quick-start.md`、`docs-site/docs/en/guide/quick-start.md`（仅在已有模型清单章节时更新）
- Test: 全仓库已有 Rust/TypeScript 测试

**Interfaces:**
- 文档明确 Claude Code alias 与第三方/SaaS `to` 的区别；不写入未实现的协议或客户端承诺。

- [ ] **Step 1: 写文档回归检查项**

在对应协议路由文档的模型清单章节加入以下可验证事实：

```text
Claude Code 官方配置使用 alias 槽位；ZCode、WorkBuddy、Qoder CLI、DeepSeek Harness 和 Claude SaaS 使用真实上游 to 模型。
Claude SaaS 不暴露账号前缀；第三方精确模式才使用 {账号前缀}/{to}。
未定价的自动发现模型不会出现在 SaaS /v1/models。
```

- [ ] **Step 2: 运行完整验证**

从仓库根目录执行：

```powershell
$env:CARGO_TARGET_DIR = 'src-tauri/target-codex'
pnpm typecheck
pnpm test:run
pnpm release:manifest:test
pnpm rust:check
pnpm rust:test
```

再从 `src-tauri` 执行重点测试：

```powershell
$env:CARGO_TARGET_DIR = 'target-codex'
cargo test --lib services::route_model_capability
cargo test --lib services::route_proxy_service
cargo test --lib saas
cargo test --lib adapters::route_config::workbuddy
```

- [ ] **Step 3: 检查格式、差异和未跟踪文件**

```powershell
git diff --check
$env:CARGO_TARGET_DIR = 'target-codex'
cargo fmt --check
git status --short --branch
```

确认只存在本计划提交的代码/文档改动，以及原本必须保留的 `.workbuddy/`、`dev.pid`、`screenshot.png`；不创建任何额外 target 目录。

- [ ] **Step 4: 提交文档与剩余集成改动**

```powershell
git add docs-site/docs/guide/protocol-routing.md docs-site/docs/en/guide/protocol-routing.md docs-site/docs/guide/quick-start.md docs-site/docs/en/guide/quick-start.md
git commit -m "docs: 补充 Claude 真实上游模型与 SaaS 说明"
```

如果文档在前置任务中已经同步，跳过该提交，但保留验证记录。

---

## 实现完成判定

实现完成必须同时满足：

1. Claude Code 的 alias 槽位写入和原生路由未回归；
2. 第三方 Claude 聚合/精确目录分别输出裸 `to` 和 `{prefix}/{to}`；
3. WorkBuddy Claude 使用 Responses URL；
4. Claude SaaS `/v1/models`、计费和账号筛选都使用裸 `to`；
5. `from` 优先级、SaaS 上游防二次改写、fallback 和冷却状态测试通过；
6. 新 SaaS 模型待定价、stale/恢复和价格保留行为通过；
7. 图片输入和 Claude 1M 能力按保守规则保留；
8. 全局验证命令通过，且没有产生额外 Cargo target 目录。
