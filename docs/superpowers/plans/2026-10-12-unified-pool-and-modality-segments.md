# 统一账号池与模态分段器（G-P8）

## 背景：导航里混了两种东西

视频（G-P1~G-P6）与音频（G-P7）落地后，侧边栏第一层同时列着：

- **池身份**（给哪个客户端用）：Codex / Claude / Grok / Gemini / OpenCode / OpenClaw / Hermes
- **模态**：Video / Audio
- **工作台**：Image Studio（插件开关控制）

10 项，两种语义挤在同一层。后果是具体的：**每加一个模态就多一个导航项、多一张 key、
多一个「平台」**——而模态本来不该是平台。

根源是「平台」这一个概念在承担三件事：

| 它承担的 | 在哪 | 该不该 |
| --- | --- | --- |
| 池身份 / 权限边界 | `route_pool_groups.platform`、本地 key、SaaS 组 | ✅ 该 |
| 协议族（请求体怎么建、响应怎么解析） | `config_json.interface_format` | ❌ 已有独立字段 |
| **模态**（用哪个端点、要什么能力） | 选了 `video` 平台 = 选了视频模态 | ❌ 该由**端点路径**定 |

## 本次做的（过渡形态）

**把模态收进 codex 页的分段器，侧边栏只留池身份。**

```
侧边栏                          侧边栏
 ├ Codex                        ├ Codex   ← 页内分段器：通用 / 生图 / 视频 / TTS
 ├ Claude                       ├ Claude
 ├ …                            ├ …
 ├ Video      ← 去掉            └ （视频 / 音频不再各占一项）
 └ Audio      ← 去掉
```

- 新增 `screens/CodexChannelsScreen`：分段器外壳，四段各自复用已有屏 ——
  通用 = `AccountsScreen(platform="codex")`（那个池的完整管理）、
  视频 / TTS = 各自的渠道管理屏（新增 `embedded` 模式，标题交给外层）、
  生图 = `ImageCapabilitySegment`（按能力筛选的只读视图 + 接入信息）。
- 分段选择**记进 localStorage**：常切的人不用每次重新点，也不至于每次进 codex 都被弹走。
- 视频 / 音频不再是导航目的地：`AgentPlatform` 去掉 `video` / `audio`，
  连同上一轮引入的「媒体伪平台」概念一起删掉。它们仍然是独立的**平台值**
  （`lib/videoPlatforms` / `lib/audioPlatforms`），只是不再各占一个入口。
- `AgentIcon` 加 `image` 变体，四段各有图标（通用用 codex 图标——那一段就是 codex 池）。
- 生图端点也进了平台侧接入信息（`ConfigWriteTargetsDialog`），因为生图**没有自己的平台**，
  「怎么调它」只能挂在它所在的池上。

**为什么放在 codex 页而不是新建一个「多模态」页**：codex 池是 OpenAI 兼容形状，
它本来就是这个项目里最通用的那个池；而且目标架构里 codex 会成为账号池的唯一载体。

**段内会写明「这些账号属于另一个池」**：视频 / 音频段显示的仍然是 `video` / `audio`
平台的账号，不共用 codex 的账号。不写清楚，用户会以为它们属于 codex 池。

## 目标架构（用户方向，**本次不做**）

```
网关统一账号池
  └─ provider 分组（openai / claude / gemini / grok / openai 兼容）
       └─ 多模态（通用 / 生图 / 视频 / TTS）
            └─ 账号
```

- 现有 codex 平台**升级为网关账号池的唯一载体**；
- 其余 6 个平台（claude / gemini / grok / opencode / openclaw / hermes）
  **取消顶级概念**，降级成账号池的 provider 来源；
- 账号池统一后要区分**官方账号**（codex/claude/grok 订阅）与 **API 账号**；
  API 账号按接口类型自动落进「openai 兼容 / Gemini 兼容」这种分组；
- 导航第一层改成**智能体对接页面**（codex / claude / workbuddy 等各种智能体对接管理），
  其中 **claude 最特殊**：对接时要勾选账号池里的模型做**槽位配置**。

