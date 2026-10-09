# 流式断流自动续写（网关侧）设计

日期：2026-10-09
状态：设计完成，待评审；其中「续写质量」与「客户端接受度」两项需先做实测（见第 12 节）。

## 1. 背景

中转站（anyrouter、agentrouter 等）在流式回答中途断开连接时，客户端会拿到
`stream disconnected before completion: stream closed before response.completed`，
整轮任务报废，用户只能手动再发一次「继续」。

实测证据（2026-10-09，本机 `~/.ai-switch/ai-switch.db`）：

- anyrouter 账号 04:05:18Z 那次断流 `duration_ms = 136750`（约 137 秒），是**流跑了两分多钟才被掐断**；
- 网关现有的「首帧前可重试」保护（`route_proxy_service.rs` 的 prime 循环 +
  `handle_stream_prime_failure`）只在**上游第一个 payload 帧到达客户端之前**有效，
  这条早已超出窗口，所以只能记账、不能重试；
- 同一账号 04:02 前后的 connect 失败时段里 `transient_failure_count` 只累加 1，
  说明现有重试/失败切换本身工作正常。

SSE 是已提交的单向流：字节一旦转发给客户端就无法回滚重试。因此要同时满足
「保留实时流」与「用户无需手动继续」，只有一条路——**由网关自己再发一次续写请求，
把结果接回同一条 response**。

### 1.1 被排除的方案

| 方案 | 结论 |
| --- | --- |
| 全量暂存、写完再发（完整性优先） | **用户明确不接受**：放弃逐字实时输出 |
| 用 `status: incomplete` + `max_output_tokens` 诱导客户端自己重发 | **不做**：这是客户端行为，不是协议保证；ZCODE/WorkBuddy 未必实现，Codex 二进制里 `Incomplete response returned, reason:` 更像报错 |
| 把续写文本逐字拼进同一个 output item | **不采纳**：要重写 delta 流，风险高，换来的只是「没有接缝」；接缝本身已确认影响不大 |

## 2. 目标与非目标

**目标**

1. 上游在流中途断开时，网关自动发起续写，客户端**只看到一轮正常完成的 response**，无错误、无需用户操作；
2. 续写质量与「用户手动继续」一致——因为发给上游的就是**同一条请求内容**（原会话 + 半截回答 + 继续指令），只是由网关代发；
3. 与客户端无关：Codex / ZCODE / WorkBuddy 等只要按 Responses 或 Chat 流式协议消费即可；
4. **失败计数保留**（渠道稳定性统计不能被稀释）。

**非目标**

- 不改变「首帧前」的现有重试/失败切换行为；
- 不为非流式请求引入续写；
- 不做跨 response 的结果合并（续写始终接在同一条 response 内）。

## 3. 工作方式总览

```
客户端 ──请求──> 网关 ──请求──> 上游 A
                    │<──SSE───  ……断流……
                    │
                    │  ① 记录已生成内容与 item 状态
                    │  ② 用「原会话 + 半截回答 + 继续指令」再发一次
                    │     （聚合模式允许换到上游 B）
                    │<──SSE─── 续写内容
                    │
                    │  ③ 丢弃续写流的 response.created，
                    │     把它的 item 作为新 item 追加进原 response，
                    │     sequence_number 接着我们的计数器走，
                    │     最后由网关补 response.completed（usage 合并）
客户端 <──同一条 response 的完整流──┘
```

## 4. 触发条件

进入续写流程必须**同时**满足：

1. 该请求是流式请求，且走的是流式透传路径（`should_stream_upstream_response` 为真）；
2. 上游**已经产生过 payload 帧**（`sse_payload_started` / `StreamObserver.saw_data_frame`）；
3. 流结束时**没有**看到终止标记（`!saw_terminal_marker`），即现有 `disconnected_before_completion` 判定为真；
4. 剩余预算 > 0（见第 9 节）。

以下情况**不**进入续写，保持现有行为：

