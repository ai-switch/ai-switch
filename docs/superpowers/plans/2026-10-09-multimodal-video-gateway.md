# 多模态网关：视频渠道（G-P1 / G-P2c / G-P3 / G-P4 / G-P6）

## 背景

`otools-aigv` 插件的视频链路（P2c）已经收敛成「一份 `openai-videos` 契约（对齐 new-api）+ 少量
`vendor-task` 描述符兜底」。要让「装了 ai-switch 的用户少配 key」，网关侧必须提供同一份契约的**服务端**：
插件只认一个 `baseUrl` + 一个 `sk-` token，供应商差异全部在网关里吃掉。

设计依据：`otools-aigv/docs/模型提供方配置架构设计.md` 第七章（网关层 vs 插件层），
编号沿用 **G-** 前缀与插件侧 P 对齐。产品取舍取 §7.8 的 **(a) 无头网关 + 渠道管理**——
只加「视频渠道类型 + 统一端点 + 协议转换」，**不动导航与生成会话模型**（G-P5 暂不做）。

> **音频渠道（TTS）见 [`2026-10-11-multimodal-audio-channel.md`](./2026-10-11-multimodal-audio-channel.md)（G-P7）。**
> 它与本文档同源但结构更简单：音频是**同步**接口，不需要任务表、轮询、回调，
> 也**不需要自己的 HTTP 入口**——直接复用 `forward_request`。

## 对外契约

网关提供**两套**契约，指向同一套任务、同一套上游方言、同一套计费与轮询。

### ① new-api 对齐（G-P2c）

```
POST /v1/video/generations
  model / prompt / duration / fps / width / height / image / seed / n / metadata
→ 201 { id, object:"video", model, created_at, task_id, status:"processing" }

GET /v1/video/generations/{task_id}
→ 200 { task_id, status:"processing"|"succeeded"|"failed", url, format, metadata, error }
```

- `metadata` 是逃逸口：`negative_prompt` / `aspect_ratio` / `resolution` / `size` / `callback_url` …（各家私有参数不进主契约）。
- 状态枚举统一成 `processing` / `succeeded` / `failed`。

### ② OpenAI 原生（G-P6，见 §9）

```
POST /v1/videos
  model / prompt / seconds / size / input_reference
→ 201 { id, object:"video", model, created_at, status:"queued", progress, seconds, size }

GET  /v1/videos/{video_id}
→ 200 { id, object:"video", model, created_at, status, progress, seconds, size, url, error }

GET  /v1/videos/{video_id}/content
→ 200 视频字节流（video/mp4）
```

- 状态枚举是 OpenAI 那套：`queued` / `in_progress` / `completed` / `failed`。
  **与 ① 不同是刻意的**，客户端按哪套契约写的就按哪套读。

### 平台与供应商

**鉴权与渠道选择是同一件事**：客户端用 `Authorization: Bearer sk-ai-switch-video`
（或 SaaS 的 `sk-saas-` key），平台由**入站 key** 解析。`x-ai-switch-platform` 是特权本地
诊断覆盖，不是对外契约（见 §4.1）。

平台**只有 `video` 一个值**：可灵 / 方舟 / MiniMax / 智谱 / Sora 的差别是线协议，住在账号的
`config_json.interface_format` 里，落到哪家由请求里的 `model` 名决定。调用方**不需要、也不应该**
指定供应商（见 §8）。

## 档位与进度

| 档 | 内容 | 状态 |
| --- | --- | --- |
| G-P1 | `Provider.kind` 语义扩为「模态:协议」（如 `video:kling`）；`dialect_from_provider_kind` 解析 | ✅ 已落地（含 `PlatformId::Video(VideoProtocol)`） |
| G-P2c | `/v1/video/generations` 契约 + 五家方言协议转换（kling / ark / minimax / zhipu / sora） | ✅ 已落地（`protocol.rs`） |
| G-P3 | 异步任务表 + 轮询推进 + 回调 `callback_url` | ✅ 已落地（`videogen/service.rs` + 常驻轮询调度器） |
| G-P4 | 计费计量单位扩展（次/秒、字符）——Saas 模块 | ✅ 已落地（按「条」+ 按「秒」相加计价；SaaS 全链路已打通并有端到端测试） |
| G-P5 | Generate TAB 合并（图像/视频/音频内 tab） | ⬜ 暂不做（仅 option (b) 才需要） |
| G-P6 | OpenAI 原生视频契约 `/v1/videos`（提交 / 查询 / 内容下载） | ✅ 已落地（见 §9） |

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

