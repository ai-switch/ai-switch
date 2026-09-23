use super::common::{
    chat_reasoning_effort, codex_agent_message_as_message, flatten_responses_function_tools,
    is_droppable_codex_control_item, is_responses_builtin_tool_type, response_tool_name,
    response_tool_namespace, response_tool_parameters, responses_reasoning_effort,
    responses_tool_namespaces, ResponsesToolNamespaces,
};
use super::thinking_text::{self, InlineThinkingSplitter, TextSegment};
use super::TransformedBridgeResponse;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Non-empty stand-in used when a `tool_calls` assistant message must carry
/// `reasoning_content` (DeepSeek/MiMo protocol) but the real reasoning was lost
/// (cold cache after a restart, ambiguous call_id, a turn with no thinking).
/// A neutral marker rather than `"..."`: reasoning models can read an ellipsis
/// as a trailing-off/incomplete thought and bias toward short, hesitant replies.
/// Matches cc-switch's placeholder.
const TOOL_CALL_REASONING_PLACEHOLDER: &str = "tool call";
const CHAT_AGENT_CONTINUATION_INSTRUCTION: &str = "Chat Completions tool-call compatibility: when tools are available and more work is needed, include the tool call in the same assistant response. If the upstream cannot combine progress text with tool_calls, omit the progress text and emit the tool call directly. Do not end the response with only a progress update, plan, or statement of the next action; use a text-only response only when the task is complete or the user explicitly requested analysis only.";

pub(super) fn responses_request_to_chat(body: &[u8]) -> Result<Vec<u8>, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Responses request JSON is invalid: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Responses request body must be a JSON object".to_string())?;
    let mut result = Map::new();

    if let Some(model) = object.get("model") {
        result.insert("model".to_string(), model.clone());
    }

    let mut messages = Vec::new();
    if let Some(instructions) = object.get("instructions") {
        let content = text_value(instructions, "instructions")?;
        if !content.is_empty() {
            messages.push(json!({"role": "system", "content": content}));
        }
    }
    let tool_namespaces = responses_tool_namespaces(object.get("tools"))?;
    if let Some(input) = object.get("input") {
        messages.extend(convert_input(input, &tool_namespaces)?);
    }
    normalize_empty_message_content(&mut messages);
    collapse_system_messages_to_head(&mut messages);
    result.insert("messages".to_string(), Value::Array(messages));

    if let Some(effort) =
        responses_reasoning_effort(object).and_then(|effort| chat_reasoning_effort(&effort))
    {
        result.insert("reasoning_effort".to_string(), json!(effort));
    }

    if let Some(limit) = object.get("max_output_tokens") {
        let model = object
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let key = if super::common::requires_max_completion_tokens(model) {
            "max_completion_tokens"
        } else {
            "max_tokens"
        };
        result.insert(key.to_string(), limit.clone());
    }

    copy_fields(
        object,
        &mut result,
        &[
            "temperature",
            "top_p",
            "parallel_tool_calls",
            "stream",
            "stop",
            "presence_penalty",
            "frequency_penalty",
            "seed",
            "service_tier",
            "user",
        ],
    );

    if object.get("stream").and_then(Value::as_bool) == Some(true) {
        result.insert("stream_options".to_string(), json!({"include_usage": true}));
    }

    let mut has_tools = false;
    if let Some(tools) = object.get("tools") {
        let converted_tools = convert_tools(tools)?;
        has_tools = converted_tools
            .as_array()
            .is_some_and(|tools| !tools.is_empty());
        if has_tools {
            result.insert("tools".to_string(), converted_tools);
            add_agent_tool_continuation_instruction(&mut result);
        }
    }
    if let Some(tool_choice) = object.get("tool_choice") {
        if let Some(converted_tool_choice) = convert_tool_choice(tool_choice, has_tools)? {
            result.insert("tool_choice".to_string(), converted_tool_choice);
        }
    }

    serde_json::to_vec(&Value::Object(result))
        .map_err(|error| format!("Could not serialize Chat request: {error}"))
}

pub(super) fn chat_response_to_responses(
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
        return Ok(TransformedBridgeResponse {
            body: chat_sse_to_responses(body, tool_namespaces)?,
            content_type: Some("text/event-stream".to_string()),
        });
    }

    Ok(TransformedBridgeResponse {
        body: chat_json_to_responses(body, tool_namespaces)?,
        content_type: Some("application/json".to_string()),
    })
}

fn chat_json_to_responses(
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<u8>, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Chat response JSON is invalid: {error}"))?;
    if value.get("error").is_some() {
        return serde_json::to_vec(&failed_response_from_error(&value))
            .map_err(|error| format!("Could not serialize Responses error: {error}"));
    }
    let response_id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("resp_ai_switch");
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let created_at = value
        .get("created")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| chrono::Utc::now().timestamp());
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| "Chat response is missing choices[0]".to_string())?;
    let message = choice
        .get("message")
        .ok_or_else(|| "Chat response is missing choices[0].message".to_string())?;
    let raw_text = chat_message_text(message)?;
    // A relay with "thinking to content" on delivers the reasoning inside the
    // visible answer; without this the client renders the tags as prose.
    let (inlined_reasoning, visible_text) = thinking_text::split_leading_thinking(&raw_text);
    let text = visible_text.to_string();
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let reasoning = merge_reasoning(message_reasoning_text(message), inlined_reasoning);
    let has_reasoning = reasoning.is_some();
    let mut output = build_output_items(
        response_id,
        &text,
        &tool_calls,
        true,
        tool_namespaces,
        reasoning.as_deref(),
    )?;
    if let Some(reasoning) = reasoning.as_deref() {
        output.insert(
            0,
            reasoning_output_item(&reasoning_item_id(response_id), reasoning),
        );
    }
    if output.is_empty() {
        output.push(message_output_item(
            &message_item_id(response_id),
            "completed",
            "",
        ));
    }
    let finish_reason = choice.get("finish_reason").and_then(Value::as_str);
    let native_finish_reason = choice.get("native_finish_reason").and_then(Value::as_str);
    let has_output_content = !text.is_empty() || !tool_calls.is_empty() || has_reasoning;
    let status = responses_status(finish_reason, native_finish_reason, has_output_content);
    let response = response_object(
        response_id,
        model,
        created_at,
        status,
        output,
        chat_usage_to_responses(value.get("usage")),
        finish_reason,
        native_finish_reason,
    );
    let mut response = response;
    response["output_text"] = Value::String(text);

    serde_json::to_vec(&response)
        .map_err(|error| format!("Could not serialize Responses response: {error}"))
}

fn chat_sse_to_responses(
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<u8>, String> {
    let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
    let mut bridge = ChatStreamBridge::new(tool_namespaces.clone());
    let mut output = String::new();
    let mut saw_done = false;

    for block in text.split("\n\n") {
        let data = block
            .lines()
            .filter_map(|line| line.trim().strip_prefix("data:").map(str::trim))
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            saw_done = true;
            break;
        }
        // Skip a record we cannot read rather than discarding the whole
        // generation: a stream cut mid-record leaves a truncated tail, and the
        // events already emitted above are still valid.
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        output.push_str(&bridge.push_value(&value)?);
        if bridge.failed() {
            return Ok(output.into_bytes());
        }
    }

    if !bridge.started() && !saw_done {
        return Err("Chat SSE response did not contain data events".to_string());
    }
    output.push_str(&bridge.finish()?);
    Ok(output.into_bytes())
}

/// Incremental form of the Chat → Responses stream conversion.
///
/// The buffered [`chat_sse_to_responses`] drives this one record at a time, so a
/// live stream and a whole body cannot drift apart — there is only one
/// implementation of the conversion, reached two ways. The proxy streams through
/// this when the upstream is a Chat endpoint, which is what keeps a Codex turn
/// from going silent until the upstream has finished.
#[derive(Debug, Default)]
pub(crate) struct ChatStreamBridge {
    state: ChatStreamState,
    sequence_number: u64,
    tool_namespaces: ResponsesToolNamespaces,
    failed: bool,
}

impl ChatStreamBridge {
    pub(crate) fn new(tool_namespaces: ResponsesToolNamespaces) -> Self {
        Self {
            state: ChatStreamState::default(),
            sequence_number: 0,
            tool_namespaces,
            failed: false,
        }
    }

    /// Whether anything has been emitted yet. A stream that never starts and
    /// never sees `[DONE]` is not a stream at all.
    pub(crate) fn started(&self) -> bool {
        self.state.started
    }

    /// Whether the upstream reported an error frame, after which no further
    /// records are convertible.
    pub(crate) fn failed(&self) -> bool {
        self.failed
    }

