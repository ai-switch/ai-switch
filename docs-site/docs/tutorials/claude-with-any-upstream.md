---
title: 让 Claude Code 用任意上游
description: 用 Messages 入口按路径判定的特性，把 Claude Code 接到 OpenAI、Responses、Gemini 或 Anthropic 协议的账号上，含模型映射、1M 上下文、curl 验证与协议边界说明。
---

# 让 Claude Code 用任意上游

**目标**：Claude Code 保持原生 Messages 协议不动，请求却由 OpenAI 兼容、Responses 或 Gemini 协议的账号提供服务。

**你需要**：一个任意协议的上游账号；已装好 Claude Code 与 AI Switch；建议先做 [跑通第一条请求](./first-request) 熟悉界面。

**验收标准**：Claude Code 完成一轮带工具调用的对话；实时日志第 2 阶段是上游方言的请求体，第 4 阶段是 Anthropic Messages 格式的响应。

## 关键机制：Messages 入口按路径判定

代理只在三种情况触发桥接：

```text
平台是 Codex 且路径是 /responses  → Responses 系列
路径是 /v1/messages             → Claude 系列（不看平台）
路径是 chat/completions         → Chat 系列（不看平台）
其余                            → 直通
```

后两条**只按路径判定，不看平台**。所以 Anthropic Messages 请求可以打进任何池——Claude 池是原生支持，Codex、Gemini、Grok、OpenCode 家族的池也能接，最终由命中账号的 `interface_format` 决定往哪种方言翻译。这是本教程能成立的全部原因。

| 本地入口 | 上游 `openai` | 上游 `openai-responses` | 上游 `anthropic` | 上游 `gemini` |
| --- | --- | --- | --- | --- |
| `/v1/messages` | `ClaudeToChat` | `ClaudeToResponses` | 直通 | `ClaudeToGemini` |
| `/responses`（Codex） | `ResponsesToChat` | `ResponsesToResponses` | `ResponsesToAnthropic` | `ResponsesToGemini` |

响应方向同样成对实现：上游的 `choices[].delta`、`response.*` 或 `usageMetadata` 会被重放成 Anthropic 的 `message_start` / `content_block_delta` / `message_delta` / `message_stop` 事件流。

::: tip 同协议不一定直通
反过来也成立：上游是 `anthropic` 时 Messages 入口是纯直通（桥接种类为空），而 Codex → `openai-responses` 虽然两边都是 Responses，仍算一条 `ResponsesToResponses` 桥接，因为第三方 Responses 网关需要一层清洗。
:::

## 第 1 步：建一个「非 Anthropic」账号

左侧 **Agents → Claude Code**，点 **+** 新增账号，保持「API 账号」：

| 字段 | 值 |
| --- | --- |
| 账号名称 | `OpenAI通道-Claude` |
| API Key | 上游 key |
| Base URL | 如 `https://your-relay.example.com/v1` |
| **接口格式** | **照上游实际协议选**，本例选 OpenAI Chat Completions（`openai`） |
| 创建后加入算力池 | 保持勾选 |

四种取值：`openai`（Chat Completions，`/chat/completions`）、`openai-responses`（Responses，`/responses`）、`anthropic`（Messages，`/v1/messages`）、`gemini`（generateContent）。

只有选 `anthropic` 时会多出 **「Claude 鉴权字段」**：

- `ANTHROPIC_AUTH_TOKEN` —— `Authorization: Bearer`，**多数中转站是这个**
- `ANTHROPIC_API_KEY` —— `x-api-key`，Anthropic 官方的方式

不确定先试前者。出站时 `anthropic` 方言还会自动补 `anthropic-version: 2023-06-01`（客户端已给就不覆盖）、对 messages 路径追加 `?beta=true`、套 Claude Code 客户端标识以避开网关的指纹校验；`gemini` 方言则把 key 放在 URL 的 `?key=` 查询参数里、流式走 `:streamGenerateContent?alt=sse`。

> ✅ **检查点**：账号在 Claude Code 平台的算力池里，状态「正常」。

## 第 2 步：处理 Claude 的模型名

Claude Code 的 `/model` 四个槽位只能填固定别名（如 `claude-sonnet-alias`），这是客户端限制。所以要在账号的「模型映射」里把别名换成上游真实模型：

```text
claude-sonnet-alias  →  gpt-4o
claude-opus-alias    →  claude-opus-4-1
```

代理按账号把 alias 改写成 `to`；**第三方客户端与 Claude SaaS 的模型清单直接使用 `to`**，不再暴露 Claude Code 的 alias。这也是为什么在 ZCode、WorkBuddy、Qoder CLI 之类客户端里看到的模型名和 Claude Code 里不一样。

::: warning 别名不一致会选不到号
映射的 `from` 必须与 Claude Code 实际发出的模型名完全一致（含 `-alias` 后缀）。没匹配上会得到 `route_pool.model_unmatched`，而不是「随便发一个请求试试」。用 `GET /v1/models` 看代理聚合出来的池内模型清单，能确认别名有没有生效。
:::

### 1M 上下文怎么办

Claude 系列的 1M 上下文要靠 `anthropic-beta: context-1m-2025-08-07` 声明。代理在下面任一条件成立时自动补这个头：

- 客户端在模型名上带了 `[1M]` 后缀（Claude Code 的写法），匹配映射时会剥掉后缀
- **服务该请求的账号**的映射勾了「1M」（`supports_1m`）——按账号判定，避免池里有一个账号不支持就省略整个池的后缀
- Codex 平台且该映射的上游模型被声明为 1M

