---
title: 跑通第一条请求
description: 五分钟从零跑通第一条经过 AI Switch 的请求，包含添加路由账号、启动本地代理、写入 CLI 配置、curl 验证与统计验收的完整操作和排错表。
---

# 跑通第一条请求

**目标**：让 Codex 的一条真实请求经过本地代理打到你的上游账号，并在用量统计里看到它。

**你需要**：已安装 AI Switch（见 [安装](/guide/installation)）；一个可用的上游账号，即 base URL + API key，中转站或官方都行；本机装了 Codex 或任意一个能发 HTTP 请求的工具。

**验收标准**：统计视图里出现一条新请求，账号名是你刚加的那个，状态成功，token 与价格有值。

::: tip 和「快速开始」的区别
[快速开始](/guide/quick-start) 讲的是五个步骤各自是什么；这篇是操作清单，每一步都带一个「怎么确认做对了」的检查点，最后还有一张按报错反查原因的表。第一次上手建议先跟这篇做完，再回去看快速开始理解原理。
:::

## 准备：先认清两个 key

动手前把两个容易混的东西分开：

| | 本地代理 key | 上游 API key |
| --- | --- | --- |
| 长什么样 | `sk-ai-switch-<uuid>` | 供应商给你的 `sk-...` |
| 从哪来 | 「接入算力池」弹窗里复制 | 你的中转站 / 官方后台 |
| 填到哪 | CLI 的 base URL 旁边 | AI Switch 新增账号对话框 |
| 发给谁 | 只发给本机代理 | 由代理发给上游 |
| 会不会外泄 | 转发前被剥掉，**绝不到上游** | 只在出站请求里出现 |

搞混的典型症状是上游报 401：把 `sk-ai-switch-*` 填进上游账号了。

## 第 1 步：添加路由账号

打开 AI Switch，左侧 **Agents** 分组里点 **Codex**（启动默认就在这里），点工具栏 **+**（「新增账号」），保持在 **「API 账号」** 标签。

按顺序填：

| 字段 | 填什么 | 常见坑 |
| --- | --- | --- |
| 账号名称 | 能认出来的名字，比如 `中转站-主力` | 用 `test` 之类，后面统计里分不清是谁 |
| API Key | 上游 key，**一行一个** | 误贴多行会一次建多个账号 |
| Base URL | 上游文档给的地址，如 `https://your-relay.example.com/v1` | 漏了 `/v1` 或重复拼 `/v1/v1` |
| 接口格式 | 按**上游**支持的协议选 | 按 CLI 选。Codex 用 `openai` 账号也要选 `openai` |
| 模型映射（可选） | CLI 请求名 → 上游模型名，如 `gpt-5.5 → gpt-4o` | 名字不一致时漏填，会得到 `route_pool.model_unmatched` |

四个接口格式对应：`openai`（Chat Completions）、`openai-responses`（Responses）、`anthropic`（Messages）、`gemini`（generateContent）。**不确定就先选 `openai`**，绝大多数中转站都是这个。

底部 **「创建后加入算力池」** 默认已勾选，别取消。点 **「保存账号」**。

> ✅ **检查点**：算力池视图里能看到这个账号，状态是「正常」，且没有出现在「未入池」里。

::: details 如果填错了怎么办
点账号行末的「编辑账号」直接改。账号已经在池子里但一直没被选中，先去「高级」分区看路由优先级是不是被设成了 5，或者状态是不是被手动暂停了。
:::

## 第 2 步：用真实生成测试先验一遍

**别急着改 CLI 配置**。先点工具栏的 **✈**（「真实生成测试算力池路由」），Codex 平台保持 `/responses`，测试模型留空用默认值，点 **「开始测试」**。

这不是 ping：它会真的让上游生成一段内容。通过的结果面板应该包含：

- **模型输出** —— 上游真的回了一段文本
- **算力池请求链路** —— 算力池入口 → 命中账号 → 上游接口，带 trace id
- 展开「查看输入输出」能看到请求 JSON 与响应 Body

> ✅ **检查点**：结果显示通过，且链路里的账号名是第 1 步创建的那个。

这一步通了，说明账号、凭据、协议、模型映射四件事全对。失败就按文末排错表反查，**不要带着一个失败的链路去改 CLI 配置**。

::: warning 测试也会记账
模型连通性测试和真实转发写进同一张用量表，统计面板不会把两者分开。频繁点测试会推高请求数，区分只能看请求列表的「来源」列。验收时请只点一次。
:::

## 第 3 步：启动本地代理

点工具栏绿色的 **▶**（「启动本地路由代理」）。状态条从「代理未启动」变成地址：

```text
http://127.0.0.1:19527
```

默认只绑 `127.0.0.1`，端口 19527；端口被占用会向上递增，**以界面显示的地址为准**。

按平台的本地入口路径：

| 平台 | 路径 | 协议 |
| --- | --- | --- |
| Codex | `/responses` | OpenAI Responses |
| Claude Code | `/v1/messages` | Anthropic Messages |
| Gemini CLI | `/v1beta/models/{model}:generateContent` | Gemini native |

> ✅ **检查点**：状态条显示地址，且 `curl http://127.0.0.1:19527/health` 能返回健康状态。

::: tip 需要 TLS 的客户端
设置里可以开「本地算力池 HTTPS」，会生成并导入根证书，HTTPS 从「HTTP 端口 + 1」起另绑一个（常见 19528）。写入客户端配置的**始终是 HTTP 地址**——自带 CA bundle 的 curl / Node CLI 读不到系统信任库里的本地根证书，写 `https://` 反而会让它们失效。详见 [远程访问与 HTTPS](/deploy/remote-access)。
:::

## 第 4 步：写入 CLI 配置

