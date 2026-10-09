//! 流式断流自动续写：续写请求体构造与续写事件重写。
//!
//! 设计见 `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`。

use serde_json::{json, Value};

use crate::models::route_pool::RouteUsageBreakdown;
use crate::services::route_proxy_stream::{OpenItem, OpenItemKind, StreamContinuationState};

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
    items.push(json!({
        "type": "message",
        "role": "assistant",
        "content": [{ "type": "output_text", "text": partial_text }]
    }));
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
    if state.partial_text.is_empty() {
        return None;
    }
    let body = build_continuation_body(original_body, &state.partial_text).ok()?;
    Some(ContinuationPlan {
        body,
        response_id,
        next_sequence_number: state.last_sequence_number + 1,
        next_output_index: state.completed_items.len() as u64,
    })
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
    /// 正在暂存的工具调用/reasoning item id（spec 第 8.1 节）。
    held_item: Option<String>,
    /// 暂存区块，按到达顺序排好；`output_item.done` 时一次性吐出。
    held_blocks: Vec<String>,
}

impl ResponsesResumeRewriter {
    pub fn new(response_id: String, next_sequence_number: u64, next_output_index: u64) -> Self {
        Self {
            response_id,
            next_sequence_number,
            next_output_index,
            held_item: None,
            held_blocks: Vec::new(),
        }
    }

    /// 丢掉没等到 `output_item.done` 的暂存 item。
    ///
    /// 续写流又断了、要开下一轮时调用：半截工具调用客户端从未见过，整条丢弃，
    /// 让模型重新发一次完整的（spec 第 8.2 节）。
    pub fn discard_held(&mut self) {
        self.held_item = None;
        self.held_blocks.clear();
    }

    /// `Ok(None)` 表示这一块不再转发。
    pub fn rewrite_block(&mut self, block: &str) -> Result<Option<String>, String> {
        let payload = block
            .lines()
            .filter_map(|line| line.trim().strip_prefix("data:").map(str::trim))
            .collect::<Vec<_>>()
            .join("\n");
        if payload.is_empty() || payload == "[DONE]" {
            return Ok(None);
        }
        let mut value: Value = match serde_json::from_str(&payload) {
            Ok(value) => value,
            // 解析不了的块原样透传：宁可让客户端看到上游原文，也不要吞掉它。
            Err(_) => return Ok(Some(ensure_terminator(block))),
        };
        let event = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        match event.as_str() {
            // response 已经在客户端那边创建过了；收尾由 `finish` 自己发。
            "response.created" | "response.in_progress" | "response.completed" => return Ok(None),
            _ => {}
        }
        // 暂存中的 item：它的后续块先攒着，等 `output_item.done` 一起放。
        if let Some(held) = self.held_item.clone() {
            if json_item_id(&value).as_deref() == Some(held.as_str()) {
                let rendered = self.render(value, &event)?;
                if event == "response.output_item.done" {
                    self.held_item = None;
                    let mut output: String = self.held_blocks.drain(..).collect();
                    output.push_str(&rendered);
                    return Ok(Some(output));
                }
                self.held_blocks.push(rendered);
                return Ok(None);
            }
            // 不是暂存 item 的块：暂存的东西永远不会收尾了，丢掉它继续。
            self.discard_held();
        }

        // 新的工具调用 / reasoning item：开始暂存，先不转发。
        if event == "response.output_item.added"
            && json_item_kind(&value).is_some_and(is_holdback_item)
        {
            let item_id = json_item_id(&value);
            let rendered = self.render(value, &event)?;
            self.held_item = item_id;
            self.held_blocks.push(rendered);
            return Ok(None);
        }

        Ok(Some(self.render(value, &event)?))
    }

    /// 给一块事件重写序号与 `output_index`，渲染成完整的 SSE 记录。
    fn render(&mut self, mut value: Value, event: &str) -> Result<String, String> {
        value["sequence_number"] = Value::from(self.next_sequence_number);
        self.next_sequence_number += 1;
        match event {
            // 只有新出现的 item 才占一个新位置；`done` 与后续的 delta 都属于
            // 同一个 item，必须复用 `added` 分配的那个 `output_index`。
            "response.output_item.added" => {
                value["output_index"] = Value::from(self.next_output_index);
                self.next_output_index += 1;
            }
            _ => {
                if value.get("output_index").and_then(Value::as_u64).is_some() {
                    value["output_index"] = Value::from(self.next_output_index.saturating_sub(1));
                }
            }
        }
        let text = serde_json::to_string(&value).map_err(|error| error.to_string())?;
        Ok(format!("data: {text}\n\n"))
    }

    /// 续写全部结束后由网关合成的收尾事件。
    ///
    /// Task 1 实测：客户端是从流式的 `output_item.*` 记录会话历史的，这里
    /// `output` 留空也不丢内容，所以不必重建整个 output 数组。
    pub fn finish(&mut self, usage: &RouteUsageBreakdown) -> String {
        synthesized_completion_block(&self.response_id, self.next_sequence_number, usage)
    }
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
        assert_eq!(rewriter.rewrite_block(added).unwrap(), None, "参数没收完前不得转发");
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
        assert_eq!(flushed.matches("data: ").count(), 3, "added+delta+done 一起放");
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
        let next_round = r#"data: {"type":"response.output_text.delta","item_id":"m2","delta":"接着写"}"#;
        let out = rewriter.rewrite_block(next_round).unwrap().expect("block");
        assert!(!out.contains("fc_1"), "半截调用不能到客户端");
        assert!(out.contains("接着写"));
    }

    #[test]
    fn a_new_item_abandons_a_held_call_that_will_never_finish() {
        let mut rewriter = ResponsesResumeRewriter::new("resp_1".into(), 0, 0);
        let added = r#"data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call"}}"#;
        assert_eq!(rewriter.rewrite_block(added).unwrap(), None);
        let text = r#"data: {"type":"response.output_item.added","output_index":1,"item":{"id":"m1","type":"message"}}"#;
        let out = rewriter.rewrite_block(text).unwrap().expect("block");
        assert!(!out.contains("fc_1"), "永远收不了尾的暂存要丢掉");
        assert!(out.contains("m1"));
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
        };
        let plan = plan_continuation(body, &state).expect("plan");
        assert_eq!(plan.response_id, "resp_1");
        assert_eq!(plan.next_sequence_number, 8);
        assert_eq!(plan.next_output_index, 1);
        let value: serde_json::Value = serde_json::from_slice(&plan.body).unwrap();
        let input = value["input"].as_array().unwrap();
        assert_eq!(input.last().unwrap()["content"][0]["text"], CONTINUE_INSTRUCTION);
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