    /// Converts one parsed Chat completion chunk into Responses SSE bytes.
    ///
    /// Returns the bytes to forward for this record — usually non-empty, but a
    /// record carrying nothing the client needs (a bare usage tail, say) yields
    /// none. [`Self::finish`] emits the closing events.
    pub(crate) fn push_value(&mut self, value: &Value) -> Result<String, String> {
        let mut output = String::new();
        let state = &mut self.state;
        let sequence_number = &mut self.sequence_number;
        let tool_namespaces = &self.tool_namespaces;

        if value.get("error").is_some() {
            ensure_stream_started(state, &mut output, sequence_number);
            push_sse_event(
                &mut output,
                "response.failed",
                failed_response_event(state, value, *sequence_number),
            )?;
            self.failed = true;
            return Ok(output);
        }

        state.capture_envelope(value);
        ensure_stream_started(state, &mut output, sequence_number);
        if let Some(usage) = value.get("usage") {
            state.usage = Some(usage.clone());
        }
        let Some(choice) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return Ok(output);
        };
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            state.finish_reason = Some(reason.to_string());
        }
        if let Some(native_reason) = choice.get("native_finish_reason").and_then(Value::as_str) {
            state.native_finish_reason = Some(native_reason.to_string());
        }
        let delta = choice.get("delta").unwrap_or(&Value::Null);
        if let Some(reasoning) = delta_reasoning_text(delta) {
            emit_reasoning_delta(state, &mut output, sequence_number, reasoning)?;
        }
        if let Some(content) = delta.get("content").and_then(Value::as_str) {
            // Segments are taken as an owned batch so the splitter's borrow ends
            // before the emitters take `&mut state`.
            let segments = state.inline_thinking.push(content);
            emit_segments(state, &mut output, sequence_number, segments)?;
        }
        if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for tool_call in tool_calls {
                emit_tool_call_delta(
                    state,
                    &mut output,
                    sequence_number,
                    tool_call,
                    tool_namespaces,
                )?;
            }
        }
        Ok(output)
    }

    /// Emits the closing events for the turn.
    pub(crate) fn finish(&mut self) -> Result<String, String> {
        let mut output = String::new();
        let state = &mut self.state;
        let sequence_number = &mut self.sequence_number;
        ensure_stream_started(state, &mut output, sequence_number);
        // Whatever the splitter was still holding back — a block the upstream
        // never closed, or a tail that turned out not to be a tag.
        let segments = state.inline_thinking.finish();
        emit_segments(state, &mut output, sequence_number, segments)?;
        finish_stream(state, &mut output, sequence_number, &self.tool_namespaces)?;
        Ok(output)
    }
}

#[derive(Debug, Default)]
struct ChatStreamState {
    response_id: String,
    model: String,
    created_at: i64,
    started: bool,
    reasoning_started: bool,
    reasoning: String,
    reasoning_output_index: usize,
    text_started: bool,
    text: String,
    text_output_index: usize,
    tools: BTreeMap<usize, StreamToolCall>,
    next_output_index: usize,
    finish_reason: Option<String>,
    native_finish_reason: Option<String>,
    usage: Option<Value>,
    /// Routes a `<think>` block the upstream inlined into `content` back onto
    /// the reasoning channel. Inert for upstreams that never inline one.
    inline_thinking: InlineThinkingSplitter,
}

impl ChatStreamState {
    fn capture_envelope(&mut self, value: &Value) {
        if self.response_id.is_empty() {
            self.response_id = value
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("resp_ai_switch")
                .to_string();
        }
        if self.model.is_empty() {
            self.model = value
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
        }
        if self.created_at == 0 {
            self.created_at = value
                .get("created")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp());
        }
    }

    fn response_id(&self) -> &str {
        if self.response_id.is_empty() {
            "resp_ai_switch"
        } else {
            &self.response_id
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

#[derive(Debug, Default)]
struct StreamToolCall {
    output_index: usize,
    item_id: String,
    call_id: String,
    name: String,
    arguments: String,
    started: bool,
}

fn ensure_stream_started(
    state: &mut ChatStreamState,
    output: &mut String,
    sequence_number: &mut u64,
) {
    if state.started {
        return;
    }
    if state.created_at == 0 {
        state.created_at = chrono::Utc::now().timestamp();
    }
    let created = response_object(
        state.response_id(),
        state.model(),
        state.created_at,
        "in_progress",
        Vec::new(),
        Value::Null,
        None,
        None,
    );
    let _ = push_sse_event(
        output,
        "response.created",
        json!({
            "type": "response.created",
            "sequence_number": *sequence_number,
            "response": created
        }),
    );
    *sequence_number += 1;
    let in_progress = response_object(
        state.response_id(),
        state.model(),
        state.created_at,
        "in_progress",
        Vec::new(),
        Value::Null,
        None,
        None,
    );
    let _ = push_sse_event(
        output,
        "response.in_progress",
        json!({
            "type": "response.in_progress",
            "sequence_number": *sequence_number,
            "response": in_progress
        }),
    );
    *sequence_number += 1;
    state.started = true;
}

fn emit_reasoning_delta(
    state: &mut ChatStreamState,
    output: &mut String,
    sequence_number: &mut u64,
    delta: &str,
) -> Result<(), String> {
    let item_id = reasoning_item_id(state.response_id());
    if !state.reasoning_started {
        state.reasoning_output_index = state.next_output_index;
        state.next_output_index += 1;
        let output_index = state.reasoning_output_index;
        push_sse_event(
            output,
            "response.output_item.added",
            json!({
                "type": "response.output_item.added",
                "sequence_number": *sequence_number,
                "output_index": output_index,
                "item": reasoning_output_item(&item_id, "")
            }),
        )?;
        *sequence_number += 1;
        push_sse_event(
            output,
            "response.reasoning_summary_part.added",
            json!({
                "type": "response.reasoning_summary_part.added",
                "sequence_number": *sequence_number,
                "item_id": item_id,
                "output_index": output_index,
                "summary_index": 0,
                "part": {"type": "summary_text", "text": ""}
            }),
        )?;
        *sequence_number += 1;
        state.reasoning_started = true;
    }
    let output_index = state.reasoning_output_index;
    state.reasoning.push_str(delta);
    push_sse_event(
        output,
        "response.reasoning_summary_text.delta",
        json!({
            "type": "response.reasoning_summary_text.delta",
            "sequence_number": *sequence_number,
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "delta": delta
        }),
    )?;
    *sequence_number += 1;
    Ok(())
}

fn emit_segments(
    state: &mut ChatStreamState,
    output: &mut String,
    sequence_number: &mut u64,
    segments: Vec<TextSegment>,
) -> Result<(), String> {
    for segment in segments {
        match segment {
            TextSegment::Reasoning(text) => {
                emit_reasoning_delta(state, output, sequence_number, &text)?
            }
            TextSegment::Text(text) => emit_text_delta(state, output, sequence_number, &text)?,
        }
    }
    Ok(())
}

fn emit_text_delta(
    state: &mut ChatStreamState,
    output: &mut String,
    sequence_number: &mut u64,
    delta: &str,
) -> Result<(), String> {
    let item_id = message_item_id(state.response_id());
    if !state.text_started {
        state.text_output_index = state.next_output_index;
        state.next_output_index += 1;
        let output_index = state.text_output_index;
        push_sse_event(
            output,
            "response.output_item.added",
            json!({
                "type": "response.output_item.added",
                "sequence_number": *sequence_number,
                "output_index": output_index,
                "item": message_output_item(&item_id, "in_progress", "")
            }),
        )?;
        *sequence_number += 1;
        push_sse_event(
            output,
            "response.content_part.added",
            json!({
                "type": "response.content_part.added",
                "sequence_number": *sequence_number,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": output_text_part("")
            }),
        )?;
        *sequence_number += 1;
        state.text_started = true;
    }
    let output_index = state.text_output_index;
    state.text.push_str(delta);
    push_sse_event(
        output,
        "response.output_text.delta",
        json!({
            "type": "response.output_text.delta",
            "sequence_number": *sequence_number,
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "delta": delta,
            "logprobs": []
        }),
    )?;
    *sequence_number += 1;
    Ok(())
}

fn emit_tool_call_delta(
    state: &mut ChatStreamState,
    output: &mut String,
    sequence_number: &mut u64,
    value: &Value,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<(), String> {
    let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
    if !state.tools.contains_key(&index) {
        let output_index = state.next_output_index;
        state.next_output_index += 1;
        state.tools.insert(
            index,
            StreamToolCall {
                output_index,
                item_id: format!("fc_{}_{}", sanitize_id(state.response_id()), index),
                call_id: value
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("call_ai_switch")
                    .to_string(),
                ..StreamToolCall::default()
            },
        );
    }
    let tool = state
        .tools
        .get_mut(&index)
        .expect("tool call inserted before mutation");
    if let Some(id) = value.get("id").and_then(Value::as_str) {
        tool.call_id = id.to_string();
    }
    if let Some(function) = value.get("function") {
        if let Some(name) = function.get("name").and_then(Value::as_str) {
            tool.name.push_str(name);
        }
    }
    if !tool.started {
        push_sse_event(
            output,
            "response.output_item.added",
            json!({
                "type": "response.output_item.added",
                "sequence_number": *sequence_number,
                "output_index": tool.output_index,
                "item": function_call_output_item(
                    &tool.item_id,
                    &tool.call_id,
                    &tool.name,
                    "",
                    "in_progress",
                    tool_namespaces,
                    None,
                )
            }),
        )?;
        *sequence_number += 1;
        tool.started = true;
    }
    if let Some(arguments) = value
        .get("function")
        .and_then(|function| function.get("arguments"))
        .and_then(Value::as_str)
    {
        tool.arguments.push_str(arguments);
        push_sse_event(
            output,
            "response.function_call_arguments.delta",
            json!({
                "type": "response.function_call_arguments.delta",
                "sequence_number": *sequence_number,
                "item_id": tool.item_id,
                "output_index": tool.output_index,
                "delta": arguments
            }),
        )?;
        *sequence_number += 1;
    }
    Ok(())
}

fn finish_stream(
    state: &mut ChatStreamState,
    output: &mut String,
    sequence_number: &mut u64,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<(), String> {
    let mut final_output = Vec::new();
    if state.reasoning_started {
        let item_id = reasoning_item_id(state.response_id());
        let output_index = state.reasoning_output_index;
        push_sse_event(
            output,
            "response.reasoning_summary_text.done",
            json!({
                "type": "response.reasoning_summary_text.done",
                "sequence_number": *sequence_number,
                "item_id": item_id,
                "output_index": output_index,
                "summary_index": 0,
                "text": state.reasoning
            }),
        )?;
        *sequence_number += 1;
        push_sse_event(
            output,
            "response.reasoning_summary_part.done",
            json!({
                "type": "response.reasoning_summary_part.done",
                "sequence_number": *sequence_number,
                "item_id": item_id,
                "output_index": output_index,
                "summary_index": 0,
                "part": {"type": "summary_text", "text": state.reasoning}
            }),
        )?;
        *sequence_number += 1;
        let item = reasoning_output_item(&item_id, &state.reasoning);
        push_sse_event(
            output,
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "sequence_number": *sequence_number,
                "output_index": output_index,
                "item": item
            }),
        )?;
        *sequence_number += 1;
        final_output.push(reasoning_output_item(&item_id, &state.reasoning));
    }
    if state.text_started {
        let item_id = message_item_id(state.response_id());
        let output_index = state.text_output_index;
        push_sse_event(
            output,
            "response.output_text.done",
            json!({
                "type": "response.output_text.done",
                "sequence_number": *sequence_number,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "text": state.text,
                "logprobs": []
            }),
        )?;
        *sequence_number += 1;
        push_sse_event(
            output,
            "response.content_part.done",
            json!({
                "type": "response.content_part.done",
                "sequence_number": *sequence_number,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": output_text_part(&state.text)
            }),
        )?;
        *sequence_number += 1;
        let item = message_output_item(&item_id, "completed", &state.text);
        push_sse_event(
            output,
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "sequence_number": *sequence_number,
                "output_index": output_index,
                "item": item
            }),
        )?;
        *sequence_number += 1;
        final_output.push(message_output_item(&item_id, "completed", &state.text));
    }
    for tool in state.tools.values() {
        push_sse_event(
            output,
            "response.function_call_arguments.done",
            json!({
                "type": "response.function_call_arguments.done",
                "sequence_number": *sequence_number,
                "item_id": tool.item_id,
                "output_index": tool.output_index,
                "arguments": tool.arguments
            }),
        )?;
        *sequence_number += 1;
        let item = function_call_output_item(
            &tool.item_id,
            &tool.call_id,
            &tool.name,
            &tool.arguments,
            "completed",
            tool_namespaces,
            Some(state.reasoning.as_str()),
        );
        push_sse_event(
            output,
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "sequence_number": *sequence_number,
                "output_index": tool.output_index,
                "item": item
            }),
        )?;
        *sequence_number += 1;
        final_output.push(function_call_output_item(
            &tool.item_id,
            &tool.call_id,
            &tool.name,
            &tool.arguments,
            "completed",
            tool_namespaces,
            Some(state.reasoning.as_str()),
        ));
    }
    final_output.sort_by_key(|item| match item.get("type").and_then(Value::as_str) {
        Some("reasoning") => 0,
        Some("message") => 1,
        _ => 2,
    });
    if final_output.is_empty() {
        let item_id = message_item_id(state.response_id());
        final_output.push(message_output_item(&item_id, "completed", ""));
    }
    let finish_reason = state.finish_reason.as_deref();
    let native_finish_reason = state.native_finish_reason.as_deref();
    let has_output_content =
        state.reasoning_started || state.text_started || !state.tools.is_empty();
    let status = responses_status(finish_reason, native_finish_reason, has_output_content);
    let response = response_object(
        state.response_id(),
        state.model(),
        state.created_at,
        status,
        final_output,
        chat_usage_to_responses(state.usage.as_ref()),
        finish_reason,
        native_finish_reason,
    );
    let event_name = if status == "failed" {
        "response.failed"
    } else if status == "incomplete" {
        "response.incomplete"
    } else {
        "response.completed"
    };
    push_sse_event(
        output,
        event_name,
        json!({
            "type": event_name,
            "sequence_number": *sequence_number,
            "response": response
        }),
    )?;
    Ok(())
}