点工具栏 **🔌**（「对接客户端：把当前算力池写入客户端配置」），勾选 Codex，点「写入」。

AI Switch 会改 `~/.codex/config.toml`，加一个名为 `ai-switch` 的 model provider 并选中它，同时写一份 `~/.codex/ai-switch-model-catalog.json` 模型目录。写入前建快照、原子写入、检测并发修改、支持带守卫回滚，**你原有的其他配置项会保留**。

各平台写入目标：

| 平台 | 文件 |
| --- | --- |
| Codex | `~/.codex/config.toml` |
| Claude Code | `~/.claude/settings.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Grok | `~/.grok/settings.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| OpenClaw | `~/.openclaw/openclaw.json` |
| Hermes | `~/.hermes/config.yaml` |

写完直接跑：

```bash
codex
```

> ✅ **检查点**：界面下方的「配置写入结果」列出目标路径与成功状态；`codex` 能正常启动并发起对话。

::: details 不想让它改配置文件？手动来
在 🔌 弹窗切到「其他 Agent」标签，复制两个值：**Base URL**（当前代理地址）和 **API Key**（本地代理 key，默认打码，点眼睛图标显示）。代理 key 可以放在 `Authorization: Bearer`、`x-api-key`、`x-goog-api-key` 头里，也可以放 URL 的 `key` / `api_key` 查询参数里。注意 **每个平台一个 key**，切标签页要重新复制。
:::

## 第 5 步：用 curl 独立确认一次

不依赖 CLI，自己发一条最干净的验证请求：

```bash
curl -X POST http://127.0.0.1:19527/responses \
  -H "Authorization: Bearer sk-ai-switch-你的key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "input": "Reply with exactly: ai-switch-ok",
    "stream": false
  }'
```

```powershell
$key = "sk-ai-switch-你的key"
$body = @{ model = "gpt-5.5"; input = "Reply with exactly: ai-switch-ok"; stream = $false } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:19527/responses `
  -H "Authorization: Bearer $key" -H "Content-Type: application/json" -d $body
```

`model` 要填**池内账号支持的模型名**（映射过的填映射前的名字）。想看池子对外暴露哪些模型，`GET /models` 会返回聚合去重后的清单，这个接口不转发到上游。

> ✅ **检查点**：返回 2xx，响应体里有模型输出，没有 `error.code`。

## 第 6 步：在统计里验收

底部视图切到 **「统计」**，选「当日」，看六张指标卡与下方 **「请求列表」**。

| 看哪里 | 期望看到 | 说明什么 |
| --- | --- | --- |
| 请求 | ≥ 1 | 转发确实发生了 |
| 账号名 | 你刚加的账号 | 优先级与选号配对 |
| 状态 / 路径 | 成功 / `/responses` | 入口协议正确 |
| 模型 | 映射后的上游名（`请求名->上游名`） | 模型映射生效 |
| 价格 | 有金额，可能带「估」 | 计价来源正常 |

> ✅ **最终验收**：请求列表里出现第 5 步那条 curl 请求，账号名、模型、token 都有值。

统计每 5 秒自动刷新，请求列表每页 20 条。费用是**参考值**：上游不报价时按本地价格表估算（金额后带「估」），人民币按固定汇率 7.1 折算成美元，账单请以供应商后台为准。口径详见 [用量与请求统计](/guide/usage-stats)。

## 排错表

| 报错 / 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| `代理未启动` | 没点 ▶，或端口冲突启动失败 | 点启动，核对状态条里的实际端口 |
| `No enabled route credentials in pool` | 池内没有可用账号 | 去「未入池」把账号加入算力池，或解除暂停 |
| `route_pool.model_unmatched` | 请求的模型没有任何账号支持 | 在账号的「模型映射」里补 `from → to` |
| `route_pool.concurrency_exhausted` | 所有账号并发都占满 | 调高「最大并发数」或再加一个账号 |
| `route_proxy.key_invalid` | 复制错了 key，或属于另一个实例 | 在「接入算力池」里重新复制当前平台的 key |
| `route_proxy.platform_unresolved` | 请求没带代理 key 也没带平台头 | 加 `Authorization: Bearer`，或 `x-ai-switch-platform` 头 |
| 上游 401 / 403 | 上游 key 错、没权限、或把本地代理 key 填进了账号 | 核对上游 key；受限 key 缺 scope 见 [稳定性与自动恢复](/guide/reliability) |
| `This account only allows Codex official clients` | 中转站校验客户端指纹 | AI Switch 会自动补 Codex 客户端标识；仍失败就检查账号是否自配了 `User-Agent` |
| 客户端只看到 HTTP 502 | 代理不透传上游状态码 | 看响应体的 `error.code` 或实时日志，不要按 502 猜 |
| 金额显示 `-` | 上游没报价、模型也不在内置价格表 | 配一份 `~/.ai-switch/model-prices.json`，见 [用量与费用对账](./usage-and-cost) |

四个阶段的实时日志（原始请求 / 发往上游 / 上游原始返回 / 最终返回）在工具栏下拉菜单里，排桥接问题时比客户端看到的更有用。它是内存环形缓冲，只留最近 100 条、不落盘。

## 跑通之后

- 加第二个账号并排好优先级，限流时自动降级 → [搭一个不会断的算力池](./failover-pool)
- 手里只有 Chat 中转 key，想让 Codex 用起来 → [用 Chat 中转账号驱动 Codex](./codex-with-chat-relay)
- 配置其他 CLI → [平台支持矩阵](/guide/platform-support)，每个平台有独立的池与代理 key
- 在浏览器或手机上管理 → [手机访问与团队自建](./remote-and-team)
- 把一次转发的完整链路搞明白 → [协议路由与桥接](/guide/protocol-routing)
