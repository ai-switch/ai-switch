# 多模态网关：视频渠道（G-P1 / G-P2c / G-P3 / G-P4）

## 背景

`otools-aigv` 插件的视频链路（P2c）已经收敛成「一份 `openai-videos` 契约（对齐 new-api）+ 少量
`vendor-task` 描述符兜底」。要让「装了 ai-switch 的用户少配 key」，网关侧必须提供同一份契约的**服务端**：
插件只认一个 `baseUrl` + 一个 `sk-` token，供应商差异全部在网关里吃掉。

设计依据：`otools-aigv/docs/模型提供方配置架构设计.md` 第七章（网关层 vs 插件层），
编号沿用 **G-** 前缀与插件侧 P 对齐。产品取舍取 §7.8 的 **(a) 无头网关 + 渠道管理**——
只加「视频渠道类型 + 统一端点 + 协议转换」，**不动导航与生成会话模型**（G-P5 暂不做）。

## 对外契约（new-api 对齐）

```
POST /v1/video/generations
  model / prompt / duration / fps / width / height / image / seed / n / metadata
→ 201 { id, object:"video", model, created_at, task_id, status:"processing" }

GET /v1/video/generations/{task_id}
→ 200 { task_id, status:"processing"|"succeeded"|"failed", url, format, metadata, error }
```

- `metadata` 是逃逸口：`negative_prompt` / `aspect_ratio` / `resolution` / `size` / `callback_url` …（各家私有参数不进主契约）。
- 状态枚举统一成 `processing` / `succeeded` / `failed`。
- 平台（渠道）由 `x-ai-switch-platform` 请求头指明，请求体里的 `platform` 字段是同语义的 curl 友好兜底；
  取值形如 `video:kling` / `video:seedance` / `video:minimax` / `video:zhipu` / `video:sora`。
  **方言不可能从 `model` 推出来**（同一个模型名各家都可能存在），所以必须由调用方指明渠道。

## 档位与进度

| 档 | 内容 | 状态 |
| --- | --- | --- |
| G-P1 | `Provider.kind` 语义扩为「模态:协议」（如 `video:kling`）；`dialect_from_provider_kind` 解析 | ✅ 已落地（含 `PlatformId::Video(VideoProtocol)`） |
| G-P2c | `/v1/video/generations` 契约 + 五家方言协议转换（kling / ark / minimax / zhipu / sora） | ✅ 已落地（`protocol.rs`） |
| G-P3 | 异步任务表 + 轮询推进 + 回调 `callback_url` | ✅ 已落地（`videogen/service.rs` + 常驻轮询调度器） |
| G-P4 | 计费计量单位扩展（次/秒、字符）——Saas 模块 | ✅ 已落地（按「条」+ 按「秒」相加计价；SaaS 全链路已打通并有端到端测试） |
| G-P5 | Generate TAB 合并（图像/视频/音频内 tab） | ⬜ 暂不做（仅 option (b) 才需要） |

## 第一轮落地内容（G-P1 / G-P2c）

- **迁移** `src-tauri/migrations/202610090001_video_generation.sql`：`videogen_sessions` / `videogen_messages`
  / `videogen_assets` / `videogen_tasks`（外键 `ON DELETE CASCADE`/`SET NULL`），并在
  `src-tauri/src/database/migration_checksums.txt` 里固定其 SHA-384。
- **`src-tauri/src/videogen/`**：
  - `models.rs`：会话 / 消息 / 资产 / 任务 + 输入 DTO。
  - `protocol.rs`：new-api 契约的请求/响应构造 + 五家方言的上游请求体、提交响应取 taskId、状态响应统一。
  - `repository.rs`：会话/消息/资产 CRUD + 任务生命周期（`create_task` / `list_active_tasks` / `progress_task` / `mark_callback_delivered`）。
  - `mod.rs`：模块声明。
- **接线**：`lib.rs` 加 `mod videogen;`；`paths.rs` 加 `videogen_dir`；
  `services/route_proxy_service.rs` 加 `requested_video_capability` 并在候选过滤里与图像能力并列。

## 第二轮落地内容（G-P3 / G-P4）

### 1. 平台身份：`PlatformId::Video(VideoProtocol)`