- 首个 payload 帧之前断掉：走 prime 重试 / 失败切换（更快更省）；
- 上游明确回了失败帧（`detect_response_failed` 命中）：按既有 semantic failure 分支处理；
- 非流式请求、官方账号、`bridge_kind` 不支持的组合；
- 断点落在不可恢复处（见第 8.3 节）。

## 5. 需要记录的状态

`StreamObserver` 目前只保留截断预览与计数，续写需要新增一组**有界**状态：

| 状态 | 说明 |
| --- | --- |
| `response_id` | 从 `response.created` 取出，续写时沿用 |
| `sequence_number` | 记录已转发的最大序号，续写从 +1 继续 |
| `completed_items` | 已收到 `output_item.done` 的 item id 列表 |
| `open_item` | 当前正在输出的 item（类型、id、文本累计、工具调用参数累计） |
| `partial_text` | 当前文本 item 的完整文本，用于构造续写请求；**有上限** |
| `usage` | 已有，续写完成后与续写流合并 |

上限：`partial_text` 累计超过 **1 MiB** 文本（与请求体上限无关，单独常量）即放弃续写，
按今天的断流路径报错记账——避免为超长回答无限占用内存。

## 6. 续写请求的构造

以**原始请求体**（网关切好、真正发给上游的那份）为基底，只替换 `input`：

- 保留原有全部 `input`；
- 追加一条 assistant 消息，内容是已生成的半截回答（`partial_text`）；
- 追加一条 user 消息，内容为固定继续指令：`Continue exactly where the previous assistant message stopped. Do not repeat anything already written, do not add a preamble, and do not restate the question.`;

其余字段（`model`、`tools`、`reasoning`、`store` 等）原样保留，`stream` 保持 `true`。

**账号选择**

- **聚合模式（`RoutePoolModelMode::Aggregate`）**：允许换账号，沿用池的失败切换与游标推进；
- **精确模式（`Precise`）**：只允许同一账号重试，超出其失败预算则放弃续写。

## 7. 事件拼接规则

续写流按块处理，规则如下（`ResponsesResumeRewriter`，与既有 `ChatStreamBridge` 同层）：

两种上游协议下重写器的职责不同，要分开实现：

- **上游也是 Responses（`ResponsesToResponses`）**：今天是逐字节透传，id / `sequence_number` /
  `output_index` 都由上游给。重写器要把续写流"伪装"成原 response 的后续。
- **上游是 Chat（`ResponsesToChat`）**：今天 `ChatStreamBridge` 已经在合成整条 Responses 事件
  序列、自己维护 `sequence_number`，所以续写只需把它的内部状态跨请求保留下来，不用再做伪装。

下表针对第一种情形：

| 续写流事件 | 处理 |
| --- | --- |
| `response.created` / `response.in_progress` | 丢弃（response 已经在客户端那边创建过了） |
| `response.output_item.added` | 转��，换一个新的 item id（与已有 item 不冲突），`output_index` 接着原序号排 |
| `response.output_text.delta` | 转发，`sequence_number` 用我们的计数器重写，`item_id` 保持本次续写的新 id |
| `response.output_item.done` | 转发，序号/`output_index` 重写，转入 `completed_items` |
| `response.completed` | 丢弃，等续写全部结束后由网关合成最终收尾 |
| 其余事件 | 透传并重写 `sequence_number` |

续写结束后由网关发一条合成的 `response.completed`：`response.id` 用原 id，
`status: "completed"`，`usage` 为两次（或多次）之和。

**接缝的表现**：用户在同一轮里看到新起一段，这是**已确认可接受**的取舍。

## 8. 工具调用与 reasoning

### 8.1 工具调用延迟提交

工具调用 item 的全部事件先暂存在网关，收到 `output_item.done` 才转发给客户端。
理由是它的参数是流式 JSON，断在中间会产生**语法都不完整的调用**——而客户端一旦
看到完整 item 就会真的去执行。

### 8.2 断在工具调用参数中间

该 item 客户端从未见过，直接**整条丢弃**，然后按第 6 节重新请求，让模型重新发出一次完整调用。
这比手动继续更好：手动继续时客户端已经报错，用户得先自己恢复现场。