#### 4.1 平台解析：以 key 为准（修正）

**原来的实现是错的，会让端点对 OpenAI 兼容客户端完全不可用。**

`x-ai-switch-platform` 在 ai-switch 里的定位是**特权本地诊断覆盖**（代码注释原话：
"a privileged diagnostic override, not an alternative to API-key auth"）——
只有持有本地 token 的桌面端能用，外部请求的这一头会被 `shared_fallback` 摘掉。
外部客户端（也就是 OpenAI 兼容客户端）走的是**入站 key**：`route_proxy_keys` 把
`sk-ai-switch-…` 映射到平台，文本平台一直是这么做的。

而视频最初只认「请求头 → 请求体 `platform` 字段」。于是：
一个用**合法 route proxy key** 通过了鉴权的请求，到这里既没有头也没有体字段，
被 400 挡回 —— 也就是说 `/v1/video/generations` 对任何 OpenAI 兼容客户端都不可用，
而「插件只认一个 baseUrl + 一个 token」正是整个 G- 系列的设计前提。

修法：`resolve_video_platform` 的优先级改成与 `route_proxy_service::resolve_platform`
**完全一致**，key 排第一：

1. 入站 API key（`Authorization: Bearer sk-ai-switch-…` / `x-api-key`）；
2. `x-ai-switch-platform` 请求头（特权本地覆盖）；
3. 请求体 `platform` 字段（curl 便利）。

key 与平台是**一一对应**的，所以每个协议一张 key（`video:kling` / `video:ark` …），
与文本平台的 `sk-ai-switch-codex` 是同一套 `route_proxy_keys` 表、同一个
`get_route_proxy_key` 命令 —— 无需新增任何机制（`get_or_create_platform_key`
只校验 `PlatformId::parse`，不查能力矩阵，所以 `video:kling` 的 key 本来就能签发）。

前端在「视频」屏加了**「接入信息」**：摊开端点与 5 个协议各自的 key（复制/显示用
`EndpointRow`，与 `AccountsScreen` 的配置写入对话框同一组件）。key 只在打开该对话框时
读取 —— 读取会在不存在时创建它，不该因为用户路过这一屏就凭空签发 5 张 key。

顺带把 `video.subtitle` 的文案从「用 x-ai-switch-platform 头指定渠道」改成
「用各自的 key 指定渠道」—— 文案原来在教用户做错的事。

### 5. 前端：视频渠道管理（第三轮）

**UX 落点**（用户定）：**一个「视频」入口**，账号列表里每行用 **TAG** 标出上游协议。
   > 后续变更（2026-10-12）：这个入口不再挂在侧边栏，而是收进 codex 页的模态分段器
   > （`通用 / 生图 / 视频 / TTS`）。见
   > [`2026-10-12-unified-pool-and-modality-segments.md`](./2026-10-12-unified-pool-and-modality-segments.md)。

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

### 7. 复审修正（G-P4 补强）

对整轮（`b8535dd..HEAD`，49 文件 / +4463）做了一次逐文件复审，抓出 5 个真 bug 并修掉。
下面只记**已修**的；未修的见「遗留」。

#### 7.1 SaaS 侧状态查询完全不可达（异步契约断一半）

`saas::proxy::execute` 的端点守卫写的是 `method != Method::POST`，于是
`sk-saas-` key 查 `/v1/video/generations/{task_id}` 只会拿到
`saas.endpoint_not_allowed` —— **提交能用、轮询不能用**。而视频是异步任务 API，
客户端不轮询就只剩可选的 `callback_url`。

修法：守卫放行「视频路径 + GET」，并在读 body **之前**分派（状态查询没有请求体，
否则空体会先撞 `saas.validation`）。新增 `execute_video_status`。

#### 7.2 状态查询没有归属校验（越权读）

