# Claude 真实上游模型与 SaaS 模型自动同步设计

日期：2026-09-16
状态：已批准；进入实现阶段

## 1. 背景

Claude Code 的官方客户端只能通过 `ANTHROPIC_DEFAULT_*_MODEL` 等槽位配置模型。槽位要求使用固定的 alias（例如 `claude-sonnet-alias`），这是 Claude Code 的客户端限制，不代表真实上游模型名称。

ZCode、WorkBuddy/CodeBuddy、Qoder CLI、DeepSeek Harness 等第三方客户端没有这个限制，可以直接显示并发送算力池映射的 `to` 模型。SaaS 也是一个独立的对外产品目录，不应把 Claude Code 的 alias 继续泄露为用户可见模型名。

当前实现已经让 Claude 第三方配置使用 `to`，但仍有几个架构缺口：

- `from` 与 `to` 匹配共用一个无上下文的查找逻辑，映射链可能被错误的 `to` 命中抢先匹配；
- SaaS 分组模型仍主要依赖手工录入，算力池变化后模型清单容易过期；
- SaaS 把已解析的 `upstream_model` 再送入通用代理时，可能被当作 alias 二次改写；
- 第三方模型目录中的图片输入、1M 上下文等能力必须随真实 `to` 模型保留；
- WorkBuddy 的 Claude 配置需要使用 Responses 端点，而 SaaS Claude 入口也必须允许对应协议。

## 2. 已确认的目标与不变规则

### 2.1 三类客户端的模型名

| 场景 | 对外模型名 | 内部处理 |
| --- | --- | --- |
| Claude Code 官方配置 | `from` alias 槽位 | 按账号映射为 `to` |
| Claude 第三方客户端 | `to` 真实上游模型 | 按 `to` 路由；精确模式可带账号前缀 |
| Claude SaaS | 裸 `to` 真实上游模型 | `model` 与 `upstream_model` 默认相同，按 `to` 筛选账号 |

Claude SaaS 是计费产品目录，始终使用裸 `to`，不暴露 `{账号前缀}/{to}`。账号前缀只用于第三方客户端和普通代理的精确模式。这样同一真实模型只有一份价格，账号改名或增删不会改变 SaaS 用户侧的模型 ID。

### 2.2 第三方客户端

- 聚合模式：不同账号的相同 `to` 合并成一个模型 ID；
- 精确模式：API 账号输出 `{prefix}/{to}`，官方账号继续合并为 `official/{to}`；
- fallback 映射不生成模型条目；
- Claude alias 槽位只用于 Claude Code 原生配置；
- WorkBuddy 与 CodeBuddy 的 Claude 模型记录使用 `/v1/responses`；
- `supports_image_input` 聚合采用 AND：只要一个贡献账号明确为文本-only，聚合模型就不声明图片输入；精确模式按账号独立声明；
- `supports_1m` 不再生成独立的 `[1m]` 第三方模型 ID，但应转换为真实的上下文窗口声明，不能因换成 `to` 而丢失 1M 能力。

### 2.3 非目标

- 不改变 Claude Code 官方 alias 槽位的协议；
- 不让 SaaS 用户选择内部账号；
- 不为零价格模型自动开通公共服务；
- 不复制一套新的协议代理，继续复用现有通用代理、重试、冷却和用量流程；
- 不改变 Codex/Gemini 现有公开模型名语义，只让同步框架可复用其现有目录生成逻辑。

## 3. 整体架构

实现分为四个边界清晰的模块。

### 3.1 统一模型目录服务

继续以 `src-tauri/src/services/route_model_capability.rs` 为模型目录和能力聚合的唯一实现位置，并把模型来源抽象为 `ModelCatalogMember`。

新增/调整的公共内部接口：

```rust
pub(crate) enum ModelMatchMode {
    NativeAlias,
    ClientFacing,
    SaasUpstream,
}

pub(crate) fn model_matches(
    platform: &str,
    capability: &ModelCapability,
    requested: Option<&str>,
    mode: ModelMatchMode,
) -> bool;

pub(crate) fn resolve_mapping_target(
    mappings: &[ModelMapping],
    requested: &str,
    mode: ModelMatchMode,
) -> Option<String>;
```

目录生成保留两条入口：