原设计里 `PlatformId` 是**无载荷**的闭合枚举，`PlatformId::parse("video:kling")` 直接拒绝，
所以视频请求根本进不了 `forward_request`（它内部要 `PlatformId` 来做候选过滤与访问域）。

做法：给 `PlatformId` 加一个**携带协议段**的变体 `Video(VideoProtocol)`，
`VideoProtocol ∈ {Kling, Ark, MiniMax, Zhipu, Sora}` 定义在 `models/platform.rs`
（不能放进 `videogen`：`videogen` 依赖 `models`，反过来会成环）。

- `as_str()` / `display_name()` **保持返回 `&'static str`**。中途试过改成 `String`，
  结果在 13 个文件里炸出 89 个 `E0308`；改回静态字面量（视频 5 个取值用显式表）后
  总错误从 96 降到 6。这是本轮最关键的取舍。
- 每个「视频不适用」的能力都给**显式且带文档**的答案，而不是静默回退：
  `capability.video_no_config_write` / `capability.video_model_test_separate` /
  `capability.video_not_an_agent`（`platform_capability_service.rs`），
  deeplink / model_test / official base_url 各自给 `unreachable!` 或显式错误。
- `videogen/protocol.rs` 加了 `VideoProtocol ↔ VideoDialect` 双向 `From`，
  并有 `dialect_and_platform_protocol_round_trip` 断言两张表字面量不漂移。

### 2. 服务层 `videogen/service.rs`

```
submit   → 转方言体 → forward_request 打上游 → 取上游 task_id → 落 videogen_tasks → 回 201 体
status   → 默认读本地；refresh=1 时先向上游拉一次（客户端不必等轮询 tick）
poll_once / advance_all → 推进在途任务，终态落 url/error
deliver_callback → 终态且带 callback_url 时投递一次，成功后 mark_callback_delivered
run_loop → 常驻轮询调度器（10s 一跳，单轮最多 32 个任务，最多 240 次尝试）
```

- 上游调用**统一走 `forward_request`**，不自己建 reqwest client：账号池选择、冷却、
  并发闸门、失败记分、请求日志、SaaS 访问域全部复用，与图像链路一致。
- **`with_access_scope(PlatformId, HashSet<String>)` 是本轮的关键机制**：提交与轮询都把请求
  钉死在它的渠道上（一个串进来的 `x-ai-switch-platform` 头或入站 key 都不能把它路由进文本池），
  同时把 SaaS 请求收窄到计费时白名单里的账号。
- 轮询调度器在 `server.rs` 与 `desktop.rs` 里与 `RouteRecoveryService::run_loop` 并列 spawn；
  没有在途任务时循环是空转，几乎不耗资源。

### 3. 计费（G-P4）

- 迁移 `src-tauri/src/saas/migrations/0007_video_billing.sql`：
  `saas_group_models` 加 `video_price_micros`（SaaS 迁移用自算校验表 `saas_schema_migrations`，
  不需要进 `migration_checksums.txt`）。
- `saas/billing`：`reserve_video`（按「次」计价，快照 `{"kind":"video",…}`，要求 `video.generate` 能力）
  与 `settle_video`。
- **异步语义**：与图像（同步）不同，视频 `POST` 只拿到一个 `task_id`，上游此时**已经开始算**。
  所以**在提交那一刀计费**（2xx → `settle_video(count=n)`；失败 → `count=0` 退款），
  轮询活在守护循环里、**绝不挂在 HTTP 请求生命周期上**。
  任务后续失败**不自动退款**：上游算力已经烧掉了。
- `saas/proxy`：端点白名单加 video，`execute_video_request` 做
  reserve → 带 `credential_ids: Some(reservation.credential_ids)` 与
  `upstream_model: Some(reservation.upstream_model)` 提交 → settle → 记日志 → 201。
- **SaaS 侧的平台白名单**：`authenticate_key` / `core_group` / `keys.create` /
  `reconcile_group_connection` / `groups.list` / `groups.available` 六处原本都只认文本平台，
  把视频渠道整条链路挡死（详见「遗留 0」的已解决记录）。现已统一放开，
  并有端到端测试兜住。

### 4. HTTP 路由

