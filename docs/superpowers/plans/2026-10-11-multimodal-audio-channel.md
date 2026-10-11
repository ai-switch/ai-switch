# 多模态网关：音频渠道（G-P7 / TTS）

> **后续变更（2026-10-12）**：音频**不再有自己的侧边栏入口** —— 它收进了 codex 页的
> 模态分段器（`通用 / 生图 / 视频 / TTS`），`AudioChannelsScreen` 以 `embedded` 模式
> 挂在那里。见 [`2026-10-12-unified-pool-and-modality-segments.md`](./2026-10-12-unified-pool-and-modality-segments.md)。

## 背景

视频渠道（G-P1 ~ G-P6）落地后，网关的模态矩阵是「文本 + 图像 + 视频」。音频是第四条：
插件/客户端要「把一段文本念出来」时，不该自己去配一家的 key 与协议。

本轮只做 **TTS**（`POST /v1/audio/speech`）。STT / 翻译（multipart 上传）是独立的后续档。

设计依据与视频同源：`otools-aigv/docs/模型提供方配置架构设计.md` 第七章。编号沿用 **G-** 前缀。

## 对外契约

```
POST /v1/audio/speech
  { model, input, voice, response_format?, speed?, instructions? }
→ 200 音频字节流（Content-Type 由上游给，原样透传）
```

- **同步接口**：一次调用就返回音频本身。没有 task_id、没有轮询、没有回调。
- 平台只有一个 `audio`；供应商住在账号的 `config_json.interface_format` 里。
- 客户端用 `Authorization: Bearer sk-ai-switch-audio`（或 SaaS 的 `sk-saas-` key），
  平台由**入站 key** 解析（与视频同一条教训，见视频文档 §4.1）。

## 落地内容

| 面 | 内容 |
| --- | --- |
| 平台 | `PlatformId::Audio`（无载荷）+ `AUDIO_PLATFORM = "audio"` |
| 能力 | `audio.generate`（与 `image.generate` / `video.generate` 同构） |
| 方言 | `audiogen::protocol::AudioDialect`，目前只有 `openai` |
| 上游路径 | `/v1/audio/speech`（与入站路径相同） |
| 直路 | `route_proxy_service::build_audio_upstream_request` |
| 计费 | 按**千字符**（迁移 `0009_audio_billing.sql`） |
| 前端 | 音频渠道屏（`AudioChannelsScreen`）+ SaaS 管理端定价列 |

**没有新模块目录的持久化层**：`audiogen/` 只有 `mod.rs` 与 `protocol.rs`。理由见下。

## 与视频的形态差异（决定了整个结构）

视频之所以要任务表 + 轮询 + 回调，是因为**上游是异步的**（提交只换回一个 task_id）。
TTS 不是。所以：

| | 视频 | 音频（TTS） |
| --- | --- | --- |
| 响应 | JSON + task_id，之后轮询 | **音频字节本身** |
| 任务表 / 轮询 / 回调 | 需要 | **不需要** |
| 最接近的既有模块 | `videogen/` | `imagegen/`（服务层那套） |

由此推出一个**比视频简单得多**的接法：**音频不需要 `web::router` 的分派**。

视频要在 `shared_fallback` 里插一段（`handle_video_request`），因为它得「先转方言体 → 打上游 →
落任务 → 回 201」，`forward_request` 的文本构造对视频不适用。音频则完全复用 `forward_request`：

- 入站路径 `/v1/audio/speech` **就是**上游路径；
- 请求体**就是**上游体（只需按 `model_mappings` 改写 `model`，而字段名恰好就是 OpenAI 风格的 `model`）；
- 响应体是二进制，而 `forward_request` 在 `bridge_kind: None` 且非流式时**原样透传字节**，
  `proxy_upstream_response` 也会把上游的 `content-type` 一起带回来。

所以音频只需要三件事：平台与能力（让候选过滤认它）、`build_audio_upstream_request`（直路）、
以及 SaaS 侧的端点白名单。**这是本轮最大的结构性收获：不是所有新模态都需要一条自己的 HTTP 入口。**

