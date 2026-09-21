use super::common::{response_tool_name, response_tool_namespace, ResponsesToolNamespaces};
use super::TransformedBridgeResponse;
use serde_json::{Map, Value};

pub(super) fn responses_request_to_responses(body: &[u8]) -> Result<Vec<u8>, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Responses request JSON is invalid: {error}"))?;
    let mut object = value
        .as_object()
        .cloned()
        .ok_or_else(|| "Responses request body must be a JSON object".to_string())?;

    if let Some(tools) = object.get("tools") {
        let flattened = flatten_native_responses_tools(tools, None)?;
        let tools = flattened
            .into_iter()
            .map(normalize_response_tool)
            .map(Value::Object)
            .collect();
        object.insert("tools".to_string(), Value::Array(tools));
    }

    // Repair `function_call_output` (and sibling custom/tool-search output) items
    // whose `call_id` was dropped on the wire — typical after a model switch
    // replays history into a strict Responses upstream that rejects the request
    // with "... function_call_output ... is missing call_id". Pairing each output
    // with the preceding `function_call` by order produces a call_id that matches
    // the assistant `tool_calls` id the upstream expects.
    if let Some(input) = object.get_mut("input") {
        repair_missing_output_call_ids(input);
    }

    if object.get("store").and_then(Value::as_bool) == Some(false) {
        clear_unstored_reasoning_ids(&mut object);
    }

    serde_json::to_vec(&Value::Object(object))
        .map_err(|error| format!("Could not serialize Responses request: {error}"))
}

fn clear_unstored_reasoning_ids(object: &mut Map<String, Value>) {
    let Some(input) = object.get_mut("input").and_then(Value::as_array_mut) else {
        return;
    };
    for item in input {
        let Some(item) = item.as_object_mut() else {
            continue;
        };
        let has_ciphertext = item
            .get("encrypted_content")
            .and_then(Value::as_str)
            .is_some_and(|content| !content.trim().is_empty());
        if item.get("type").and_then(Value::as_str) == Some("reasoning") && !has_ciphertext {
            // Do not drop the summary or content just because an upstream cannot
            // resolve this ID. Full ciphertext-shape cleanup is account-opt-in.
            item.remove("id");
        }
    }
}

fn flatten_native_responses_tools(
    tools: &Value,
    namespace: Option<&str>,
) -> Result<Vec<Map<String, Value>>, String> {
    let tools = tools
        .as_array()
        .ok_or_else(|| "Responses tools must be an array".to_string())?;
    let mut flattened = Vec::new();
    for tool in tools {
        let object = tool
            .as_object()
            .ok_or_else(|| "Responses tool entries must be objects".to_string())?;
        let tool_type = object
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("function");
        if tool_type == "namespace" {
            let nested_namespace = object
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| object.get("namespace").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .or(namespace);
            if let Some(nested_tools) = object.get("tools") {
                flattened.extend(flatten_native_responses_tools(
                    nested_tools,
                    nested_namespace,
                )?);
            }
            continue;
        }

        let mut function = object.clone();
        if tool_type == "function" {
            if let (Some(namespace), Some(name)) = (
                namespace.filter(|value| !value.is_empty()),
                object.get("name").and_then(Value::as_str),
            ) {
                function.insert(
                    "name".to_string(),
                    Value::String(super::common::qualified_response_tool_name(namespace, name)),
                );
            }
            function = normalize_response_tool(function);
        }
        flattened.push(function);
    }
    Ok(flattened)
}

fn repair_missing_output_call_ids(input: &mut Value) -> usize {
    let mut pending_call_ids = Vec::new();
    let mut repaired = 0usize;
    match input {
        Value::Array(items) => {
            for item in items.iter_mut() {
                repair_input_item_call_id(item, &mut pending_call_ids, &mut repaired);
            }
        }
        _ => repair_input_item_call_id(input, &mut pending_call_ids, &mut repaired),
    }
    repaired
}