`shared_fallback` 在进 `proxy_handler` **之前**分流视频路径：
它需要「先转方言体 → 打上游 → 落任务 → 回 201」这套异步流程，不是逐字节透明转发。
分流时先摘掉未授权请求的 `x-ai-switch-platform` 头（与既有代理路径同一套防伪）。

### 5. 前端：视频渠道管理（第三轮）

**UX 落点**（用户定）：侧边栏**一个「视频」入口**，账号列表里每行用 **TAG** 标出上游协议。

实现要点：

- `src/lib/videoPlatforms.ts`（新）：5 个方言的**单一来源**——既是「可选协议」列表，
  也是「账号 `platform` → 展示名」的映射（`video:ark` 显示成 Seedance）。
- `src/screens/VideoChannelsScreen.tsx`（新）：把 5 个方言的账号**合并成一屏**管理，
  每行 TAG 标协议；支持新增 / 编辑 / 启用停用 / 删除。
  - 模型映射用 JSON 文本框，**校验每条都必须带 `video.generate`**——少了它网关在账号池里
    根本选不到这个账号，必须在界面上拦住。
  - 编辑时协议**不可改**（`update_route_credential` 没有 platform 字段），key 留空表示不改动。
  - `interface_format` 固定 `openai`：五家上游都用 `Authorization: Bearer`。
  - 刻意不做：官方账号导入、写 CLI 配置、模型测试、终端/会话——后端能力矩阵对这四项
    给的就是 `unavailable`，界面上也不该出现。
- 导航接线：`AgentPlatform` 加一个**伪平台** `video`（不是真实平台值，5 个方言合成一屏），
  于是可见性开关、设置页的勾选列表都白拿。连带处理三处：
  - `SessionsScreen`：会话筛选下拉**排除** video（视频没有会话，列出来是恒为 0 的死选项）；
    `platformLabels` 仍补上 `video` 只为类型完整。
  - `SettingsScreen` 的 `agentLabelKeys` 补 `video`（可见性勾选里要有它，才能隐藏）。
  - `App.tsx`：`AccountsScreen` 的 `platform` 是真实平台值，所以 `video` 要**排除**在它之外，
    改渲染 `VideoChannelsScreen`。
- 顺带补上 `platformCapabilities.ts` 里缺的 3 个视频 reason code
  （`capability.video_no_config_write` / `video_model_test_separate` / `video_not_an_agent`），
  否则界面只会显示兜底文案。
- `RouteCredentialImportDialog` 的平台下拉接上 `VIDEO_PROTOCOLS`，导入也能选视频平台。

**测试**：`tests/VideoChannelsScreen.test.tsx`（6 例：合并列表 + TAG、空态、缺
`video.generate` 被拦、按所选协议创建、启用停用、编辑不动平台与 key）+
`tests/lib/videoPlatforms.test.ts`（4 例）。

### 6. SaaS 管理端支持视频定价

后端计费早已支持视频（迁移 0007 / 0008），但管理端没有填价入口，只能靠 SQL 或接口写。

- `src/saas/types.ts`：`ModelPrice` 加 `videoPriceMicros` / `videoPricePerSecondMicros`。
- `src/saas/admin/Groups.tsx`：定价表加「视频 · USD/条 + USD/秒」列；每个模型行加两个
  输入（USD/条、USD/sec），后者的 hint 写明与前者**相加**，避免被当成二选一；
  保存时两列一起提交——`groups.save` 是整行覆盖 `saas_group_models`，漏掉就会把已存的
  视频价格清成 0。
- **顺带修一个显示 bug**：平台徽标原本是 `codex ? … : gemini ? … : "Claude"` 的三元表达式，
  视频分组会被显示成 "Claude"。抽成 `platformLabel()`，视频显示「Video · Kling」。
- `SaasEndpoint` 原本只有 `codex | claude | gemini`（后端 SaaS 平台白名单的前端镜像），
  改为从 `VideoPlatform`（`video:${VideoProtocol}`）推导，保持单一来源。

## 验证

```bash
cd src-tauri
CARGO_TARGET_DIR=target-codex cargo check --lib
CARGO_TARGET_DIR=target-codex cargo test --lib
```