## 计费：单位选错就一定会做错

TTS 按**字符**计费（OpenAI tts-1 是 $15 / 1M 字符）。两个细节：

**① 用 `chars().count()`，不是 `len()`。** `"你好".len()` 是 6（UTF-8 字节），按字节计费会
**多收 3 倍**。`audiogen::protocol::input_characters` 是唯一入口，有测试钉住。

**② 列名是「每千字符」，不是「每字符」。** 现有列都是 `xxx_price_micros`（每单位多少 micros），
照抄会出事：

| 模型 | 单价 | 折成「每字符」 | 折成「每千字符」 |
| --- | --- | --- | --- |
| tts-1 | $15 / 1M 字符 | 15 micros ✅ | 15000 ✅ |
| 便宜模型 | $0.5 / 1M 字符 | **0.5 micros** ❌ 整数存不下 | 500 ✅ |

所以列名是 `audio_price_micros_per_1k_chars`。

**计价口径**（沿用视频 0008 那条已经验证过的做法）：

```
单次价格 = ceil(字符数 × audio_price_micros_per_1k_chars / 1000)
最终金额 = 单次价格 × 组倍率
```

**取整只做一次**，在预留时；结果（总额）冻结进预留快照，`settle_audio` 只读快照。
取整方向**向上**：宁可多收一个 micro，也不漏收。

**结算语义是全有或全无**：上游 2xx 就按预留的总额收款，失败整笔退款。没有「成功几个字」
这种中间态——图像/视频能从响应体里数出成功了几条，**音频的响应是二进制，数不出来**。

由此推出本轮最该记住的一条：

> **音频的计费用量只能来自请求。** 这不是妥协，是正确：上游也是按 `input` 收费的，
> 两边口径一致；而「从音频时长反推字数」那种做法既不准也不必要。

字符数从**同一份请求体**算（`execute_audio_request` 与 `build_audio_upstream_request`
用的是同一个函数），所以「计费的文本」与「发给上游的文本」不会分叉。

## 几个刻意的取舍

- **只做一个方言（`openai` 兼容）。** TTS 的供应商差异比视频**大**（MiniMax 回 JSON+hex、
  火山回 base64、Azure 要 SSML 且鉴权头是 `Ocp-Apim-Subscription-Key`、ElevenLabs 用
  `xi-api-key`），所以更不该一上来做七家。现在几乎所有厂商都有 OpenAI 兼容端点。
- **不做回程解码。** 唯一的方言回的就是原始字节，写一个恒等函数只是噪声。
  `audiogen::protocol` 的模块文档写清了加第二家时要补什么（方言变体 + `extract_audio` + 按方言的鉴权头）。
- **`input` 超限拒绝，不截断。** 截断会让「计费的文本」与「实际合成的文本」分叉
  ——视频那条「计价口径与上游口径必须同源」的同一个教训。
- **`voice` 原样透传，不统一词表。** OpenAI 是 `alloy`、MiniMax 是 `voice_id`、
  ElevenLabs 是 URL 段。统一词表是自找的抽象泄漏。
- **`interface_format: "openai"` 在音频这里是正当取值**，而视频那边**刻意排除**了 `openai`
  （那里收了它 `interface_format: "openai"` 会静默变成「Sora」）。两处结论相反是因为语义不同。
- **不做 `/audio/speech`（无 `/v1`）别名。** OpenAI 的路径永远是 `/v1/audio/speech`，
  加别名只会让它在 `is_shared_model_api_path` 里也需要一条对应规则，换不到任何真实客户端。
- **只认 `/v1/audio/speech` 一个路径**，不做 `/v1/audio/*` 通配：STT/翻译是 multipart，
  要单独接（SaaS 那条路现在无条件按 JSON 读 body）。

## 踩到的坑