- `advertised_model_catalog_entries`：原生模型目录，Claude 使用 `from`；
- `client_facing_model_catalog_entries`：第三方目录，Claude 使用 `to`。

第三方目录必须在折叠前解析每个贡献的真实模型能力，再进行去重，确保 `context_window`、图片输入能力和 reasoning 信息不受 alias/账号前缀影响。

### 3.2 上下文相关的模型匹配

同一个字符串在不同入口的含义不同，不能再用一个无上下文的 `from || to` 查找解决全部场景。

#### `NativeAlias`

用于 Claude Code 原生 alias 请求。优先精确匹配 `from`，再按 Claude 的 1M 后缀规则处理，最后才考虑 fallback。

#### `ClientFacing`

用于普通第三方客户端请求。匹配顺序固定为：

1. 显式 `from`；
2. 非空的 `to`；
3. fallback。

因此以下映射请求 `B` 时，`B → C` 的显式 `from` 优先于 `A → B` 的 `to`：

```text
A → B
B → C
```

#### `SaasUpstream`

用于 SaaS 已经根据价格表解析出的 `upstream_model`。只按非 fallback 映射的 `to` 匹配，并将已经是目标模型的请求保持原样；只有 fallback 账号没有对应的具体 `to` 时，才改写到其 fallback 目标。

这样可以同时保证：

- `A → B` 的 SaaS 请求 `B` 不会被 `B → C` 再改写；
- fallback 账号仍能接收模型并改写到自身的兜底上游；
- 每账号的模型冷却键、失败归因和请求统计仍使用实际目标模型。

`ProxyAppState` 增加内部模型匹配上下文。普通公开代理默认使用 `ClientFacing`；SaaS 调用通用代理时通过内部构造器传入 `SaasUpstream`，不使用可被外部伪造的公开请求头。

### 3.3 SaaS 模型同步服务

新增 `src-tauri/src/saas/domain/model_sync.rs`，提供幂等的：

```rust
pub(crate) async fn reconcile_group(
    connection: &mut SqliteConnection,
    group_id: &str,
) -> Result<(), AppError>;
```

同步源为分组当前有效成员：

- 成员在目标分组内；
- 账号状态为 `ok`；
- 未归档；
- 平台与分组一致。

本次自动生命周期同步首先覆盖 Claude SaaS：调用 `client_facing_model_catalog_entries` 的真实上游语义，但 SaaS 固定使用聚合的裸 `to`。Codex/Gemini 不改变现有手工模型定价和公开名称行为，只保留各自已有的目录身份规则供后续扩展。

同步只负责模型身份、可用性和能力元数据；价格仍由管理员配置，不能由上游模型名推断。

### 3.4 配置适配器

- `route_config_service.rs`：Claude 原生写入仍使用 `resolve_claude_env_plan` 和 alias；第三方写入使用 `client_facing_model_catalog_entries`；
- `workbuddy.rs`：Claude/CodeBuddy 适配器生成并识别 `/v1/responses` URL，旧的受管 `/chat/completions` 记录在下一次写入时被替换；
- `saas/proxy/mod.rs`：Claude 允许 Messages 和 Responses 入口，内部通过通用代理桥接到每个账号配置的 dialect；不改变 Gemini/Codex 的端点约束。

## 4. SaaS 数据与同步规则

### 4.1 模型记录状态

为 `saas_group_models` 增加模型生命周期字段（migration 文件名按实现日期生成）：

```sql
ALTER TABLE saas_group_models ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE saas_group_models ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE saas_group_models ADD COLUMN managed_by_pool INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saas_group_models ADD COLUMN last_seen_at INTEGER;
ALTER TABLE saas_group_models ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE saas_group_model_sync (
    group_id TEXT PRIMARY KEY REFERENCES route_pool_groups(id),
    source_fingerprint TEXT NOT NULL,
    last_success_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL
);
```

`sync_state` 取值：

- `active`：模型在当前算力池中存在；
- `pending_pricing`：模型由算力池新发现，但尚未完成价格配置；
- `stale`：模型暂时不在算力池中，保留历史价格等待恢复。