- `cargo check --lib`：**通过，0 error**（89 条 warning 全部是既有告警，本轮新增文件零告警）。
- `cargo test --lib`：**1968 passed / 0 failed / 13 ignored**（整仓，128s）。
- `npx tsc --noEmit`：**0 error**。
- `npx vitest run`：**953 passed / 0 failed**（81 个文件；`src/` 下没有测试文件，
  前端测试都在仓库根的 `tests/`）。
- 分套件：`videogen` 12 例（新增 `dialect_and_platform_protocol_round_trip`、
  `minimax_polls_through_query_string`、`platform_hint_round_trips_to_a_dialect`、
  `every_dialect_extracts_the_video_url_from_a_success_response`、
  `builds_the_remaining_three_dialects_and_their_paths`、
  `kling_submit_poll_and_callback_run_end_to_end`）、
  `web::video_routes` 4 例（新增 `dispatches_methods_and_maps_errors_to_status_codes`，
  覆盖 405 / 404 / 400 分派）、
  导入服务 35 例（新增 `video_channels_are_importable_and_normalize_to_their_canonical_platform`）、
  `saas` 109 例（新增 `saas_video_request_authenticates_reserves_submits_and_bills_per_video`、
  `saas_video_key_cannot_reach_text_endpoints`、`video_pricing_adds_the_flat_and_per_second_prices`、
  `video_pricing_rejects_unpriced_models_and_out_of_range_inputs`）、
  `platform` 81 例（新增 3 例视频渠道解析/拒绝/遍历）、`migration` 11 例，全过。

**已覆盖 vs 未覆盖**（写清楚，免得下次误判）：

| 面 | 状态 |
| --- | --- |
| 五家方言的上游体 / 提交响应取值 / 提交与状态路径 / 成功响应取 url | ✅ 单测 |
| 直连网关链路（提交 → 查询 → 轮询 → 终态 → 回调 → 不重复投递） | ✅ 集成测试（真 mock 上游 + 真库） |
| HTTP 入口的方法分派与 400/404/405 映射 | ✅ 单测 |
| 平台钉死、能力收窄、账号池选择 | ✅ 集成测试间接覆盖 |
| 视频渠道的导入（含别名归一） | ✅ 单测 |
| 前端视频渠道管理（合并列表 + TAG、增删改、能力校验） | ✅ 组件测试 |
| SaaS 管理端的视频定价（按条 + 按秒）与平台徽标 | ✅ 组件测试 |
| `reserve_video` / `settle_video` 的计费与退款 | ✅ 集成测试（SaaS 全链路）+ 定价矩阵单测（起步价 / 按秒 / 相加 / 越界 fail closed） |
| `execute_video_request` 的 HTTP 行为 | ✅ 集成测试（201 契约体、日志、模型名不泄漏） |
| 视频 key 的端点边界 | ✅ 单测（不能打文本端点） |

### 端到端验证（真上游 mock + 真库）

单测只覆盖协议转换，账号池选择 / 平台钉死 / 上游 URL 拼接 / 能力收窄 / 回调投递
这些只有在真跑一次时才暴露。所以补了一条集成测试
`videogen::service::tests::kling_submit_poll_and_callback_run_end_to_end`：
起一个 axum mock 上游（可灵方言的提交 + 状态 + 一个回调接收点）+ 内存库，
走完「提交 → `refresh=1` 查询 → 轮询到终态 → 回调投递 → 再 tick 不重复投递」。

**它抓出了两个真 bug（都已修）：**

1. **直连（非 SaaS）视频链路永远选不出账号**。`ProxyAppState::with_access_scope` 的
   `credential_ids` 是无条件集合，而 `videogen::proxy_state` 在 `credential_ids: None`
   时传了 `unwrap_or_default()`（空集）。空集在 `load_scoped_candidates` /
   `restrict_candidates` 里的语义是「一个都不允许」（SaaS fail-closed 需要它），
   于是直连路径在 `forward_request` 里直接返回 `No enabled route credentials in pool`。
   修法：`credential_ids` 改成 `Option<HashSet<String>>`，`None` = 不限制账号子集，
   新增 `with_platform_scope(platform)`（只钉平台、不限账号）供直连路径使用。
   `Some(空集)` 的 fail-closed 语义原样保留（既有测试 `saas_access_scope_filters_…` 仍通过）。
