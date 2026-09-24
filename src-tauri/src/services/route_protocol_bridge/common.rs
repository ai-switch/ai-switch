use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) type ResponsesToolNamespaces = BTreeMap<String, String>;

pub(super) fn responses_reasoning_effort(object: &Map<String, Value>) -> Option<String> {
    let effort = object
        .get("reasoning")
        .and_then(Value::as_object)
        .and_then(|reasoning| reasoning.get("effort"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|effort| !effort.is_empty())?
        .to_ascii_lowercase();
    (effort != "none").then_some(effort)
}

pub(super) fn chat_reasoning_effort(effort: &str) -> Option<&'static str> {
    match effort.trim().to_ascii_lowercase().as_str() {
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" | "xhigh" | "max" | "ultra" => Some("high"),
        _ => None,
    }
}

pub(super) fn anthropic_thinking_budget(effort: &str, max_tokens: Option<i64>) -> Option<i64> {
    let requested = match effort.trim().to_ascii_lowercase().as_str() {
        "low" => 2_048,
        "medium" => 8_192,
        "high" => 16_384,
        "xhigh" => 32_768,
        "max" => 65_536,
        "ultra" => 131_072,
        _ => return None,
    };
    let budget = max_tokens.map_or(requested, |max_tokens| {
        requested.min(max_tokens.saturating_sub(1))
    });
    (budget >= 1_024).then_some(budget)
}

pub(super) fn gemini_thinking_config(effort: &str, model: &str) -> Option<Value> {
    let effort = effort.trim().to_ascii_lowercase();
    if effort == "none" {
        return None;
    }
    if model.to_ascii_lowercase().contains("gemini-3") {
        return Some(serde_json::json!({
            "thinkingLevel": if effort == "low" { "low" } else { "high" }
        }));
    }
    let budget = match effort.as_str() {
        "low" => 1_024,
        "medium" => 4_096,
        "high" => 8_192,
        "xhigh" => 16_384,
        "max" => 32_768,
        "ultra" => 65_536,
        _ => return None,
    };
    Some(serde_json::json!({ "thinkingBudget": budget }))
}

/// Responses API reasoning items carry model reasoning from a previous turn.
/// Upstream chat/anthropic/gemini bridges have no equivalent input shape, so
/// these items are dropped during conversion.
pub(super) fn is_reasoning_input_item(item: &Value) -> bool {
    item.as_object()
        .and_then(|object| object.get("type"))
        .and_then(Value::as_str)
        .map(|item_type| item_type.eq_ignore_ascii_case("reasoning"))
        .unwrap_or(false)
}

pub(super) fn flatten_responses_function_tools(
    tools: &Value,
) -> Result<Vec<Map<String, Value>>, String> {
    let tools = tools
        .as_array()
        .ok_or_else(|| "Responses tools must be an array".to_string())?;
    let mut flattened = Vec::new();
    collect_responses_function_tools(tools, None, &mut flattened)?;
    Ok(flattened)
}

/// Codex control items that carry no conversation content, so every bridge can
/// drop them instead of failing the turn.
///
/// - `compaction` / `context_compaction` hold an `encrypted_content` blob only
///   the issuing upstream can read. It is the same class of problem as a
///   thinking signature: replayed to a different account or a different provider
///   it is at best meaningless, at worst a hard error.
/// - `configuration_update` is a durable reasoning-effort control the backend
///   interprets at its position in history. Effort is already carried on the
///   request itself by each bridge's reasoning conversion.
/// - `compaction_trigger` is an empty marker (`{}`).
/// - `image_generation_call` replays a hosted-tool result. Hosted tools are
///   filtered out of the declaration the upstream receives, so replaying the
///   call names a tool it was never told about — same reason the
///   `web_search_call` family is dropped.
pub(super) fn is_droppable_codex_control_item(item: &Value) -> bool {
    item.get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|item_type| {
            matches!(
                item_type,
                "compaction"
                    | "compaction_summary"
                    | "context_compaction"
                    | "configuration_update"
                    | "compaction_trigger"
                    | "image_generation_call"
            )
        })
}

/// Restate an `agent_message` as an ordinary `message` item.
///
/// Codex emits this for multi-agent turns. Unlike the control items above it
/// **carries prose** in `content[]`, so dropping it silently deletes part of the
/// conversation — the model then answers as though a turn had never happened.
/// Returning it in the shape every bridge already converts is the only option
/// that neither errors nor loses text.
///
/// `role` is `user`: the fields Codex uses instead are `author` / `recipient`,
/// which have no equivalent here, and the text is input *to* the model whichever
/// agent produced it. `encrypted_content` parts are skipped rather than inlined
/// as text — they are opaque to anything but the issuing upstream, and pasting
/// the ciphertext into the prompt would be worse than omitting it. `None` means
/// the item was not an `agent_message`.
pub(super) fn codex_agent_message_as_message(item: &Value) -> Option<Value> {
    if item.get("type").and_then(Value::as_str).map(str::trim) != Some("agent_message") {
        return None;
    }
    let content = match item.get("content") {
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| {
                part.get("type").and_then(Value::as_str).map(str::trim) != Some("encrypted_content")
            })
            .filter_map(|part| {
                let text = part.get("text").and_then(Value::as_str)?;
                (!text.is_empty()).then(|| serde_json::json!({"type": "input_text", "text": text}))
            })
            .collect(),
        Some(Value::String(text)) if !text.is_empty() => {
            vec![serde_json::json!({"type": "input_text", "text": text})]
        }
        _ => Vec::new(),
    };
    Some(serde_json::json!({
        "type": "message",
        "role": "user",
        "content": Value::Array(content)
    }))
}

