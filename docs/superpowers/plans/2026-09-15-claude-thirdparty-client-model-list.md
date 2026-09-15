# Claude 第三方客户端模型清单重构计划

## 背景

Claude Code 原生客户端通过 ``~/.claude/settings.json`` 的环境变量槽位（``ANTHROPIC_DEFAULT_SONNET_MODEL`` 等）配置模型，使用 ``claude-sonnet-alias`` 等固定别名，这是 Claude Code 的限制。但第三方客户端（ZCode、WorkBuddy/CodeBuddy、Qoder CLI、DeepSeek Harness）没有这个限制，它们各自有独立的模型清单格式。

当前问题：写入第三方客户端时，``advertised_model_catalog_entries`` 对 Claude 平台输出的仍然是 ``from`` 别名（如 ``claude-sonnet-alias``），而非映射的目标模型 ``to``。第三方客户端不认识这些别名，用户看到的模型名没有意义。

此外，WorkBuddy/CodeBuddy 使用 OpenAI Chat Completions 协议（``/chat/completions``），不支持 Anthropic Messages 端点，写入 Claude 平台时应该使用 Responses 端点。

## 目标

1. 聚合模式：写入 Claude 第三方客户端时，模型清单使用映射的 ``to``（上游模型名），去重后写入，而非 ``from`` 别名。
2. 精确模式：按账号前缀输出模型列表，与 Codex 精确模式一致。
3. 模型能力恢复：因为第三方客户端现在看到的是真实上游模型，``supports_image_input`` 的逐账号声明在第三方客户端场景下重新有意义——聚合模式下取 AND（保守），精确模式下各账号独立。
4. Claude Code 原生配置不变：仍使用别名槽位写入 ``settings.json``，不受影响。
5. WorkBuddy 端点修正：Claude 平台写入 WorkBuddy 时使用 ``/responses`` 端点而非 ``/chat/completions``（如果代理支持）。

## 不在范围内

- 代理运行时的模型路由逻辑不变：代理仍按 ``from`` 别名匹配候选账号，然后 rewrite 为 ``to`` 上游模型。
- ``/v1/models`` 端点的输出不变：仍输出别名列表，因为 Claude Code 原生客户端会调用这个端点。
- Claude Code 原生配置写入不变。

## 实现步骤

### Task 1: 新增 client_facing_model_catalog_entries 函数

在 ``route_model_capability.rs`` 中新增一个函数，专门用于生成写入第三方客户端配置的模型清单。与 ``advertised_model_catalog_entries`` 的区别：

- 聚合模式：使用 ``to``（上游模型名）作为模型 id，去重合并。
- 精确模式：使用 ``{prefix}/{to}`` 作为模型 id。
- 保留 ``supports_image_input``、``context_window`` 等字段的合并逻辑。
- 跳过 fallback mapping（``claude-model``）和 baseline 别名（``claude-sonnet-alias`` 等），只输出真实映射。
- 对 Claude 平台的 ``[1m]`` 变体：不再展开，因为第三方客户端不需要 1M 标记。

关键设计：这个函数只在 Claude 平台且写入第三方客户端时使用。Codex 和其他平台继续使用现有的 ``advertised_model_catalog_entries``，因为它们的 ``from`` 就是用户想要的模型名。

### Task 2: 修改 resolve_client_models 区分原生与第三方

在 ``route_config_service.rs`` 的 ``resolve_client_models`` 中，根据写入目标是否包含第三方客户端来决定使用哪个函数：

- 如果写入目标只有 Claude Code（native），不需要 ``client_models``（现有行为）。
- 如果写入目标包含第三方客户端，使用新函数生成基于 ``to`` 的模型清单。
- ``supports_image_input`` 恢复为按 ``model.supports_image_input`` 传递，不再强制 ``true``。

### Task 3: WorkBuddy Claude 端点修正

检查 WorkBuddy 的 ``model_url`` 方法。如果 Claude 平台的代理端点是 ``/responses`` 而非 ``/chat/completions``，修正 WorkBuddy 的 URL 生成逻辑。

需要确认：代理对 Claude 平台暴露的端点是什么。如果代理接受 ``/v1/messages``（Anthropic）和 ``/responses``（OpenAI Responses），WorkBuddy 应该使用它能理解的协议对应的端点。

### Task 4: 恢复 Claude 下的模型能力 UI

在 ``AccountsScreen.tsx`` 中恢复 Claude 平台的 ``ImageMappingCapabilityFields`` 渲染。因为第三方客户端现在看到真实上游模型，``supports_image_input`` 的声明重新有意义。

### Task 5: 测试

- Rust 测试：验证聚合模式下 Claude 第三方客户端写入的模型清单使用 ``to`` 而非 ``from``。
- Rust 测试：验证精确模式下 Claude 第三方客户端按账号前缀输出。
- Rust 测试：验证 ``supports_image_input`` 在聚合模式下取 AND。
- 前端测试：验证 Claude 编辑器重新显示模型能力行。
- 前端测试：验证 Codex 行为不变。