`videogen_tasks` 原本**没有任何「属于谁」的列**，所以一旦放开查询，任何
`sk-saas-` key 都能按 task_id 读到别人的任务和出片地址。task_id 是 UUIDv4 猜不到，
但出片地址是**可用的签名 CDN 链接**，不该靠「猜不到」当访问控制。

修法：迁移 `202610100001_video_task_owner.sql` 加 `owner_user_id`；
`SubmitVideoInput.owner_user_id` 由 SaaS 路径填 `principal.user_id`（直连留 NULL）；
查询时比对，不匹配回答 `videogen.task_not_found`（**不是**「无权访问」——
后者会泄漏 task_id 是否存在）。

#### 7.3 `callback_url` 零校验（SSRF）

`deliver_callback` 直接把客户端给的地址交给 `reqwest.post`。SaaS 场景下网关是
**运营方的机器**，于是任意租户都能让网关去打内网，最典型的是云元数据端点
`http://169.254.169.254/latest/meta-data/…`。

修法：新增 `validate_callback_url(raw, policy)`，提交时校验（坏地址不落库）、
投递前再校验一次（兜住旧行与直接改库）。策略是**参数**而不是常量，因为两个部署
模式的威胁模型不同：

| 类别 | `Local`（桌面） | `Server`（`standalone-server`） |
| --- | --- | --- |
| 非 http/https、带 userinfo、不是 URL | 拒 | 拒 |
| 链路本地 `169.254/16`、`0.0.0.0`、`::`、元数据主机名 | 拒 | 拒 |
| 回环 / RFC1918 私网 / `localhost` | **放行** | 拒 |

回环在桌面模式放行是刻意的：本应用本地优先，「回调打到本机」是正当用法。
**已知不覆盖** DNS 重绑定（校验时解析公网、请求时解析内网），要封住得在连接建立后
核对对端 IP。

> 实现细节：必须用 `Url::host()` 拿 `Host` 枚举，**不能**用 `host_str()` ——
> 后者对 IPv6 返回带方括号的 `[::1]`，`parse::<IpAddr>()` 会失败，整个 IPv6 分支
> 被静默跳过（复审时第一版就是这么写的，被自己的测试抓到）。

#### 7.4 `n>1` 按条收费但不生效（多收钱）

`upstream_body` **压根不读 `request.n`**，而 `status_response` 的 `url` 是单值。
所以 `n=4` 的语义是「按 4 条收钱、只发 1 条、只回 1 个地址」。

修法：`MAX_VIDEO_COUNT` 从 4 改成 1（`videogen` 与 `saas::billing` 两处），
`n>1` 在**预留之前**显式报错。要支持多条得先让契约能表达多个地址（`urls`），
那是契约层的事，不在网关里糊。

#### 7.5 回调投递失败永远不会重试（注释在说谎）

`list_active_tasks` 只取 `status='processing'`，而终态任务的 `poll_once` 会直接
早返回 —— 所以 `callback_delivered=0` 的任务**永远不会被再碰一次**。
`deliver_callback` 上那句「失败留给下一轮重投」是空话。

修法：迁移加 `callback_attempts`；新增 `list_pending_callbacks` +
`retry_pending_callbacks`（在 `advance_all` 开头跑）；`run_loop` 的空闲判定也要把
「待重投回调」算进来，否则有回调要投时循环会直接 `continue`。预算
`MAX_CALLBACK_ATTEMPTS = 8`，防止死地址变成常驻噪声。

#### 7.6 `/video/generations`（无 `/v1` 前缀）永远 404

`web::video_routes::is_video_submit_path`、`is_video_generation_path`、
`video_task_id_from_path` 都声称认这个别名，但 `shared_fallback` 只在
`is_shared_model_api_path` 为真时才进入代理逻辑，而它不覆盖 `/video/generations`
—— 别名被静默降级成静态兜底 404。「代码声称支持、实际永远 404」。

修法：`is_shared_model_api_path` 补上该别名（含 `/video/generations/` 前缀）。

#### 7.7 顺带清理

- `route_credential_transfer_import_service` 里那条测试的注释说「导入是配置
  `video:kling` 账号的唯一入口」——第三轮加了「视频」屏之后已经不成立，改了。

### 8. 供应商改用 `interface_format` 承载（平台统一成 `video`）