pub(super) fn is_responses_additional_tools_item(item: &Value) -> bool {
    item.get("type")
        .and_then(Value::as_str)
        .is_some_and(|item_type| item_type.trim().eq_ignore_ascii_case("additional_tools"))
}

/// Codex "Responses Lite" stops sending a top-level `tools` array. The tool
/// catalogue instead rides inside `input` as an `additional_tools` carrier item
/// (and `instructions` becomes a `developer` message, which every bridge already
/// understands). The switch is keyed purely on model metadata upstream — there
/// is no provider check — so a pool pointed at any relay receives this shape.
///
/// Nothing here recognised the carrier: the chat / anthropic / gemini bridges
/// rejected the turn on the first request of a session, and because that error
/// is charged as a per-credential `request_build` failure the retry loop walked
/// the whole pool and reported every account as broken. The native Responses
/// path did not error but only ever flattened a *top-level* `tools`, so it
/// forwarded a catalogue that neither the flattener nor the upstream could see.
///
/// Lifting the carrier back to a top-level `tools` puts all four paths on the
/// shape they already handle, including the `namespace` grouping inside it.
/// Top-level order is preserved and carrier tools are appended de-duplicated so
/// a request carrying both stays stable. `Ok(None)` means no carrier was
/// present and the caller's bytes are left untouched.
pub(super) fn promote_responses_additional_tools(body: &[u8]) -> Result<Option<Vec<u8>>, String> {
    // A body we cannot parse is not ours to report: the per-bridge converters
    // produce their own message, and the passthrough path stays byte-exact.
    let Ok(mut value) = serde_json::from_slice::<Value>(body) else {
        return Ok(None);
    };
    let carries_tools = value
        .get("input")
        .and_then(Value::as_array)
        .is_some_and(|input| input.iter().any(is_responses_additional_tools_item));
    if !carries_tools {
        return Ok(None);
    }
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Responses request body must be a JSON object".to_string())?;

    let mut merged: Vec<Value> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    if let Some(tools) = object.get("tools").and_then(Value::as_array) {
        for tool in tools {
            seen.insert(responses_tool_dedup_key(tool));
            merged.push(tool.clone());
        }
    }

    let input = object
        .get_mut("input")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Responses input must be an array".to_string())?;
    let mut kept = Vec::with_capacity(input.len());
    for item in std::mem::take(input) {
        if !is_responses_additional_tools_item(&item) {
            kept.push(item);
            continue;
        }
        let Some(tools) = item.get("tools").and_then(Value::as_array) else {
            continue;
        };
        for tool in tools {
            if seen.insert(responses_tool_dedup_key(tool)) {
                merged.push(tool.clone());
            }
        }
    }
    *input = kept;

    // An empty `tools: []` is rejected by some relays, so only write the key
    // when the lift actually produced something.
    if !merged.is_empty() {
        object.insert("tools".to_string(), Value::Array(merged));
    }

    serde_json::to_vec(&value)
        .map(Some)
        .map_err(|error| format!("Responses request could not be re-encoded: {error}"))
}

/// Stand-in `call_id` for a tool call whose upstream never supplied a usable id.
pub(super) const FALLBACK_TOOL_CALL_ID: &str = "call_ai_switch";

/// The first of `values` that carries a usable id.
///
/// A relay may leave `"call_id": ""` while a real `id` sits next to it, so an
/// empty string has to fall through rather than win the lookup.
pub(super) fn first_non_blank<'a, I>(values: I) -> Option<&'a str>
where
    I: IntoIterator<Item = Option<&'a str>>,
{
    values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
}

/// The tool-call id to publish when the upstream sent a blank or missing one.
///
/// Chat-compatible relays differ in how they stream tool calls: some repeat the
/// header on every fragment, and some send `"id": ""` on the fragments after the
/// first. An empty string is not an id — publishing it leaves `call_id` blank on
/// the wire, and the client then has nothing to echo back, so the *next* turn
/// reaches the upstream with an empty `call_id` and dies on
/// `responses function_call call_id is required` — or, one bridge earlier, on
/// `... is missing call_id` when an output can no longer be paired with its call.
/// See [`repair_blank_call_ids_in_input`] for the replay-side repair.
pub(super) fn tool_call_id_or_fallback(id: Option<&str>) -> &str {
    first_non_blank([id]).unwrap_or(FALLBACK_TOOL_CALL_ID)
}

/// A `function_call` whose `*_output` has not been seen yet.
struct PendingCallId {
    call_id: String,
    /// The client sent a blank `call_id`, so the item's own `id` (or a generated
    /// one) was substituted. Recorded because it decides what an output carrying
    /// no id of its own may be matched against — see [`take_pending_call_id`].
    recovered: bool,
}