fn build_output_items(
    response_id: &str,
    text: &str,
    tool_calls: &[Value],
    completed: bool,
    tool_namespaces: &ResponsesToolNamespaces,
    reasoning: Option<&str>,
) -> Result<Vec<Value>, String> {
    let mut output = Vec::new();
    if !text.is_empty() {
        output.push(message_output_item(
            &message_item_id(response_id),
            if completed {
                "completed"
            } else {
                "in_progress"
            },
            text,
        ));
    }
    for (index, tool_call) in tool_calls.iter().enumerate() {
        let call_id = tool_call
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("call_ai_switch");
        let function = tool_call
            .get("function")
            .ok_or_else(|| "Chat tool call is missing function".to_string())?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Chat tool call is missing function.name".to_string())?;
        let arguments = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        output.push(function_call_output_item(
            &format!("fc_{}_{}", sanitize_id(response_id), index),
            call_id,
            name,
            arguments,
            if completed {
                "completed"
            } else {
                "in_progress"
            },
            tool_namespaces,
            reasoning,
        ));
    }
    Ok(output)
}

fn chat_message_text(message: &Value) -> Result<String, String> {
    match message.get("content") {
        Some(Value::String(text)) => Ok(text.clone()),
        Some(Value::Array(parts)) => Ok(parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("content").and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join("")),
        Some(Value::Null) | None => Ok(String::new()),
        Some(_) => Err("Chat message content has an unsupported shape".to_string()),
    }
}

/// `created_at` is threaded in rather than read from the clock here: one
/// response must report the same creation time in `response.created`,
/// `response.in_progress` and the terminal event. Calling `Utc::now()` per
/// call made the streaming path emit a terminal `created_at` one second off
/// from its own opening event whenever the wall clock ticked over mid-stream.
fn response_object(
    response_id: &str,
    model: &str,
    created_at: i64,
    status: &str,
    output: Vec<Value>,
    usage: Value,
    finish_reason: Option<&str>,
    native_finish_reason: Option<&str>,
) -> Value {
    let mut metadata = Map::new();
    if let Some(native_finish_reason) = native_finish_reason {
        metadata.insert(
            "native_finish_reason".to_string(),
            Value::String(native_finish_reason.to_string()),
        );
    }
    json!({
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": status,
        "background": false,
        "error": native_response_error(status, native_finish_reason),
        "incomplete_details": incomplete_details(finish_reason),
        "instructions": Value::Null,
        "max_output_tokens": Value::Null,
        "model": model,
        "output": output,
        "parallel_tool_calls": true,
        "previous_response_id": Value::Null,
        "reasoning": {"effort": Value::Null, "summary": Value::Null},
        "store": false,
        "temperature": Value::Null,
        "text": {"format": {"type": "text"}},
        "tool_choice": "auto",
        "tools": [],
        "top_p": Value::Null,
        "truncation": "disabled",
        "usage": usage,
        "metadata": metadata
    })
}

fn message_output_item(item_id: &str, status: &str, text: &str) -> Value {
    json!({
        "id": item_id,
        "type": "message",
        "status": status,
        "role": "assistant",
        "content": [output_text_part(text)]
    })
}

fn output_text_part(text: &str) -> Value {
    json!({
        "type": "output_text",
        "text": text,
        "annotations": [],
        "logprobs": []
    })
}

