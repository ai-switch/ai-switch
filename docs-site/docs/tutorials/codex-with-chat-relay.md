---
title: 用 Chat 中转账号驱动 Codex
description: 手上是 OpenAI Chat Completions 格式的中转站 key，却想用只讲 Responses API 的 Codex。本教程用协议桥接走通这条链路，含模型映射、真实生成测试、实时日志与常见报错排查。
---

# 用 Chat 中转账号驱动 Codex

**目标**：不改 Codex 一行配置，让它通过一个只支持 Chat Completions 的中转站账号正常工作，包括工具调用与流式输出。

**你需要**：一个 OpenAI 兼容（`/chat/completions`）的上游账号；已装好 Codex 与 AI Switch；做过 [跑通第一条请求](./first-request) 更好，但不是必须。

**验收标准**：Codex 能完成一轮带工具调用的对话；实时日志里第 2 阶段是 Chat Completions 请求体，第 4 阶段是 Responses 格式的响应。

## 为什么直接改配置不行

Codex 发出去的永远是 Responses API 请求（`POST /responses`，`input`、`tools`、`response.*` 事件）。而中转站只认 `POST /chat/completions`（`messages`、`tools`、`choices[].delta`）。把 base URL 指过去，得到的只会是 404 或 400——**这不是 key 的问题，是协议形状的问题**。

AI Switch 在本地插了一层：入口继续讲 Responses，命中账号是 `openai` 方言时，链路走 `ResponsesToChat`，把请求改写成 Chat Completions，再把上游回答（含 SSE 流）重放成 Responses 事件序列。七条桥接链路里，这一条是最常用的。

```text
Codex ── /responses ──> 本地代理 ── /chat/completions ──> 中转站
      <── response.* ──          <── choices[].delta ───
```

只有创建端点会桥接，`/models` 这类路径由代理直接返回池内聚合的模型清单，不转发到上游。

## 第 1 步：按上游协议建账号

左侧 **Agents → Codex**，点 **+** 新增账号，保持「API 账号」标签：

| 字段 | 值 |
| --- | --- |
| 账号名称 | `Chat中转-Codex` |
| API Key | 中转站给的 key |
| Base URL | 如 `https://your-relay.example.com/v1` |
| **接口格式** | **OpenAI Chat Completions（`openai`）** |
| 创建后加入算力池 | 保持勾选 |

::: warning 最容易填错的一栏
「接口格式」说的是**上游账号**讲哪种协议，不是 Codex 讲哪种。中转站是 Chat Completions 就选 `openai`，哪怕客户端是 Codex。选成 `openai-responses` 会把请求发到上游不存在的 `/responses`，拿到 404。
:::

> ✅ **检查点**：账号出现在算力池里，「接口格式」一栏显示 Chat Completions。

## 第 2 步：填模型映射（大概率必须）

Codex 默认请求的模型名（如 `gpt-5.5`）和中转站实际提供的模型名（如 `gpt-4o`、`claude-sonnet-4`）通常不一样。在新增账号对话框的「模型映射」里加一条：

```text
gpt-5.5  →  gpt-4o
```

上游模型名和 CLI 请求名一致就不用填。

::: tip 映射同时决定能不能路由
代理会先检查请求的模型在池里有没有账号支持，一个都没有就直接返回 `route_pool.model_unmatched`，**不会瞎发一个请求过去**。所以映射不只是改名，它是选号的依据。多个账号映射同一个别名时，代理在它们之间轮换。
:::

> ✅ **检查点**：🔌 弹窗里的模型清单能看到 `gpt-5.5`（聚合模式列出的是客户端可见的别名，不是上游真名）。

## 第 3 步：用真实生成测试打通链路

点工具栏 **✈**（「真实生成测试算力池路由」），测试接口保留 `/responses`，模型选第 2 步的别名，点 **「开始测试」**。

通过时展开「查看输入输出」，你会看到这次桥接确实发生了：

| 阶段 | 应该看到 |
| --- | --- |
| 发给代理 | Responses 形状：`input`、可能有 `tools` |
| 发往上游 | `messages` 数组、`model` 已换成映射后的名字 |
| 上游原始返回 | `choices[0].message` 或 `choices[0].delta` |
| 返回客户端 | Responses 形状：`output` / `response.completed` |

> ✅ **检查点**：结果通过，链路里命中 `Chat中转-Codex`，上游接口是 `/chat/completions`。

测试不通过时，错误信息会指出卡在哪一环：`transport` 是网络问题，`upstream_status` 是上游返回了非 2xx，`request_build` 是桥接阶段构造请求失败，`response_transform` 是返回方向转换失败。

## 第 4 步：写入 Codex 配置并跑起来

点工具栏 **🔌**，勾选 Codex，点「写入」。它会改 `~/.codex/config.toml`：

```toml
model_provider = "ai-switch"

[model_providers.ai-switch]
base_url = "http://127.0.0.1:19527/v1"
wire_api = "responses"
experimental_bearer_token = "sk-ai-switch-..."
```

注意 `wire_api = "responses"` —— **Codex 侧始终讲 Responses**，转换发生在代理里，客户端完全不需要知道上游是 Chat 格式。写入是快照 + 原子写入 + 并发检测，原有配置保留。

```bash
codex
```

