#[cfg(test)]
mod tests {
    /// A Codex client never sends cache_control, so without injection every
    /// turn re-bills the whole system prompt and tool array at full price.
    #[test]
    fn codex_requests_get_cache_breakpoints() {
        let body = serde_json::json!({
            "model": "claude-sonnet-4",
            "max_output_tokens": 1024,
            "instructions": "You are a careful engineer.",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "first"}]},
                {"type": "function_call", "call_id": "c1", "name": "read", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "c1", "output": "ok"},
                {"role": "user", "content": [{"type": "input_text", "text": "second"}]}
            ],
            "tools": [{
                "type": "function",
                "name": "read",
                "parameters": {"type": "object", "properties": {}}
            }]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        // Tools and system carry the stable prefix markers.
        let tools = converted["tools"].as_array().expect("tools");
        assert!(
            tools.last().unwrap()["cache_control"].is_object(),
            "tools tail must be marked: {converted}"
        );
        assert!(
            converted["system"][0]["cache_control"].is_object(),
            "system tail must be marked: {converted}"
        );

        // At least one message anchor extends the cached prefix, and the total
        // stays within Anthropic's limit of four.
        let rendered = serde_json::to_string(&converted).unwrap();
        let total = rendered.matches("\"cache_control\"").count();
        assert!(total >= 3, "expected several breakpoints, got {total}");
        assert!(total <= 4, "must not exceed 4 breakpoints, got {total}");
    }

    use super::{
        anthropic_response_to_responses, responses_request_to_anthropic,
        DEFAULT_ANTHROPIC_MAX_TOKENS,
    };
    use serde_json::Value;
    use std::collections::BTreeMap;

    #[test]
    fn converts_responses_request_to_claude_messages() {
        let body = serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "instructions": "Be concise",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "Find x"}]},
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{\"key\":\"x\"}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "42"}
            ],
            "max_output_tokens": 64,
            "temperature": 0.2,
            "tools": [{
                "type": "function",
                "name": "lookup",
                "description": "Lookup value",
                "parameters": {"type":"object","properties":{"key":{"type":"string"}}}
            }]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        // `system` is promoted to Anthropic's block form so it can carry a
        // cache_control breakpoint; the text itself is unchanged.
        assert_eq!(converted["system"][0]["type"], "text");
        assert_eq!(converted["system"][0]["text"], "Be concise");
        assert_eq!(converted["messages"][0]["role"], "user");
        assert_eq!(converted["messages"][0]["content"][0]["type"], "text");
        assert_eq!(converted["messages"][1]["content"][0]["type"], "tool_use");
        assert_eq!(
            converted["messages"][2]["content"][0]["type"],
            "tool_result"
        );
        assert_eq!(converted["max_tokens"], 64);
        assert_eq!(converted["tools"][0]["input_schema"]["type"], "object");
    }

    /// Codex Responses Lite puts its base instructions in an inline developer
    /// message. Anthropic messages only accept user/assistant roles, so that
    /// text has to be folded into the top-level system prompt.
    #[test]
    fn folds_inline_developer_message_into_anthropic_system() {
        let body = serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "instructions": "base instruction",
            "input": [
                {
                    "type": "message",
                    "role": "developer",
                    "content": [{"type": "input_text", "text": "developer reminder"}]
                },
                {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "hi"}]
                }
            ]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        assert_eq!(converted["messages"].as_array().unwrap().len(), 1);
        assert_eq!(converted["messages"][0]["role"], "user");
        let system = converted["system"].as_array().unwrap();
        assert_eq!(system.len(), 2, "system={system:?}");
        assert_eq!(system[0]["text"], "base instruction");
        assert_eq!(system[1]["text"], "developer reminder");
    }

    #[test]
    fn forwards_metadata_so_claude_code_gated_relays_accept_the_request() {
        // Relays gating on the Claude Code signature parse `metadata.user_id` and
        // reject the request when it is missing, so dropping the field during
        // conversion breaks Codex against those upstreams.
        let body = serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "input": "hi",
            "metadata": {"user_id": "{\"device_id\":\"abc\",\"session_id\":\"s\"}"}
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        assert_eq!(
            converted["metadata"]["user_id"],
            "{\"device_id\":\"abc\",\"session_id\":\"s\"}"
        );
    }

    #[test]
    fn converts_responses_input_image_to_anthropic_image_block() {
        let body = serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "See image"},
                        {"type": "input_image", "image_url": "data:image/png;base64,aGVsbG8="}
                    ]
                }
            ]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        assert_eq!(converted["messages"][0]["content"][0]["type"], "text");
        assert_eq!(converted["messages"][0]["content"][1]["type"], "image");
        assert_eq!(
            converted["messages"][0]["content"][1]["source"]["type"],
            "base64"
        );
        assert_eq!(
            converted["messages"][0]["content"][1]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(
            converted["messages"][0]["content"][1]["source"]["data"],
            "aGVsbG8="
        );
    }

    /// Responses `reasoning` items must survive the trip to a Claude upstream and
    /// back: encoded into a leading thinking block on the way out, decoded into
    /// the exact original item on the way in. Otherwise a stateless tool loop
    /// loses the chain of thought that justified each tool call.
    #[test]
    fn reasoning_survives_the_round_trip_to_anthropic_and_back() {
        // Request: a Codex turn with a summarized, encrypted reasoning item before
        // a tool call. The reasoning must ride along as a leading thinking block,
        // not be dropped.
        let request = serde_json::json!({
            "model": "claude-sonnet-4-5",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "read it"}]},
                {"type": "reasoning", "id": "rs_1",
                 "summary": [{"type": "summary_text", "text": "Need to read the file."}],
                 "encrypted_content": "cipher"},
                {"type": "function_call", "call_id": "call_1", "name": "read",
                 "arguments": "{}"}
            ]
        });
        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&request).unwrap()).unwrap(),
        )
        .unwrap();
        let assistant = &converted["messages"][1];
        assert_eq!(assistant["role"], "assistant");
        // thinking leads, tool_use follows, in the same assistant message.
        assert_eq!(assistant["content"][0]["type"], "thinking");
        assert_eq!(
            assistant["content"][0]["thinking"],
            "Need to read the file."
        );
        assert_eq!(assistant["content"][1]["type"], "tool_use");

        // Response: the upstream echoes the same thinking block back. It must
        // decode into the exact original reasoning item, not leak as output_text.
        let signature = assistant["content"][0]["signature"].as_str().unwrap();
        let upstream = serde_json::json!({
            "id": "msg_1",
            "model": "claude-sonnet-4-5",
            "stop_reason": "end_turn",
            "content": [
                {"type": "thinking", "thinking": "Need to read the file.", "signature": signature},
                {"type": "text", "text": "done"}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5}
        });
        let back = anthropic_response_to_responses(
            200,
            Some("application/json"),
            &serde_json::to_vec(&upstream).unwrap(),
            &BTreeMap::new(),
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&back.body).unwrap();
        let reasoning = value["output"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["type"] == "reasoning")
            .expect("reasoning item recovered from the thinking block");
        assert_eq!(reasoning["id"], "rs_1");
        assert_eq!(reasoning["encrypted_content"], "cipher");
        assert_eq!(reasoning["summary"][0]["text"], "Need to read the file.");
        let rendered = serde_json::to_string(&value).unwrap();
        assert!(
            !rendered.contains("Need to read the file.\",\"type\":\"output_text"),
            "reasoning must not leak into visible output",
        );
    }

    /// A fresh thinking block takes the same trip without any envelope of ours:
    /// the signature is the upstream's own. The client has to get a summary it can
    /// render, and the next request has to hand the upstream back the block it
    /// signed rather than a placeholder it will reject.
    #[test]
    fn fresh_thinking_reaches_the_client_and_replays_verbatim() {
        let upstream = serde_json::json!({
            "id": "msg_1",
            "model": "claude-sonnet-4-5",
            "stop_reason": "tool_use",
            "content": [
                {"type": "thinking", "thinking": "Need the file first.", "signature": "real-sig"},
                {"type": "tool_use", "id": "call_1", "name": "read", "input": {}}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5}
        });
        let back = anthropic_response_to_responses(
            200,
            Some("application/json"),
            &serde_json::to_vec(&upstream).unwrap(),
            &BTreeMap::new(),
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&back.body).unwrap();
        let reasoning = value["output"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["type"] == "reasoning")
            .expect("thinking must become a reasoning item")
            .clone();
        assert_eq!(reasoning["summary"][0]["text"], "Need the file first.");

        // Next turn: Codex replays that item ahead of the tool output.
        let request = serde_json::json!({
            "model": "claude-sonnet-4-5",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "read it"}]},
                reasoning,
                {"type": "function_call", "call_id": "call_1", "name": "read",
                 "arguments": "{}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "contents"}
            ]
        });
        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&request).unwrap()).unwrap(),
        )
        .unwrap();
        let assistant = converted["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|message| message["role"] == "assistant")
            .expect("assistant turn");
        assert_eq!(assistant["content"][0]["type"], "thinking");
        assert_eq!(assistant["content"][0]["thinking"], "Need the file first.");
        assert_eq!(
            assistant["content"][0]["signature"], "real-sig",
            "the upstream's own signature must come back, not an ai-switch envelope"
        );
    }

    /// Codex replays its own transcript on every turn, and after the first
    /// `apply_patch` that transcript contains item types no Anthropic client ever
    /// sends. Rejecting one fails the whole request, so the relay looks dead
    /// under the codex platform while the same base_url and key keep working
    /// under the claude platform.
    #[test]
    fn converts_codex_only_input_items_instead_of_failing_the_turn() {
        let body = serde_json::json!({
            "model": "claude-sonnet-4-5",
            "instructions": "You are a coding agent running in the Codex CLI.",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "fix the typo"}]},
                {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "gAAAA"},
                {"type": "custom_tool_call", "id": "ctc_1", "call_id": "call_1",
                 "name": "apply_patch", "input": "*** Begin Patch\n*** End Patch\n"},
                {"type": "custom_tool_call_output", "call_id": "call_1", "output": "Success"},
                {"type": "local_shell_call", "id": "lsc_1", "call_id": "call_2",
                 "action": {"type": "exec", "command": ["ls"]}},
                {"type": "local_shell_call_output", "call_id": "call_2", "output": "README.md"},
                {"type": "input_text", "text": "and run the tests"}
            ]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap())
                .expect("Codex transcript must convert"),
        )
        .unwrap();
        let messages = converted["messages"].as_array().expect("messages");

        // The freeform call keeps the `{"input": …}` spelling the tool was
        // declared with, so the replayed turn agrees with its own schema.
        assert_eq!(messages[1]["role"], "assistant");
        // The ciphertext-only reasoning item leads the tool-use turn as a
        // redacted_thinking block, then the freeform call follows.
        assert_eq!(messages[1]["content"][0]["type"], "redacted_thinking");
        assert!(messages[1]["content"][0]["data"]
            .as_str()
            .is_some_and(|data| data.starts_with("ai-switch-openai-reasoning-v1:")));
        assert_eq!(messages[1]["content"][1]["type"], "tool_use");
        assert_eq!(messages[1]["content"][1]["name"], "apply_patch");
        assert_eq!(messages[1]["content"][1]["id"], "call_1");
        assert_eq!(
            messages[1]["content"][1]["input"]["input"],
            "*** Begin Patch\n*** End Patch\n"
        );
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "call_1");
        assert_eq!(messages[2]["content"][0]["content"], "Success");

        // `local_shell` is filtered out of the tool array, so replaying its call
        // would be a tool_use Claude cannot match to any declared tool.
        let rendered = serde_json::to_string(&converted).unwrap();
        assert!(
            !rendered.contains("call_2"),
            "hosted-tool calls must be dropped, not forwarded: {rendered}"
        );
        assert_eq!(
            messages.last().unwrap()["content"][0]["text"],
            "and run the tests"
        );
    }

    /// Anthropic answers a parallel tool turn with several `tool_use` blocks in
    /// one assistant message, and requires the matching `tool_result` blocks in
    /// the single user message that follows. Codex replays that turn as a flat run
    /// of `function_call` / `function_call_output` items, so emitting one message
    /// per item splits it into two assistant messages and two user messages — the
    /// first `tool_use` is then not answered by the next message, and the upstream
    /// rejects the request (`Invalid tool use format` on the AWS-backed relays).
    /// Nothing in the transcript can be replayed after that, so the session is
    /// dead from its first parallel turn while every other session keeps working.
    #[test]
    fn a_parallel_tool_turn_stays_one_assistant_message_and_one_user_reply() {
        let body = serde_json::json!({
            "model": "claude-sonnet-4-5",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "read both files"}]},
                {"type": "function_call", "call_id": "call_1", "name": "read",
                 "arguments": "{\"path\":\"a\"}"},
                {"type": "function_call", "call_id": "call_2", "name": "read",
                 "arguments": "{\"path\":\"b\"}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "a"},
                {"type": "function_call_output", "call_id": "call_2", "output": "b"}
            ],
            "tools": [{
                "type": "function",
                "name": "read",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}
            }]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();
        let messages = converted["messages"].as_array().expect("messages");

        let roles = messages
            .iter()
            .map(|message| message["role"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(
            roles,
            vec!["user", "assistant", "user"],
            "a parallel turn must not split into extra messages: {converted}"
        );

        // Both calls share the assistant turn that produced them, in order.
        let calls = messages[1]["content"].as_array().expect("tool_use blocks");
        assert_eq!(calls.len(), 2, "{converted}");
        assert_eq!(calls[0]["type"], "tool_use");
        assert_eq!(calls[0]["id"], "call_1");
        assert_eq!(calls[1]["id"], "call_2");

        // And both results answer it from the one user message that follows, so
        // neither `tool_use` is left without a `tool_result` after it.
        let results = messages[2]["content"]
            .as_array()
            .expect("tool_result blocks");
        assert_eq!(results.len(), 2, "{converted}");
        assert_eq!(results[0]["type"], "tool_result");
        assert_eq!(results[0]["tool_use_id"], "call_1");
        assert_eq!(results[1]["tool_use_id"], "call_2");
    }

    #[test]
    fn converts_anthropic_response_to_responses_json() {
        let upstream = serde_json::json!({
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [
                {"type": "text", "text": "hello"},
                {"type": "tool_use", "id": "toolu_1", "name": "lookup", "input": {"key":"x"}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 3, "output_tokens": 5}
        });

        let converted = anthropic_response_to_responses(
            200,
            Some("application/json"),
            serde_json::to_vec(&upstream).unwrap().as_slice(),
            &BTreeMap::new(),
        )
        .unwrap();
        let output: Value = serde_json::from_slice(&converted.body).unwrap();

        assert_eq!(output["object"], "response");
        assert_eq!(output["id"], "msg_1");
        assert_eq!(output["output_text"], "hello");
        assert_eq!(output["output"][1]["type"], "function_call");
        assert_eq!(output["output"][1]["call_id"], "toolu_1");
        assert_eq!(output["usage"]["input_tokens"], 3);
        assert_eq!(output["usage"]["output_tokens"], 5);
    }

    #[test]
    fn converts_anthropic_sse_to_responses_events() {
        let upstream = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"claude-sonnet-4\",\"usage\":{\"input_tokens\":3,\"output_tokens\":0}}}\n\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n",
            "event: content_block_stop\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":5}}\n\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n\n"
        );

        let converted = anthropic_response_to_responses(
            200,
            Some("text/event-stream"),
            upstream.as_bytes(),
            &BTreeMap::new(),
        )
        .unwrap();
        let output = String::from_utf8(converted.body).unwrap();

        assert!(output.contains("event: response.created"));
        assert!(output.contains("event: response.output_text.delta"));
        assert!(output.contains("\"delta\":\"hello\""));
        assert!(output.contains("event: response.completed"));
    }

    /// This bridge asks the upstream for thinking, so it must accept the thinking
    /// blocks that request produces. Failing here 502s and fails every credential.
    #[test]
    fn accepts_the_thinking_it_enables() {
        let request = serde_json::json!({
            "model": "claude-sonnet-4",
            "max_output_tokens": 8192,
            "reasoning": {"effort": "medium"},
            "input": [{"type": "message", "role": "user", "content": "hi"}]
        });
        let prepared: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&request).unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            prepared["thinking"]["type"], "enabled",
            "precondition: the bridge enables thinking"
        );

        let upstream = concat!(
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"claude-sonnet-4\",\"usage\":{\"input_tokens\":3,\"output_tokens\":0}}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\",\"signature\":\"\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Let me think.\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"Erf1\"}}\n\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"42\"}}\n\n",
            "data: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":5}}\n\n",
            "data: {\"type\":\"message_stop\"}\n\n"
        );

        let converted = anthropic_response_to_responses(
            200,
            Some("text/event-stream"),
            upstream.as_bytes(),
            &BTreeMap::new(),
        )
        .expect("thinking deltas must not fail the transform");
        let output = String::from_utf8(converted.body).unwrap();

        assert!(output.contains("event: response.completed"));
        assert!(
            output.contains("\"delta\":\"42\""),
            "visible text must survive: {output}"
        );
        assert!(
            output.contains("event: response.reasoning_summary_text.delta")
                && output.contains("\"delta\":\"Let me think.\""),
            "thinking must reach the client as a reasoning summary: {output}"
        );

        let completed: Value = serde_json::from_str(
            output
                .split("event: response.completed")
                .nth(1)
                .and_then(|rest| rest.split("data: ").nth(1))
                .expect("completed event payload")
                .trim(),
        )
        .expect("completed event json");
        assert_eq!(completed["response"]["output_text"], "42");
        let items = completed["response"]["output"].as_array().expect("output");
        assert_eq!(
            items[0]["type"], "reasoning",
            "the turn's thinking must lead the output: {completed}"
        );
        assert_eq!(items[0]["summary"][0]["text"], "Let me think.");
        assert_eq!(items[1]["type"], "message");
        // The signature has to survive the trip out, or the replayed block on the
        // next request is not the one the upstream signed.
        let block = super::super::reasoning_bridge::decode_anthropic_thinking_block(
            items[0]["encrypted_content"]
                .as_str()
                .expect("native block envelope"),
        )
        .expect("native block envelope must decode");
        assert_eq!(block["type"], "thinking");
        assert_eq!(block["thinking"], "Let me think.");
        assert_eq!(block["signature"], "Erf1");
    }

    /// A thinking block is reasoning, not answer text. It has to reach the client
    /// as a `reasoning` item whose summary carries the plaintext, with the signed
    /// block in `encrypted_content` so a replayed turn matches what the upstream
    /// signed. `redacted_thinking` has no plaintext, so it carries the payload only.
    #[test]
    fn thinking_content_blocks_become_reasoning_items() {
        let upstream = serde_json::json!({
            "id": "msg_1",
            "model": "claude-sonnet-4",
            "stop_reason": "end_turn",
            "content": [
                {"type": "thinking", "thinking": "Internal reasoning.", "signature": "sig"},
                {"type": "redacted_thinking", "data": "opaque"},
                {"type": "text", "text": "The answer is 42."}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5}
        });

        let converted = anthropic_response_to_responses(
            200,
            Some("application/json"),
            &serde_json::to_vec(&upstream).unwrap(),
            &BTreeMap::new(),
        )
        .expect("thinking blocks must not fail the transform");
        let value: Value = serde_json::from_slice(&converted.body).unwrap();

        let items = value["output"].as_array().expect("output");
        assert_eq!(items[0]["type"], "reasoning");
        assert_eq!(items[0]["summary"][0]["text"], "Internal reasoning.");
        assert_eq!(
            super::super::reasoning_bridge::decode_anthropic_thinking_block(
                items[0]["encrypted_content"]
                    .as_str()
                    .expect("native block envelope")
            )
            .expect("native block envelope must decode")["signature"],
            "sig"
        );
        assert_eq!(items[1]["type"], "reasoning");
        assert_eq!(items[1]["summary"], serde_json::json!([]));
        assert_eq!(
            super::super::reasoning_bridge::decode_anthropic_thinking_block(
                items[1]["encrypted_content"]
                    .as_str()
                    .expect("redacted block envelope")
            )
            .expect("redacted block envelope must decode")["type"],
            "redacted_thinking"
        );
        assert_eq!(items[2]["type"], "message");
        assert_eq!(items[2]["content"][0]["text"], "The answer is 42.");
        assert_eq!(value["output_text"], "The answer is 42.");
    }

    /// A relay that strips extended thinking, or a model answering without it,
    /// writes the scratchpad into the text block as tags. That block has to
    /// reach the client as a reasoning item, and the streamed form has to carry
    /// the summary events — a buffered `reasoning` item with no `added`/`done`
    /// pair is ignored by the client that receives it.
    #[test]
    fn inlined_thinking_tags_become_a_reasoning_item() {
        let upstream = serde_json::json!({
            "id": "msg_2",
            "model": "claude-sonnet-4",
            "stop_reason": "end_turn",
            "content": [
                {"type": "text", "text": "<thinking>Checking the mapping.</thinking>\n\nThe key is unset."}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 5}
        });

        let converted = anthropic_response_to_responses(
            200,
            Some("application/json"),
            &serde_json::to_vec(&upstream).unwrap(),
            &BTreeMap::new(),
        )
        .expect("inlined tags must not fail the transform");
        let value: Value = serde_json::from_slice(&converted.body).unwrap();

        assert_eq!(value["output"][0]["type"], "reasoning");
        assert_eq!(
            value["output"][0]["summary"][0]["text"],
            "Checking the mapping."
        );
        assert_eq!(value["output"][1]["type"], "message");
        assert_eq!(value["output_text"], "The key is unset.");

        let streamed = anthropic_response_to_responses(
            200,
            Some("text/event-stream"),
            concat!(
                "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_2\",\"model\":\"claude-sonnet-4\",\"usage\":{\"input_tokens\":3,\"output_tokens\":0}}}\n\n",
                "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"<thinking>Checking.</thinking>Done.\"}}\n\n",
                "data: {\"type\":\"message_stop\"}\n\n",
            )
            .as_bytes(),
            &BTreeMap::new(),
        )
        .expect("streamed inlined tags must not fail the transform");
        let rendered = String::from_utf8(streamed.body).unwrap();

        assert!(
            rendered.contains("event: response.reasoning_summary_text.delta"),
            "the buffered reasoning item must be replayed as summary events: {rendered}"
        );
        assert!(
            !rendered.contains("<thinking>"),
            "no tag may reach the client: {rendered}"
        );
    }

    /// Anthropic rejects `budget_tokens >= max_tokens`. Codex sends no
    /// `max_output_tokens` and defaults to `medium`, so the invented 8192 tied
    /// the medium budget exactly and every effort above `low` 400'd — the whole
    /// Codex-on-Anthropic path, not an edge case.
    #[test]
    fn thinking_budget_always_leaves_room_under_max_tokens() {
        for effort in super::super::RECOGNISED_REASONING_EFFORTS {
            let request = serde_json::json!({
                "model": "claude-sonnet-4",
                "reasoning": {"effort": effort},
                "input": [{"type": "message", "role": "user", "content": "hi"}]
            });
            let prepared: Value = serde_json::from_slice(
                &responses_request_to_anthropic(&serde_json::to_vec(&request).unwrap()).unwrap(),
            )
            .unwrap();

            let max_tokens = prepared["max_tokens"]
                .as_i64()
                .expect("max_tokens is required");
            let budget = prepared["thinking"]["budget_tokens"]
                .as_i64()
                .unwrap_or_else(|| panic!("{effort} must enable thinking"));
            assert!(
                budget < max_tokens,
                "{effort}: budget_tokens {budget} must be under max_tokens {max_tokens}"
            );
            assert!(
                max_tokens - budget >= DEFAULT_ANTHROPIC_MAX_TOKENS,
                "{effort}: only {} tokens left for the answer",
                max_tokens - budget
            );
        }
    }

    /// A cap the caller set is the caller's. Growing it to fit a bigger thinking
    /// budget would spend tokens the client explicitly refused.
    #[test]
    fn a_client_supplied_limit_is_never_raised() {
        let request = serde_json::json!({
            "model": "claude-sonnet-4",
            "max_output_tokens": 4096,
            "reasoning": {"effort": "high"},
            "input": [{"type": "message", "role": "user", "content": "hi"}]
        });
        let prepared: Value = serde_json::from_slice(
            &responses_request_to_anthropic(&serde_json::to_vec(&request).unwrap()).unwrap(),
        )
        .unwrap();

        assert_eq!(prepared["max_tokens"], 4096);
        assert!(
            prepared["thinking"]["budget_tokens"].as_i64().unwrap() < 4096,
            "the budget must fit under the caller's cap, not the other way round"
        );
    }
}

