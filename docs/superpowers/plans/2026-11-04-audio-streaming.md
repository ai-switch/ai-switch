# 流式 TTS 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenAI / MiniMax 的 `stream_format: "sse"` 真正逐帧转发，并按完整音频流全额结算或退款。

**Architecture:** 新增独立的音频 SSE 校验/适配器与音频数据泵，不进入文本续写。既有 `forward_request` 保留首音频前的账号重试，SaaS 用响应体生命周期决定结算。

**Tech Stack:** Rust、Axum、Tokio、Reqwest、Base64、SQLx、既有 Rust/Vitest 测试设施。

**Spec:** `docs/superpowers/specs/2026-11-04-audio-streaming-design.md`

## Global Constraints

- 在既有 `D:/Repos/ai-switch-gw` worktree 的 `feat/videogen-gateway` 工作，不切分支。
- Rust 验证从 `src-tauri` 执行，`CARGO_TARGET_DIR=target-codex`；不新建 target，使用 `CARGO_INCREMENTAL=0` 控制磁盘。
- 未要求推送、发布或另行提交；不执行这些操作。
- SSE 单帧 / 待完成帧上限 4 MiB；首音频前保留量受限。
- 完整成功必须有非空音频和 `speech.audio.done`，`[DONE]` 不替代语义完成。

## Review Focus

- 网络切开 CRLF、UTF-8、JSON / Base64：整帧处理，不能损坏音频或错误忽略尾巴。
- 上游完成标记后又发送错误或重复音频：不能错误结算或重复播放。
- 音频未出现前只有 keepalive / 控制帧：保持切号能力且内存有界。
- 客户端在首次轮询前丢弃响应：冻结额与并发槽必须释放。
- 同一池混用 OpenAI / MiniMax：首帧切号后响应仍是相同 OpenAI SSE，不带文本续写。

## Task 1: 音频 SSE 协议

**Files:** 修改 `src-tauri/src/audiogen/protocol.rs`、`audiogen/mod.rs`；新增 `audiogen/stream.rs`（含单元测试）。

**Interfaces:** `SpeechStreamFormat::Sse`；`speech_request_streams(body: &[u8]) -> bool`；`SpeechStreamAdapter::new(dialect: AudioDialect)`、`push(&[u8]) -> Result<Vec<u8>, String>`、`finish() -> Result<Vec<u8>, String>`、`started() -> bool`、`completed() -> bool`。

- [ ] 先写请求测试：MiniMax SSE 请求必须 `stream=true`、`exclude_aggregated_audio=true`；OpenAI SSE 原字节保留。
- [ ] 写适配器测试：OpenAI split delta/done；只有 `[DONE]` 或无 done 必败；MiniMax `494433` 转成 `SUQz`、status 2 只输出一次 done；损坏 hex/Base64、provider error、过大帧与 CRLF 拆分拒绝/正确处理。
- [ ] 运行 `CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=target-codex cargo test --lib audiogen::`，确认新用例 RED。
- [ ] 按接口最小实现；MiniMax 完成事件用量为 0，未知协议/损坏尾帧不当成功。
- [ ] 重跑 `audiogen::`，期望全部通过。

## Task 2: 路由实时转发

**Files:** 修改 `services/route_proxy_service.rs`、`services/route_proxy_stream.rs`；新增 `services/route_proxy_service/audio_stream_tests.rs`。

**Consumes:** Task 1 的增量适配器与 SSE 请求识别。

**Produces:** 每个 TTS SSE 请求独立的音频数据泵；账号日志/健康判定使用音频语义结束；不会调用文本续写。

- [ ] 先写 socket / 延迟控制的端到端测试：请求在末帧释放前已返回可读第一块，done 无 `[DONE]` 仍成功；首帧 provider error 能切至另一家；只有 delta 的断流返回体错误且不再次请求；MiniMax 的客户端只收到 Base64 的 OpenAI SSE。
- [ ] 运行 `cargo test --lib services::route_proxy_service::tests::audio_stream`（携带规定环境变量），确认 RED。
- [ ] SSE 请求在原账号循环内先校验首音频并保留前序事件；只有非空音频可提交成功响应。按账号方言实例化 Task 1 适配器；已发音频后读失败/协议失败均报响应体错误。
- [ ] 用独立音频数据泵复用既有 StreamCompletion 日志/健康逻辑，音频专用观察模式不识别文本终止标记；Drop 记失败并释放账号并发槽。
- [ ] 重跑上述测试与 `services::route_proxy_stream::`，期望全部通过。

## Task 3: SaaS 延迟结算与完整回归

**Files:** 修改 `saas/proxy/mod.rs`、`saas/proxy/tests.rs`。

**Consumes:** Task 2 的 OpenAI 兼容 SSE 与响应体错误。

**Produces:** 音频响应体生命周期驱动一次性结算；中断 / Drop 全额退款并释放用户并发槽。

- [ ] 先写集成测试：末帧到达前 reservation 仍 pending / frozen、首块可读；完整 done 后 settled / usage；缺 done、显式 error 与客户端提前 Drop 后 refunded / no usage / frozen=0。
- [ ] 运行 `cargo test --lib saas::proxy::tests::`（规定环境变量）确认 RED。
- [ ] 延迟结算：不 `to_bytes` 全量缓冲 SSE；带 Drop guard，保持日志、余额头与请求身份一致，结算失败沿既有 pending-review 处理，不假称成功。
- [ ] 先验证 SaaS 子集，然后全量 `cargo test --lib`、standalone-server 构建、`pnpm typecheck`、`pnpm test:run`。期望全部通过；如失败如实记录。
- [ ] 整分支 fresh-context review；重要问题按 RED→GREEN 修复，所有变更保留在本地工作区，不推送。