fn function_call_output_item(
    item_id: &str,
    call_id: &str,
    name: &str,
    arguments: &str,
    status: &str,
    tool_namespaces: &ResponsesToolNamespaces,
    reasoning: Option<&str>,
) -> Value {
    let mut item = json!({
        "id": item_id,
        "type": "function_call",
        "status": status,
        "call_id": call_id,
        "name": name,
        "arguments": arguments
    });
    let response_name = response_tool_name(name, tool_namespaces);
    item["name"] = Value::String(response_name.to_string());
    if let Some(namespace) = response_tool_namespace(name, tool_namespaces) {
        item["namespace"] = Value::String(namespace.to_string());
    }
    // Carry the turn's reasoning on the function_call item so a full Codex
    // history replay preserves it. When Codex sends only previous_response_id +
    // tool outputs, CodexReasoningCache restores the cached call group instead.
    // DeepSeek/MiMo require this on the tool-call assistant message.
    if let Some(reasoning) = reasoning.filter(|value| !value.trim().is_empty()) {
        item["reasoning_content"] = Value::String(reasoning.to_string());
    }
    item
}
fn chat_usage_to_responses(usage: Option<&Value>) -> Value {
    let Some(usage) = usage else {
        return Value::Null;
    };
    let input_tokens = usage
        .get("prompt_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("completion_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(input_tokens + output_tokens);
    let cached_tokens = usage
        .pointer("/prompt_tokens_details/cached_tokens")
        .and_then(Value::as_i64)
        .or_else(|| usage.get("prompt_cache_hit_tokens").and_then(Value::as_i64))
        .unwrap_or(0);
    let reasoning_tokens = usage
        .pointer("/completion_tokens_details/reasoning_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let mut result = json!({
        "input_tokens": input_tokens,
        "input_tokens_details": {"cached_tokens": cached_tokens},
        "output_tokens": output_tokens,
        "output_tokens_details": {"reasoning_tokens": reasoning_tokens},
        "total_tokens": total_tokens
    });
    if let (Some(result), Some(original)) = (result.as_object_mut(), usage.as_object()) {
        for (key, value) in original {
            result.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }
    result
}

fn responses_status(
    finish_reason: Option<&str>,
    native_finish_reason: Option<&str>,
    has_output_content: bool,
) -> &'static str {
    if !has_output_content && is_native_finish_failure(native_finish_reason) {
        return "failed";
    }
    match finish_reason {
        Some("length" | "content_filter") => "incomplete",
        Some("error") => "failed",
        _ => "completed",
    }
}

fn incomplete_details(finish_reason: Option<&str>) -> Value {
    match finish_reason {
        Some("length") => json!({"reason": "max_output_tokens"}),
        Some("content_filter") => json!({"reason": "content_filter"}),
        _ => Value::Null,
    }
}

fn native_response_error(status: &str, native_finish_reason: Option<&str>) -> Value {
    if status == "failed" && is_native_finish_failure(native_finish_reason) {
        json!({
            "code": "upstream_native_failure",
            "message": format!(
                "upstream ended the response with native_finish_reason: {}",
                native_finish_reason.unwrap_or_default()
            )
        })
    } else {
        Value::Null
    }
}
fn is_native_finish_failure(native_finish_reason: Option<&str>) -> bool {
    let Some(reason) = native_finish_reason else {
        return false;
    };
    let normalized = reason.to_ascii_lowercase().replace(['-', ' ', ':'], "_");
    normalized.contains("network_error")
        || normalized.contains("timeout")
        || normalized.contains("timed_out")
        || normalized.contains("connection_error")
        || normalized.contains("connection_reset")
        || normalized.contains("upstream_error")
        || normalized.contains("server_error")
        || normalized.contains("provider_error")
        || normalized.contains("service_unavailable")
        || normalized.contains("bad_gateway")
        || normalized.contains("gateway_timeout")
        || normalized.contains("internal_error")
}

fn failed_response_from_error(value: &Value) -> Value {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Chat upstream returned an error");
    json!({
        "id": value.get("id").cloned().unwrap_or_else(|| json!("resp_ai_switch")),
        "object": "response",
        "created_at": value
            .get("created")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp()),
        "status": "failed",
        "error": {
            "code": value.pointer("/error/code").cloned().unwrap_or(Value::Null),
            "message": message
        },
        "output": [],
        "usage": Value::Null
    })
}

fn failed_response_event(state: &ChatStreamState, value: &Value, sequence_number: u64) -> Value {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Chat upstream returned an error");
    json!({
        "type": "response.failed",
        "sequence_number": sequence_number,
        "response": {
            "id": state.response_id(),
            "object": "response",
            "created_at": state.created_at,
            "status": "failed",
            "model": state.model(),
            "error": {
                "code": value.pointer("/error/code").cloned().unwrap_or(Value::Null),
                "message": message
            },
            "output": [],
            "usage": Value::Null
        }
    })
}

fn push_sse_event(output: &mut String, event: &str, value: Value) -> Result<(), String> {
    output.push_str("event: ");
    output.push_str(event);
    output.push('\n');
    output.push_str("data: ");
    output.push_str(
        &serde_json::to_string(&value)
            .map_err(|error| format!("Could not serialize Responses SSE event: {error}"))?,
    );
    output.push_str("\n\n");
    Ok(())
}

fn looks_like_sse(body: &[u8]) -> bool {
    std::str::from_utf8(body).ok().is_some_and(|text| {
        text.lines()
            .any(|line| line.trim_start().starts_with("data:"))
    })
}

fn message_item_id(response_id: &str) -> String {
    format!("msg_{}", sanitize_id(response_id))
}

fn reasoning_item_id(response_id: &str) -> String {
    format!("rs_{}", sanitize_id(response_id))
}

fn reasoning_output_item(item_id: &str, text: &str) -> Value {
    let summary = if text.is_empty() {
        json!([])
    } else {
        json!([{"type": "summary_text", "text": text}])
    };
    json!({
        "id": item_id,
        "type": "reasoning",
        "summary": summary
    })
}

fn delta_reasoning_text(delta: &Value) -> Option<&str> {
    delta
        .get("reasoning_content")
        .and_then(Value::as_str)
        .or_else(|| delta.get("reasoning").and_then(Value::as_str))
        .filter(|text| !text.is_empty())
}

fn message_reasoning_text(message: &Value) -> Option<&str> {
    message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .or_else(|| message.get("reasoning").and_then(Value::as_str))
        .filter(|text| !text.is_empty())
}