/// Fill in the `call_id`s a client left blank on a replayed Responses turn.
///
/// Codex replays the whole transcript on every turn, so one assistant turn that
/// reached it with `"call_id": ""` poisons the entire session: a strict Responses
/// upstream rejects every later replay with `function_call call_id is required`,
/// and the chat / anthropic bridges cannot pair a `*_output` with its call at all
/// and fail with `... is missing call_id`. The id is rebuilt from the item's own
/// `id` — Codex stamps a `function_call` with `fc_<response>_<index>`, which is
/// unique per call and therefore a faithful stand-in.
///
/// Returns how many items were repaired, so a caller holding the raw bytes can
/// keep them when nothing was wrong.
pub(super) fn repair_blank_call_ids_in_input(input: &mut Value) -> usize {
    let mut pending: Vec<PendingCallId> = Vec::new();
    let mut repaired = 0usize;
    let mut generated = 0usize;
    match input {
        Value::Array(items) => {
            for item in items.iter_mut() {
                repair_call_id_in_item(item, &mut pending, &mut repaired, &mut generated);
            }
        }
        _ => repair_call_id_in_item(input, &mut pending, &mut repaired, &mut generated),
    }
    repaired
}

fn repair_call_id_in_item(
    item: &mut Value,
    pending: &mut Vec<PendingCallId>,
    repaired: &mut usize,
    generated: &mut usize,
) {
    let Some(object) = item.as_object_mut() else {
        return;
    };
    let item_type = object.get("type").and_then(Value::as_str);
    match item_type {
        Some("function_call") | Some("custom_tool_call") | Some("tool_search_call") => {
            // Bind owned strings before touching `object` again: the match
            // scrutinee below would otherwise keep an immutable borrow alive
            // across the insert.
            let explicit = non_blank_str(object.get("call_id")).map(str::to_string);
            let (call_id, recovered) = match explicit {
                Some(call_id) => (call_id, false),
                None => {
                    *generated += 1;
                    let call_id = non_blank_str(object.get("id"))
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{FALLBACK_TOOL_CALL_ID}_{}", *generated));
                    object.insert("call_id".to_string(), Value::String(call_id.clone()));
                    *repaired += 1;
                    (call_id, true)
                }
            };
            pending.push(PendingCallId { call_id, recovered });
        }
        // A message starts a fresh turn, so the previous turn's tool round is
        // over and nothing after it can belong to those calls.
        Some("message") | Some("agent_message") => pending.clear(),
        Some("function_call_output")
        | Some("custom_tool_call_output")
        | Some("tool_search_output") => {
            let existing = non_blank_str(object.get("call_id")).map(str::to_string);
            match existing {
                Some(call_id) => {
                    if let Some(index) = pending
                        .iter()
                        .position(|entry| entry.call_id == call_id)
                    {
                        pending.remove(index);
                    }
                }
                None => {
                    if let Some(call_id) = take_pending_call_id(pending) {
                        object.insert("call_id".to_string(), Value::String(call_id));
                        *repaired += 1;
                    }
                }
            }
        }
        _ => {}
    }
}

/// Claim the `call_id` that an output carrying none of its own belongs to.
///
/// `None` means the answer is genuinely ambiguous and the caller must let the
/// bridge report its own error rather than relabel a tool result.
fn take_pending_call_id(pending: &mut Vec<PendingCallId>) -> Option<String> {
    if pending.len() == 1 {
        return Some(pending.remove(0).call_id);
    }
    // Position only carries meaning while no queued call ever had an identity:
    // the client dropped every `call_id`, so each entry was recovered and the
    // outputs can only be read in call order. As soon as one call carries a real
    // id, an anonymous output could belong to any of them, and pairing by
    // position would attribute one tool's result to another — refuse instead.
    if !pending.is_empty() && pending.iter().all(|entry| entry.recovered) {
        return Some(pending.remove(0).call_id);
    }
    None
}

fn non_blank_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// [`repair_blank_call_ids_in_input`] over a raw request body.
///
/// `Ok(None)` means every `call_id` was already present and the caller can keep
/// the bytes it had. A body that does not parse is likewise left alone: the
/// per-dialect converters report malformed requests in their own terms.
pub(super) fn repair_blank_responses_call_ids(body: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let Ok(mut value) = serde_json::from_slice::<Value>(body) else {
        return Ok(None);
    };
    let Some(input) = value.get_mut("input") else {
        return Ok(None);
    };
    if repair_blank_call_ids_in_input(input) == 0 {
        return Ok(None);
    }
    serde_json::to_vec(&value)
        .map(Some)
        .map_err(|error| format!("Responses request could not be re-encoded: {error}"))
}

/// Stable identity for a tool so the same entry appearing both top-level and in
/// the carrier is only kept once: `(type, name)`, `(mcp, server_label)`, or the
/// serialized tool when it has neither.
fn responses_tool_dedup_key(tool: &Value) -> String {
    let tool_type = tool
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if !tool_type.is_empty() {
        if let Some(name) = tool
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            return format!("type:{tool_type}\u{0}name:{name}");
        }
        if tool_type == "mcp" {
            if let Some(label) = tool
                .get("server_label")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|label| !label.is_empty())
            {
                return format!("type:mcp\u{0}server_label:{label}");
            }
        }
    }
    format!("json:{tool}")
}

pub(super) fn responses_tool_namespaces_from_body(
    body: &[u8],
) -> Result<ResponsesToolNamespaces, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Responses request JSON is invalid: {error}"))?;
    responses_tool_namespaces(value.get("tools"))
}
pub(super) fn responses_tool_namespaces(
    tools: Option<&Value>,
) -> Result<ResponsesToolNamespaces, String> {
    let Some(tools) = tools else {
        return Ok(BTreeMap::new());
    };
    let tools = tools
        .as_array()
        .ok_or_else(|| "Responses tools must be an array".to_string())?;
    let mut namespaces = BTreeMap::new();
    collect_responses_tool_namespaces(tools, None, &mut namespaces)?;
    Ok(namespaces)
}

