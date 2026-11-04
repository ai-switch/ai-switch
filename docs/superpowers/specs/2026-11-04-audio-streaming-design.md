# 流式 TTS 设计

## 目标

完成音频渠道计划的「流式 TTS」遗留项：客户端发送 `POST /v1/audio/speech` 和 `stream_format: "sse"` 后，OpenAI 与 MiniMax 账号都能逐帧返回 OpenAI 兼容的音频 SSE。首块音频出来后立即交给客户端，不等待整段合成；SaaS 只有在音频流完整结束时才按原请求的字符数扣费。

用户已经要求直接继续执行、不再提问。以下实现选择由执行者决定，并非用户逐项选择。

## 契约

- `response_format` 仍决定 SSE 中音频字节的编码；默认 MP3。
- `speech.audio.delta` 的 `audio` 字段是 Base64。`speech.audio.done` 是语义完成事件；`[DONE]` 只是可选的传输哨兵，不能单独证明成功。
- EOF 前必须收到非空音频以及语义完成事件。JSON 损坏、编码损坏、供应商业务错误、连接中断、客户端提前丢弃响应均视为失败。
- MiniMax 请求使用 `stream: true` 和 `stream_options.exclude_aggregated_audio: true`，避免末帧再次携带累计音频。供应商的 `data.status == 2` 转为 `speech.audio.done`。
- MiniMax 未提供 token 用量时，兼容完成事件的三个 token 字段为 0；不能把字符数伪装为 token。SaaS 计价仍只使用预留的字符数快照。
- `stream_format: "audio"` 或未指定时保留已有非 SSE 处理；本项不顺便改变默认二进制响应的行为。

## 方案与边界

考虑过扩展文本数据泵与独立音频数据泵。选择独立音频数据泵：文本路径会自动续写与合成 Responses 收尾，音频不具备这些语义。复用既有账号选择、失败重试、并发槽、请求日志与健康记录，但不调用文本续写。

协议模块负责纯请求转换与增量 SSE 校验/转换；路由模块负责首块保留与流生命周期；SaaS 模块负责延迟结算与 Drop 退款。

首个音频分块到客户端之前，错误仍在账号重试循环内处理；之后只终止本次流，不换号拼接两段音频。SSE 的网络分块可切开 JSON、Base64 或 CRLF，因此只能处理完整帧。单帧/待完成帧上限 4 MiB，防止不完整事件无限占内存；首音频之前累计保留也受限。

## 不做

不增加供应商、不做音频资产落盘、不改变 STT、不加入 Realtime API、不重构文本流式桥接、不推送或发布。未获单独提交指令时保留本地工作区改动。

## 验收

覆盖 OpenAI 完成事件但无 `[DONE]`、只有 `[DONE]` 的截断、MiniMax hex→Base64、末帧无重复、首帧错误切号、首音频延迟后的实时可读、流中断/客户端丢弃的全额退款、并发槽释放，以及所有 Rust/TypeScript/Vitest 回归。