/// Combines reasoning that arrived on its own field with a block the upstream
/// inlined into the answer.
///
/// Normally only one of the two is present — a relay that inlines the block is
/// one that emptied `reasoning_content` to do it. When both arrive they are
/// usually the same text double-reported, so an identical pair collapses; a
/// differing pair is kept whole rather than picking a winner and silently losing
/// half the model's plan.
fn merge_reasoning(field: Option<&str>, inlined: Option<&str>) -> Option<String> {
    match (field, inlined.filter(|text| !text.is_empty())) {
        (Some(field), Some(inlined)) if field.trim() != inlined.trim() => {
            Some(format!("{field}\n{inlined}"))
        }
        (Some(field), _) => Some(field.to_string()),
        (None, Some(inlined)) => Some(inlined.to_string()),
        (None, None) => None,
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

fn convert_input(
    input: &Value,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<Value>, String> {
    match input {
        Value::String(text) => Ok(vec![json!({"role": "user", "content": text})]),
        Value::Array(items) => convert_input_items(items, tool_namespaces),
        Value::Object(object) => {
            convert_input_items(&[Value::Object(object.clone())], tool_namespaces)
        }
        Value::Null => Ok(Vec::new()),
        _ => Err("Responses input must be a string, object, or array".to_string()),
    }
}

fn convert_input_items(
    items: &[Value],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<Value>, String> {
    let mut messages = Vec::new();
    let mut pending_tool_calls = Vec::new();
    // IDs of tool calls buffered for the current assistant turn. Outputs with
    // an explicit ID remove that exact entry; a missing ID is repaired only
    // when one unambiguous candidate remains.
    let mut pending_call_ids = Vec::new();
    let mut pending_reasoning = None;
    let mut last_assistant_index = None;

    for item in items {
        convert_input_item(
            item,
            tool_namespaces,
            &mut messages,
            &mut pending_tool_calls,
            &mut pending_call_ids,
            &mut pending_reasoning,
            &mut last_assistant_index,
        )?;
    }

    flush_pending_tool_calls(
        &mut messages,
        &mut pending_tool_calls,
        &mut pending_reasoning,
        &mut last_assistant_index,
    );
    attach_pending_reasoning_to_previous_assistant(
        &mut messages,
        last_assistant_index,
        &mut pending_reasoning,
    );
    ensure_tool_call_reasoning(&mut messages);
    Ok(messages)
}

/// Merge every `system`/`developer` message into a single system message at the
/// head of the list. Codex sends the base instructions plus a separate developer
/// block (skills/plugins), which convert to two back-to-back system messages;
/// some strict Chat gateways behave better with one system message at the front.
/// Mirrors cc-switch's `collapse_system_messages_to_head`.
fn collapse_system_messages_to_head(messages: &mut Vec<Value>) {
    let mut system_chunks: Vec<String> = Vec::new();
    let mut rest: Vec<Value> = Vec::with_capacity(messages.len());
    for message in messages.drain(..) {
        let is_system = message.get("role").and_then(Value::as_str) == Some("system");
        if is_system {
            if let Some(text) = message.get("content").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    system_chunks.push(text.to_string());
                }
                continue;
            }
        }
        rest.push(message);
    }
    let mut out: Vec<Value> = Vec::with_capacity(rest.len() + 1);
    if !system_chunks.is_empty() {
        out.push(json!({"role": "system", "content": system_chunks.join("\n\n")}));
    }
    out.extend(rest);
    *messages = out;
}

/// Chat gateways (DeepSeek/MiMo relays, e.g. v2ex) reject a request with
/// `Message content must not be empty` when any message has empty/whitespace
/// content and no tool_calls to justify it. Codex history can produce such
/// messages (an assistant turn that was pure reasoning, an empty text part, an
/// empty tool output). Drop the empty conversational messages and give empty
/// `tool` results a placeholder (they can't be dropped — they pair with a
/// tool_call_id). Assistant messages that carry tool_calls keep their null
/// content, which is spec-compliant.
fn normalize_empty_message_content(messages: &mut Vec<Value>) {
    messages.retain_mut(|message| {
        let Some(object) = message.as_object_mut() else {
            return true;
        };
        let has_tool_calls = object
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|calls| !calls.is_empty());
        if has_tool_calls {
            return true;
        }
        let content_empty = match object.get("content") {
            None | Some(Value::Null) => true,
            Some(Value::String(text)) => text.trim().is_empty(),
            Some(Value::Array(parts)) => parts.is_empty(),
            _ => false,
        };
        if !content_empty {
            return true;
        }
        if object.get("role").and_then(Value::as_str) == Some("tool") {
            object.insert("content".to_string(), Value::String(" ".to_string()));
            true
        } else {
            false
        }
    });
}

/// MiMo/DeepSeek reject a follow-up turn with `400 The reasoning_content in the
/// thinking mode must be passed back to the API` when an assistant message that
/// carries `tool_calls` has no `reasoning_content`. That happens whenever the
/// upstream reasoning was lost — client-side context compaction, a tool turn the
/// model emitted without reasoning, or history predating reasoning round-trip.
/// Guarantee the field is present (placeholder when the real one is gone) so the
/// conversation keeps working instead of hard-failing.
fn ensure_tool_call_reasoning(messages: &mut [Value]) {
    for message in messages.iter_mut() {
        let Some(object) = message.as_object_mut() else {
            continue;
        };
        let is_assistant = object.get("role").and_then(Value::as_str) == Some("assistant");
        let has_tool_calls = object
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|calls| !calls.is_empty());
        if !is_assistant || !has_tool_calls {
            continue;
        }
        let has_reasoning = object
            .get("reasoning_content")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty());
        if !has_reasoning {
            object.insert(
                "reasoning_content".to_string(),
                Value::String(TOOL_CALL_REASONING_PLACEHOLDER.to_string()),
            );
        }
    }
}

/// Guarantee that *every* assistant message in a converted Chat request carries
/// a non-empty `reasoning_content`, inserting the neutral placeholder when the
/// real reasoning is gone. This is the no-tool-turn counterpart to
/// [`ensure_tool_call_reasoning`]: some thinking upstreams (DeepSeek/MiMo behind
/// new-api) reject a follow-up with `reasoning_content_missing` / code 11155
/// whenever a prior *plain* assistant turn lacks the field.
///
/// Applied only when the account opted in (`force_reasoning_content`) or after
/// the upstream actually returned that error (self-heal), so upstreams that do
/// not want the field never see it. Operates on the final Chat body bytes and
/// returns `Some` only when something changed.
pub(crate) fn force_reasoning_content_on_chat_body(body: &[u8]) -> Option<Vec<u8>> {
    let mut value = serde_json::from_slice::<Value>(body).ok()?;
    let messages = value.get_mut("messages")?.as_array_mut()?;
    let mut changed = false;
    for message in messages.iter_mut() {
        let Some(object) = message.as_object_mut() else {
            continue;
        };
        if object.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let has_reasoning = object
            .get("reasoning_content")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty());
        if has_reasoning {
            continue;
        }
        object.insert(
            "reasoning_content".to_string(),
            Value::String(TOOL_CALL_REASONING_PLACEHOLDER.to_string()),
        );
        changed = true;
    }
    if !changed {
        return None;
    }
    serde_json::to_vec(&value).ok()
}

fn convert_input_item(
    item: &Value,
    tool_namespaces: &ResponsesToolNamespaces,
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    pending_call_ids: &mut Vec<String>,
    pending_reasoning: &mut Option<String>,
    last_assistant_index: &mut Option<usize>,
) -> Result<(), String> {
    let object = item
        .as_object()
        .ok_or_else(|| "Responses input items must be JSON objects".to_string())?;
    match object.get("type").and_then(Value::as_str) {
        Some("function_call") => {
            append_unique_pending_reasoning(pending_reasoning, reasoning_text(item));
            let call = function_call_to_chat(object, tool_namespaces)?;
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                pending_call_ids.push(id.to_string());
            }
            pending_tool_calls.push(call);
        }
        Some("function_call_output") => {
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
            let call_id = tool_result_call_id(object, pending_call_ids, "function_call_output")?;
            messages.push(tool_result_message(
                object,
                "function_call_output",
                &call_id,
            )?);
            *last_assistant_index = None;
        }
        Some("custom_tool_call") | Some("tool_search_call") => {
            append_unique_pending_reasoning(pending_reasoning, reasoning_text(item));
            let call = synthetic_tool_call(object)?;
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                pending_call_ids.push(id.to_string());
            }
            pending_tool_calls.push(call);
        }
        Some("custom_tool_call_output") | Some("tool_search_output") => {
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
            let call_id = tool_result_call_id(object, pending_call_ids, "tool_output")?;
            messages.push(tool_result_message(object, "tool_output", &call_id)?);
            *last_assistant_index = None;
        }
        Some("reasoning") => {
            append_pending_reasoning(pending_reasoning, reasoning_text(item));
        }
        Some("input_text") | Some("input_image") | Some("input_file") | Some("input_audio") => {
            pending_call_ids.clear();
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
            let role = object.get("role").and_then(Value::as_str).unwrap_or("user");
            let message = json!({
                "role": chat_role(role),
                "content": convert_message_content(&Value::Array(vec![item.clone()]))?
            });
            append_message_with_reasoning(
                messages,
                message,
                pending_reasoning,
                last_assistant_index,
            );
        }
        Some("message") | None if object.contains_key("role") || object.contains_key("content") => {
            pending_call_ids.clear();
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
            let content = object
                .get("content")
                .map(convert_message_content)
                .transpose()?
                .unwrap_or(Value::String(String::new()));
            let message = json!({
                "role": chat_role(object.get("role").and_then(Value::as_str).unwrap_or("user")),
                "content": content
            });
            append_message_with_reasoning(
                messages,
                message,
                pending_reasoning,
                last_assistant_index,
            );
        }
        Some("web_search_call")
        | Some("web_search_call_output")
        | Some("file_search_call")
        | Some("file_search_call_output")
        | Some("computer_call")
        | Some("computer_call_output")
        | Some("local_shell_call")
        | Some("local_shell_call_output") => {
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
        }
        // Codex control items with no conversable content.
        Some(_) if is_droppable_codex_control_item(item) => {
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
        }
        // Carries prose, so it is restated rather than dropped.
        Some("agent_message") => {
            pending_call_ids.clear();
            flush_pending_tool_calls(
                messages,
                pending_tool_calls,
                pending_reasoning,
                last_assistant_index,
            );
            let Some(restated) = codex_agent_message_as_message(item) else {
                return Ok(());
            };
            let content = restated
                .get("content")
                .map(convert_message_content)
                .transpose()?
                .unwrap_or(Value::String(String::new()));
            append_message_with_reasoning(
                messages,
                json!({"role": "user", "content": content}),
                pending_reasoning,
                last_assistant_index,
            );
        }
        Some(other) => return Err(format!("Unsupported Responses input item type: {other}")),
        None => return Err("Responses input item is missing role or type".to_string()),
    }
    Ok(())
}