use super::common::{
    anthropic_thinking_budget, codex_agent_message_as_message, flatten_responses_function_tools,
    is_droppable_codex_control_item, is_reasoning_input_item, response_tool_name,
    response_tool_namespace, response_tool_parameters, responses_reasoning_effort,
    tool_call_id_or_fallback, ResponsesToolNamespaces,
};
use super::{common::parse_base64_data_url, sse, thinking_text, TransformedBridgeResponse};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Anthropic requires `max_tokens`; the Responses API does not, and Codex never
/// sends `max_output_tokens`. Large enough not to truncate real answers.
const DEFAULT_ANTHROPIC_MAX_TOKENS: i64 = 8_192;

pub(super) fn responses_request_to_anthropic(body: &[u8]) -> Result<Vec<u8>, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Responses request JSON is invalid: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Responses request body must be a JSON object".to_string())?;
    let mut result = Map::new();

    if let Some(model) = object.get("model") {
        result.insert("model".to_string(), model.clone());
    }
    let mut system_blocks = Vec::new();
    if let Some(instructions) = object.get("instructions") {
        let system = text_value(instructions, "instructions")?;
        if !system.is_empty() {
            system_blocks.push(text_block(&system));
        }
    }
    let mut messages = Vec::new();
    if let Some(input) = object.get("input") {
        messages.extend(convert_input(input)?);
    }
    fold_system_messages_into_system(&mut messages, &mut system_blocks)?;
    if !system_blocks.is_empty() {
        result.insert("system".to_string(), Value::Array(system_blocks));
    }
    result.insert("messages".to_string(), Value::Array(messages));
    // Anthropic requires max_tokens, but the Responses API treats
    // max_output_tokens as optional and Codex omits it entirely. Without a
    // default every Codex request would 400.
    let requested_max_tokens = object
        .get("max_output_tokens")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0);
    let thinking_budget = responses_reasoning_effort(object)
        .and_then(|effort| anthropic_thinking_budget(&effort, requested_max_tokens));
    // Anthropic rejects `budget_tokens >= max_tokens`. When the client named a
    // limit the budget is already clamped under it, so that value stands — it is
    // the caller's cap and not ours to raise. When the client named nothing, the
    // 8192 invented above has to grow to clear the budget: Codex sends no
    // max_output_tokens and defaults to `medium`, whose 8192 budget ties the
    // default exactly and 400s every request. Clamping instead of growing would
    // technically pass while leaving the answer a single token.
    let max_tokens = match (requested_max_tokens, thinking_budget) {
        (Some(limit), _) => limit,
        (None, Some(budget)) => budget + DEFAULT_ANTHROPIC_MAX_TOKENS,
        (None, None) => DEFAULT_ANTHROPIC_MAX_TOKENS,
    };
    result.insert("max_tokens".to_string(), json!(max_tokens));
    if let Some(budget) = thinking_budget {
        result.insert(
            "thinking".to_string(),
            json!({"type": "enabled", "budget_tokens": budget}),
        );
    }
    // `metadata` rides along because relays gating on the Claude Code signature
    // parse `metadata.user_id` and reject the request when it is absent.
    copy_fields(
        object,
        &mut result,
        &["temperature", "top_p", "stream", "metadata"],
    );
    if result.get("thinking").is_some() {
        // Extended thinking rejects temperature outright and constrains top_p to
        // 0.95-1, so drop both rather than risk a 400 on the caller's value.
        result.remove("temperature");
        result.remove("top_p");
    }
    if let Some(stop) = object.get("stop") {
        result.insert("stop_sequences".to_string(), stop.clone());
    }
    if let Some(tools) = object.get("tools") {
        let converted_tools = convert_tools(tools)?;
        if converted_tools
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
        {
            result.insert("tools".to_string(), converted_tools);
        }
    }
    // Only meaningful alongside tools; a dangling tool_choice is a 400.
    if result.contains_key("tools") {
        if let Some(tool_choice) = responses_tool_choice_to_anthropic(object) {
            result.insert("tool_choice".to_string(), tool_choice);
        }
    }

    // A Codex client has no cache_control concept, so without this the whole
    // system prompt and tool array is re-billed at full input price every turn.
    let mut result = Value::Object(result);
    super::anthropic_cache::inject_cache_breakpoints(&mut result);

    serde_json::to_vec(&result)
        .map_err(|error| format!("Could not serialize Anthropic request: {error}"))
}