fn collect_responses_function_tools(
    tools: &[Value],
    namespace: Option<&str>,
    flattened: &mut Vec<Map<String, Value>>,
) -> Result<(), String> {
    for tool in tools {
        let object = tool
            .as_object()
            .ok_or_else(|| "Responses tool entries must be objects".to_string())?;
        let tool_type = object
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("function");
        match tool_type {
            "function" => {
                let mut function = object.clone();
                if let (Some(namespace), Some(name)) = (
                    namespace.filter(|value| !value.is_empty()),
                    object.get("name").and_then(Value::as_str),
                ) {
                    function.insert(
                        "name".to_string(),
                        Value::String(qualified_response_tool_name(namespace, name)),
                    );
                }
                flattened.push(function);
            }
            "namespace" => {
                let nested_namespace = object
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| object.get("namespace").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .or(namespace);
                if let Some(nested) = object.get("tools") {
                    let nested = nested
                        .as_array()
                        .ok_or_else(|| "Responses namespace tools must be an array".to_string())?;
                    collect_responses_function_tools(nested, nested_namespace, flattened)?;
                }
            }
            "custom" => flattened.push(object.clone()),
            other if is_responses_builtin_tool_type(other) => {}
            other => return Err(format!("Unsupported Responses tool type: {other}")),
        }
    }
    Ok(())
}

pub(super) fn is_responses_builtin_tool_type(tool_type: &str) -> bool {
    matches!(
        tool_type,
        "web_search"
            | "web_search_preview"
            | "file_search"
            | "computer_use_preview"
            | "code_interpreter"
            | "image_generation"
            | "local_shell"
            | "shell"
            | "apply_patch"
            | "mcp"
            | "container_file_citation"
    )
}

fn collect_responses_tool_namespaces(
    tools: &[Value],
    namespace: Option<&str>,
    namespaces: &mut ResponsesToolNamespaces,
) -> Result<(), String> {
    for tool in tools {
        let object = tool
            .as_object()
            .ok_or_else(|| "Responses tool entries must be objects".to_string())?;
        let tool_type = object
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("function");
        match tool_type {
            "function" => {
                if let (Some(namespace), Some(name)) =
                    (namespace, object.get("name").and_then(Value::as_str))
                {
                    let namespace = namespace.trim();
                    let name = name.trim();
                    if !namespace.is_empty() && !name.is_empty() {
                        let qualified_name = qualified_response_tool_name(namespace, name);
                        namespaces.insert(qualified_name, namespace.to_string());
                        namespaces
                            .entry(name.to_string())
                            .or_insert_with(|| namespace.to_string());
                    }
                }
            }
            "namespace" => {
                let nested_namespace = object
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| object.get("namespace").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .or(namespace);
                if let Some(nested) = object.get("tools") {
                    let nested = nested
                        .as_array()
                        .ok_or_else(|| "Responses namespace tools must be an array".to_string())?;
                    collect_responses_tool_namespaces(nested, nested_namespace, namespaces)?;
                }
            }
            "custom" => {}
            _ => {}
        }
    }
    Ok(())
}

pub(super) fn response_tool_namespace<'a>(
    name: &str,
    namespaces: &'a ResponsesToolNamespaces,
) -> Option<&'a str> {
    namespaces.get(name).map(String::as_str)
}

pub(super) fn response_tool_name<'a>(
    name: &'a str,
    namespaces: &ResponsesToolNamespaces,
) -> &'a str {
    let Some(namespace) = response_tool_namespace(name, namespaces) else {
        return name;
    };
    let prefix = qualified_response_tool_name(namespace, "");
    name.strip_prefix(&prefix).unwrap_or(name)
}

pub(super) fn qualified_response_tool_name(namespace: &str, name: &str) -> String {
    let namespace = namespace.trim_end_matches('_');
    if namespace.is_empty() {
        return name.to_string();
    }
    format!("{namespace}__{name}")
}

pub(super) fn response_tool_parameters(object: &Map<String, Value>) -> Value {
    object
        .get("parameters")
        .or_else(|| object.get("inputSchema"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}))
}
/// Renders Anthropic `tool_result` content as the plain string that Chat,
/// Responses, and Gemini all require for a tool result.
///
/// Non-text blocks cannot survive as-is in a string field, but dropping them
/// silently is worse than saying so: an MCP screenshot tool would return an
/// empty result and the model would answer as though it had seen nothing.
/// Each one is replaced by a short marker instead.
///
/// Never returns an empty string for a non-empty result — several
/// OpenAI-compatible gateways reject a `tool` message whose content is `""`.
pub(super) fn stringify_tool_result_content(value: &Value) -> Result<String, String> {
    match value {
        Value::String(text) => Ok(text.clone()),
        Value::Array(parts) => {
            let rendered = parts
                .iter()
                .map(tool_result_part_to_text)
                .collect::<Vec<_>>();
            let joined = rendered
                .iter()
                .filter(|part| !part.is_empty())
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            Ok(joined)
        }
        Value::Null => Ok(String::new()),
        _ => serde_json::to_string(value)
            .map_err(|error| format!("Could not serialize tool result content: {error}")),
    }
}

