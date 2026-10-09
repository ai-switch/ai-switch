//! 流式断流自动续写：续写请求体构造与续写事件重写。
//!
//! 设计见 `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`。

use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

mod holdback;
pub(super) use holdback::ResponsesItemHoldback;

use crate::models::route_pool::RouteUsageBreakdown;
#[cfg(test)]
use crate::services::route_proxy_stream::OpenItem;
use crate::services::route_proxy_stream::{OpenItemKind, StreamContinuationState};

/// 与「用户手动继续」等价的那句指令（spec 第 6 节）。
pub const CONTINUE_INSTRUCTION: &str = "Continue exactly where the previous assistant message stopped. Do not repeat anything already written, do not add a preamble, and do not restate the question.";

/// 用「原请求 + 半截回答 + 继续指令」构造续写请求体。
///
/// 只动 `input` 与 `stream`，其余字段（model / tools / reasoning / store …）
/// 原样保留——这是「质量与手动继续一致」的前提：续写用的就是同一个请求。
pub fn build_continuation_body(
    original_body: &[u8],
    partial_text: &str,
) -> Result<Vec<u8>, String> {
    let mut value: Value = serde_json::from_slice(original_body)
        .map_err(|error| format!("original request body is not JSON: {error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "original request body must be a JSON object".to_string())?;
    let items = object
        .get_mut("input")
        .ok_or_else(|| "original request body has no input".to_string())?
        .as_array_mut()
        .ok_or_else(|| "original request input must be an array".to_string())?;
    if !partial_text.is_empty() {
        items.push(json!({
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": partial_text }]
        }));
    }
    items.push(json!({
        "type": "message",
        "role": "user",
        "content": [{ "type": "input_text", "text": CONTINUE_INSTRUCTION }]
    }));
    object.insert("stream".to_string(), Value::Bool(true));
    serde_json::to_vec(&value)
        .map_err(|error| format!("could not serialize continuation body: {error}"))
}

/// 一次续写的施工图：请求体、以及把续写流接回原 response 所需的游标。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContinuationPlan {
    /// 以原请求为基础、追加了半截回答与继续指令的续写请求体。
    pub body: Vec<u8>,
    /// 原 response 的 id；续写流的收尾事件必须沿用它。
    pub response_id: String,
    /// 续写流里第一个事件要用的 `sequence_number`。
    pub next_sequence_number: u64,
    /// 续写流里第一个 item 要用的 `output_index`。
    pub next_output_index: u64,
}

/// 断流后是否值得再发一次「继续」请求；能续就返回施工图。
///
/// 放弃续写的情形（spec 第 8、10 节）：
/// - 半截正文超过内存上限（`text_truncated`）；
/// - 还没拿到 `response.created`，或正文为空——没有可续的东西；
/// - 原请求体不是可改写的 JSON。
pub fn plan_continuation(
    original_body: &[u8],
    state: &StreamContinuationState,
) -> Option<ContinuationPlan> {
    if state.text_truncated {
        return None;
    }
    // 断在加密 reasoning 中间：密文无法重建，放弃续写走今天的报错路径。
    if state
        .open_item
        .as_ref()
        .is_some_and(|item| item.kind == OpenItemKind::Reasoning && item.encrypted)
    {
        return None;
    }
    let response_id = state.response_id.clone()?;
    if state.partial_text.is_empty()
        && !state
            .open_item
            .as_ref()
            .is_some_and(|item| is_holdback_item(item.kind))
    {
        return None;
    }
    let body = build_continuation_body(original_body, &state.partial_text).ok()?;
    // 断流时还开着的那个 item 也占了一个 `output_index`；新 item 必须排在它后面，
    // 否则客户端那边两条 item 撞在同一个位置上。它已经被网关补过 done，
    // 所以这里按「它的位置 + 1」算。
    let next_output_index = match state.open_item.as_ref() {
        Some(open) => open.output_index + 1,
        None => state.completed_items.len() as u64,
    };
    Some(ContinuationPlan {
        body,
        response_id,
        next_sequence_number: state.last_sequence_number + 1,
        next_output_index,
    })
}

/// 给「断流时还开着的那个文本 item」补一条合成的 `output_item.done`。
///
/// 必须先于续写流的第一条事件发出：客户端是靠 `output_item.*` 记录会话历史的，
/// item 不 done，断流前那一段就永远不会进客户端的历史（Task 1 的 spike 就是这么
/// 拼的，实机复验也证实：不补这条，客户端只显示续写那一段）。
pub fn synthesized_item_done_block(
    sequence_number: u64,
    item_id: &str,
    output_index: u64,
    text: &str,
) -> String {
    let value = json!({
        "type": "response.output_item.done",
        "sequence_number": sequence_number,
        "output_index": output_index,
        "item": {
            "id": item_id,
            "type": "message",
            "role": "assistant",
            "status": "completed",
            "content": [{ "type": "output_text", "text": text }],
        }
    });
    format!("data: {value}\n\n")
}

/// 需要「收到 `output_item.done` 才转发」的 item 类型（spec 第 8.1 节）。
///
/// 工具调用的参数是流式 JSON，断在中间会得到语法都不完整的调用，而客户端一旦
/// 看到完整 item 就会真的去执行它；reasoning 同理，半截密文/摘要没有意义。
pub fn is_holdback_item(kind: OpenItemKind) -> bool {
    matches!(kind, OpenItemKind::FunctionCall | OpenItemKind::Reasoning)
}

/// 把续写流重写成「原 response 的后续」（spec 第 7 节）。
///
/// 只负责上游是 Responses 协议的情形：丢掉续写流自己的 `response.created`
/// 与收尾事件，把序号与 `output_index` 接到原响应后面。
pub struct ResponsesResumeRewriter {
    response_id: String,
    next_sequence_number: u64,
    next_output_index: u64,
    holdback: ResponsesItemHoldback,
    /// 多个文本 item 可以交错；不能被新工具/reasoning item 覆盖。
    open_messages: BTreeMap<String, OpenMessage>,
    item_ids: HashMap<String, (String, u64)>,
    output_indices: HashMap<u64, u64>,
    used_ids: HashSet<String>,
    text_bytes: usize,
    text_truncated: bool,
}

struct OpenMessage {
    output_index: u64,
    text: String,
}

impl ResponsesResumeRewriter {
    pub fn new(response_id: String, next_sequence_number: u64, next_output_index: u64) -> Self {
        Self {
            response_id,
            next_sequence_number,
            next_output_index,
            holdback: ResponsesItemHoldback::default(),
            open_messages: BTreeMap::new(),
            item_ids: HashMap::new(),
            output_indices: HashMap::new(),
            used_ids: HashSet::new(),
            text_bytes: 0,
            text_truncated: false,
        }
    }

    pub fn reserve_item_ids(&mut self, ids: impl IntoIterator<Item = String>) {
        self.used_ids.extend(ids);
    }

    pub fn can_continue(&self) -> bool {
        self.holdback.can_continue() && !self.text_truncated
    }

    /// 跨轮游标保留，上游每轮从零开始的索引映射则必须重建。
    pub fn begin_next_stream(&mut self) {
        self.item_ids.clear();
        self.output_indices.clear();
    }

    /// 断流后先放行交错的完整 item；未收完的工具/reasoning 永不交给客户端。
    pub fn release_interrupted(&mut self) -> Result<String, String> {
        let blocks = self.holdback.discard_incomplete();
        self.rewrite_released(blocks)
    }

    pub fn take_dangling_message_done(&mut self) -> Option<String> {
        if self.open_messages.is_empty() || self.text_truncated {
            return None;
        }
        let mut messages: Vec<_> = std::mem::take(&mut self.open_messages)
            .into_iter()
            .collect();
        messages.sort_by_key(|(_, message)| message.output_index);
        let mut output = String::new();
        for (id, message) in messages {
            output.push_str(&synthesized_item_done_block(
                self.next_sequence_number,
                &id,
                message.output_index,
                &message.text,
            ));
            self.next_sequence_number += 1;
        }
        self.text_bytes = 0;
        Some(output)
    }

    #[cfg(test)]
    pub fn discard_held(&mut self) {
        let _ = self.release_interrupted();
        self.begin_next_stream();
    }

    pub fn rewrite_block(&mut self, block: &str) -> Result<Option<String>, String> {
        let blocks = self.holdback.push_block(block)?;
        let output = self.rewrite_released(blocks)?;
        Ok((!output.is_empty()).then_some(output))
    }

    fn rewrite_released(&mut self, blocks: Vec<String>) -> Result<String, String> {
        let mut output = String::new();
        for block in blocks {
            let payload = block_payload(&block);
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&payload) else {
                continue;
            };
            let event = value["type"].as_str().unwrap_or_default().to_string();
            if matches!(
                event.as_str(),
                "response.created" | "response.in_progress" | "response.completed"
            ) {
                continue;
            }
            output.push_str(&self.render(value, &event)?);
        }
        Ok(output)
    }

    fn render(&mut self, mut value: Value, event: &str) -> Result<String, String> {
        if !value.is_object() {
            return Err("Responses event must be an object".into());
        }
        value["sequence_number"] = Value::from(self.next_sequence_number);
        self.next_sequence_number += 1;
        let original_id = json_item_id(&value);
        let original_index = value["output_index"].as_u64();
        if event == "response.output_item.added" {
            if self.used_ids.len() >= 4096 {
                return Err("too many continuation output items".into());
            }
            let index = self.next_output_index;
            self.next_output_index += 1;
            if let Some(id) = original_id.as_ref() {
                let mut client_id = id.clone();
                if self.used_ids.contains(&client_id) {
                    client_id = format!("{id}_resume_{index}");
                    while self.used_ids.contains(&client_id) {
                        client_id.push('_');
                    }
                }
                self.used_ids.insert(client_id.clone());
                self.item_ids.insert(id.clone(), (client_id, index));
            }
            if let Some(original_index) = original_index {
                self.output_indices.insert(original_index, index);
            }
            value["output_index"] = Value::from(index);
        }
        if let Some((id, index)) = original_id.as_ref().and_then(|id| self.item_ids.get(id)) {
            if value.get("item_id").is_some() {
                value["item_id"] = Value::String(id.clone());
            }
            if value.get("item").is_some_and(Value::is_object) {
                value["item"]["id"] = Value::String(id.clone());
            }
            value["output_index"] = Value::from(*index);
        } else if let Some(index) = original_index.and_then(|index| self.output_indices.get(&index))
        {
            value["output_index"] = Value::from(*index);
        }
        if value.get("response").is_some_and(Value::is_object) {
            value["response"]["id"] = Value::String(self.response_id.clone());
        }
        if value.get("response_id").is_some() {
            value["response_id"] = Value::String(self.response_id.clone());
        }
        let id = json_item_id(&value);
        match event {
            "response.output_item.added"
                if value.pointer("/item/type").and_then(Value::as_str) == Some("message") =>
            {
                if let Some(id) = id {
                    self.open_messages.insert(
                        id,
                        OpenMessage {
                            output_index: value["output_index"].as_u64().unwrap_or_default(),
                            text: String::new(),
                        },
                    );
                }
            }
            "response.output_text.delta" => {
                if let (Some(open), Some(delta)) = (
                    id.as_ref().and_then(|id| self.open_messages.get_mut(id)),
                    value["delta"].as_str(),
                ) {
                    let remaining = (1024usize * 1024).saturating_sub(self.text_bytes);
                    self.text_truncated |= delta.len() > remaining;
                    let mut end = delta.len().min(remaining);
                    while !delta.is_char_boundary(end) {
                        end -= 1;
                    }
                    open.text.push_str(&delta[..end]);
                    self.text_bytes += end;
                }
            }
            "response.output_item.done" => {
                if let Some(open) = id.as_ref().and_then(|id| self.open_messages.remove(id)) {
                    self.text_bytes = self.text_bytes.saturating_sub(open.text.len());
                }
            }
            _ => {}
        }
        Ok(format!("data: {value}\n\n"))
    }

    pub fn finish(&mut self, usage: &RouteUsageBreakdown) -> String {
        synthesized_completion_block(&self.response_id, self.next_sequence_number, usage)
    }
}