/// Maps a Responses `tool_choice` (plus `parallel_tool_calls`) onto Anthropic's
/// shape. Dropping this silently downgrades a forced tool call to optional,
/// which stalls agent loops that depend on it.
fn responses_tool_choice_to_anthropic(object: &Map<String, Value>) -> Option<Value> {
    let disable_parallel = object
        .get("parallel_tool_calls")
        .and_then(Value::as_bool)
        .is_some_and(|parallel| !parallel);
    let mut choice = match object.get("tool_choice") {
        Some(Value::String(value)) => match value.trim().to_ascii_lowercase().as_str() {
            "auto" => json!({"type": "auto"}),
            "required" | "any" => json!({"type": "any"}),
            "none" => json!({"type": "none"}),
            _ => return None,
        },
        Some(Value::Object(value)) => {
            let choice_type = value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match choice_type {
                // Responses names a forced tool via {type:"function",name:"x"}.
                "function" | "tool" | "custom" => {
                    let name = value
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())?;
                    json!({"type": "tool", "name": name})
                }
                "allowed_tools" => json!({"type": "any"}),
                "auto" => json!({"type": "auto"}),
                "required" | "any" => json!({"type": "any"}),
                "none" => json!({"type": "none"}),
                _ => return None,
            }
        }
        // No explicit choice: still surface a parallel-tool-use opt-out.
        _ if disable_parallel => json!({"type": "auto"}),
        _ => return None,
    };
    // Anthropic expresses "no parallel calls" as a flag on tool_choice, and
    // rejects it on {type:"none"}.
    if disable_parallel && choice.get("type").and_then(Value::as_str) != Some("none") {
        choice["disable_parallel_tool_use"] = Value::Bool(true);
    }
    Some(choice)
}