/// Renders one `tool_result` content block. Media becomes a marker naming what
/// was there, so the model can ask for it another way instead of assuming the
/// tool returned nothing.
fn tool_result_part_to_text(part: &Value) -> String {
    let Some(object) = part.as_object() else {
        return part.as_str().map(str::to_string).unwrap_or_default();
    };
    if let Some(text) = object.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    match object.get("type").and_then(Value::as_str) {
        Some("image") => {
            let media_type = object
                .get("source")
                .and_then(Value::as_object)
                .and_then(|source| source.get("media_type"))
                .and_then(Value::as_str)
                .unwrap_or("image");
            format!("[ai-switch: tool returned an image ({media_type}) that this upstream cannot receive in a tool result]")
        }
        Some("document") => {
            "[ai-switch: tool returned a document that this upstream cannot receive in a tool result]"
                .to_string()
        }
        Some(other) => format!("[ai-switch: tool returned unsupported content of type {other}]"),
        None => String::new(),
    }
}

pub(super) fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        String::new()
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

pub(super) fn is_create_path(path: &str, expected: &str) -> bool {
    strip_version_segments(path).trim_end_matches('/') == expected.trim_start_matches('/')
}

/// Matches a sub-resource of a create path, e.g. `messages/count_tokens`
/// against `("messages", "count_tokens")`.
pub(super) fn is_create_subpath(path: &str, expected: &str, sub: &str) -> bool {
    let remaining = strip_version_segments(path).trim_end_matches('/');
    let Some(rest) = remaining.strip_prefix(expected.trim_start_matches('/')) else {
        return false;
    };
    rest.strip_prefix('/') == Some(sub)
}

/// Strips leading API version segments (`v1`, `v1beta`, …) so path matching is
/// insensitive to how the client spells the version prefix.
fn strip_version_segments(path: &str) -> &str {
    let normalized = path.trim();
    let mut remaining = normalized
        .strip_prefix('/')
        .unwrap_or(normalized)
        .trim_start_matches('/');
    while let Some(first) = remaining.split('/').next() {
        if !is_version_segment(first) {
            break;
        }
        remaining = remaining[first.len()..].trim_start_matches('/');
    }
    remaining
}

pub(super) fn request_streaming(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value.get("stream").and_then(Value::as_bool))
        .unwrap_or(false)
}

pub(super) fn gemini_model_from_body(body: &[u8]) -> Result<String, String> {
    let value = serde_json::from_slice::<Value>(body)
        .map_err(|error| format!("Request JSON is invalid: {error}"))?;
    value
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Gemini bridge request is missing model".to_string())
}

/// Models that reject `max_tokens` and require `max_completion_tokens`: the
/// o-series (o1, o3, o4-mini, …).
pub(super) fn requires_max_completion_tokens(model: &str) -> bool {
    let model = model.trim().to_ascii_lowercase();
    model.len() > 1
        && model.starts_with('o')
        && model
            .as_bytes()
            .get(1)
            .is_some_and(|byte| byte.is_ascii_digit())
}

pub(super) fn gemini_endpoint(model: &str, streaming: bool) -> (String, Option<String>) {
    let model = normalize_gemini_model_id(model);
    if streaming {
        (
            format!("/v1beta/models/{model}:streamGenerateContent"),
            Some("alt=sse".to_string()),
        )
    } else {
        (format!("/v1beta/models/{model}:generateContent"), None)
    }
}

/// Strips a leading `models/` (or `/`) so the endpoint format string cannot
/// produce a doubled prefix like `/v1beta/models/models/gemini-2.5-pro`, which
/// the upstream rejects. Model mappings and client env vars both supply that form.
fn normalize_gemini_model_id(model: &str) -> &str {
    let trimmed = model.trim().trim_start_matches('/');
    trimmed.strip_prefix("models/").unwrap_or(trimmed)
}

pub(super) fn parse_base64_data_url(value: &str) -> Option<(String, String)> {
    let value = value.trim();
    let (metadata, data) = value.strip_prefix("data:")?.split_once(',')?;
    let mut parts = metadata.split(';');
    let media_type = parts.next()?.trim();
    if media_type.is_empty() || !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return None;
    }
    Some((media_type.to_string(), data.to_string()))
}

