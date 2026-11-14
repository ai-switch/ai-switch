---
title: 教程中心
description: 六篇可照着做的 AI Switch 实战教程，覆盖第一条请求、Codex 接 Chat 中转、算力池故障转移、Claude Code 接任意上游、用量费用对账与远程团队自建。
---

# 教程中心

这里不是功能说明书，而是**照着做就能跑通**的实战教程。每篇都有明确的验收标准、可复制的命令和一张排错表，做完就能确认自己真的配对了。

如果你还没装好应用，先看 [安装](/guide/installation) 和 [快速开始](/guide/quick-start)。本栏目的教程假设你已经能打开 AI Switch 主界面，并且手上至少有一个可用的上游账号（base URL + API key，中转站或官方都行）。

<div class="tutorial-grid">
  <a class="tutorial-card" href="./first-request.html">
    <div class="tc-head"><span class="tc-tag">入门</span><span class="tc-time">5 分钟</span></div>
    <span class="tc-title">跑通第一条请求</span>
    <span class="tc-desc">装好应用、添加路由账号、启动代理、写入 CLI 配置，最后在统计里看到这条请求。</span>
    <span class="tc-more">开始教程 →</span>
  </a>
  <a class="tutorial-card" href="./codex-with-chat-relay.html">
    <div class="tc-head"><span class="tc-tag">协议</span><span class="tc-time">8 分钟</span></div>
    <span class="tc-title">用 Chat 中转账号驱动 Codex</span>
    <span class="tc-desc">手里只有 OpenAI 兼容的第三方 key？用协议桥接让 Codex 照样工作，不用改 CLI 一个字。</span>
    <span class="tc-more">开始教程 →</span>
  </a>
  <a class="tutorial-card" href="./failover-pool.html">
    <div class="tc-head"><span class="tc-tag">进阶</span><span class="tc-time">10 分钟</span></div>
    <span class="tc-title">搭一个不会断的算力池</span>
    <span class="tc-desc">主力 / 备用 / 兜底三层优先级，配合并发上限、冷却与自动恢复，让限流时无感切换。</span>
    <span class="tc-more">开始教程 →</span>
  </a>
  <a class="tutorial-card" href="./claude-with-any-upstream.html">
    <div class="tc-head"><span class="tc-tag">协议</span><span class="tc-time">8 分钟</span></div>
    <span class="tc-title">让 Claude Code 用任意上游</span>
    <span class="tc-desc">Messages 入口可以打进任何池，把 Claude Code 接到 OpenAI 或 Gemini 协议的账号上。</span>
    <span class="tc-more">开始教程 →</span>
  </a>
  <a class="tutorial-card" href="./usage-and-cost.html">
    <div class="tc-head"><span class="tc-tag">运维</span><span class="tc-time">7 分钟</span></div>
    <span class="tc-title">用量、费用与对账</span>
    <span class="tc-desc">看懂六张指标卡与请求列表，配置自定义模型价格，分清上游实价与本地估算。</span>
    <span class="tc-more">开始教程 →</span>
  </a>
  <a class="tutorial-card" href="./remote-and-team.html">
    <div class="tc-head"><span class="tc-tag">部署</span><span class="tc-time">12 分钟</span></div>
    <span class="tc-title">手机访问与团队自建</span>
    <span class="tc-desc">Web 服务、Tailscale Funnel 公网访问、独立服务器与 Docker 四条路径，按场景选一条。</span>
    <span class="tc-more">开始教程 →</span>
  </a>
</div>

## 按场景挑一篇

| 你现在的情况 | 建议从哪篇开始 |
| --- | --- |
| 第一次打开 AI Switch，还没发出过请求 | [跑通第一条请求](./first-request) |
| Codex 只有官方账号才连得上，中转站 key 用不了 | [用 Chat 中转账号驱动 Codex](./codex-with-chat-relay) |
| 主力号经常 429、额度用完就卡住 | [搭一个不会断的算力池](./failover-pool) |
| 想让 Claude Code 走便宜的 OpenAI / Gemini 通道 | [让 Claude Code 用任意上游](./claude-with-any-upstream) |
| 号多了，想知道钱花在哪里、数字准不准 | [用量、费用与对账](./usage-and-cost) |
| 想在手机上看，或者给团队共用一份配置 | [手机访问与团队自建](./remote-and-team) |

## 教程里的共同约定

几篇教程反复用到同一组东西，先在这里说清楚：

- **本地代理地址**：`http://127.0.0.1:19527`。端口被占用时会向上递增，以界面上显示的地址为准。
- **本地代理 key**：形如 `sk-ai-switch-<uuid>`，在「接入算力池」弹窗里复制，**每个平台一个**。它只用于本地识别，绝不会发给上游。
- **接口格式**：指的是**上游**说哪种协议，不是 CLI 用哪种。`openai`（Chat Completions）、`openai-responses`（Responses）、`anthropic`（Messages）、`gemini`（generateContent）四选一，照上游文档填。
- **算力池**：每个平台有自己独立的池子和代理 key。切到别的平台要重新添加账号、重新复制 key。
- **验证三件套**：工具栏的 ✈「真实生成测试」、下拉菜单里的「实时日志」、底部「统计」视图的请求列表。前者看链路通不通，中间看请求被怎么改写，后者看最终落到哪个号。

::: tip 出问题先看哪里
代理把「所有账号都失败」「模型没匹配上」这类错误统一以 HTTP **502** 返回，真正的线索在响应体的 `error.code` 里，比如 `route_pool.model_unmatched`、`route_pool.model_unavailable`。CLI 里只看到 502 时，去实时日志或请求列表看具体原因。
:::

## 想系统学一遍

教程解决「怎么做」，文档解决「为什么」。建议按这个顺序补：

1. [AI Switch 是什么](/guide/introduction) —— 本地代理、算力池、协议桥接三个核心概念
2. [账号与算力池](/guide/accounts) —— 优先级、并发、状态机
3. [协议路由与桥接](/guide/protocol-routing) —— 七条桥接链路与一次转发的完整顺序
4. [稳定性与自动恢复](/guide/reliability) —— 失败分类、两层冷却、定时与探活恢复
5. [用量与请求统计](/guide/usage-stats) —— 每个数字的精确口径
6. [常见问题](/faq) —— 平台支持、密钥安全、Tailscale、备份等

## 还有别的问题

- 想二次开发、看架构或接中转站？首页底部的「开发者 · 二次开发」一栏有 [架构总览](/dev/architecture)、[本地开发](/dev/local-setup)、[发布流程](/dev/release) 与 [中转站接入规范](/relay/spec)。
- 找不到答案？去 [GitHub Issues](https://github.com/ai-switch/ai-switch/issues) 或 [Discussions](https://github.com/ai-switch/ai-switch/discussions) 提一个，把实时日志里的 `error.code` 和 trace id 一起贴上来最快定位。
