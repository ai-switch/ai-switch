//! 流式断流自动续写：续写请求体构造与续写事件重写。
//!
//! 设计见 `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`。

use serde_json::{json, Value};

use crate::models::route_pool::RouteUsageBreakdown;

/// 与「用户手动继续」等价的那句指令（spec 第 6 节）。
pub const CONTINUE_INSTRUCTION: &str = "Continue exactly where the previous assistant message stopped. Do not repeat anything already written, do not add a preamble, and do not restate the question.";

/// 用「原请求 + 半截回答 + 继续指令」构造续写请求体。
///
/// 只动 `input` 与 `stream`，其余字段（model / tools / reasoning / store …）
/// 原样保留——这是「质量与手动继续一致」的前提：续写用的就是同一个请求。
pub fn build_continuation_body(original_body: &[u8], partial_text: &str) -> Result<Vec<u8>, String> {
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

/// 把续写流重写成「原 response 的后续」（spec 第 7 节）。
///
/// 只负责上游是 Responses 协议的情形：丢掉续写流自己的 `response.created`
/// 与收尾事件，把序号与 `output_index` 接到原响应后面。
pub struct ResponsesResumeRewriter {
    response_id: String,
    next_sequence_number: u64,
    next_output_index: u64,
}

impl ResponsesResumeRewriter {
    pub fn new(response_id: String, next_sequence_number: u64, next_output_index: u64) -> Self {
        Self {
            response_id,
            next_sequence_number,
            next_output_index,
        }
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
        value["sequence_number"] = Value::from(self.next_sequence_number);
        self.next_sequence_number += 1;
        match event.as_str() {
            "response.output_item.added" | "response.output_item.done" => {
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
        Ok(Some(format!("data: {text}\n\n")))
    }

    /// 续写全部结束后由网关合成的收尾事件。
    ///
    /// Task 1 实测：客户端是从流式的 `output_item.*` 记录会话历史的，这里
    /// `output` 留空也不丢内容，所以不必重建整个 output 数组。
    pub fn finish(&mut self, usage: &RouteUsageBreakdown) -> String {
        let value = json!({
            "type": "response.completed",
            "sequence_number": self.next_sequence_number,
            "response": {
                "id": self.response_id,
                "object": "response",
                "status": "completed",
                "output": [],
                "usage": usage_to_responses_json(usage),
            }
        });
        format!("data: {value}\n\n")
    }
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
}