pub(super) fn block_payload(block: &str) -> String {
    block
        .lines()
        .filter_map(|line| line.trim().strip_prefix("data:").map(str::trim))
        .collect::<Vec<_>>()
        .join("\n")
}

/// 从事件里取 item id：增量事件放 `item_id`，`output_item.*` 放 `item.id`。
fn json_item_id(value: &Value) -> Option<String> {
    value
        .get("item_id")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/item/id").and_then(Value::as_str))
        .map(str::to_string)
}

/// 从 `output_item.added/done` 的 `item.type` 取 item 类型。
fn json_item_kind(value: &Value) -> Option<OpenItemKind> {
    match value.pointer("/item/type").and_then(Value::as_str) {
        Some("function_call") | Some("custom_tool_call") => Some(OpenItemKind::FunctionCall),
        Some("reasoning") => Some(OpenItemKind::Reasoning),
        Some("message") => Some(OpenItemKind::Message),
        _ => None,
    }
}

/// 合成一条 `response.completed`。
///
/// 两处共用：续写全部结束时的收尾，以及「内容完整、只缺收尾事件」时的补齐。
pub fn synthesized_completion_block(
    response_id: &str,
    sequence_number: u64,
    usage: &RouteUsageBreakdown,
) -> String {
    let value = json!({
        "type": "response.completed",
        "sequence_number": sequence_number,
        "response": {
            "id": response_id,
            "object": "response",
            "status": "completed",
            "output": [],
            "usage": usage_to_responses_json(usage),
        }
    });
    format!("data: {value}\n\n")
}