**这是对 G-P1 的推翻。** 原来把供应商放进 `platform`（`video:kling` / `video:ark` …），
但按文本平台已有的分层，`platform` 是**池身份**（路由/鉴权/计价/冷却/key 的单位），
`interface_format` 才是**这个账号说的是哪种线协议** —— `build_api_upstream_request`
里就是 `interface_format` 优先、平台默认兜底（一个 `platform = codex` 的账号完全可以
挂 `interface_format: anthropic`）。

视频的「供应商」恰好就是线协议：可灵 `/v1/videos/text2video` + `model_name`、
方舟的 `content[]`、MiniMax 的 query 轮询、Sora 的 `seconds`+`size`。而视频没有
「给哪个 CLI 用」这回事，所以池身份只有一个：`video`。

放进 `platform` 的代价是一连串的：

| | 旧（`video:kling`） | 新（`video` + `interface_format`） |
| --- | --- | --- |
| key | 5 张 | **1 张** |
| SaaS 组 | 5 个 | 1 个 |
| 平台枚举 | 5 个视频变体 | 1 个 `Video`（无载荷） |
| 跨供应商路由 | 需要一个专门的「路由模式」跨 5 个平台 | **不需要任何机制** |
| 前端 | 早就按「一个入口 + TAG 标供应商」做了 | 与后端一致 |

**跨供应商路由因此变成普通逻辑**：按 `model` 名过滤候选 → 选中的账号自带方言 →
用那个方言建体。没有任何开关或特殊模式。

要点：

- `PlatformId::Video` 去掉载荷；`VideoProtocol` 枚举、两张 5 分支静态表、与
  `VideoDialect` 的 `From` 桥、往返守护测试**全部删除**。
- 旧的 `video:kling` **明确拒绝**并给可照做的提示，不静默接受（静默接受会让账号落到
  一个永远不会被选中的平台值上）。
- 视频方言**不再接受 `openai` 别名**：那是文本 `ApiDialect` 的名字，收了它
  `interface_format: "openai"` 会变成「Sora」这种惊悚的巧合。
- **选号在 `route_proxy_service::video_route_plan`**（候选加载 → 模型过滤 →
  `video.generate` 能力过滤 → 冷却剔除 → 优先级/游标排序 → 按方言分组），复用本模块
  内部机制；视频侧再实现一遍必然漂移。
- `forward_request` 的文本请求构造对视频不适用（`ApiDialect::parse("kling")` 直接失败，
  而协议桥接/模型改写/reasoning 清理对视频全无意义），所以加了一条直路
  `build_video_upstream_request`。
- **轮询钉到提交时的账号**（迁移 `202610100002` 加 `credential_id`）：上游的任务按账号
  隔离，换个账号的 key 查会 404/403；平台统一后账号变多，靠「按平台重选一个」几乎
  必然选错。代价是 `forward_request` 内部的多账号 failover 用不上，改由
  `forward_submit` 自己按 `classify_proxy_failure` 轮（同组方言不变，请求体可复用）。
- 跨供应商游标由调用方推进：`forward_request` 只看到一个账号，它的推进是
  `(0+1)%1=0`，会把游标按回 0。
- 凭据服务 `validate_interface_format` 改成**按平台分**：两个方向都必须拦 —— 视频方言
  塞进 `ApiDialect` 会污染文本的路径规范化；文本方言出现在视频账号上是静默死数据。
- 导入：视频条目复用 `openai-compatibility` 分区（`api-key-entries`/`base-url` 的提取
  是按分区走的，另造分区拿不到 key），但平台声明为 video 时跳过「分区→方言」检查。

**顺带修掉的不一致**：`/v1/models` 两条路径都不按 `video.generate` 过滤，会列出
「看得见、提交必失败」的模型。直连侧加了
`advertised_model_catalog_entries_with_capability`；SaaS 侧改用
`permitted_accounts_for_capability`。

### 9. 补上 OpenAI 原生视频契约（`/v1/videos`，G-P6）

**为什么补。** 在这之前网关只提供 new-api 那一份契约。照 OpenAI 官方视频文档写的客户端
（SDK 的 `client.videos.create()` / `.retrieve()` / `.content()`）打的是 `/v1/videos`，
在我们这儿是 404。而 **new-api 自己是两套并存的**（`/v1/video/generations` 是它自己的
格式，`/v1/videos` 是 OpenAI 兼容格式），所以「对齐 new-api」不能只做一套。