fn flush_pending_tool_calls(
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    pending_reasoning: &mut Option<String>,
    last_assistant_index: &mut Option<usize>,
) {
    if pending_tool_calls.is_empty() {
        return;
    }
    let mut message = json!({
        "role": "assistant",
        "content": Value::Null,
        "tool_calls": std::mem::take(pending_tool_calls)
    });
    attach_reasoning_content(&mut message, pending_reasoning.take());
    *last_assistant_index = Some(messages.len());
    messages.push(message);
}

fn append_message_with_reasoning(
    messages: &mut Vec<Value>,
    mut message: Value,
    pending_reasoning: &mut Option<String>,
    last_assistant_index: &mut Option<usize>,
) {
    let is_assistant = message.get("role").and_then(Value::as_str) == Some("assistant");
    if is_assistant {
        attach_reasoning_content(&mut message, pending_reasoning.take());
        *last_assistant_index = Some(messages.len());
    } else {
        attach_pending_reasoning_to_previous_assistant(
            messages,
            *last_assistant_index,
            pending_reasoning,
        );
        *last_assistant_index = None;
    }
    messages.push(message);
}

fn attach_pending_reasoning_to_previous_assistant(
    messages: &mut [Value],
    last_assistant_index: Option<usize>,
    pending_reasoning: &mut Option<String>,
) {
    let Some(reasoning) = pending_reasoning.take() else {
        return;
    };
    let Some(message) = last_assistant_index.and_then(|index| messages.get_mut(index)) else {
        return;
    };
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return;
    }
    attach_reasoning_content(message, Some(reasoning));
}

fn attach_reasoning_content(message: &mut Value, reasoning: Option<String>) {
    let Some(reasoning) = reasoning.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    let Some(object) = message.as_object_mut() else {
        return;
    };
    match object.get_mut("reasoning_content") {
        Some(Value::String(existing)) if !existing.is_empty() => {
            existing.push_str("\n\n");
            existing.push_str(&reasoning);
        }
        _ => {
            object.insert("reasoning_content".to_string(), Value::String(reasoning));
        }
    }
}

fn append_pending_reasoning(pending_reasoning: &mut Option<String>, reasoning: Option<String>) {
    let Some(reasoning) = reasoning.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    match pending_reasoning {
        Some(existing) if !existing.is_empty() => {
            existing.push_str("\n\n");
            existing.push_str(&reasoning);
        }
        _ => *pending_reasoning = Some(reasoning),
    }
}

fn append_unique_pending_reasoning(
    pending_reasoning: &mut Option<String>,
    reasoning: Option<String>,
) {
    let Some(reasoning) = reasoning else {
        return;
    };
    let reasoning = reasoning.trim();
    if reasoning.is_empty() {
        return;
    }
    match pending_reasoning {
        Some(existing) if existing.contains(reasoning) => {}
        Some(existing) if !existing.is_empty() => {
            existing.push_str("\n\n");
            existing.push_str(reasoning);
        }
        _ => *pending_reasoning = Some(reasoning.to_string()),
    }
}

fn reasoning_text(item: &Value) -> Option<String> {
    // Restored/inline plaintext reasoning (e.g. from the reasoning cache) wins:
    // it carries the model's actual chain-of-thought for this tool-call turn.
    for key in ["reasoning_content", "reasoning"] {
        if let Some(text) = item.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    // Responses providers differ on where they expose replayable plaintext:
    // `summary` is normally a part array, while some gateways use a string or
    // put `reasoning_text` parts under `content`. Match WorkBuddy's compatibility
    // shape so either representation reaches Chat's `reasoning_content`.
    for key in ["summary", "content"] {
        if let Some(text) = reasoning_field_text(item.get(key)) {
            return Some(text);
        }
    }
    None
}

fn reasoning_field_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match value {
        Value::String(text) => {
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_string())
        }
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| match part {
                    Value::String(text) => Some(text.as_str()),
                    Value::Object(object) => {
                        let part_type = object.get("type").and_then(Value::as_str)?;
                        matches!(
                            part_type,
                            "summary_text"
                                | "reasoning_text"
                                | "input_text"
                                | "output_text"
                                | "text"
                        )
                        .then(|| object.get("text").and_then(Value::as_str))
                        .flatten()
                    }
                    _ => None,
                })
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn function_call_to_chat(
    object: &Map<String, Value>,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Value, String> {
    let call_id = object
        .get("call_id")
        .or_else(|| object.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Responses function_call is missing call_id".to_string())?;
    let name = required_string(object, "name", "function_call")?;
    let namespace = object.get("namespace").and_then(Value::as_str);
    // Tools went upstream under their namespace-qualified name. A client that
    // replays a function_call without the `namespace` field would otherwise
    // send the bare name, which no longer matches any declared tool — so
    // re-qualify it from the namespace map built at request time.
    let name = match namespace.filter(|value| !value.trim().is_empty()) {
        Some(namespace) => super::common::qualified_response_tool_name(namespace, name),
        None => match super::common::response_tool_namespace(name, tool_namespaces) {
            // Already qualified (the map keys both spellings) — leave it alone.
            Some(_) if tool_namespaces.contains_key(name) && name.contains("__") => {
                name.to_string()
            }
            Some(namespace) => super::common::qualified_response_tool_name(namespace, name),
            None => name.to_string(),
        },
    };
    let arguments = object
        .get("arguments")
        .map(stringify_content)
        .transpose()?
        .unwrap_or_else(|| "{}".to_string());
    Ok(json!({
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments}
    }))
}

fn synthetic_tool_call(object: &Map<String, Value>) -> Result<Value, String> {
    let call_id = object
        .get("call_id")
        .or_else(|| object.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Responses tool call is missing call_id".to_string())?;
    let item_type = object.get("type").and_then(Value::as_str).unwrap_or("");
    let name = if item_type == "tool_search_call" {
        "tool_search"
    } else {
        required_string(object, "name", "custom_tool_call")?
    };
    let arguments = if item_type == "custom_tool_call" {
        json!({"input": object.get("input").cloned().unwrap_or(Value::String(String::new()))})
    } else {
        object
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}))
    };
    Ok(json!({
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string())}
    }))
}

fn tool_result_call_id(
    object: &Map<String, Value>,
    pending_call_ids: &mut Vec<String>,
    label: &str,
) -> Result<String, String> {
    if let Some(call_id) = object
        .get("call_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(index) = pending_call_ids
            .iter()
            .position(|pending| pending == call_id)
        {
            pending_call_ids.remove(index);
        }
        return Ok(call_id.to_string());
    }

    if pending_call_ids.len() == 1 {
        return Ok(pending_call_ids.pop().expect("length checked"));
    }

    Err(format!("Responses {label} is missing call_id"))
}

fn tool_result_message(
    object: &Map<String, Value>,
    _label: &str,
    call_id: &str,
) -> Result<Value, String> {
    let output = object
        .get("output")
        .or_else(|| object.get("result"))
        .map(stringify_content)
        .transpose()?
        .unwrap_or_default();
    Ok(json!({"role": "tool", "tool_call_id": call_id, "content": output}))
}

fn chat_role(role: &str) -> &'static str {
    match role {
        "system" | "developer" => "system",
        "assistant" => "assistant",
        "tool" => "tool",
        _ => "user",
    }
}

fn convert_message_content(content: &Value) -> Result<Value, String> {
    match content {
        Value::String(text) => Ok(Value::String(text.clone())),
        Value::Array(parts) => {
            let mut converted = Vec::new();
            for part in parts {
                let object = part
                    .as_object()
                    .ok_or_else(|| "Responses content parts must be objects".to_string())?;
                match object.get("type").and_then(Value::as_str) {
                    Some("input_text" | "output_text" | "text") => {
                        if let Some(text) = object.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                converted.push(json!({"type": "text", "text": text}));
                            }
                        }
                    }
                    Some("refusal") => {
                        if let Some(text) = object.get("refusal").and_then(Value::as_str) {
                            if !text.is_empty() {
                                converted.push(json!({"type": "text", "text": text}));
                            }
                        }
                    }
                    Some("input_image") => {
                        if let Some(image_url) = object.get("image_url") {
                            let image_url = if image_url.is_object() {
                                image_url.clone()
                            } else {
                                json!({ "url": image_url.as_str().unwrap_or_default() })
                            };
                            converted.push(json!({
                                "type": "image_url",
                                "image_url": image_url
                            }));
                        }
                    }
                    Some(_) | None => {}
                }
            }
            if converted.len() == 1
                && converted[0].get("type").and_then(Value::as_str) == Some("text")
            {
                return Ok(converted[0]
                    .get("text")
                    .cloned()
                    .unwrap_or_else(|| Value::String(String::new())));
            }
            if converted.is_empty() {
                return Ok(Value::String(String::new()));
            }
            Ok(Value::Array(converted))
        }
        Value::Null => Ok(Value::String(String::new())),
        _ => Err("Responses message content must be a string or array".to_string()),
    }
}