### 8.3 不可恢复的情形

- 断点落在**加密 reasoning** 内容里：密文无法重建，放弃续写，走今天的报错路径；
- 续写请求自身失败且账号切换无效：放弃，报错 + 记账。

### 8.4 只缺收尾事件

若所有 item 都已 `done`，只是没等到 `response.completed`：**不发起续写**，
直接补一条合成的 `response.completed` 让这轮成功——省掉一次模型调用。

## 9. 预算与设置

- 新增设置项 `route_proxy_stream_continue_max`，**默认 10**，`0` 表示关闭续写；
- 落点：`AppSettings` / `AppSettingsView`（`src-tauri/src/models/settings.rs`）
  + 设置界面（`src/screens/SettingsScreen.tsx`，与 `route_proxy_request_body_limit_mib` 同区）；
- 每次续写写一条日志：第几次续写、落在哪个账号、续写消耗的文本量；失败照常计入
  `transient_failure_count` 与 `last_failure_*`。

## 10. 失败与放弃

以下任一成立即停止续写，回落到今天的报错 + 记账：

1. 已续写次数达到 `route_proxy_stream_continue_max`；
2. `partial_text` 超过内存上限；
3. 断点落在不可恢复处；
4. 续写请求失败且（精确模式下）不可换账号。

## 11. 与既有机制的边界

- **prime 重试**：首帧前的重试优先于续写，二者不叠加；
- **缓冲路径**：非流式请求不受影响；
- **失败记账**：续写不改变记账规则，断流仍然给上游账号记 `semantic_response_transient`；
- **响应体上限**：`ROUTE_PROXY_RESPONSE_BODY_LIMIT` 只影响日志预览，与本方案的续写缓冲是两件事。

## 12. 待验证前提（实现前必须先做）

1. **续写质量**：拿 anyrouter / agentrouter 各跑数次「半截文本 + 继续指令」，
   统计是否无缝接着写、是否重复、是否加前言。若命中率低，本方案的收益不成立。
   **注意：这一步会消耗用户配额，并可能在这些渠道的统计里留下几条测试请求**，
   因此必须先取得用户同意再跑，且用最小 `max_output_tokens`。
2. **客户端接受度**：用假上游给真实客户端喂一条**手工拼接**的 SSE
   （同 `response.id`、新 item、`sequence_number` 接续、尾部补 `response.completed`），
   确认客户端照常渲染、且会把工具调用当真执行。

两项都通过再进入实现；任一项不通过，本设计需要重新讨论。

### 12.1 实测记录（2026-10-09，续写质量）

经本机 ai-switch 代理、用最小 `max_output_tokens` 对真实渠道跑了续写探针：

| 模型 | 任务 | 结果 |
| --- | --- | --- |
| gpt-6-astra | 数数（半截停在 `… 11, 12,`） | **3/3 从 `13` 无缝续写**，无重来、无前言 |
| gpt-6-astra | 散文（半截停在分号处） | `completed`：续写恰好接完那半句，并补完第二/第三点与收尾，无重复、无前言 |
| glm-5.3 | 散文 | 返回 `incomplete`，输出只有 `reasoning`——200 token 预算全被思考吃掉；其 reasoning 摘要明确写着"需要从断点接着写"，说明指令本身被正确理解 |

实测落在 anyrouter / AgentRouterL（gpt-6-astra）与 modelport（glm-5.3）。

**结论：续写质量通过。** gpt-6-astra 是 AgentRouter 的主用模型，表现与用户手动继续一致。

两点实现备忘：

1. 续写请求必须沿用原请求的 reasoning 配置，且预算要覆盖 reasoning 消耗——glm-5.3 那次就是被思考吃光预算后没吐出正文；
2. 探针请求会落在真实账号上并留下记录：本次为 `gpt-5.6-sol` 的"渠道无可用"多记了几次模型级失败，并在 AgentRouterL 记了一次 quota 失败。**正式实现不得产生这类副作用**（续写失败应记在该请求自己的账上，而不是拿探针打真实池子）。