两条契约**指向同一套任务、同一套上游方言、同一套计费与轮询**，差别只在请求体 / 响应体
形状与状态词表，全部在 `videogen::protocol` 里吃掉：

| | new-api 契约 | OpenAI 原生契约 |
| --- | --- | --- |
| 时长 | `duration: 5`（数字） | `seconds: "5"`（**字符串**） |
| 画幅 | `width` / `height` 两个整数 | `size: "1280x720"` 一个字符串 |
| 首帧图 | `image` | `input_reference` |
| 状态词表 | `processing` / `succeeded` / `failed` | `queued` / `in_progress` / `completed` / `failed` |

状态词表不同有测试钉住（`openai_video_statuses_use_the_openai_vocabulary` 里显式断言
`openai_video_status(Succeeded) != Succeeded.as_str()`），免得以后有人「统一」成一套。

要点：

- **迁移 `202610100003`** 给 `videogen_tasks` 加 `duration_seconds` / `size` 两列。
  OpenAI 的响应体里这两个字段必现，而它们**只在提交时已知**（上游响应里没有），之后
  无从推导。纯追加，既有行留 NULL，new-api 契约完全不读。用 `INTEGER` 而不是 `REAL`：
  时长本来就取整到秒（`effective_duration_seconds`），而且 `f64` 没有 `Eq`，会让
  `VideoTask` 的 `Eq` 派生失效。
- **`submit` 改成返回 `SubmitVideoOutcome { task_id, body }`**：两条契约的 201 体形状
  不同（new-api 的 `id` 是 `video-{task_id}` 且另有 `task_id` 字段；OpenAI 的 `id` 就是
  裸 task_id）。让调用方去解析 body 里的 JSON 取 id 太脆。这是本轮唯一改到既有签名的
  地方（3 个构造点跟着改）。
- **`/v1/videos/{id}` 容忍 `video-` 前缀**：两条契约共用一套任务，客户端可能拿 new-api 的
  `id` 去查 OpenAI 的端点。前缀字面量抽成 `protocol::VIDEO_TASK_ID_PREFIX`，
  `submit_response` 与查询共用，不会漂。
- **不做 `/videos`（无 `/v1`）别名。** `/video/generations` 那个别名有真实消费者，
  而 OpenAI 的路径永远是 `/v1/videos`；加别名只会让 `/videos/generations` 这类无关路径
  被 `is_shared_model_api_path` 顺手放进来 —— 已有断言在防这个。
- **`/content` 是真代理字节，不是 302。** OpenAI 的契约是「返回视频文件流」，而不少 SDK
  的 HTTP 客户端默认不跟随重定向（Python `httpx` 就是 `follow_redirects=False`），
  一个 302 会让它们拿到空体。用 `Body::from_stream` 流式转发（出片几十上百 MB，缓冲会把
  并发上限变成内存上限），120s 超时。目标地址来自**我们自己刚存下的上游响应**（签名 CDN
  链接），不是客户端给的，所以没有 SSRF 面。
- **SaaS 侧三条 GET 形态合成一个 `execute_video_get`**，共用**同一套**归属校验 —— 拆成三个
  函数之后最容易发生的事就是有一处忘了校验，而出片地址是可用的签名链接。归属校验发生在
  去上游取字节**之前**。（原来的 `execute_video_status` 被它取代。）
- **`submit_openai_video` 的 `seconds` / `size` 与落库、与上游体共用同一份计算**
  （`effective_duration_seconds` / `effective_size`），否则三个地方会各算一套。
- **`effective_size` 优先用显式的 `metadata.size`**（Sora 方言的上游体读的就是它，必须原样
  保留），其次由 `width` / `height` 拼，两者都没有时返回 `None` —— 不编造默认值，
  否则「客户端没说要多大」和「客户端要 1280x720」变得无法区分。
- **不支持 multipart 的 `input_reference`。** OpenAI 那边它是文件上传，我们只收字符串
  （URL / data URI）。传了文件会被当成非字符串而忽略，随后因为「既没有 prompt 也没有
  首帧图」在 `submit` 里被拒 —— 不会静默出错片。