pub(super) fn anthropic_response_to_responses(
    status: u16,
    content_type: Option<&str>,
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<TransformedBridgeResponse, String> {
    if !(200..300).contains(&status) {
        return Ok(TransformedBridgeResponse {
            body: body.to_vec(),
            content_type: content_type.map(str::to_string),
        });
    }
    if content_type.is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        || looks_like_sse(body)
    {
        let response = anthropic_sse_to_responses_json(body, tool_namespaces)?;
        return Ok(TransformedBridgeResponse {
            body: sse::responses_events_from_completed_response(&response)?,
            content_type: Some("text/event-stream".to_string()),
        });
    }
    Ok(TransformedBridgeResponse {
        body: anthropic_json_to_responses(body, tool_namespaces)?,
        content_type: Some("application/json".to_string()),
    })
}

fn anthropic_json_to_responses(
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<u8>, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Anthropic response JSON is invalid: {error}"))?;
    if value.get("error").is_some() {
        return Ok(body.to_vec());
    }
    anthropic_value_to_responses_json(&value, tool_namespaces)
}

fn anthropic_value_to_responses_json(
    value: &Value,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<u8>, String> {
    let response_id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("resp_ai_switch");
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let stop_reason = value.get("stop_reason").and_then(Value::as_str);
    let (output, output_text) = anthropic_content_to_responses_output(
        response_id,
        value.get("content").and_then(Value::as_array),
        tool_namespaces,
    )?;
    let response = json!({
        "id": response_id,
        "object": "response",
        "created_at": chrono::Utc::now().timestamp(),
        "status": responses_status(stop_reason),
        "model": model,
        "output": output,
        "output_text": output_text,
        "error": Value::Null,
        "incomplete_details": incomplete_details(stop_reason),
        "usage": anthropic_usage_to_responses(value.get("usage")),
    });
    serde_json::to_vec(&response)
        .map_err(|error| format!("Could not serialize Responses response: {error}"))
}

fn anthropic_sse_to_responses_json(
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Value, String> {
    let mut state = AnthropicSseState::default();
    for value in sse::parse_sse_data_records(body)? {
        match value.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                if let Some(message) = value.get("message") {
                    state.capture_message(message);
                }
            }
            Some("content_block_start") => {
                let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let block = value
                    .get("content_block")
                    .cloned()
                    .unwrap_or_else(|| json!({"type": "text", "text": ""}));
                state.blocks.insert(index, block);
            }
            Some("content_block_delta") => {
                let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                state.apply_delta(index, value.get("delta").unwrap_or(&Value::Null))?;
            }
            Some("message_delta") => {
                if let Some(stop_reason) =
                    value.pointer("/delta/stop_reason").and_then(Value::as_str)
                {
                    state.stop_reason = stop_reason.to_string();
                }
                if let Some(output_tokens) = value
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_i64)
                {
                    state.output_tokens = output_tokens;
                }
            }
            Some("message_stop") => {}
            _ => {}
        }
    }

    let message = json!({
        "id": state.response_id(),
        "model": state.model(),
        "content": state.blocks.into_values().collect::<Vec<_>>(),
        "stop_reason": if state.stop_reason.is_empty() { "end_turn" } else { &state.stop_reason },
        "usage": {
            "input_tokens": state.input_tokens,
            "output_tokens": state.output_tokens
        }
    });
    let bytes = anthropic_value_to_responses_json(&message, tool_namespaces)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse buffered Responses JSON: {error}"))
}

