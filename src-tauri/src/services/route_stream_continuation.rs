//! 流式断流自动续写：续写请求体构造与续写事件重写。
//!
//! 设计见 `docs/superpowers/specs/2026-10-09-stream-continuation-design.md`。

use serde_json::{json, Value};

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
    fn rejects_a_body_whose_input_is_not_an_array() {
        assert!(build_continuation_body(br#"{"model":"m","input":"hi"}"#, "x").is_err());
    }
}
