# Responses 推理兼容清理：保守方案（2026-09-14）

## 结论与范围

本次在 `main` 实现 task/191 的替代方案，未合入该工作区的 `item_reference → 空 reasoning` 逻辑，也未增加 `responses_item_reference_inline` 开关。只做具有明确语义边界的兼容清理，不声称能够恢复 Azure 跨资源引用。

通过 Rust 实现密文外形校验及孤立 ID 清理，不增加依赖，也不尝试解密或重建历史内容。

## 清理规则

- 仅处理顶层 `input` 数组中的 `type: "reasoning"` 项，不改变条目数量和顺序。
- 密文外形检查：base64url（接受有 padding 和无 padding）、`gAAAA` 前缀、Fernet 版本/长度/AES 块结构，最大 32 MiB；不接受首尾空白。
- 格式有效的 `encrypted_content` 连同原 ID 全部保留。**外形有效不代表能在当前上游解密，也不能证明跨 Azure resource 可用。**
- 密文缺失或格式非法时，删除非法密文字段；只有 `store` 非 `true` 时才移除对应的孤立 ID。`store: true` 保留服务器侧 ID。
- 原有 `summary`、`content`、`status`、扩展字段原样保留。工具调用及结果、消息、`item_reference`（含省略/null `type`）、compaction 系列条目、metadata、tools、include、`previous_response_id` 一律不作展开或删除。
- 清理幂等，无可改写内容时返回不变。

## 入口与恢复边界

- 复用持久化字段 `config_json.responses_encrypted_content_cleanup`，默认 `false`，旧设置保持兼容，不做数据库迁移。界面改名为「Responses 推理兼容清理」。
- 开启时，仅在 API 账号的原生 `ResponsesToResponses` 路径发送前执行保守清理。不会扩展到 Chat/Anthropic/Gemini 或官方账号直通路径。
- 既有显式 `store: false` 原生桥接不再删除无密文的整个 reasoning 项，改为只清除孤立 ID、保留明文；不开启账号选项时不主动校验非空密文。
- `invalid_encrypted_content` 错误最多触发一次同账号的保守清理，不消耗普通失败重试预算。清理必须能改变**实际已经发给上游的请求**；若桥接已经完成唯一的 ID 清理，则不重复发送相同请求。
- 格式有效但不可解密的密文、压缩状态等不做破坏性降级；返回原上游错误，不遍历池、不记账号或模型健康失败。
- Azure「created under/by a different Azure OpenAI resource ... Use the same resource」错误原样返回，不伪造引用内容，也不惩罚账号或模型。该识别仍保留在请求事件/日志中，健康状态与请求失败日志是不同概念。
- 任意引用的真实恢复、跨请求历史缓存、会话粘性及中转站内部资源固定路由不属于本次范围。

## 离线验证

采用先测试后实现：观察到了旧实现删除 reasoning/compaction、丢弃明文摘要、将 Azure 请求错误计入账号失败，以及重复发送已净化请求的预期失败，再实施修复。

- 清理单测覆盖 `store` 缺失/false/true、有效密文、无密文、null/非字符串/非法编码/首尾空白、幂等、引用及工具配对、压缩上下文、嵌套业务数据。
- 恢复链的模拟上游按**实际请求密文和工具配对**决定响应，不再从第二次请求起无条件返回 200；同时断言完整上游请求的内容。
- 集成测试覆盖预清理与错误后清理、原样返回 Azure 错误、有效外形密文仍被拒绝、仅压缩状态、已由桥接清理的孤立 ID，以及账号/模型不受罚。
- `CARGO_TARGET_DIR=target-codex cargo test --lib`：1587 通过、0 失败、10 忽略（包括需显式真实上游配置的验收）。
- `pnpm test:run`：75 个文件、835 项测试通过。
- `pnpm typecheck`：通过。
- `CARGO_TARGET_DIR=target-codex cargo check --no-default-features --features standalone-server --bin ai-switch-server`：通过。
- 本次修改的 Rust 文件 rustfmt 检查和 `git diff --check`：通过。
- 构建仍有仓库既存的未使用项等警告，未在本任务中扩大范围处理。

以上为本地离线结论，不证明真实 Azure/AnyRouter 已接受无 ID reasoning，也不代表跨资源引用错误已修复。既有 `live_responses_encrypted_content_recovery` 入口仍可显式检验「格式非法密文」的有限恢复，但不能作为跨资源恢复的替代验收。