#[derive(Debug, Default)]
struct AnthropicSseState {
    id: String,
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    stop_reason: String,
    blocks: BTreeMap<usize, Value>,
}

impl AnthropicSseState {
    fn capture_message(&mut self, message: &Value) {
        if self.id.is_empty() {
            self.id = message
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("resp_ai_switch")
                .to_string();
        }
        if self.model.is_empty() {
            self.model = message
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
        }
        self.input_tokens = message
            .pointer("/usage/input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(self.input_tokens);
    }

    fn apply_delta(&mut self, index: usize, delta: &Value) -> Result<(), String> {
        let block = self
            .blocks
            .entry(index)
            .or_insert_with(|| json!({"type": "text", "text": ""}));
        match delta.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                let text = delta.get("text").and_then(Value::as_str).unwrap_or("");
                let current = block.get("text").and_then(Value::as_str).unwrap_or("");
                block["text"] = Value::String(format!("{current}{text}"));
            }
            Some("input_json_delta") => {
                let partial_json = delta
                    .get("partial_json")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let current = block
                    .get("_partial_json")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                block["_partial_json"] = Value::String(format!("{current}{partial_json}"));
                if let Some(input) = serde_json::from_str::<Value>(
                    block
                        .get("_partial_json")
                        .and_then(Value::as_str)
                        .unwrap_or("{}"),
                )
                .ok()
                {
                    block["input"] = input;
                }
            }
            // thinking_delta / signature_delta arrive whenever this bridge asked
            // for thinking (see the request path). They are accumulated onto the
            // block so `anthropic_content_to_responses_output` can hand the
            // client a `reasoning` item: the plaintext becomes its summary and
            // the signature rides in `encrypted_content`, which is what makes the
            // next turn's replayed thinking block acceptable upstream.
            Some("thinking_delta") => {
                let thinking = delta.get("thinking").and_then(Value::as_str).unwrap_or("");
                let current = block.get("thinking").and_then(Value::as_str).unwrap_or("");
                block["thinking"] = Value::String(format!("{current}{thinking}"));
            }
            Some("signature_delta") => {
                let signature = delta.get("signature").and_then(Value::as_str).unwrap_or("");
                let current = block.get("signature").and_then(Value::as_str).unwrap_or("");
                block["signature"] = Value::String(format!("{current}{signature}"));
            }
            Some(_) | None => {}
        }
        Ok(())
    }

    fn response_id(&self) -> &str {
        if self.id.is_empty() {
            "resp_ai_switch"
        } else {
            &self.id
        }
    }

    fn model(&self) -> &str {
        if self.model.is_empty() {
            "unknown"
        } else {
            &self.model
        }
    }
}