fn convert_tools(tools: &Value) -> Result<Value, String> {
    let tools = flatten_responses_function_tools(tools)?;
    let mut converted = Vec::with_capacity(tools.len());
    for object in tools {
        let name = required_string(&object, "name", "function tool")?;
        let mut function = Map::new();
        function.insert("name".to_string(), Value::String(name.to_string()));
        if let Some(description) = object.get("description") {
            function.insert("description".to_string(), description.clone());
        }
        let parameters = if object.get("type").and_then(Value::as_str) == Some("custom") {
            json!({
                "type": "object",
                "properties": {
                    "input": {
                        "type": "string",
                        "description": "Raw string input for the original Responses custom tool."
                    }
                },
                "required": ["input"]
            })
        } else {
            response_tool_parameters(&object)
        };
        function.insert("parameters".to_string(), parameters);
        if let Some(strict) = object.get("strict") {
            function.insert("strict".to_string(), strict.clone());
        }
        converted.push(json!({"type": "function", "function": function}));
    }
    Ok(Value::Array(converted))
}

fn add_agent_tool_continuation_instruction(result: &mut Map<String, Value>) {
    let Some(messages) = result.get_mut("messages").and_then(Value::as_array_mut) else {
        return;
    };
    if messages.iter().any(|message| {
        message
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains(CHAT_AGENT_CONTINUATION_INSTRUCTION))
    }) {
        return;
    }
    if let Some(index) = messages.iter().position(|message| {
        message.get("role").and_then(Value::as_str) == Some("system")
            && message.get("content").and_then(Value::as_str).is_some()
    }) {
        let mut text = messages[index]["content"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if !text.trim().is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(CHAT_AGENT_CONTINUATION_INSTRUCTION);
        messages[index]["content"] = Value::String(text);
        return;
    }
    messages.insert(
        0,
        json!({
            "role": "system",
            "content": CHAT_AGENT_CONTINUATION_INSTRUCTION
        }),
    );
}