已有记录迁移为 `enabled=1`、`sync_state='active'`、`managed_by_pool=0`，并以迁移时间填充 `updated_at`，保证升级不改变既有 SaaS 服务。Claude 首次成功同步后，归一化的模型记录标记为 `managed_by_pool=1`；Codex/Gemini 既有手工公开名继续保持 `managed_by_pool=0`。

### 4.2 Claude 身份归一化

对每个 Claude SaaS 分组，目标模型键为裸 `to`：

```text
from = claude-sonnet-alias
 to  = provider-sonnet

SaaS:
model          = provider-sonnet
upstream_model = provider-sonnet
```

首次同步旧配置时，按以下顺序迁移价格：

1. 优先匹配已有 `model == to`；
2. 否则匹配已有 `upstream_model == to`；
3. 若只有一个旧 alias 行指向该 `to`，迁移其价格、启用状态和版本；
4. 多个旧行合并时选择 `version` 最大、再以 `updated_at` 较新的记录为优先，并写入审计记录；
5. 旧 alias 行标记为 `stale`，不再公开。

Claude SaaS 后端拒绝保存 `model != upstream_model` 的新映射，避免重新引入 alias 作为公共模型名。

### 4.3 新增、移除与恢复

- 新发现的 `to` 插入为 `pending_pricing`、`enabled=0`，价格字段初始化为 0；
- 管理员完成价格后保存为 `active`、`enabled=1`；零价格作为明确的免费定价仍允许，但必须由管理员显式启用；
- 不再出现的模型标记为 `stale`，从普通用户分组、公开 `/v1/models` 和计费查询中隐藏；
- 模型重新出现时恢复为 `active`，保留原价格和管理员启用状态；
- 账号能力变化只更新能力/可用账号统计，不覆盖价格。

管理员分组页面显示 active、pending 和 stale 状态；普通用户只看到 active 且 enabled 的模型。管理端新增 `groups.sync` 操作用于立即重试指定分组，并在分组返回值中提供 `sourceFingerprint`、`lastSyncAt` 和 `lastSyncError`。

### 4.4 聚合能力

同一 `to` 由多个账号贡献时：

- `supports_image_input` 使用 AND；
- Codex 的 `context_window` 延续现有最大值合并规则；
- Claude 的 `supports_1m` 使用 AND：只有同一聚合 `to` 的所有有效贡献都声明支持 1M 时，第三方目录才折算为 1,000,000 上下文窗口；否则保持普通 Claude 模型窗口，不生成 `[1m]` 模型 ID；
- 精确模式下每个账号独立计算 1M 能力；SaaS 固定聚合，因此采用上述保守 AND 规则；
- 运行时图片请求仍按每个账号的实际能力重新过滤，目录声明不能替代路由侧校验；
- 如果没有任何账号支持请求所需能力，返回现有的模型/能力不可用错误，不回退到其他 SaaS 分组。

## 5. 同步触发与错误处理

采用“修改后同步 + 读取/请求兜底”的方案，不引入定时轮询。

### 5.1 主触发点

以下操作提交成功后触发同步：

- 路由账号创建、更新、删除、归档、恢复、状态变化；
- 批量导入、复制账号以及账号模型映射/能力编辑；
- 算力池成员新增、移除、移动；
- 模型模式切换；
- SaaS 分组首次添加或管理员保存分组配置。

触发应发生在核心事务提交之后，避免同步失败回滚普通算力池操作。同步服务本身使用独立事务并按组幂等执行。

### 5.2 兜底触发点

以下路径进入前再次确保目标分组模型状态最新：

- 管理员 `groups.list`、`groups.catalog`；
- 普通用户 `groups`；
- SaaS `/v1/models`；
- `billing::reserve` 和 `reserve_image`。

读取路径先根据排序后的成员 ID、成员配置内容和平台模式计算 `source_fingerprint`；指纹未变化时只做轻量检查，不重复写入；计费路径必须在模型和价格检查之后再创建 reservation。

### 5.3 失败策略

- 算力池主操作成功后，同步失败只记录警告，不阻断账号或成员修改；
- 管理端显示最近一次同步失败提示，并可点击“重新同步”；
- 公共 `/v1/models` 在同步失败时只返回最近一次已持久化且仍有效的 active 模型；
- 新计费请求在无法确认模型身份或价格时 fail closed，返回可重试的 SaaS 服务错误，不创建 reservation；
- 不删除旧价格，不自动把未知模型开放为免费模型。