勾了「1M」的映射会在模型列表里额外暴露一个 `别名[1m]` 变体。

## 第 3 步：测试并写入 Claude Code 配置

点 **✈** 真实生成测试，接口保持 `/v1/messages`，模型选第 2 步的别名。通过后展开「查看输入输出」，确认请求方向确实被改写成了上游方言、响应方向是 Messages 格式。

再点 **🔌**，勾选 Claude Code，点「写入」。它会改 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:19527",
    "AI_SWITCH_ROUTE_PROXY": "1",
    "AI_SWITCH_ROUTE_PROXY_API_KEY": "sk-ai-switch-..."
  },
  "aiSwitch": {
    "routeProxy": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:19527",
      "platform": "claude",
      "apiKey": "sk-ai-switch-..."
    }
  }
}
```

本地代理 key 也可以直接放在 `x-api-key` 头里。它只用于本地识别平台，转发前会被剥掉，上游看到的是账号自己的真实 key。

```bash
claude
```

> ✅ **检查点**：`claude` 能完成一轮带工具调用的对话，没有协议格式报错。

## 第 4 步：用 curl 单独验证桥接

```bash
curl -N -X POST http://127.0.0.1:19527/v1/messages \
  -H "Authorization: Bearer sk-ai-switch-你的key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-alias",
    "max_tokens": 64,
    "stream": true,
    "messages": [{ "role": "user", "content": "Say hi in three words" }]
  }'
```

`-N` 能看到 Anthropic 风格的 SSE 事件逐段到达。把 `stream` 改成 `false` 就是单个 JSON 响应。

> ✅ **检查点**：返回的是 `message_start` / `content_block_delta` / `message_stop` 这一套，而不是上游原生的 `choices` 或 `response.*`。

## 可选：把请求钉在某个账号

「接入算力池」弹窗顶部可以把模型清单从**聚合模式**切到**精确模式**：

| 模式 | 清单形态 | 选号行为 |
| --- | --- | --- |
| 聚合 | `claude-sonnet-alias` | 池内轮换 |
| 精确 | `OpenAI通道-Claude/gpt-4o`、`official/模型` | 前者钉死在该 API 账号；后者在全部官方账号间轮换 |

前缀由账号名安全化而来（空格、`/`、`:` 换成 `-`，中文保留，截到 32 字符；重名会补账号 id 前 6 位）。三点要注意：

- 代理**任何模式下都接受**带前缀的模型名，切回聚合不会让已写出去的配置失效。
- 前缀解不出账号时会把整串当模型名继续走，所以中转站常见的 `z-ai/glm-5.3` 这类带厂商路径的名字不受影响。
- **Claude Code 的四个 `/model` 槽位不受影响**：槽位写的是单个别名而非清单，继续走轮换。Gemini 原生路径把模型放在 URL 里，也不解析前缀。

改了账号名要重新写入客户端配置，旧前缀不再解析。

## 排错表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| `route_pool.model_unmatched` | 别名映射的 `from` 与 Claude Code 发出的名字对不上 | 核对 `/model` 槽位值，补齐 `alias → to` 映射 |
| 上游 404 | 接口格式选错，或 Base URL 少了 `/v1` | 按上游文档重选方言、核对 base URL |
| 401 / 403 | key 无效、`anthropic` 方言的鉴权字段选错 | `anthropic` 账号在 `ANTHROPIC_AUTH_TOKEN` 与 `ANTHROPIC_API_KEY` 之间换一个试 |
| `1m 上下文已经全量可用…` | 上游要求显式 1M 声明 | 在映射上勾「1M」，或让客户端用 `[1M]` 后缀 |
| 工具调用结果格式怪 | 上游不支持 Claude 的 `tool_use` 形状 | 桥接负责双向转换；看实时日志第 2 / 4 阶段确认改写是否生效 |
| 流式输出卡住 | 首包后的断流 | 账号失败策略里可开「自动续写」，默认关闭 |
| 客户端只看到 HTTP 502 | 代理不透传上游状态码 | 看响应体 `error.code` 与实时日志 |
| `route_proxy.platform_unresolved` | 请求没带代理 key 也没带平台头 | 加 `Authorization: Bearer` 或 `x-ai-switch-platform: claude` |

::: tip 非 2xx 原样透传
上游报错时响应体不做反向转换，你看到的是上游原始错误体。这不是 bug——排错需要原文。若上游返回 gzip/br/zstd，出站请求已强制 `accept-encoding: identity`，避免中转环节看到乱码。
:::

## 边界：别指望 Gemini CLI 也这样

Gemini CLI 发的是 `/v1beta/models/{model}:generateContent`，既不是 `/responses` 也不是 `/v1/messages`，不在三个桥接分支里，落回**直通**。这是当前的能力边界：**Gemini CLI 只能路由到 `gemini` 方言的账号**，模型测试的方言校验里也写死了这一点。

另外，只有创建端点会被桥接，`/v1/models`、`/models` 由代理直接聚合池内模型返回（`owned_by` 固定 `ai-switch`），不会转发到上游，且只接受 `GET`。

## 下一步

- [协议路由与桥接](/guide/protocol-routing)：七条链路矩阵、模型映射、1M 声明、工具命名空间展平、一次转发的完整顺序
- [用 Chat 中转账号驱动 Codex](./codex-with-chat-relay)：对称的另一条常用链路
- [平台支持矩阵](/guide/platform-support)：7 个平台各自写入哪个原生配置文件
- [模型连通性测试](/guide/model-test)：测试结果面板的字段含义