1. **SaaS 迁移要在 `saas/repository/mod.rs` 的数组里注册。** 核心迁移是 sqlx 扫目录自动发现的，
   SaaS 迁移**不是**——它是一个手写的 `(version, include_str!(...))` 数组。漏注册的症状是
   **所有** `saas::*` 测试一起红（`table saas_group_models has no column named ...`），
   很容易误判成「迁移 SQL 语法错」。
2. **`br#"..."#` 不能含非 ASCII。** 测试里想写带中文的 JSON 请求体，得用
   `serde_json::to_vec(&json!({...}))`，直接写 `br#"{"input":"你好"}"#` 编译不过。
3. **`PlatformId` 新增变体后，4 处穷尽 `match` 要补分支**：`deeplink_service`（两处）、
   `route_model_test_service`（官方账号路由）、`route_proxy_service`（官方上游 Base URL）。
4. **`is_video()` 的调用点要逐个判断该不该变成 `is_media()`。** 本轮找到 2 处漏网的：
   复制凭据（`route_credential_service`）与导入（`route_credential_transfer_import_service`）。
   两处都是「媒体账号的 `interface_format` 是上游方言、不是文本 `ApiDialect`」这条规则。
5. **又一次 INSERT 占位符少一个**（`model_sync::upsert_migrated_model` 的 `VALUES`）——
   与视频那轮**同一个坑，第二次踩**。给 `saas_group_models` 加列时要同步改 4 处：
   `groups.save` 的 INSERT、`upsert_migrated_model` 的 INSERT + `DO UPDATE SET`、
   `pending_pricing` 那条字面量 INSERT、以及 3 处 `SELECT` 列清单。
6. **`isMediaPseudoPlatform` 必须是类型谓词。** `App.tsx` 里 `!isMediaPseudoPlatform(x)`
   要能把 `AgentPlatform` 收窄成 7 个文本平台，才能交给 `AccountsScreen`（它的 `platform`
   是真实的 `PlatformId`）。写成返回 `boolean` 就收窄不了，类型报错。
7. **6 处平台白名单要一次找齐**（这次做到了）：`authenticate_key`、`core_group`、
   `groups.list`、`groups.available`、`keys.create`、`model_sync.reconcile`。
   视频那轮是被这个咬了三层才发现的。

## 验证

- `cargo test --lib`：**1987 passed / 0 failed / 13 ignored**（+5 例）
- `cargo check --no-default-features --features standalone-server --bin ai-switch-server`：0 error
- `npx tsc --noEmit`：0 error
- `npx vitest run`：**967 passed / 0 failed**（83 文件；+2 文件 / +12 例）
- 新增用例：`audiogen::protocol` 4 例（方言表与别名、**按字符不按字节**、请求校验、
  超限拒绝含中文 4096 字符的边界）、`platform` 1 例（音频平台解析/往返/`is_media`）、
  前端 `audioPlatforms` 4 例 + `AudioChannelsScreen` 8 例。

## 遗留

1. **STT / 翻译**（`/v1/audio/transcriptions` / `/v1/audio/translations`）。是 multipart 上传，
   与 TTS 不是一回事：要转发 multipart、从**表单字段**取 `model`（不能用 JSON 取）、
   SaaS 那条路要单开分支（现在无条件 `serde_json::from_slice` 读 body）。能力名用 `audio.transcribe`。
2. **第二个音频方言**（MiniMax / 火山 / Azure / ElevenLabs）。到那时才需要
   `extract_audio`（JSON 里的 hex/base64 → 字节）与按方言的鉴权头——现在 `build_audio_upstream_request`
   硬写 `Authorization: Bearer`。
3. **流式 TTS**（`stream_format: "sse"`）。要留意 `stream_disconnected_before_completion`
   的 SSE 嗅探：音频 SSE 若被误判成「断流」会触发一次多余的重试。
4. **音频资产落盘**（如果要复用 `imagegen/storage.rs` 的模式）。现在音频是直通，
   不落任何本地文件。
5. **`/v1/models` 的音频过滤**已接（`models_list_capability` → `audio.generate`），
   但**没有 `/v1/audio/models` 之类的目录端点**——与图像/视频保持一致（都靠 `/v1/models`）。