fn repair_input_item_call_id(
    item: &mut Value,
    pending_call_ids: &mut Vec<String>,
    repaired: &mut usize,
) {
    let Some(object) = item.as_object_mut() else {
        return;
    };
    let item_type = object.get("type").and_then(Value::as_str);
    match item_type {
        Some("function_call") | Some("custom_tool_call") | Some("tool_search_call") => {
            let id = object
                .get("call_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_default();
            pending_call_ids.push(id);
        }
        Some("message") | Some("agent_message") => {
            pending_call_ids.clear();
        }
        Some("function_call_output")
        | Some("custom_tool_call_output")
        | Some("tool_search_output") => {
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
            } else if pending_call_ids.len() == 1 {
                if let Some(call_id) = pending_call_ids.pop() {
                    if !call_id.is_empty() {
                        object.insert("call_id".to_string(), Value::String(call_id));
                        *repaired += 1;
                    }
                }
            }
        }
        _ => {}
    }
}

pub(super) fn responses_response_to_responses(
    status: u16,
    content_type: Option<&str>,
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<TransformedBridgeResponse, String> {
    if !(200..300).contains(&status) || tool_namespaces.is_empty() {
        return Ok(TransformedBridgeResponse {
            body: body.to_vec(),
            content_type: content_type.map(str::to_string),
        });
    }

    if content_type.is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        || looks_like_sse(body)
    {
        return Ok(TransformedBridgeResponse {
            body: responses_sse_to_responses(body, tool_namespaces)?,
            content_type: Some("text/event-stream".to_string()),
        });
    }

    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Responses response JSON is invalid: {error}"))?;
    let value = restore_tool_namespaces(value, tool_namespaces);
    Ok(TransformedBridgeResponse {
        body: serde_json::to_vec(&value)
            .map_err(|error| format!("Could not serialize Responses response: {error}"))?,
        content_type: Some("application/json".to_string()),
    })
}

fn normalize_response_tool(mut tool: Map<String, Value>) -> Map<String, Value> {
    if !tool.contains_key("parameters") {
        if let Some(input_schema) = tool.remove("inputSchema") {
            tool.insert("parameters".to_string(), input_schema);
        }
    } else {
        tool.remove("inputSchema");
    }
    tool
}

fn restore_tool_namespaces(mut value: Value, tool_namespaces: &ResponsesToolNamespaces) -> Value {
    match &mut value {
        Value::Array(items) => {
            for item in items {
                *item = restore_tool_namespaces(item.take(), tool_namespaces);
            }
        }
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("function_call") {
                if let Some(name) = object.get("name").and_then(Value::as_str) {
                    if let Some(namespace) = response_tool_namespace(name, tool_namespaces) {
                        let response_name = response_tool_name(name, tool_namespaces).to_string();
                        object.insert("name".to_string(), Value::String(response_name));
                        object.insert(
                            "namespace".to_string(),
                            Value::String(namespace.to_string()),
                        );
                    }
                }
            }
            for item in object.values_mut() {
                let current = item.take();
                *item = restore_tool_namespaces(current, tool_namespaces);
            }
        }
        _ => {}
    }
    value
}

fn responses_sse_to_responses(
    body: &[u8],
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Vec<u8>, String> {
    let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
    let mut output = String::new();
    for block in text.split("\n\n") {
        let Some(converted) = responses_sse_block_to_responses(block, tool_namespaces)? else {
            continue;
        };
        output.push_str(&converted);
        output.push_str("\n\n");
    }
    Ok(output.into_bytes())
}

/// Converts one already-framed SSE block for the Responses → Responses bridge.
///
/// `block` arrives without its `\n\n` terminator and the result is returned the
/// same way. [`responses_sse_to_responses`] drives this block by block, so the
/// buffered path and the streamed path emit identical bytes and cannot drift.
///
/// Returns `None` for a block with nothing to forward — a blank keep-alive.
pub(super) fn responses_sse_block_to_responses(
    block: &str,
    tool_namespaces: &ResponsesToolNamespaces,
) -> Result<Option<String>, String> {
    if block.trim().is_empty() {
        return Ok(None);
    }
    let data = block
        .lines()
        .filter_map(|line| line.trim().strip_prefix("data:").map(str::trim))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return Ok(Some(block.to_string()));
    }
    // This path only rewrites tool names, so a record we cannot parse is
    // forwarded untouched instead of failing the whole stream.
    let Ok(value) = serde_json::from_str::<Value>(&data) else {
        return Ok(Some(block.to_string()));
    };
    let mut output = String::new();
    for line in block
        .lines()
        .filter(|line| !line.trim().starts_with("data:"))
    {
        output.push_str(line);
        output.push('\n');
    }
    output.push_str("data: ");
    output.push_str(
        &serde_json::to_string(&restore_tool_namespaces(value, tool_namespaces))
            .map_err(|error| format!("Could not serialize Responses SSE data: {error}"))?,
    );
    Ok(Some(output))
}