fn convert_input(input: &Value) -> Result<Vec<Value>, String> {
    match input {
        Value::String(text) => Ok(vec![json!({"role": "user", "content": [text_block(text)]})]),
        Value::Array(items) => convert_input_items(items),
        Value::Null => Ok(Vec::new()),
        _ => Err("Responses input must be a string or array".to_string()),
    }
}

/// Anthropic only permits `user` and `assistant` in `messages`; instruction
/// roles live in the top-level `system` field. Codex Responses Lite can move
/// its base instructions out of the top-level `instructions` field and into an
/// inline `developer` message, which strict Anthropic-to-Kiro relays reject.
///
/// The Responses instruction hierarchy gives `system` and `developer` the same
/// authority, above user content, so both become top-level system blocks in
/// source order. Downgrading them to user turns would change their semantics.
fn fold_system_messages_into_system(
    messages: &mut Vec<Value>,
    system_blocks: &mut Vec<Value>,
) -> Result<(), String> {
    let mut conversation = Vec::with_capacity(messages.len());
    for message in messages.drain(..) {
        let is_system = message
            .get("role")
            .and_then(Value::as_str)
            .is_some_and(|role| matches!(role, "system" | "developer"));
        if !is_system {
            conversation.push(message);
            continue;
        }
        let start = system_blocks.len();
        match message.get("content") {
            Some(Value::String(text)) => {
                if !text.is_empty() {
                    system_blocks.push(text_block(text));
                }
            }
            Some(Value::Array(parts)) => {
                for part in parts {
                    if let Some(block) = system_content_block(part)? {
                        system_blocks.push(block);
                    }
                }
            }
            Some(Value::Null) | None => {}
            _ => return Err("Responses system message content must be text".to_string()),
        }
        // Responses cache markers belong on the last system block produced by
        // the message. Preserve them, but never override a part-level marker.
        if system_blocks.len() > start {
            if let (Some(last), Some(cache_control)) =
                (system_blocks.last_mut(), message.get("cache_control"))
            {
                if last.get("cache_control").is_none() {
                    last["cache_control"] = cache_control.clone();
                }
            }
        }
    }
    *messages = conversation;
    Ok(())
}

/// Anthropic's top-level `system` field accepts text blocks only. Conversely,
/// `text_value` joins blocks, which would erase the source block boundaries and
/// part-level cache markers during this conversion.
fn system_content_block(part: &Value) -> Result<Option<Value>, String> {
    let object = part
        .as_object()
        .ok_or_else(|| "Responses system message content parts must be objects".to_string())?;
    let part_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !matches!(part_type, "input_text" | "output_text" | "text") {
        return Err(format!(
            "Responses system message content type '{part_type}' is not supported by Anthropic"
        ));
    }
    let Some(text) = object
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
    else {
        return Ok(None);
    };
    let mut block = text_block(text);
    if let Some(cache_control) = object.get("cache_control") {
        block["cache_control"] = cache_control.clone();
    }
    Ok(Some(block))
}

fn convert_input_items(items: &[Value]) -> Result<Vec<Value>, String> {
    let mut messages = Vec::new();
    let mut pending = PendingToolTurn::default();

    for item in items {
        if is_reasoning_input_item(item) {
            // Recover the reasoning as an Anthropic thinking block instead of
            // dropping it, so a stateless tool loop against a Claude upstream
            // keeps the chain of thought that justified each tool call. A block
            // this bridge carried out to the client comes back verbatim, real
            // signature included; anything else falls back to the plaintext or
            // round-trip envelope. Empty reasoning items (no summary, no
            // ciphertext) carry nothing and are skipped.
            if let Some(block) = super::reasoning_bridge::anthropic_block_from_reasoning_item(item)
            {
                pending.push_thinking(&mut messages, block);
            }
            continue;
        }
        convert_input_item(item, &mut messages, &mut pending)?;
    }

    pending.flush(&mut messages);
    Ok(messages)
}

/// Anthropic pairs a tool turn as *one* assistant message holding every
/// `tool_use`, immediately followed by *one* user message holding the matching
/// `tool_result` blocks. Codex replays the same turn as a flat run of separate
/// `function_call` / `function_call_output` items, so converting one item to one
/// message splits a parallel turn across two assistant messages and two user
/// messages — then the first `tool_use` is not answered by the message that
/// follows it, and a strict upstream rejects the whole request
/// (`Invalid tool use format` on the AWS-backed relays; Anthropic itself says
/// `tool_use ids were found without tool_result blocks immediately after`).
/// Buffering both sides and flushing on the next unrelated item rebuilds the
/// pairing Anthropic documents.
#[derive(Default)]
struct PendingToolTurn {
    /// Thinking blocks recovered from Responses `reasoning` items, buffered so
    /// they lead the assistant message they belong to (Anthropic requires a
    /// thinking block to be the first content of its assistant turn).
    thinking: Vec<Value>,
    tool_uses: Vec<Value>,
    tool_results: Vec<Value>,
}

impl PendingToolTurn {
    /// Buffer a thinking block to lead the next assistant message (tool-use turn
    /// or plain assistant text). A tool result closes the assistant turn, so any
    /// thinking still buffered then is stale and dropped by `flush_tool_results`.
    fn push_thinking(&mut self, messages: &mut Vec<Value>, block: Value) {
        self.flush_tool_results(messages);
        self.thinking.push(block);
    }

    /// A new call opens a new tool turn, so results buffered from the previous
    /// one have to land before it.
    fn push_tool_use(&mut self, messages: &mut Vec<Value>, block: Value) {
        self.flush_tool_results(messages);
        self.tool_uses.push(block);
    }

    fn push_tool_result(&mut self, messages: &mut Vec<Value>, block: Value) {
        self.flush_tool_uses(messages);
        self.tool_results.push(block);
    }

    fn flush(&mut self, messages: &mut Vec<Value>) {
        self.flush_tool_uses(messages);
        self.flush_tool_results(messages);
    }

    fn flush_tool_uses(&mut self, messages: &mut Vec<Value>) {
        if self.tool_uses.is_empty() {
            // Thinking with no tool_use to lead becomes its own assistant turn so
            // the reasoning is not lost when the model answered without a tool.
            self.flush_thinking_as_message(messages);
            return;
        }
        let mut content = std::mem::take(&mut self.thinking);
        content.extend(std::mem::take(&mut self.tool_uses));
        messages.push(json!({
            "role": "assistant",
            "content": content
        }));
    }

    /// Take the buffered thinking blocks so a caller can lead an assistant
    /// message with them directly.
    fn take_thinking(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.thinking)
    }

    /// Emit buffered thinking as a standalone assistant message. Used when a
    /// reasoning item is followed by something other than a tool call.
    fn flush_thinking_as_message(&mut self, messages: &mut Vec<Value>) {
        if self.thinking.is_empty() {
            return;
        }
        messages.push(json!({
            "role": "assistant",
            "content": std::mem::take(&mut self.thinking)
        }));
    }

    fn flush_tool_results(&mut self, messages: &mut Vec<Value>) {
        if self.tool_results.is_empty() {
            return;
        }
        // A tool result belongs to a tool_use already emitted; any thinking still
        // buffered here has no assistant turn left to lead, so discard it rather
        // than attach it to the user (tool_result) message.
        self.thinking.clear();
        messages.push(json!({
            "role": "user",
            "content": std::mem::take(&mut self.tool_results)
        }));
    }
}