fn convert_tool_choice(tool_choice: &Value, has_tools: bool) -> Result<Option<Value>, String> {
    let Some(object) = tool_choice.as_object() else {
        if !has_tools {
            return Ok(match tool_choice.as_str() {
                Some("required") => Some(json!("auto")),
                _ => None,
            });
        }
        return Ok(Some(tool_choice.clone()));
    };
    match object.get("type").and_then(Value::as_str) {
        Some("function" | "custom") => {
            let name = required_string(object, "name", "function tool choice")?;
            if has_tools {
                Ok(Some(
                    json!({"type": "function", "function": {"name": name}}),
                ))
            } else {
                Ok(Some(json!("auto")))
            }
        }
        Some(other) if is_responses_builtin_tool_type(other) => {
            Ok(has_tools.then(|| json!("auto")))
        }
        Some(other) => Err(format!("Unsupported Responses tool choice type: {other}")),
        None => Ok(has_tools.then(|| tool_choice.clone())),
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

#[cfg(test)]
mod tests {
    use super::{
        chat_response_to_responses, force_reasoning_content_on_chat_body,
        responses_request_to_chat, TOOL_CALL_REASONING_PLACEHOLDER,
    };
    use serde_json::Value;
    use std::collections::BTreeMap;

    /// One response must report one creation time. The streaming path used to
    /// read the clock again for the terminal event, so a stream that started
    /// at 1790134800 could complete at `created_at: 1790134801` — a stream
    /// contradicting its own opening frame, and a wall-clock-dependent test
    /// failure roughly one run in five.
    #[test]
    fn every_event_of_one_streamed_response_shares_a_single_created_at() {
        let body = concat!(
            "data: {\"id\":\"cc-1\",\"model\":\"deepseek-chat\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"cc-1\",\"model\":\"deepseek-chat\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n"
        );

        let converted = chat_response_to_responses(
            200,
            Some("text/event-stream"),
            body.as_bytes(),
            &BTreeMap::new(),
        )
        .expect("sse conversion");
        let text = String::from_utf8_lossy(&converted.body);

        let stamps: Vec<i64> = text
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .filter_map(|payload| serde_json::from_str::<Value>(payload).ok())
            .filter_map(|event| {
                event
                    .pointer("/response/created_at")
                    .and_then(Value::as_i64)
            })
            .collect();

        assert!(
            stamps.len() >= 3,
            "expected created/in_progress/completed frames, got {stamps:?}"
        );
        assert!(
            stamps.iter().all(|stamp| *stamp == stamps[0]),
            "one response must not report several creation times: {stamps:?}"
        );
    }

    #[test]
    fn force_reasoning_fills_missing_reasoning_on_plain_assistant_turns() {
        // A no-tool assistant turn without reasoning_content is exactly the
        // 11155 case. The forcer must add the placeholder without touching turns
        // that already carry real reasoning, and never touch user/system turns.
        let body = serde_json::json!({
            "model": "deepseek-reasoner",
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "first answer"},
                {"role": "user", "content": "again"},
                {"role": "assistant", "content": "second", "reasoning_content": "kept"}
            ]
        });
        let forced = force_reasoning_content_on_chat_body(body.to_string().as_bytes())
            .expect("a plain assistant turn was missing reasoning_content");
        let value: Value = serde_json::from_slice(&forced).unwrap();
        let messages = value["messages"].as_array().unwrap();
        assert_eq!(
            messages[0].get("reasoning_content"),
            None,
            "system untouched"
        );
        assert_eq!(messages[1].get("reasoning_content"), None, "user untouched");
        assert_eq!(
            messages[2]["reasoning_content"].as_str(),
            Some(TOOL_CALL_REASONING_PLACEHOLDER),
            "missing reasoning filled with placeholder",
        );
        assert_eq!(
            messages[4]["reasoning_content"].as_str(),
            Some("kept"),
            "real reasoning preserved",
        );
    }

    #[test]
    fn force_reasoning_is_a_noop_when_every_assistant_turn_already_has_reasoning() {
        let body = serde_json::json!({
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "a", "reasoning_content": "r"}
            ]
        });
        assert!(
            force_reasoning_content_on_chat_body(body.to_string().as_bytes()).is_none(),
            "no change means no rewrite so callers can skip the retry",
        );
    }

    fn to_responses(status: u16, content_type: &str, body: &str) -> String {
        String::from_utf8(
            chat_response_to_responses(
                status,
                Some(content_type),
                body.as_bytes(),
                &BTreeMap::new(),
            )
            .expect("upstream body must convert")
            .body,
        )
        .expect("converted body must be UTF-8")
    }

    /// Relays with a "thinking to content" switch (New API's
    /// `thinking_to_content` and the forks that copied it) splice the reasoning
    /// into `content` wrapped in tags. Forwarding that verbatim is what makes
    /// Codex print `<thinking>…</thinking>` in the middle of the transcript.
    #[test]
    fn inlined_thinking_block_becomes_reasoning_not_answer_text() {
        let upstream = serde_json::json!({
            "id": "cc-1",
            "model": "deepseek-reasoner",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "<thinking>Checking the key mapping.</thinking>\n\nThe key is unset."
                },
                "finish_reason": "stop"
            }]
        });

        let converted: Value = serde_json::from_str(&to_responses(
            200,
            "application/json",
            &upstream.to_string(),
        ))
        .expect("converted body must be JSON");

        assert_eq!(
            converted["output_text"], "The key is unset.",
            "the answer must not carry the tags"
        );
        assert_eq!(converted["output"][0]["type"], "reasoning");
        assert_eq!(
            converted["output"][0]["summary"][0]["text"],
            "Checking the key mapping."
        );
        let rendered = converted.to_string();
        assert!(
            !rendered.contains("<thinking>"),
            "no tag may survive anywhere in the response: {rendered}"
        );
    }

    /// The streamed path is the one users actually hit, and the tag routinely
    /// straddles two `content` deltas.
    #[test]
    fn inlined_thinking_is_rerouted_across_streamed_delta_boundaries() {
        let upstream = concat!(
            "data: {\"id\":\"cc-2\",\"model\":\"mimo\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"<think\"}}]}\n\n",
            "data: {\"id\":\"cc-2\",\"model\":\"mimo\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ing>Weighing it.</think\"}}]}\n\n",
            "data: {\"id\":\"cc-2\",\"model\":\"mimo\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ing>Use the cache.\"}}]}\n\n",
            "data: {\"id\":\"cc-2\",\"model\":\"mimo\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n",
        );

        let output = to_responses(200, "text/event-stream", upstream);

        assert!(
            output.contains("event: response.reasoning_summary_text.delta"),
            "the block must travel on the reasoning channel: {output}"
        );
        assert!(
            output.contains("\"delta\":\"Weighing it.\""),
            "reasoning must arrive whole, not one character per event: {output}"
        );
        assert!(
            output.contains("\"delta\":\"Use the cache.\""),
            "the answer must still reach the text channel: {output}"
        );
        assert!(
            !output.contains("<think"),
            "no tag may reach the client: {output}"
        );
    }

    /// The regression guard for the rewrite itself: an upstream that never
    /// inlines anything must stream byte-for-byte what it always did.
    #[test]
    fn ordinary_streamed_text_is_untouched() {
        let upstream = concat!(
            "data: {\"id\":\"cc-3\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Here \"}}]}\n\n",
            "data: {\"id\":\"cc-3\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"you go.\"}}]}\n\n",
            "data: {\"id\":\"cc-3\",\"model\":\"gpt-4o\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n",
        );

        let output = to_responses(200, "text/event-stream", upstream);

        assert!(output.contains("\"delta\":\"Here \""));
        assert!(output.contains("\"delta\":\"you go.\""));
        assert!(
            !output.contains("reasoning_summary"),
            "a turn with no reasoning must not grow a reasoning item: {output}"
        );
    }

    /// A turn that only quotes the tags is an answer, not a thought.
    #[test]
    fn tags_inside_the_answer_stay_in_the_answer() {
        let upstream = serde_json::json!({
            "id": "cc-4",
            "model": "gpt-4o",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Wrap the scratchpad in <thinking>…</thinking> like so."
                },
                "finish_reason": "stop"
            }]
        });

        let converted: Value = serde_json::from_str(&to_responses(
            200,
            "application/json",
            &upstream.to_string(),
        ))
        .expect("converted body must be JSON");

        assert_eq!(
            converted["output_text"], "Wrap the scratchpad in <thinking>…</thinking> like so.",
            "quoting the tags must not be mistaken for reasoning"
        );
    }

    /// Tools go upstream under their namespace-qualified name. A client that
    /// replays a function_call without the `namespace` field must still produce
    /// the qualified name, or the transcript references a tool that was never
    /// declared and strict gateways reject it.
    #[test]
    fn replayed_function_call_is_requalified_from_the_namespace_map() {
        let body = serde_json::json!({
            "model": "gpt-4o",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "go"}]},
                // Replayed by the client with the namespace field dropped.
                {"type": "function_call", "call_id": "c1", "name": "lookup", "arguments": "{}"}
            ],
            "tools": [{
                "type": "namespace",
                "name": "database",
                "tools": [{
                    "type": "function",
                    "name": "lookup",
                    "parameters": {"type": "object", "properties": {}}
                }]
            }]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        let declared = converted["tools"][0]["function"]["name"]
            .as_str()
            .expect("declared tool name");
        assert_eq!(declared, "database__lookup");

        let replayed = converted["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .find_map(|message| message.get("tool_calls"))
            .and_then(|calls| calls.get(0))
            .and_then(|call| call["function"]["name"].as_str())
            .expect("replayed tool call");

        assert_eq!(
            replayed, declared,
            "the replayed call must match the declared tool name: {converted}"
        );
    }

    /// A call that already carries its qualified name must not be double-prefixed.
    #[test]
    fn already_qualified_function_call_is_not_double_prefixed() {
        let body = serde_json::json!({
            "model": "gpt-4o",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "go"}]},
                {"type": "function_call", "call_id": "c1", "name": "database__lookup", "arguments": "{}"}
            ],
            "tools": [{
                "type": "namespace",
                "name": "database",
                "tools": [{
                    "type": "function",
                    "name": "lookup",
                    "parameters": {"type": "object", "properties": {}}
                }]
            }]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        let replayed = converted["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .find_map(|message| message.get("tool_calls"))
            .and_then(|calls| calls.get(0))
            .and_then(|call| call["function"]["name"].as_str())
            .expect("replayed tool call");

        assert_eq!(replayed, "database__lookup", "converted={converted}");
    }

    /// A tool with no namespace must pass through untouched.
    #[test]
    fn unnamespaced_function_call_is_unchanged() {
        let body = serde_json::json!({
            "model": "gpt-4o",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "go"}]},
                {"type": "function_call", "call_id": "c1", "name": "lookup", "arguments": "{}"}
            ],
            "tools": [{
                "type": "function",
                "name": "lookup",
                "parameters": {"type": "object", "properties": {}}
            }]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        let replayed = converted["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .find_map(|message| message.get("tool_calls"))
            .and_then(|calls| calls.get(0))
            .and_then(|call| call["function"]["name"].as_str())
            .expect("replayed tool call");

        assert_eq!(replayed, "lookup", "converted={converted}");
    }

    /// WorkBuddy2API-Hub v1.4.0 also accepts reasoning history where
    /// `summary` is a string or the plaintext rides in `content` parts. Our
    /// converter must recover both forms before attaching them to the next
    /// assistant/tool-call turn.
    #[test]
    fn extracts_reasoning_text_from_string_summary_and_content_parts() {
        let body = serde_json::json!({
            "model": "deepseek-reasoner",
            "input": [
                {"type": "reasoning", "summary": "summary as a string"},
                {"type": "function_call", "call_id": "call_1", "name": "first", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "one"},
                {
                    "type": "reasoning",
                    "summary": [],
                    "content": [
                        {"type": "reasoning_text", "text": "content part one"},
                        {"type": "reasoning_text", "text": "content part two"}
                    ]
                },
                {"type": "function_call", "call_id": "call_2", "name": "second", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "call_2", "output": "two"}
            ],
            "tools": [
                {"type": "function", "name": "first", "parameters": {"type": "object", "properties": {}}},
                {"type": "function", "name": "second", "parameters": {"type": "object", "properties": {}}}
            ]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();
        let assistant = converted["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .filter(|message| message["role"] == "assistant")
            .collect::<Vec<_>>();

        assert_eq!(assistant.len(), 2);
        assert_eq!(assistant[0]["reasoning_content"], "summary as a string");
        assert_eq!(
            assistant[1]["reasoning_content"],
            "content part one\ncontent part two"
        );
    }

    /// Streamed chat responses omit usage unless this is set, which would leave
    /// every streamed turn reporting zero tokens.
    #[test]
    fn streaming_requests_opt_into_usage_reporting() {
        let body = serde_json::json!({
            "model": "gpt-4o",
            "stream": true,
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        assert_eq!(converted["stream_options"]["include_usage"], true);
    }

    /// Switching models mid-conversation (e.g. gpt6 -> glm-5.3) can replay a
    /// `function_call_output` whose `call_id` was dropped. The bridge must recover
    /// it from the preceding `function_call` so the chat `tool_call_id` still
    /// matches the assistant `tool_calls` id, instead of failing the whole
    /// request with "Responses function_call_output is missing call_id".
    #[test]
    fn recovers_call_id_from_function_call_when_output_lacks_it() {
        let body = serde_json::json!({
            "model": "glm-5.3",
            "input": [
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{\"q\":\"x\"}"},
                {"type": "function_call_output", "output": "42"}
            ]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();

        let messages = converted["messages"].as_array().expect("messages");
        let assistant = messages
            .iter()
            .find(|message| message["role"] == "assistant")
            .expect("assistant message");
        assert_eq!(assistant["tool_calls"][0]["id"], "call_1");
        let tool = messages
            .iter()
            .find(|message| message["role"] == "tool")
            .expect("tool message");
        assert_eq!(
            tool["tool_call_id"], "call_1",
            "recovered call_id must match the assistant tool_calls id: {converted}"
        );
        assert_eq!(tool["content"], "42");
    }

    #[test]
    fn matches_missing_output_to_the_only_unmatched_call_after_explicit_out_of_order_output() {
        let body = serde_json::json!({
            "model": "glm-5.3",
            "input": [
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call", "call_id": "call_2", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "call_2", "output": "result-2"},
                {"type": "function_call_output", "output": "result-1"}
            ]
        });

        let converted: Value = serde_json::from_slice(
            &responses_request_to_chat(&serde_json::to_vec(&body).unwrap()).unwrap(),
        )
        .unwrap();
        let tools = converted["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| message["role"] == "tool")
            .collect::<Vec<_>>();
        assert_eq!(tools[0]["tool_call_id"], "call_2");
        assert_eq!(tools[1]["tool_call_id"], "call_1");
    }

    #[test]
    fn does_not_guess_missing_output_when_multiple_calls_remain_unmatched() {
        let body = serde_json::json!({
            "model": "glm-5.3",
            "input": [
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call", "call_id": "call_2", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "output": "ambiguous"}
            ]
        });

        let error = responses_request_to_chat(&serde_json::to_vec(&body).unwrap())
            .expect_err("ambiguous missing call_id must not be guessed");
        assert!(
            error.contains("function_call_output is missing call_id"),
            "{error}"
        );
    }
}