#### 9.1 踩到的真 bug：入站与上游是两个谓词，不能合并

`is_video_generation_path`（**入站**端点识别）与 `requested_video_capability`
（**上游**路径 → 这次请求要账号声明什么能力）原本共用同一份路径判断。我一开始把
`/v1/videos*` 直接塞进那份判断，结果**两个端到端视频测试同时挂掉**：

```text
videogen.submit_failed: route_pool.model_unmatched:
  no enabled route credential supports model 'unknown' on platform 'video'
```

根因：**Sora 方言的上游提交路径恰好就是 `/v1/videos`，可灵的是 `/v1/videos/text2video`**
—— 与入站的 OpenAI 原生家族同名。塞进去之后，这两家的**上游**请求被 `forward_request`
当成「入站视频端点」，于是在能力过滤那一步要求 `video.generate` 并按 `model` 字段匹配；
而可灵的上游体用的是 `model_name`、根本没有 `model` 字段，匹配必然落空，账号被全部筛掉。
`'unknown'` 就是「读不出 model」的占位符，症状离根因很远。

修法：拆成两个函数。`is_video_generation_path` = new-api 家族 ∪ `/v1/videos` 家族；
`requested_video_capability` 只留 new-api 家族。新增
`upstream_video_paths_do_not_imply_a_capability` 把五家方言的 11 条上游提交/状态路径
全部钉成 `None`，作为这次回归的守卫。

**教训：一个函数同时服务「入站」与「上游」两种路径语义时，任何新增路径都可能在两个方向
之一上是错的。方向必须体现在函数名与注释里。**

#### 9.2 验证

- `cargo test --lib`：**1982 passed / 0 failed / 13 ignored**（+10 例）
- `cargo check --no-default-features --features standalone-server --bin ai-switch-server`：0 error
- `npx tsc --noEmit`：0 error
- `npx vitest run`：**955 passed / 0 failed**（81 文件；「接入信息」那条测试加了一个断言，
  没有新增用例）
- 新增用例：`protocol` 5 例（字段名映射、缺 model、状态词表、两种响应体、`effective_size`
  优先级）、`web::video_routes` 3 例（路径解析、两条契约路径族不重叠、`video-` 前缀容忍 +
  输出形状回显）、`route_proxy_service` 2 例（两条契约都是入站视频路径；上游路径不推能力）、
  `videogen::repository` 的既有生命周期测试补了输出形状断言、`saas::proxy` 的既有测试扩到
  三条 GET 形态（含「别人的 `/content` 也读不到」）。

## 验证

```bash
cd src-tauri
CARGO_TARGET_DIR=target-codex cargo check --lib
CARGO_TARGET_DIR=target-codex cargo test --lib
```

- `cargo check --lib`：**通过，0 error**（89 条 warning 全部是既有告警，本轮新增文件零告警）。
- `cargo test --lib`：**1973 passed / 0 failed / 13 ignored**（整仓，121s；含复审新增 4 例）。
- `npx tsc --noEmit`：**0 error**。
- `npx vitest run`：**955 passed / 0 failed**（81 个文件；`src/` 下没有测试文件，
  前端测试都在仓库根的 `tests/`）。
  > 全量跑时**每次会随机丢掉几个文件**：沙箱的 fs 垫片写不了 vitest 缓存，
    抛 `EPERM …\Temp\…\web\<hash>`，**每个 EPERM 丢一个文件**，丢哪个每次不同。
    所以单次输出会比 81/955 少。校验办法：把 `Test Files / Tests` 的差值拿去补跑
    被丢的文件，或直接按上面的数字核对（丢的文件单独跑都是全过）。
    这不是本仓的问题，也不是本次改动引起的。