/// 透传的块要自己带 `\n\n`：调用方是从 framer 里拿的、已经把终止符剥掉。
fn ensure_terminator(block: &str) -> String {
    if block.ends_with("\n\n") {
        block.to_string()
    } else {
        format!("{block}\n\n")
    }
}

fn usage_to_responses_json(usage: &RouteUsageBreakdown) -> Value {
    let input_tokens = usage.input_tokens.unwrap_or(0);
    let output_tokens = usage.output_tokens.unwrap_or(0);
    json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "input_tokens_details": { "cached_tokens": usage.cache_tokens.unwrap_or(0) },
        "output_tokens_details": { "reasoning_tokens": 0 },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_round_closes_its_own_text_and_avoids_reused_item_ids() {
        let mut rw = ResponsesResumeRewriter::new("root".into(), 3, 1);
        rw.reserve_item_ids(["m".to_string()]);
        let added = r#"data: {"type":"response.output_item.added","output_index":0,"item":{"id":"m","type":"message"}}"#;
        let delta = r#"data: {"type":"response.output_text.delta","output_index":0,"item_id":"m","delta":"中文"}"#;
        let a = rw.rewrite_block(added).unwrap().unwrap();
        let d = rw.rewrite_block(delta).unwrap().unwrap();
        let close = rw.take_dangling_message_done().unwrap();
        let parse =
            |s: &str| serde_json::from_str::<Value>(s.trim().trim_start_matches("data: ")).unwrap();
        let a = parse(&a);
        let d = parse(&d);
        let close = parse(&close);
        assert_ne!(a["item"]["id"], "m");
        assert_eq!(d["item_id"], a["item"]["id"]);
        assert_eq!(close["item"]["id"], a["item"]["id"]);
        assert_eq!(close["item"]["content"][0]["text"], "中文");
        assert_eq!(close["sequence_number"], 5);
        rw.begin_next_stream();
        let next = parse(&rw.rewrite_block(added).unwrap().unwrap());
        assert_ne!(next["item"]["id"], a["item"]["id"]);
        assert_eq!(next["output_index"], 2);
        assert_eq!(next["sequence_number"], 6);
    }

    #[test]
    fn continuation_text_buffers_stop_at_the_limit() {
        let mut rw = ResponsesResumeRewriter::new("root".into(), 0, 0);
        rw.rewrite_block(r#"data: {"type":"response.output_item.added","output_index":0,"item":{"id":"m","type":"message"}}"#).unwrap();
        let block = format!(
            "data: {}",
            json!({"type":"response.output_text.delta","item_id":"m",
            "delta":"x".repeat(1024 * 1024 + 1)})
        );
        rw.rewrite_block(&block).unwrap();
        assert!(!rw.can_continue());
        assert!(rw.text_bytes <= 1024 * 1024);
        assert!(
            rw.take_dangling_message_done().is_none(),
            "不能提交被截断的缓存正文"
        );
    }

    #[test]
    fn appends_partial_answer_and_instruction_without_touching_other_fields() {
        let original = br#"{"model":"gpt-6-astra","store":false,"reasoning":{"effort":"high"},
            "tools":[{"type":"function","name":"t"}],"input":[{"type":"message","role":"user",
            "content":[{"type":"input_text","text":"hi"}]}]}"#;
        let out = build_continuation_body(original, "半截回答").expect("body");
        let value: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(value["model"], "gpt-6-astra");
        assert_eq!(value["reasoning"]["effort"], "high");
        assert_eq!(value["tools"][0]["name"], "t");
        let input = value["input"].as_array().unwrap();
        assert_eq!(input.len(), 3);
        assert_eq!(input[1]["role"], "assistant");
        assert_eq!(input[1]["content"][0]["text"], "半截回答");
        assert_eq!(input[2]["role"], "user");
        assert!(input[2]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Continue exactly"));
    }

    #[test]
    fn rewriter_drops_created_and_renumbers_sequence_and_output_index() {
        let mut rewriter = ResponsesResumeRewriter::new("resp_1".into(), 10, 2);
        let created =
            r#"data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_2"}}"#;
        assert_eq!(rewriter.rewrite_block(created).unwrap(), None);

        let added = r#"data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_9","type":"message"}}"#;
        let out = rewriter.rewrite_block(added).unwrap().expect("block");
        let value: serde_json::Value =
            serde_json::from_str(out.trim_start_matches("data: ")).unwrap();
        assert_eq!(value["sequence_number"], 10);
        assert_eq!(value["output_index"], 2);
        assert_eq!(value["item"]["id"], "msg_9");
    }

    #[test]
    fn rewriter_suppresses_upstream_completed_and_synthesizes_our_own() {
        let mut rewriter = ResponsesResumeRewriter::new("resp_1".into(), 10, 2);
        let done = r#"data: {"type":"response.completed","sequence_number":11,"response":{"id":"resp_2","status":"completed"}}"#;
        assert_eq!(rewriter.rewrite_block(done).unwrap(), None);

        let final_block = rewriter.finish(&RouteUsageBreakdown::default());
        assert!(final_block.contains("\"type\":\"response.completed\""));
        assert!(final_block.contains("\"id\":\"resp_1\""));
        assert!(final_block.contains("\"status\":\"completed\""));
    }

    #[test]
    fn rejects_a_body_whose_input_is_not_an_array() {
        assert!(build_continuation_body(br#"{"model":"m","input":"hi"}"#, "x").is_err());
    }

    #[test]
    fn function_call_arguments_are_held_back_until_done() {
        let mut rewriter = ResponsesResumeRewriter::new("resp_1".into(), 0, 0);
        let added = r#"data: {"type":"response.output_item.added","sequence_number":0,"output_index":0,"item":{"id":"fc_1","type":"function_call","name":"lookup"}}"#;
        assert_eq!(
            rewriter.rewrite_block(added).unwrap(),
            None,
            "参数没收完前不得转发"
        );
        let delta = r#"data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\"a\":"}"#;
        assert_eq!(rewriter.rewrite_block(delta).unwrap(), None);
        let done = r#"data: {"type":"response.output_item.done","sequence_number":2,"output_index":0,"item":{"id":"fc_1","type":"function_call","arguments":"{}"}}"#;
        let flushed = rewriter
            .rewrite_block(done)
            .unwrap()
            .expect("done 应当把整条调用一起放出来");
        assert!(flushed.contains("fc_1"));
        assert!(flushed.contains("response.output_item.added"));
        assert!(flushed.contains("response.output_item.done"));
        assert_eq!(
            flushed.matches("data: ").count(),
            3,
            "added+delta+done 一起放"
        );
    }

    #[test]
    fn a_cut_inside_function_call_drops_the_item_instead_of_forwarding_it() {
        let mut rewriter = ResponsesResumeRewriter::new("resp_1".into(), 0, 0);
        let added = r#"data: {"type":"response.output_item.added","sequence_number":0,"output_index":0,"item":{"id":"fc_1","type":"function_call","name":"lookup"}}"#;
        assert_eq!(rewriter.rewrite_block(added).unwrap(), None);
        let delta = r#"data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\"a\":"}"#;
        assert_eq!(rewriter.rewrite_block(delta).unwrap(), None);
        // 上游提前结束：整条丢弃，重新请求。
        rewriter.discard_held();
        let next_round =
            r#"data: {"type":"response.output_text.delta","item_id":"m2","delta":"接着写"}"#;
        let out = rewriter.rewrite_block(next_round).unwrap().expect("block");
        assert!(!out.contains("fc_1"), "半截调用不能到客户端");
        assert!(out.contains("接着写"));
    }

    #[test]
    fn a_new_item_waits_for_the_held_call_instead_of_discarding_it() {
        let mut rewriter = ResponsesResumeRewriter::new("resp_1".into(), 0, 0);
        let added = r#"data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call"}}"#;
        assert_eq!(rewriter.rewrite_block(added).unwrap(), None);
        let text = r#"data: {"type":"response.output_item.added","output_index":1,"item":{"id":"m1","type":"message"}}"#;
        assert_eq!(rewriter.rewrite_block(text).unwrap(), None);
        let done = r#"data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","arguments":"{}"}}"#;
        let out = rewriter
            .rewrite_block(done)
            .unwrap()
            .expect("complete items");
        assert!(out.contains("fc_1") && out.contains("m1"));
        let events: Vec<Value> = out
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .map(|data| serde_json::from_str(data).unwrap())
            .collect();
        assert_eq!(events[0]["output_index"], 0);
        assert_eq!(events[1]["output_index"], 1);
        assert_eq!(
            events[2]["output_index"], 0,
            "交错的 done 必须仍属于原 item"
        );
    }

    #[test]
    fn plan_continuation_carries_the_seam_cursor_and_the_half_written_text() {
        let body = br#"{"model":"gpt-6-astra","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}]}"#;
        let state = StreamContinuationState {
            response_id: Some("resp_1".into()),
            last_sequence_number: 7,
            completed_items: vec!["m0".into()],
            open_item: None,
            partial_text: "半截回答".into(),
            text_truncated: false,
            open_item_text: String::new(),
        };
        let plan = plan_continuation(body, &state).expect("plan");
        assert_eq!(plan.response_id, "resp_1");
        assert_eq!(plan.next_sequence_number, 8);
        assert_eq!(plan.next_output_index, 1);
        let value: serde_json::Value = serde_json::from_slice(&plan.body).unwrap();
        let input = value["input"].as_array().unwrap();
        assert_eq!(
            input.last().unwrap()["content"][0]["text"],
            CONTINUE_INSTRUCTION
        );
    }

    #[test]
    fn a_cut_inside_encrypted_reasoning_abandons_continuation() {
        let body = br#"{"model":"m","input":[]}"#;
        let encrypted = StreamContinuationState {
            response_id: Some("resp_1".into()),
            partial_text: "已经写了一点".into(),
            open_item: Some(OpenItem {
                id: "rs_1".into(),
                kind: OpenItemKind::Reasoning,
                output_index: 1,
                encrypted: true,
            }),
            ..StreamContinuationState::default()
        };
        assert!(
            plan_continuation(body, &encrypted).is_none(),
            "加密 reasoning 断在半截，密文无法重建，必须放弃续写"
        );

        // 不带密文的 reasoning 只是普通 item，可以照常续写。
        let plain = StreamContinuationState {
            open_item: Some(OpenItem {
                id: "rs_2".into(),
                kind: OpenItemKind::Reasoning,
                output_index: 1,
                encrypted: false,
            }),
            ..encrypted.clone()
        };
        assert!(plan_continuation(body, &plain).is_some());
    }

    #[test]
    fn plan_continuation_puts_the_new_item_after_the_dangling_one() {
        let body = br#"{"model":"m","input":[]}"#;
        let state = StreamContinuationState {
            response_id: Some("resp_1".into()),
            last_sequence_number: 4,
            completed_items: vec!["m0".into()],
            open_item: Some(OpenItem {
                id: "m1".into(),
                kind: OpenItemKind::Message,
                output_index: 1,
                encrypted: false,
            }),
            partial_text: "半截".into(),
            open_item_text: "半截".into(),
            text_truncated: false,
        };
        let plan = plan_continuation(body, &state).expect("plan");
        assert_eq!(
            plan.next_output_index, 2,
            "断流 item 占着 index 1，新 item 必须排到 2"
        );
    }

    #[test]
    fn plan_continuation_gives_up_without_a_response_id_or_partial_text() {
        let body = br#"{"model":"m","input":[]}"#;
        let no_text = StreamContinuationState {
            response_id: Some("resp_1".into()),
            partial_text: String::new(),
            ..StreamContinuationState::default()
        };
        assert!(plan_continuation(body, &no_text).is_none());

        let no_id = StreamContinuationState {
            response_id: None,
            partial_text: "x".into(),
            ..StreamContinuationState::default()
        };
        assert!(plan_continuation(body, &no_id).is_none());

        let truncated = StreamContinuationState {
            response_id: Some("resp_1".into()),
            partial_text: "x".into(),
            text_truncated: true,
            ..StreamContinuationState::default()
        };
        assert!(plan_continuation(body, &truncated).is_none());
    }
}