fn is_version_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix('v') else {
        return false;
    };
    !rest.is_empty() && rest.chars().next().is_some_and(|ch| ch.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::{
        anthropic_thinking_budget, chat_reasoning_effort, codex_agent_message_as_message,
        gemini_thinking_config, is_create_path, is_create_subpath, is_droppable_codex_control_item,
        promote_responses_additional_tools, repair_blank_responses_call_ids,
        responses_tool_namespaces_from_body, stringify_tool_result_content,
        tool_call_id_or_fallback,
    };
    use serde_json::{json, Value};

    /// Binds the advertised effort list to the conversions that have to honour it.
    ///
    /// The Codex model catalog filters what it advertises against
    /// `RECOGNISED_REASONING_EFFORTS`. If a tier were added there without being
    /// taught to these three, a client could select an effort that then silently
    /// vanished from the upstream request — reasoning off, no error, nothing to
    /// look at. Failing here instead makes that ordering impossible to get wrong.
    #[test]
    fn every_advertised_reasoning_effort_is_understood_by_all_three_bridges() {
        for effort in super::super::RECOGNISED_REASONING_EFFORTS {
            assert!(
                chat_reasoning_effort(effort).is_some(),
                "chat cannot express {effort}"
            );
            assert!(
                anthropic_thinking_budget(effort, None).is_some(),
                "anthropic cannot express {effort}"
            );
            assert!(
                gemini_thinking_config(effort, "gemini-2.5-pro").is_some(),
                "gemini cannot express {effort}"
            );
        }
        // And something outside the list really is refused, so the assertions
        // above are not vacuous.
        assert!(chat_reasoning_effort("insane").is_none());
        assert!(anthropic_thinking_budget("insane", None).is_none());
    }

    /// An MCP screenshot tool returns an image. Dropping it silently made the
    /// model answer as though the tool had returned nothing at all.
    #[test]
    fn tool_result_image_becomes_a_visible_marker() {
        let rendered = stringify_tool_result_content(&json!([
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}}
        ]))
        .unwrap();

        assert!(
            !rendered.trim().is_empty(),
            "an image-only result must not render as empty"
        );
        assert!(rendered.contains("image/png"), "rendered={rendered}");
        // The base64 payload itself must not be inlined.
        assert!(!rendered.contains("iVBORw0KGgo="), "rendered={rendered}");
    }

    #[test]
    fn tool_result_keeps_text_alongside_media() {
        let rendered = stringify_tool_result_content(&json!([
            {"type": "text", "text": "Screenshot captured."},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}}
        ]))
        .unwrap();

        assert!(
            rendered.contains("Screenshot captured."),
            "rendered={rendered}"
        );
        assert!(rendered.contains("image/png"), "rendered={rendered}");
    }

    #[test]
    fn tool_result_plain_text_is_unchanged() {
        assert_eq!(
            stringify_tool_result_content(&json!("42")).unwrap(),
            "42",
            "a plain string result must pass through verbatim"
        );
        assert_eq!(
            stringify_tool_result_content(&json!([{"type": "text", "text": "42"}])).unwrap(),
            "42"
        );
    }

    #[test]
    fn create_path_matching_ignores_version_prefixes() {
        assert!(is_create_path("/v1/messages", "messages"));
        assert!(is_create_path("/messages", "messages"));
        assert!(is_create_path("/v1beta/messages/", "messages"));
        assert!(!is_create_path("/v1/messages/count_tokens", "messages"));
        assert!(!is_create_path("/v1/responses", "messages"));
    }

    #[test]
    fn create_subpath_matches_only_the_named_sub_resource() {
        assert!(is_create_subpath(
            "/v1/messages/count_tokens",
            "messages",
            "count_tokens"
        ));
        assert!(is_create_subpath(
            "/messages/count_tokens",
            "messages",
            "count_tokens"
        ));
        // The parent path and a different sub-resource must not match.
        assert!(!is_create_subpath(
            "/v1/messages",
            "messages",
            "count_tokens"
        ));
        assert!(!is_create_subpath(
            "/v1/messages/batches",
            "messages",
            "count_tokens"
        ));
        // A deeper path must not match either.
        assert!(!is_create_subpath(
            "/v1/messages/count_tokens/extra",
            "messages",
            "count_tokens"
        ));
    }

    /// A Responses Lite request shaped the way Codex sends it: no top-level
    /// `tools`, the catalogue in an `additional_tools` carrier, instructions
    /// demoted to a `developer` message.
    fn responses_lite_body() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "model": "gpt-6-astra",
            "input": [
                {
                    "type": "additional_tools",
                    "id": "at_1",
                    "role": "developer",
                    "tools": [{
                        "type": "namespace",
                        "name": "functions",
                        "tools": [
                            {"type": "function", "name": "shell", "parameters": {"type": "object"}},
                            {"type": "function", "name": "apply_patch", "parameters": {"type": "object"}}
                        ]
                    }]
                },
                {"type": "message", "id": "msg_1", "role": "developer", "content": [{"type": "input_text", "text": "BASE"}]},
                {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn additional_tools_carrier_becomes_top_level_tools() {
        let lifted = promote_responses_additional_tools(&responses_lite_body())
            .expect("carrier lifts cleanly")
            .expect("a carrier was present, so the body changed");
        let value: serde_json::Value = serde_json::from_slice(&lifted).unwrap();

        assert_eq!(
            value["tools"],
            json!([{
                "type": "namespace",
                "name": "functions",
                "tools": [
                    {"type": "function", "name": "shell", "parameters": {"type": "object"}},
                    {"type": "function", "name": "apply_patch", "parameters": {"type": "object"}}
                ]
            }])
        );

        // The carrier itself must go: it is not a conversable input item, and
        // leaving it behind is what the bridges choked on.
        let input = value["input"].as_array().expect("input survives");
        assert_eq!(input.len(), 2, "only the carrier is removed: {input:?}");
        assert!(input.iter().all(|item| item["type"] != "additional_tools"));
        // Order of the remaining turn is untouched.
        assert_eq!(input[0]["role"], "developer");
        assert_eq!(input[1]["role"], "user");
    }

    /// The namespace map is what turns `functions__shell` back into `shell` on
    /// the way home. It only ever read the top-level `tools`, so before the lift
    /// a Lite turn produced an empty map and every tool call came back to Codex
    /// under a name it had never advertised.
    #[test]
    fn lifted_carrier_feeds_the_tool_namespace_map() {
        let body = responses_lite_body();
        assert!(
            responses_tool_namespaces_from_body(&body)
                .unwrap()
                .is_empty(),
            "carrier tools are invisible to the map until they are lifted"
        );

        let lifted = promote_responses_additional_tools(&body).unwrap().unwrap();
        let namespaces = responses_tool_namespaces_from_body(&lifted).unwrap();

        assert_eq!(
            namespaces.get("functions__shell").map(String::as_str),
            Some("functions")
        );
        assert_eq!(
            namespaces.get("shell").map(String::as_str),
            Some("functions")
        );
    }

    #[test]
    fn carrier_tools_are_appended_after_existing_tools_and_deduped() {
        let body = serde_json::to_vec(&json!({
            "input": [
                {"type": "message", "role": "user", "content": "hi"},
                {"type": "additional_tools", "tools": [
                    {"type": "function", "name": "shell"},
                    {"type": "function", "name": "web_fetch"}
                ]}
            ],
            "tools": [{"type": "function", "name": "shell"}]
        }))
        .unwrap();

        let lifted = promote_responses_additional_tools(&body).unwrap().unwrap();
        let value: serde_json::Value = serde_json::from_slice(&lifted).unwrap();

        assert_eq!(
            value["tools"],
            json!([
                {"type": "function", "name": "shell"},
                {"type": "function", "name": "web_fetch"}
            ]),
            "the duplicate is dropped and the new tool is appended"
        );
    }

    /// Every non-Lite Codex request goes through this too, so a body with no
    /// carrier has to come back untouched rather than re-serialized — the
    /// passthrough and prompt-cache paths depend on the bytes not moving.
    #[test]
    fn body_without_a_carrier_is_left_alone() {
        let body = serde_json::to_vec(&json!({
            "input": [{"type": "message", "role": "user", "content": "hi"}],
            "tools": [{"type": "function", "name": "shell"}]
        }))
        .unwrap();

        assert!(promote_responses_additional_tools(&body).unwrap().is_none());
        // Including bodies this helper cannot parse at all.
        assert!(promote_responses_additional_tools(b"not json")
            .unwrap()
            .is_none());
    }

    /// An empty carrier must not leave `tools: []` behind — several relays 400
    /// on an empty tool array, which would turn a harmless no-op into an outage.
    #[test]
    fn empty_carrier_does_not_introduce_an_empty_tools_array() {
        let body = serde_json::to_vec(&json!({
            "input": [
                {"type": "additional_tools", "tools": []},
                {"type": "message", "role": "user", "content": "hi"}
            ]
        }))
        .unwrap();

        let lifted = promote_responses_additional_tools(&body).unwrap().unwrap();
        let value: serde_json::Value = serde_json::from_slice(&lifted).unwrap();

        assert!(value.get("tools").is_none(), "value={value}");
        assert_eq!(value["input"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn droppable_control_items_are_exactly_the_contentless_ones() {
        for item_type in [
            "compaction",
            "compaction_summary",
            "context_compaction",
            "configuration_update",
            "compaction_trigger",
            "image_generation_call",
        ] {
            assert!(
                is_droppable_codex_control_item(&json!({"type": item_type})),
                "{item_type} should be droppable"
            );
        }
        // Anything that carries conversation must not be swept up by this.
        for item_type in [
            "agent_message",
            "message",
            "function_call",
            "function_call_output",
            "custom_tool_call",
            "reasoning",
        ] {
            assert!(
                !is_droppable_codex_control_item(&json!({"type": item_type})),
                "{item_type} must not be dropped"
            );
        }
    }

    /// The whole point of restating rather than dropping: the text has to come
    /// out the other side. The ciphertext part must not — it is readable only by
    /// the upstream that issued it, so inlining it as prose would feed the model
    /// a base64 blob.
    #[test]
    fn agent_message_keeps_prose_and_omits_encrypted_parts() {
        let restated = codex_agent_message_as_message(&json!({
            "type": "agent_message",
            "id": "am_1",
            "author": "planner",
            "recipient": "coder",
            "content": [
                {"type": "input_text", "text": "REVIEW"},
                {"type": "encrypted_content", "encrypted_content": "OPAQUE"},
                {"type": "input_text", "text": "THE DIFF"}
            ]
        }))
        .expect("an agent_message is restated");

        assert_eq!(
            restated,
            json!({
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "REVIEW"},
                    {"type": "input_text", "text": "THE DIFF"}
                ]
            })
        );
    }

    #[test]
    fn agent_message_restatement_ignores_other_item_types() {
        assert!(
            codex_agent_message_as_message(&json!({"type": "message", "role": "user"})).is_none()
        );
        assert!(codex_agent_message_as_message(&json!({"type": "compaction"})).is_none());
    }

    #[test]
    fn a_blank_tool_call_id_is_not_an_id() {
        assert_eq!(tool_call_id_or_fallback(Some("call_1")), "call_1");
        assert_eq!(tool_call_id_or_fallback(Some("  call_1  ")), "call_1");
        assert_eq!(tool_call_id_or_fallback(Some("")), "call_ai_switch");
        assert_eq!(tool_call_id_or_fallback(Some("   ")), "call_ai_switch");
        assert_eq!(tool_call_id_or_fallback(None), "call_ai_switch");
    }

    #[test]
    fn a_body_whose_call_ids_are_all_present_is_left_byte_exact() {
        let body = json!({
            "model": "gpt-5.6",
            "input": [
                {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "read", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "ok"}
            ]
        });

        let repaired = repair_blank_responses_call_ids(&serde_json::to_vec(&body).unwrap())
            .expect("repair runs");
        assert!(repaired.is_none(), "nothing was wrong, so no bytes are spent");
    }

    #[test]
    fn a_blank_call_id_is_rebuilt_from_the_items_own_id() {
        let body = json!({
            "model": "gpt-5.6",
            "input": [
                {"type": "function_call", "id": "fc_resp_0", "call_id": "", "name": "read", "arguments": "{}"},
                {"type": "function_call_output", "id": "fco_1", "call_id": "", "output": "ok"}
            ]
        });

        let repaired = repair_blank_responses_call_ids(&serde_json::to_vec(&body).unwrap())
            .expect("repair runs")
            .expect("the blank ids are worth rewriting");
        let repaired: Value = serde_json::from_slice(&repaired).unwrap();

        assert_eq!(repaired["input"][0]["call_id"], "fc_resp_0");
        assert_eq!(repaired["input"][1]["call_id"], "fc_resp_0");
    }

    /// The shape that poisoned a real Codex session: two parallel calls, every
    /// `call_id` blank, and outputs that carry no id of their own to match on.
    #[test]
    fn parallel_calls_that_all_lost_their_call_id_are_paired_in_call_order() {
        let body = json!({
            "model": "gpt-5.6",
            "input": [
                {"type": "function_call", "id": "fc_resp_0", "call_id": "", "name": "exec", "arguments": "{\"cmd\":\"a\"}"},
                {"type": "function_call", "id": "fc_resp_1", "call_id": "", "name": "exec", "arguments": "{\"cmd\":\"b\"}"},
                {"type": "function_call_output", "id": "fco_a", "call_id": "", "output": "out-a"},
                {"type": "function_call_output", "id": "fco_b", "call_id": "", "output": "out-b"}
            ]
        });

        let repaired = repair_blank_responses_call_ids(&serde_json::to_vec(&body).unwrap())
            .expect("repair runs")
            .expect("the blank ids are worth rewriting");
        let repaired: Value = serde_json::from_slice(&repaired).unwrap();
        let input = repaired["input"].as_array().unwrap();

        assert_eq!(input[0]["call_id"], "fc_resp_0");
        assert_eq!(input[1]["call_id"], "fc_resp_1");
        assert_eq!(input[2]["call_id"], "fc_resp_0");
        assert_eq!(input[3]["call_id"], "fc_resp_1");
    }

    /// The complement of the rule above: once a call *does* carry a real id, an
    /// anonymous output could belong to any of the queued calls. Rewriting one
    /// would attribute a tool's result to a different call, so the request is
    /// left for the bridge to reject.
    #[test]
    fn anonymous_output_against_calls_that_kept_their_ids_is_not_guessed() {
        let body = json!({
            "model": "gpt-5.6",
            "input": [
                {"type": "function_call", "id": "fc_resp_0", "call_id": "call_1", "name": "read", "arguments": "{}"},
                {"type": "function_call", "id": "fc_resp_1", "call_id": "call_2", "name": "read", "arguments": "{}"},
                {"type": "function_call_output", "id": "fco_a", "output": "ambiguous"}
            ]
        });

        let repaired = repair_blank_responses_call_ids(&serde_json::to_vec(&body).unwrap())
            .expect("repair runs");
        assert!(repaired.is_none(), "an ambiguous pairing must not be rewritten");
    }

    #[test]
    fn a_call_with_no_id_at_all_still_gets_a_usable_call_id() {
        let body = json!({
            "model": "gpt-5.6",
            "input": [
                {"type": "function_call", "call_id": "", "name": "read", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "", "output": "ok"}
            ]
        });

        let repaired = repair_blank_responses_call_ids(&serde_json::to_vec(&body).unwrap())
            .expect("repair runs")
            .expect("the blank ids are worth rewriting");
        let repaired: Value = serde_json::from_slice(&repaired).unwrap();
        let input = repaired["input"].as_array().unwrap();
        let call_id = input[0]["call_id"].as_str().unwrap();

        assert!(!call_id.is_empty());
        assert_eq!(input[1]["call_id"], call_id);
    }

    #[test]
    fn a_message_ends_the_tool_round_so_a_later_output_is_not_matched_across_it() {
        let body = json!({
            "model": "gpt-5.6",
            "input": [
                {"type": "function_call", "id": "fc_resp_0", "call_id": "", "name": "read", "arguments": "{}"},
                {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "hi"}]},
                {"type": "function_call_output", "id": "fco_a", "call_id": "", "output": "stale"}
            ]
        });

        let repaired = repair_blank_responses_call_ids(&serde_json::to_vec(&body).unwrap())
            .expect("repair runs")
            .expect("only the call is rewritten");
        let repaired: Value = serde_json::from_slice(&repaired).unwrap();
        let input = repaired["input"].as_array().unwrap();

        assert_eq!(input[0]["call_id"], "fc_resp_0");
        assert_eq!(
            input[2]["call_id"], "",
            "the output belongs to no call this turn, so it stays blank for the bridge to report"
        );
    }
}