- 分套件：`videogen` 12 例（新增 `dialect_and_platform_protocol_round_trip`、
  `minimax_polls_through_query_string`、`platform_hint_round_trips_to_a_dialect`、
  `every_dialect_extracts_the_video_url_from_a_success_response`、
  `builds_the_remaining_three_dialects_and_their_paths`、
  `kling_submit_poll_and_callback_run_end_to_end`）、
  `web::video_routes` 6 例（新增 `dispatches_methods_and_maps_errors_to_status_codes`
  覆盖 405 / 404 / 400 分派、`resolves_the_platform_from_a_route_proxy_key`
  覆盖「只用 key 就能定出渠道 / 文本 key 不能用 / 无效 key 被拒」）、
  复审新增 4 例：`saas_video_status_is_available_and_scoped_to_its_owner`、
  `saas_video_request_rejects_more_than_one_clip`、
  `callback_targets_are_validated_per_policy`、
  `video_paths_without_the_v1_prefix_are_shared_model_api_paths`、
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
| 平台从入站 key 解析（OpenAI 兼容路径） | ✅ 单测（含「文本 key 不能调视频」「无效 key 被拒」） |
| 「接入信息」对话框（端点 + 每协议一张 key） | ✅ 组件测试（含未启动代理时的提示） |
| SaaS 管理端的视频定价（按条 + 按秒）与平台徽标 | ✅ 组件测试 |
| SaaS 的状态查询（可用性 + 归属校验） | ✅ 集成测试（含「别人的任务读到 not_found」） |
| `n>1` 在预留前被拒 | ✅ 集成测试（并断言账上无冻结残留） |
| `callback_url` 的 SSRF 校验（两种部署口径） | ✅ 单测（含 IPv6 / 映射地址 / userinfo） |
| `/video/generations` 无 `/v1` 别名能进代理 | ✅ 单测 |
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

- **`x-ai-switch-platform` 是特权本地覆盖，不是对外契约。** 任何新增的多模态端点
  （视频、音频、未来别的）都**必须**把入站 key 作为平台来源的第一顺位，
  否则端点在 OpenAI 兼容客户端眼里就是坏的。视频这里是踩过一次的（见 4.1）。
- **需要「先知道平台才能发请求」的端点，要自己在 HTTP 层解析平台**：
  `forward_request` 内部解析平台是在发出去之前的最后一步，拿不到值去做请求体转换。
  但解析的**来源与优先级**必须与 `resolve_platform` 一致，不能自己另发明一套。

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