2. **可灵 / 智谱 / Sora 永远取不到视频地址**。`protocol::dig` 用 `Value::get(&str)` 走点号路径，
   而它**不能索引数组**；这三家的地址都在数组里（`data.task_result.videos.0.url`、
   `video_result.0.url`、`output.0.url`）。取不到 url 时 `poll_once` 会把「上游说成功但没有 url」
   判成失败，症状离根因很远。修法：`dig` 在遇到数组时把数字段当下标。
   同时补了 `every_dialect_extracts_the_video_url_from_a_success_response`
   把五家的「成功」响应都钉住——原来的单测只覆盖了 Ark（无下标）+ 智谱失败 + Sora 处理中，
   恰好绕开了全部数组路径。

- 全仓 `cargo test --lib`：**1961 passed / 0 failed / 13 ignored**。
- `cargo check --no-default-features --features standalone-server --bin ai-switch-server`：0 error
  （视频轮询调度器在无 tauri 的独立服务端里同样编译通过）。

## 实现备忘（给后续接线的人）

- **`video:kling` 落在 `route_credentials.platform` 列，不是 `kind` 列**。
  `kind` 有 `CHECK (kind IN ('official','api'))`，视频账号必须写 `kind='api'`；
  `platform` / `route_pool_members.platform` / `route_pool_groups.platform` 都是自由 TEXT，无约束。
- 账号池三张表的 platform 必须**同时**等于目标平台（`rpm.platform = c.platform AND
  groups.platform = c.platform`），且直连路径额外要求 `route_pool_groups.is_active = 1`
  （SaaS 路径因为按 id 白名单取，不查这个字段）。
- 账号的 `config_json.model_mappings[].capabilities` 必须包含 `video.generate`，
  否则会在 `forward_request` 的能力收窄那一步被过滤掉。

## 遗留 / 后续

0. ~~**SaaS 侧视频链路完全不可达**~~ —— **已解决**。原状：SaaS 模块里**六处**硬编码的
   平台白名单把视频渠道挡在门外，**每一处单独就足以致命**，于是
   `execute_video_request` / `reserve_video` / `settle_video` 全是死代码、也无测试：

   | 位置 | 原语句 | 后果 |
   | --- | --- | --- |
   | `saas/billing/mod.rs` `authenticate_key` | `groups.platform IN ('codex','claude','gemini')` | 视频组的 key **认证不过** → 拿不到 principal |
   | `saas/domain/groups.rs` `core_group` | `platform IN ('codex','claude','gemini')` | `permitted_accounts_*` 拿不到组 → `reserve_video` 必返回 `saas.empty_pool`；`groups.save` 也走它，所以**连定价都写不进去** |
   | `saas/domain/keys.rs` `keys.create` | `platform IN ('codex','claude')` | 视频组**发不出 key** |
   | `saas/domain/model_sync.rs` `reconcile_group_connection` | `platform IN ('codex','claude','gemini')` | `reserve_video` 内部会调它 → `saas.group_not_found` |
   | `saas/domain/groups.rs` `list` | Rust 侧 `SUPPORTED_PLATFORMS` 数组 + `platform=?` 前校验 | `groups.list {platform:"video:kling"}` 报 `Unsupported platform` |
   | `saas/domain/groups.rs` `available` | `platform IN ('codex','claude','gemini')` | 后台看不到视频组 |

   `core_group` 是**关键那一个**：`groups.save`（`saas_group_models` 的唯一写入路径）、
   `permitted_accounts_*`、`group_json`、`catalog` 全都经过它。放开它，整条链路才通。

   **做法**：SQL 侧统一加 `OR platform LIKE 'video:%'`（而不是列 5 个方言字面量——
   `Provider.kind` 是「模态:协议」，新方言不该再改一次 SQL；协议段的合法性由
   `PlatformId::parse` 在凭据/导入边界把关）。Rust 侧的 `SUPPORTED_PLATFORMS` 常量换成
   `fn supported_platforms()`，从 `VideoProtocol::ALL` 推导，成为 SaaS 平台白名单的单一来源。

   **另外修掉的两个问题**（都是打通后才暴露的）：
   - **视频 key 能打到文本端点**：端点白名单只按路径判断，`principal.platform` 的三条规则
     （claude/gemini/codex）都不匹配 `video:*`，于是视频 key 能走到文本预留，
     再被 `reserve` 的白名单挡下，报出来是误导性的 `saas.invalid_key`。补了对称规则
     `principal.platform.starts_with("video:") && !videos`。
   - **201 响应体回显内部上游模型名**：`execute_video_request` 原来把 `payload.model`
     改写成 `reservation.upstream_model`，`submit` 又用 `request.model` 拼响应体，
     于是 SaaS 用户看到的是 `kling-v1-upstream`（信息泄漏 + 与请求对不上）。
     修法：`SubmitVideoInput` 新增 `upstream_model`，把「客户端看到的名字」（进响应体与
     任务表 `model` 列）与「上游认的名字」（进上游体与任务表 `upstream_model` 列）分开。
     **顺带纠正一个错误认知**：`forward_request` 的 model_mappings 只认 OpenAI 风格的
     `model` 字段，可灵的上游体用的是 `model_name`，**改写不到**——所以 SaaS 的显式
     `upstream_model` 不是冗余，是必需的。

   **验证**：`saas_video_request_authenticates_reserves_submits_and_bills_per_video`
   （认证 → 预留 → 提交上游 → 按条结算 → 写日志，含响应体模型名与任务表两列的断言）
   与 `saas_video_key_cannot_reach_text_endpoints`。