/// One Responses input item, appended to `messages` or buffered in `pending`.
///
/// Two things make this match worth reading carefully. Tool calls and their
/// outputs are buffered rather than emitted, so `PendingToolTurn` can rebuild
/// Anthropic's one-message-per-tool-turn pairing. And the tail handles item types
/// no Anthropic client ever sends — `custom_tool_call` for freeform tools like
/// `apply_patch`, `local_shell_call` for the sandboxed shell — which Codex
/// replays from the second turn of any session that edited a file. Failing on an
/// unknown type kills the whole request, so the account looks broken while the
/// same relay works under the claude platform (which speaks `/v1/messages` and
/// never reaches this converter). Mirrors `responses_chat::convert_input_item`,
/// which has handled these since the Chat bridge shipped.
fn convert_input_item(
    item: &Value,
    messages: &mut Vec<Value>,
    pending: &mut PendingToolTurn,
) -> Result<(), String> {
    let object = item
        .as_object()
        .ok_or_else(|| "Responses input items must be JSON objects".to_string())?;
    match object.get("type").and_then(Value::as_str) {
        Some("function_call") => {
            let call_id = required_string(object, "call_id", "function_call")?;
            let name = required_string(object, "name", "function_call")?;
            let arguments = object
                .get("arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}");
            let input = serde_json::from_str::<Value>(arguments)
                .unwrap_or_else(|_| Value::String(arguments.to_string()));
            pending.push_tool_use(
                messages,
                json!({
                    "type": "tool_use",
                    "id": call_id,
                    "name": name,
                    "input": input
                }),
            );
        }
        Some("function_call_output") => {
            let call_id = required_string(object, "call_id", "function_call_output")?;
            let output = object
                .get("output")
                .map(stringify_content)
                .transpose()?
                .unwrap_or_default();
            pending.push_tool_result(
                messages,
                json!({
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": output
                }),
            );
        }
        // A freeform tool's whole payload is one string. `{"input": "…"}` is the
        // shape `custom_tool_to_function_tool` advertises to the model, so a call
        // replayed from history has to be spelled the same way or the next turn
        // contradicts the schema the tool was declared with.
        Some(item_type @ ("custom_tool_call" | "tool_search_call")) => {
            let call_id = object
                .get("call_id")
                .or_else(|| object.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|call_id| !call_id.is_empty())
                .ok_or_else(|| format!("Responses {item_type} is missing call_id"))?;
            let (name, input) = if item_type == "tool_search_call" {
                (
                    "tool_search",
                    object
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                )
            } else {
                (
                    required_string(object, "name", "custom_tool_call")?,
                    json!({"input": object.get("input").cloned().unwrap_or_else(|| json!(""))}),
                )
            };
            pending.push_tool_use(
                messages,
                json!({
                    "type": "tool_use",
                    "id": call_id,
                    "name": name,
                    "input": input
                }),
            );
        }
        Some(item_type @ ("custom_tool_call_output" | "tool_search_output")) => {
            let call_id = required_string(object, "call_id", item_type)?;
            let output = object
                .get("output")
                .or_else(|| object.get("result"))
                .map(stringify_content)
                .transpose()?
                .unwrap_or_default();
            pending.push_tool_result(
                messages,
                json!({
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": output
                }),
            );
        }
        // Tools the upstream never saw declared (they are filtered out of the
        // tool array by `is_responses_builtin_tool_type`), so replaying their
        // calls would be a tool_use Claude cannot match to a tool.
        Some(
            "web_search_call"
            | "web_search_call_output"
            | "file_search_call"
            | "file_search_call_output"
            | "computer_call"
            | "computer_call_output"
            | "local_shell_call"
            | "local_shell_call_output",
        ) => {
            pending.flush(messages);
        }
        // A bare content part used as an input item, rather than wrapped in a
        // message. Codex sends this shape for pasted images.
        Some("input_text" | "input_image" | "input_file" | "input_audio") => {
            pending.flush(messages);
            let role = object.get("role").and_then(Value::as_str).unwrap_or("user");
            let content = convert_message_content(&Value::Array(vec![item.clone()]))?;
            messages.push(json!({"role": role, "content": content}));
        }
        Some("message") | None if object.contains_key("role") => {
            let role = object.get("role").and_then(Value::as_str).unwrap_or("user");
            // Buffered thinking leads the assistant turn it belongs to; flushing
            // tool state first keeps prior tool pairs correctly ordered. For a
            // non-assistant message the thinking has no turn to lead, so it is
            // emitted as its own assistant message ahead of this one.
            let leading_thinking = if role == "assistant" {
                pending.take_thinking()
            } else {
                Vec::new()
            };
            pending.flush(messages);
            let mut content = leading_thinking;
            content.extend(
                object
                    .get("content")
                    .map(convert_message_content)
                    .transpose()?
                    .unwrap_or_else(Vec::new),
            );
            messages.push(json!({"role": role, "content": content}));
        }
        // Codex control items with no conversable content.
        Some(_) if is_droppable_codex_control_item(item) => {
            pending.flush(messages);
        }
        // Carries prose, so it is restated rather than dropped.
        Some("agent_message") => {
            pending.flush(messages);
            let Some(restated) = codex_agent_message_as_message(item) else {
                return Ok(());
            };
            let content = restated
                .get("content")
                .map(convert_message_content)
                .transpose()?
                .unwrap_or_else(Vec::new);
            if !content.is_empty() {
                messages.push(json!({"role": "user", "content": content}));
            }
        }
        Some(other) => return Err(format!("Unsupported Responses input item type: {other}")),
        None => return Err("Responses input item is missing role or type".to_string()),
    }
    Ok(())
}

fn convert_message_content(content: &Value) -> Result<Vec<Value>, String> {
    match content {
        Value::String(text) => Ok(vec![text_block(text)]),
        Value::Array(parts) => parts
            .iter()
            .map(convert_content_part)
            .filter_map(|result| match result {
                Ok(Some(value)) => Some(Ok(value)),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            })
            .collect(),
        Value::Null => Ok(Vec::new()),
        _ => Err("Responses message content must be a string or array".to_string()),
    }
}

fn convert_content_part(part: &Value) -> Result<Option<Value>, String> {
    let object = part
        .as_object()
        .ok_or_else(|| "Responses content parts must be objects".to_string())?;
    match object.get("type").and_then(Value::as_str) {
        Some("input_text" | "output_text" | "text") => Ok(object
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| text_block(text))),
        Some("input_image") => {
            let image_url = required_string(object, "image_url", "input_image")?;
            let Some((media_type, data)) = parse_base64_data_url(image_url) else {
                return Err("Anthropic bridge only supports base64 data URL images".to_string());
            };
            Ok(Some(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": data
                }
            })))
        }
        Some(other) => Err(format!("Unsupported Responses content type: {other}")),
        None => Err("Responses content part is missing type".to_string()),
    }
}