3. ~~**复审发现、未修的问题**~~ —— **全部已解决**（2026-11-04，见各条的「修法」）：

   a. ~~**按秒计价的时长口径对两个方言不成立**~~ —— **已解决**。新增
      `protocol::upstream_effective_duration(dialect, raw_seconds) -> Option<i64>`
      作为「上游真的会执行的时长」的唯一来源：Kling / Ark / MiniMax 直通，
      **Sora 在这里 clamp 到 1..20**（`upstream_body` 的 clamp 也删掉、改走它），
      **智谱返回 `None`**。计费侧 `reserve_video` 在算出候选账号后查
      `DISTINCT json_extract(config_json,'$.interface_format')`：
      - 方言一致 → 按该方言折算（Sora 按 clamp 后的秒数收、智谱按秒价 × 0，
        只剩起步价；只配按秒价会总价为 0 → fail closed，那是配置错误）；
      - 混合方言 → 退回客户端请求的时长（旧口径，混合池本来就无法预知落哪家）。
      快照里的 `durationSeconds` 落的是折算后的值。测试：
      `upstream_effective_duration_matches_what_each_dialect_will_run` /
      `sora_upstream_body_sends_the_clamped_seconds` /
      `video_pricing_bills_the_duration_the_dialect_will_actually_run`。

   b. ~~**`?refresh=1` 绕过轮询间隔**~~ —— **已解决**。新增 `poll_due(task)`：
      `status(refresh=true)` 与 `advance_all` 的循环都先过它，距 `last_polled_at`
      不满一个 `POLL_INTERVAL_SECONDS` 就回本地状态 / 跳过本 tick。契约里没有
      「这次有没有真的去上游」的表达，静默回缓存是更友好的降级。测试：
      `refresh_within_the_poll_interval_returns_the_cached_status`。

   c. ~~**轮询循环没有真实背压**~~ —— **已解决**。`run_loop` 的 ticker 设
      `MissedTickBehavior::Delay`：一轮最坏 32 × 10s 超时远超 tick 间隔，
      `Burst` 会把错过的 tick 立刻补齐变成连续跑；`Delay` 让下一轮从本次跑完
      之后重新计时。（并发度受限的 `join_all` 没做——单任务本来就是串行查询，
      Delay 已把「无间隔连续跑」斩断。）

   d. ~~**并发投递回调可能重复**~~ —— **已解决**，且比原计划的 CAS 更进一步：
      把「记一次尝试」改成**认领制**的 `claim_callback_attempt(task_id, max)`
      （`UPDATE ... SET attempts=attempts+1 WHERE callback_delivered=0 AND
      callback_attempts < max`，`rows_affected==1` 才算拿到资格）。`settle` 与
      重投循环都先认领再 POST —— 认领是原子的，同一笔回调只会被 POST 一次；
      认领即计数，投递失败不再需要单独 bump。`mark_callback_delivered` 也加了
      `WHERE callback_delivered=0` 兜底收敛。测试：
      `callback_delivery_is_claimed_not_raced`。

   e. ~~**`settle_video` 失败会让整个请求 500**~~ —— **已解决**。
      `execute_video_request` 在「提交成功但结算失败」时不再上抛：转调
      `settle_video(None, true)`（既有的 pending_review 分支，此前没有调用方）
      把冻结的预留挂着等人判，`eprintln!` 留痕，客户端仍然拿到 201 —— 否则
      客户端会重发、白烧一份算力。双重失败（连 pending_review 都写不进去）时
      构造一个 pending_review 的 Settlement 让响应继续，预留保持冻着可见。
      提交失败的结算（退款）失败仍上抛，钱的问题要让人看见。测试：
      `settle_video_without_a_count_marks_the_reservation_pending_review`。

   f. ~~**`forward_submit` / `forward_poll` 里设的 `x-ai-switch-platform` 头是死代码**~~
      —— **已随「平台由入站 key 解析」的重构消失**（`51ae0bb` 之后两个函数都
      不再设这个头），无需再改。

   g. ~~**`max_poll_attempts` 240 × 10s = 40 分钟**~~ —— **已解决**。常量改名
      `MIN_POLL_ATTEMPTS`（下限语义），新增 `poll_budget(duration_seconds)`：
      `时长/间隔 + 60 次余量`，与下限取大。没有时长信息的方言（智谱）用下限。
      同时把预算检查提到 `poll_once` 最前 —— 以前 `attempt_count` 只在**失败
      分支**被比较，「上游一直回 processing」的僵尸任务以前根本不会停。测试：
      `poll_budget_scales_with_the_declared_duration`。

   **实现细节（沿用 + 一条新教训）**：
   - 计价用的时长与发到上游的时长**共用同一个来源**：以前是共用
     `DEFAULT_VIDEO_DURATION_SECONDS` 常量，3a 之后收紧为共用
     `upstream_effective_duration` 函数本身 —— 常量级同源挡不住方言各自的
     clamp/缺省，函数级同源才能。
   - `execute_video_request` 先解析契约体、再预留：解析失败时还没预留，
     不需要退款分支。
   - billing 引入了对 `videogen::protocol` 的依赖（`upstream_effective_duration` /
     `VideoDialect`）：「计费不依赖 videogen」的原则对**数量上下界**仍然成立，
     但时长口径必须与协议同源 —— 口径分叉的地方就会多收钱。
3. **没有 `/v1/video/models` 目录端点**：原先 `service.rs` 里有个 `list_models`（从账号池的
   `model_mappings` + `video.generate` 推导模型目录），但它没有任何调用方、也不在约定契约里
   （计划只约定 `/v1/video/generations` + `GET /{task_id}`），已删除。图像侧同样没有目录端点，
   客户端自己配模型名——视频保持一致。等前端/插件真需要目录时再按当时的需求加。
4. **G-P5 生成会话模型暂缓**：`videogen/models.rs` 与 `repository.rs` 里的
   会话/消息/资产类型与 CRUD 目前只有测试覆盖，所以这两个文件保留了 `#![allow(dead_code)]`
   （文件头写明了原因）。**G-P5 落地时应当移除**，让编译器重新盯着这批类型。
   `PlatformId::all_with_video()` 是「遍历所有平台（含视频）」的扩展点，
   目前只被测试与导入去重用到；前端接入视频渠道时应改用它。