1. ~~**前端没有视频渠道入口 / SaaS 后台没有视频定价入口**~~ —— **都已解决**：
   本地渠道管理见「第三轮：前端」，SaaS 定价见「第六轮：SaaS 管理端」。
   至此「跑视频」的两条路径在界面上都完整了：
   - **本地直连**：在侧边栏「视频」屏新增渠道 → 客户端带
     `x-ai-switch-platform: video:kling` 打 `/v1/video/generations`；
   - **SaaS**：管理端建视频分组并定价（按条 + 按秒）→ 发 `sk-saas-` key → 同一个端点。

   **导入路径也仍然可用**（界面上也能选到视频平台）：`video:kling` / `video:seedance`
   （别名归一成 `video:ark`）都能导入成账号。
2. ~~**按「次」计价覆盖不了时长成本差**~~ —— **已解决**（迁移 `0008_video_price_per_second.sql`）。
   加列 `video_price_per_second_micros`，计价口径是**相加**而不是二选一：

   ```
   单条价格 = video_price_micros + video_price_per_second_micros × 时长秒数
   ```

   相加能同时表达三种配置且不必额外加开关：只配起步价（`per_second` 默认 0，
   **既有行一分钱都不变，向后兼容**）、只配按秒价（纯按秒）、两个都配（起步价 + 按秒）。
   单价在**预留时**就折算成最终值写进预留快照的 `unitPriceMicros`，
   所以 `settle_video` 一行没改——它本来就只按快照单价乘条数。

   **两个实现细节值得记**：
   - 计价用的时长与发到上游的时长**共用同一个来源**：`protocol::effective_duration_seconds()`
     与 `upstream_body` 共用 `DEFAULT_VIDEO_DURATION_SECONDS`。否则「按秒收费」的秒数会和
     实际发给上游的秒数对不上。
   - `execute_video_request` 改成**先解析契约体、再预留**：这样时长只有一个来源，
     并且解析失败时还没预留，原来那支「解析失败要退款」的分支直接消失了。
3. **没有 `/v1/video/models` 目录端点**：原先 `service.rs` 里有个 `list_models`（从账号池的
   `model_mappings` + `video.generate` 推导模型目录），但它没有任何调用方、也不在约定契约里
   （计划只约定 `/v1/video/generations` + `GET /{task_id}`），已删除。图像侧同样没有目录端点，
   客户端自己配模型名——视频保持一致。等前端/插件真需要目录时再按当时的需求加。
4. **G-P5 生成会话模型暂缓**：`videogen/models.rs` 与 `repository.rs` 里的
   会话/消息/资产类型与 CRUD 目前只有测试覆盖，所以这两个文件保留了 `#![allow(dead_code)]`
   （文件头写明了原因）。**G-P5 落地时应当移除**，让编译器重新盯着这批类型。
   `PlatformId::all_with_video()` 是「遍历所有平台（含视频）」的扩展点，
   目前只被测试与导入去重用到；前端接入视频渠道时应改用它。