- 客户端接受度（2026-10-09）：**通过**，客户端 codex exec 0.150.1；退出码 0；无 `stream disconnected before completion` / `Incomplete response returned`；tokens used 3。
  会话 rollout 证实：两段分别记为两条 assistant message（`msg_1` / `msg_2`），该轮正常 `task_complete`；终端里「第二段打印两次」只是 exec 在流式输出后再回显一次 final message，不是协议问题。
  **实现备忘**：客户端是从流式的 `output_item.*` 事件记录会话历史的，合成收尾的 `response.completed` 里 `response.output` 留空也不丢内容——重写器不必重建完整 output 数组。

## 13. 测试计划

- **脚本化上游**（复用 `start_scripted_sse_upstream`）造三类场景：
  文本中断 / 工具调用参数中断 / 只缺 `response.completed`；
- 断言：客户端只收到一条 response；`sequence_number` 严格递增不重复；
  工具调用完整；只缺收尾时不额外请求上游；`transient_failure_count` 记账正确；
  预算耗尽后回落到报错路径；
- **设置项**：默认 10、`0` 关闭、聚合/精确两种模式的账号选择差异。

## 14. 明确不做

- 不做全量暂存（完整性优先模式）；
- 不做逐字拼接同一个 item；
- 不依赖任何客户端特有的自动续写行为。

## 15. 实现结果（2026-10-09）

已落地并合并到 `main`（见 `docs/superpowers/plans/2026-10-09-stream-continuation.md` 的分步笔记）：

- **客户端接受度**（第 12 节）：拼接流可被真实 Codex 客户端接受，直接实施。
- **状态采集**：`StreamObserver` 采集 `response_id` / 最大 `sequence_number` /
  已完成的 item / 当前 open item / 半截正文（上限 1 MiB）/ 用量。
- **续写请求**：`build_continuation_body` 以**客户端请求体**为基底追加「半截回答 + 继续指令」，
  再由 `build_upstream_request_internal` 重新做映射/桥接/净化。
- **事件重写**：`ResponsesResumeRewriter` 丢掉续写流的 `response.created` 与收尾事件，
  把序号与 `output_index` 接到原 response 后面，结束时由网关合成一条 `response.completed`。
- **账号选择**：聚合模式换账号（排除当前），精确模式同账号重试。
- **预算**：设置项 `route_proxy_stream_continue_max`，**默认 10，0 关闭**；保存设置即刷新运行态。
- **Chat 桥**：`ResponsesToChat` 的续写沿用同一个 `ChatStreamBridge`，客户端只看到一条
  `response.created`。
- **工具调用延迟提交**：续写流里的 `function_call` / `reasoning` item 等
  `output_item.done` 才整体转发；断在半截就整条丢弃并要求模型重发。
- **不可恢复边界**：断在加密 reasoning 中间、半截正文超限、精确模式下无可换账号、
  续写请求自身失败——都放弃续写，回落到第 10 节的报错 + 记账。

**与设计的差异 / 已知取舍**：

1. **不走额外的请求事件**。第 9 节原写「每次续写写一条日志」。实现只在 `eprintln!` 里
   记录轮次与账号，**不再多插一行 `route_credential_request_events`**：那会给统计接口凭空
   多算一次请求、动摇第 11 节「失败记账规则不变」的承诺。断流那一次请求照旧由
   `StreamCompletion::finish` 记一条（`truncated` → `semantic_response_transient`），
   续写成功**不回滚**这条失败。
2. **延迟提交只覆盖续写流**。原上游的 Responses 透传仍是逐块转发：它若断在工具调用中间，
   半截调用已经到过客户端，之后续写轮重发的完整调用会是第二个 item。要连原上游一起延迟
   提交，需要给透传路径加一层按 item 的暂存（后续可选项，不在本次范围）。
3. **接缝**：续写从原 response 的下一个 `output_index` 起一段新 item，与第 7 节的取舍一致。