## 分阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| **P1** | codex 页模态分段器 + 去掉视频/音频导航项 + 生图段 | ✅ 完成（纯前端，`631cf64`） |
| **P2** | ~~key 统一：`resolve_platform` 让「路径定的模态」优先~~ | ✅ **已实现，但走的是更彻底的路**（`7f5880b`，见下） |
| **P2.5** | 模态账号禁通配映射（保住池不串味） | ✅ 完成（`c3503cc`） |
| **P3** | SaaS 组支持平台集合（一个 key 多模态） | ⬜ 未做，代价高 |
| **P4** | 统一账号池 + provider 分组 + 智能体对接页 | ⬜ 未做（用户方向） |

### P2 实际走的路：模态成为账号属性（而非只改 key 解析）

原计划的 P2 只动 `resolve_platform`：让「路径定的模态」优先于 key 的平台，改完
`sk-ai-switch-codex` 就能调视频端点。**代价小，但 `PlatformId` 里仍然留着
`Video` / `Audio` 两个变体** —— 「模态是平台」这个根因还在，每加一个模态还是要多
一个变体、多处穷尽 match、一套能力矩阵。

用户指出这点后改成**直接取消 video/audio 平台值**：模态降为账号的一个分类，
靠 `model_mappings[*].capabilities` 里的能力声明识别。用户同时拍板**不做数据迁移**
（video/audio 账号版本从未发布）。

```
账号
 ├─ platform      = 池身份（codex / claude / gemini / …）   ← 与哪个 CLI 用、哪张 key、哪个 SaaS 组
 ├─ interface_format = 协议族（openai / kling / ark / …）    ← 已有独立字段
 └─ capabilities  = 模态分类（video.generate / audio.generate / image.generate）
```

**收益**：

- `CodexChannelsScreen` 四段**全部**是 `AccountsScreen(platform="codex")`，区别只在
  `capabilityFilter` —— 删掉 `VideoChannelsScreen` / `AudioChannelsScreen` 两屏。
- 一把 codex key 天然能打所有模态端点（视频/音频账号就在 codex 池里）。
- SaaS 一个 `codex` 组可同时卖文本、生图、视频与 TTS，单价挂在
  `saas_group_models` 的对应列上。

**代价（必须记住的一条）**：池不再按平台隔离，文本请求的 `requested_capability`
是 `None`（不过滤），只靠模型名精确匹配排除异类。所以**模态账号不得配 fallback
映射**（`from == FALLBACK_MODEL_ALIAS`，字面量 `"claude-model"`，不是 `"*"`）——
由 `validate_model_mappings` 在创建与更新两条路径上强制（P2.5）。
这仍是结构保证而非配置纪律：`mapping_from_matches` 只做精确匹配、没有前缀通配，
禁掉 fallback 后文本请求命中模态账号的唯一方式就是模型名完全相同。

### P2 的现状与代价（SaaS 侧，P3）

SaaS 的 key → 组 → 平台仍是**单值**。要一个 key 跨组/跨模态，得让组支持平台集合，
动到计费全链、模型同步、6 处白名单。**而且按模态分 key 在 SaaS 侧是特性不是缺陷**：
组的 `multiplier_micros` / `timeout_seconds` / `max_concurrency` / 订阅开关本来就
按模态不同（视频 300s、文本 60s、计费单位分别是条/秒/字符）。

## 明确不做

1. **不合并账号池** —— 可灵不是 OpenAI。生图能「融合」是因为它的供应商（OpenAI / Google）
   与文本账号完全重合；视频 / 音频的供应商是不同公司、不同套 key。
2. **不把 `interface_format` 变成按模态的嵌套结构** —— 收益只覆盖「同一上游跨协议族」的
   少数情况（智谱 / MiniMax），代价是每个消费点都要按模态取。

## 验证

- `cargo test --lib`：1988 passed / 0 failed / 13 ignored
- `cargo check --no-default-features --features standalone-server --bin ai-switch-server`：0 error
- `npx tsc --noEmit`：0 error
- `npx vitest run --no-file-parallelism`：970 passed / 0 failed（84 文件）

> **环境注意**：本机 vitest 偶发**静默漏收整个测试文件** —— 沙箱的 brokered-fs shim
> 在 worker 写临时模块缓存时报 `EPERM`，worker 挂掉后那个文件不计入统计，输出仍是
> 「全部通过」。表现为「文件数比磁盘上少一个、用例数少一整个文件」。验证时留意
> `Test Files` 的数量，必要时用 `--no-file-parallelism` 串行跑。