让 Codex 做一件会触发工具调用的事（比如「读一下当前目录的 package.json 并总结」），工具调用是桥接最容易出问题的地方。

> ✅ **检查点**：Codex 能读文件、能拿到结果，没有 `tool` 相关的报错。

## 第 5 步：在实时日志里确认四个阶段

打开工具栏下拉菜单的 **「实时日志」**，重发一条请求，看四个阶段：

1. **客户端原始请求** —— Responses 格式
2. **改写后的上游请求** —— `messages`、扁平化的 `tools`
3. **上游原始响应** —— Chat Completions 格式
4. **返回给客户端的最终响应** —— `response.*` 事件

这条链路里代理还顺手做了几件不显眼但很关键的事：

- **自定义工具兼容自动开启**：Codex 的 custom tool 写法和 OpenAI 托管工具（`web_search`、`code_interpreter` 等七种）第三方网关通常不认。Codex + `openai` 方言 + Responses 路径会自动把自定义工具改写成普通 function tool、剥掉托管工具，响应回来再还原；如果 `tool_choice` 正好钉住了被剥掉的工具，会放宽成 `"auto"`。
- **工具命名空间展平**：Responses 支持 `namespace` 分组，Chat 只有平铺函数列表，桥接会映射成 `namespace__tool` 并在回来时还原。
- **推理内容回填**：DeepSeek、MiMo 一类推理模型要求带工具调用的 assistant 消息必须带 `reasoning_content`，否则 400。代理会缓存并在多轮工具调用里回填，避免模型丢掉自己的计划。
- **流式事件重放**：上游的 `choices[].delta` 会被重放成 `response.created` → `response.output_text.delta` → `response.completed`，上游的 `[DONE]` 标记会被剥掉（Responses 不用它）。
- **指纹与压缩**：出站会套 Codex 客户端标识（含 `x-codex-window-id`）并强制 `accept-encoding: identity`，避免上游返回 gzip 后中转环节看到乱码。

::: warning 非 2xx 不做转换
上游报错时响应体**原样透传**，你看到的是上游的原始错误，而不是被改写过的 Responses 形状。这是刻意的——排错需要原文。所以客户端看到的错误体长得「不像 Responses」是正常现象。
:::

## 可选：用 curl 绕开 CLI 单独验证

```bash
curl -N -X POST http://127.0.0.1:19527/responses \
  -H "Authorization: Bearer sk-ai-switch-你的key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "input": "Say hello in five words",
    "stream": true
  }'
```

`-N` 关掉缓冲，能直接看到 `response.output_text.delta` 事件逐段到达。想非流式就把 `stream` 改成 `false`。

## 排错表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| 上游 404 / `route not found` | 接口格式选成了 `openai-responses`，或 base URL 拼错 | 改成 `openai`；核对上游文档里的 base URL 是否自带 `/v1` |
| `route_pool.model_unmatched` | 没填模型映射，或别名写错 | 补 `CLI 模型名 → 上游模型名`，与请求里的 `model` 完全一致 |
| `This account only allows Codex official clients` | 中转站校验客户端指纹 | 代理会自动补标识；若账号自配了 `User-Agent`，那套伪装会整体让路，去掉自定义 UA 试试 |
| 401 / 403 | key 无效、受限 key 缺 scope、或额度耗尽 | 核对 key；缺 `api.responses.write` 一类的受限 key 可把接口格式改成 Chat Completions，见 [稳定性与自动恢复](/guide/reliability) |
| 工具调用报 `custom tool not supported` | 上游网关不认 Codex 自定义工具 | 这条链路默认自动兼容；若仍失败，检查账号配置里 `responses_custom_tool_compat` 是否被关掉 |
| 多轮工具调用后模型「忘了」要做什么 | 上游要求 `reasoning_content` | 代理会回填；确认请求没被中间层改写丢字段 |
| 只看到 HTTP 502 | 代理不透传上游状态码 | 看响应体 `error.code` 与实时日志第 3 阶段的上游原文 |
| 流式输出卡住 / 半截 | 首包后的断流 | 可在账号的失败策略里开「自动续写」；默认关闭，因为续写是一次完整计费请求 |
| Codex 读不到本地根证书 | 手动把 base URL 写成了 `https://` | 用回 `http://`，HTTPS 端点只给确实要求 TLS 且信任本地 CA 的客户端 |

## 边界：哪些情况不由这条链路管

- **Gemini CLI 不桥接。** 它发的是 `/v1beta/models/{model}:generateContent`，既不是 `/responses` 也不是 `/v1/messages`，落回直通，只能路由到 `gemini` 方言的账号。
- **Messages 入口按路径判定，不看平台。** `/v1/messages` 可以打进任何池，见 [让 Claude Code 用任意上游](./claude-with-any-upstream)。
- **同协议不一定直通。** Codex → `openai-responses` 仍算一条 `ResponsesToResponses` 桥接，因为第三方 Responses 网关的实现差异需要清洗。

## 下一步

- [协议路由与桥接](/guide/protocol-routing)：七条链路矩阵、一次转发的完整顺序
- [模型连通性测试](/guide/model-test)：测试结果面板里每个字段的含义
- [搭一个不会断的算力池](./failover-pool)：再加几个账号，让这条链路在限流时也不中断
- [用量、费用与对账](./usage-and-cost)：桥接后的请求怎么计价