fn looks_like_sse(body: &[u8]) -> bool {
    String::from_utf8_lossy(body)
        .lines()
        .any(|line| line.trim_start().starts_with("data:"))
}

#[cfg(test)]
mod tests {
    use super::responses_request_to_responses;
    use serde_json::{json, Value};

    fn converted_request(body: Value) -> Value {
        let body = serde_json::to_vec(&body).expect("request json");
        let converted = responses_request_to_responses(&body).expect("converted request");
        serde_json::from_slice(&converted).expect("converted json")
    }

    #[test]
    fn store_false_preserves_reasoning_summary_without_orphan_id() {
        let converted = converted_request(json!({
            "model": "gpt-5",
            "store": false,
            "input": [
                {
                    "type": "reasoning",
                    "id": "rs_chatcmpl-opc-2537eab80ac672361146",
                    "summary": [{"type": "summary_text", "text": "thinking"}]
                },
                {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "continue"}]
                }
            ]
        }));

        assert_eq!(
            converted["input"],
            json!([
                {"type": "reasoning", "summary": [{"type": "summary_text", "text": "thinking"}]},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "continue"}]}
            ])
        );
    }

    #[test]
    fn store_false_keeps_replayable_encrypted_reasoning() {
        let reasoning = json!({
            "type": "reasoning",
            "id": "rs_real",
            "encrypted_content": "encrypted",
            "summary": []
        });
        let converted = converted_request(json!({
            "model": "gpt-5",
            "store": false,
            "input": [reasoning.clone()]
        }));

        assert_eq!(converted["input"], json!([reasoning]));
    }

    #[test]
    fn store_true_keeps_reasoning_item_references() {
        let reasoning = json!({
            "type": "reasoning",
            "id": "rs_stored",
            "summary": []
        });
        let converted = converted_request(json!({
            "model": "gpt-5",
            "store": true,
            "input": [reasoning.clone()]
        }));

        assert_eq!(converted["input"], json!([reasoning]));
    }

    /// Model switch into a Responses upstream can replay a
    /// `function_call_output` whose `call_id` was dropped; repair it from the
    /// preceding `function_call` so the upstream's
    /// "... function_call_output ... is missing call_id" check passes.
    #[test]
    fn repairs_function_call_output_missing_call_id_from_paired_function_call() {
        let converted = converted_request(json!({
            "model": "5.6",
            "store": false,
            "input": [
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "output": "42"}
            ]
        }));
        assert_eq!(
            converted["input"][1]["call_id"], "call_1",
            "converted={converted}"
        );
        assert_eq!(converted["input"][1]["output"], "42");
    }

    #[test]
    fn matches_missing_output_to_the_only_unmatched_call_after_explicit_out_of_order_output() {
        let converted = converted_request(json!({
            "model": "gpt-5",
            "input": [
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call", "call_id": "call_2", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "call_2", "output": "result-2"},
                {"type": "function_call_output", "output": "result-1"}
            ]
        }));
        assert_eq!(
            converted["input"][3]["call_id"], "call_1",
            "converted={converted}"
        );
    }

    #[test]
    fn leaves_missing_output_unmodified_when_multiple_calls_remain_unmatched() {
        let converted = converted_request(json!({
            "model": "gpt-5",
            "input": [
                {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call", "call_id": "call_2", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "output": "ambiguous"}
            ]
        }));
        assert!(
            converted["input"][2].get("call_id").is_none(),
            "converted={converted}"
        );
    }
}