## 6. SaaS 请求数据流

以 Claude SaaS 请求 `provider-sonnet` 为例：

1. API Key 解析出固定分组和平台；
2. 若分组同步指纹已变化，先在同一数据库连接上完成模型归一化；
3. 同步服务确认 `provider-sonnet` 是 active、enabled 且已定价；
4. `permitted_accounts_connection` 使用 `SaasUpstream`，按各账号的 `to` 能力筛选，并排除暂停/冷却账号；
5. `billing::reserve` 保存用户请求的公共模型名、价格快照和 `upstream_model=provider-sonnet`；
6. SaaS 代理把请求体模型改为 `provider-sonnet`，给内部通用代理附加 `SaasUpstream` 上下文和账号访问范围；
7. 通用代理对每个选中账号只在必要时应用其 fallback 映射，不再次把真实 `to` 误当 alias；
8. 原有协议桥接、重试、用量观察、结算和日志流程不变。

## 7. 前端行为

### 7.1 账号映射编辑

Claude 映射行继续显示：

- 图片输入能力；
- 图片生成/编辑能力（适用平台）；
- Claude alias 支持的 1M 选项。

模板行更新必须基于现有对象展开，而不是只重新构造 `from`、`to`、`label`、`supports_1m`，以保留 `supports_image_input`、`capabilities` 和未来新增字段。

### 7.2 SaaS 分组编辑器

- Claude 分组的模型候选自动来自当前算力池的真实 `to`；
- Claude 的公开模型名与上游模型名显示为同一个只读值；
- 新模型显示“待定价”，不能因为价格字段为 0 自动启用；
- 已存在模型的价格编辑保持不变；
- stale 模型显示恢复/删除操作；删除只清除历史价格记录，不影响算力池；
- `groups.save` 接受模型的 `enabled` 状态，`groups.sync` 只更新模型身份和生命周期，不覆盖价格或管理员启用状态；
- 保存后刷新模型同步状态、可用账号数和模型能力提示。

## 8. 测试设计

### Rust 单元测试

`route_model_capability`：

- `from` 优先于 `to`；
- `SaasUpstream` 只按 `to` 匹配；
- fallback 在上游模式下只承担兜底改写；
- 相同 `to` 的图片能力 AND 合并；
- `supports_1m` 生成 1,000,000 上下文窗口但不生成 `[1m]` 第三方 ID；
- 聚合/精确第三方目录分别输出裸 `to` 与 `{prefix}/{to}`。

`route_proxy_service`：

- SaaS 上下文不会二次改写 `to`；
- `A→B`、`B→C` 映射链按上下文得到正确目标；
- fallback 账号仍可收到并改写请求；
- 精确前缀、未知前缀和真实厂商路径行为不回归。

`saas/domain/model_sync`：

- 首次同步生成 pending 模型；
- 同步不覆盖已有价格；
- alias 到 `to` 的旧行迁移；
- stale 隐藏、重新出现恢复；
- 重复同步幂等；
- 多账号同 `to` 的能力和可用账号数正确聚合。

SaaS 代理/账务：

- `/v1/models` 只返回 active、enabled 且有可用账号的模型；
- 未定价模型不创建 reservation；
- Claude Messages、Responses 均可进入允许的入口；
- reservation 的价格快照和公共模型名保持不变。

### 前端测试

- Claude 映射模板编辑保留全部能力字段；
- 第三方客户端配置写入真实 `to`；
- WorkBuddy Claude URL 为 `/v1/responses`；
- SaaS 编辑器展示自动同步模型、待定价和 stale 状态，并覆盖 `groups.sync` 重试；
- 价格编辑不会改变自动生成的 Claude 模型身份。

## 9. 验收命令

实现阶段使用以下命令验证，Rust 构建目录统一为 `src-tauri/target-codex/`：

```text
pnpm typecheck
pnpm test:run
pnpm release:manifest:test
pnpm rust:check
pnpm rust:test
CARGO_TARGET_DIR=target-codex cargo test --lib services::route_model_capability
CARGO_TARGET_DIR=target-codex cargo test --lib saas
```

完整测试执行时，工作目录为 `src-tauri`，不得创建其他 Cargo target 目录。