fn convert_tools(tools: &Value) -> Result<Value, String> {
    let tools = flatten_responses_function_tools(tools)?;
    let mut converted = Vec::with_capacity(tools.len());
    for object in tools {
        let name = required_string(&object, "name", "function tool")?;
        let mut converted_tool = Map::new();
        converted_tool.insert("name".to_string(), Value::String(name.to_string()));
        if let Some(description) = object.get("description") {
            converted_tool.insert("description".to_string(), description.clone());
        }
        converted_tool.insert(
            "input_schema".to_string(),
            response_tool_parameters(&object),
        );
        converted.push(Value::Object(converted_tool));
    }
    Ok(Value::Array(converted))
}

fn anthropic_content_to_responses_output(
    response_id: &str,
    content: Option<&Vec<Value>>,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<(Vec<Value>, String), String> {
    let mut output = Vec::new();
    let mut text = String::new();
    let mut message_content = Vec::new();
    // Reasoning from this turn's own thinking blocks, kept aside so it can lead
    // the output: a client that sees the answer before its reasoning renders the
    // reasoning as a reply to it.
    let mut native_reasoning = Vec::new();
    let Some(content) = content else {
        return Ok((output, text));
    };
    for (block_index, item) in content.iter().enumerate() {
        match item.get("type").and_then(Value::as_str) {
            Some("text") => {
                let item_text = item.get("text").and_then(Value::as_str).unwrap_or("");
                text.push_str(item_text);
                message_content.push(json!({
                    "type": "output_text",
                    "text": item_text,
                    "annotations": [],
                    "logprobs": []
                }));
            }
            Some("tool_use") => {
                // An Anthropic `tool_use` always carries an id, but a blank one is
                // as unusable as a missing one: the client echoes `call_id` back on
                // the next turn, and an empty value makes the replay invalid.
                let call_id = tool_call_id_or_fallback(item.get("id").and_then(Value::as_str));
                let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                let response_name = response_tool_name(name, tool_namespaces);
                let arguments =
                    serde_json::to_string(item.get("input").unwrap_or(&Value::Object(Map::new())))
                        .map_err(|error| {
                            format!("Could not serialize Anthropic tool input: {error}")
                        })?;
                let mut function_call = json!({
                    "id": format!("fc_{}_{}", sanitize_id(response_id), output.len()),
                    "type": "function_call",
                    "status": "completed",
                    "call_id": call_id,
                    "name": response_name,
                    "arguments": arguments
                });
                if let Some(namespace) = response_tool_namespace(name, tool_namespaces) {
                    function_call["namespace"] = Value::String(namespace.to_string());
                }
                output.push(function_call);
            }
            // Thinking blocks arrive because the request path enables thinking.
            // Two shapes reach here and both have to become a `reasoning` item:
            //
            // - the block is one the client replayed and the upstream echoed
            //   back, so it carries our own envelope and decodes into the exact
            //   original item (see `reasoning_bridge`);
            // - the block is fresh thinking from this turn, signed by the
            //   upstream. Its plaintext becomes the summary the client renders,
            //   and the verbatim block is carried in `encrypted_content` so the
            //   signature survives the next request. Dropping it here is what
            //   used to leave Codex with no thinking to show at all.
            Some("thinking") | Some("redacted_thinking") => {
                if let Some(reasoning) =
                    super::reasoning_bridge::openai_reasoning_item_from_anthropic_block(item)
                {
                    output.push(reasoning);
                } else if let Some(reasoning) =
                    super::reasoning_bridge::reasoning_item_from_anthropic_block(
                        &format!("rs_{}_{}", sanitize_id(response_id), block_index),
                        item,
                    )
                {
                    native_reasoning.push(reasoning);
                }
            }
            Some(_) | None => {}
        }
    }
    // A model whose real thinking channel was never enabled writes its
    // scratchpad into the answer as `<thinking>…</thinking>`. Route it where the
    // client already renders reasoning instead of printing the tags as prose.
    let (inlined_reasoning, visible_text) = thinking_text::split_leading_thinking(&text);
    let inlined_reasoning = inlined_reasoning.map(str::to_string);
    let visible_text = visible_text.to_string();
    if inlined_reasoning.is_some() {
        message_content = if visible_text.is_empty() {
            Vec::new()
        } else {
            vec![json!({
                "type": "output_text",
                "text": visible_text,
                "annotations": [],
                "logprobs": []
            })]
        };
        text = visible_text;
    }
    if !message_content.is_empty() {
        output.insert(
            0,
            json!({
                "id": format!("msg_{}", sanitize_id(response_id)),
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": message_content
            }),
        );
    }
    // Ahead of the message: the client orders output items as it receives them,
    // and reasoning that lands after the answer reads as a reply to it.
    if let Some(reasoning) = inlined_reasoning {
        output.insert(
            0,
            json!({
                "id": format!("rs_{}", sanitize_id(response_id)),
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": reasoning}]
            }),
        );
    }
    // The turn's own thinking leads everything else. `inlined_reasoning` is the
    // `<thinking>` fallback a relay writes into the text when its real thinking
    // channel was never enabled, so a native block always outranks it.
    if !native_reasoning.is_empty() {
        native_reasoning.append(&mut output);
        output = native_reasoning;
    }
    Ok((output, text))
}

fn anthropic_usage_to_responses(usage: Option<&Value>) -> Value {
    let Some(usage) = usage else {
        return Value::Null;
    };
    let input_tokens = usage
        .get("input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let field = |key: &str| usage.get(key).and_then(Value::as_i64).unwrap_or(0);
    // Anthropic reports cache reads/writes outside input_tokens, so the Responses
    // total has to add them back or a cached turn undercounts by the whole prefix.
    let cache_read = field("cache_read_input_tokens");
    let cache_creation = field("cache_creation_input_tokens");
    json!({
        "input_tokens": input_tokens + cache_read + cache_creation,
        "input_tokens_details": {"cached_tokens": cache_read},
        "output_tokens": output_tokens,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": input_tokens + cache_read + cache_creation + output_tokens
    })
}

fn responses_status(stop_reason: Option<&str>) -> &'static str {
    match stop_reason {
        Some("max_tokens") => "incomplete",
        _ => "completed",
    }
}

fn incomplete_details(stop_reason: Option<&str>) -> Value {
    match stop_reason {
        Some("max_tokens") => json!({"reason": "max_output_tokens"}),
        _ => Value::Null,
    }
}

fn text_value(value: &Value, label: &str) -> Result<String, String> {
    match value {
        Value::String(text) => Ok(text.clone()),
        Value::Array(parts) => parts
            .iter()
            .map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| format!("Responses {label} entries must contain text"))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|parts| parts.join("\n")),
        _ => Err(format!("Responses {label} must be text")),
    }
}

fn text_block(text: &str) -> Value {
    json!({"type": "text", "text": text})
}

fn stringify_content(value: &Value) -> Result<String, String> {
    match value {
        Value::String(text) => Ok(text.clone()),
        Value::Null => Ok(String::new()),
        _ => serde_json::to_string(value)
            .map_err(|error| format!("Could not serialize tool output: {error}")),
    }
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Responses {label} is missing {key}"))
}

fn copy_fields(source: &Map<String, Value>, target: &mut Map<String, Value>, fields: &[&str]) {
    for field in fields {
        if let Some(value) = source.get(*field) {
            target.insert((*field).to_string(), value.clone());
        }
    }
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn looks_like_sse(body: &[u8]) -> bool {
    std::str::from_utf8(body).ok().is_some_and(|text| {
        text.lines()
            .any(|line| line.trim_start().starts_with("data:"))
    })
}
