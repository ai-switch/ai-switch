//! Per-account request rewrite for upstreams that cap how many images one
//! request may carry (`Exceeded maximum number of images (50) allowed in the
//! request.`).
//!
//! The count lives in the conversation the client sends, so the only way to keep
//! the turn alive without touching the client's history is to drop the older
//! images from the copy that goes upstream. The newest ones are kept: they are
//! what the user is actually looking at, and an agent session that has been
//! running for hours is exactly the case where the oldest screenshots are the
//! least likely to matter.
//!
//! Nothing here is applied unless the account opts in. Switching it on is the
//! user's decision, or the proxy's own self-heal the first time the upstream
//! answers with that limit — see `enable_image_limit_compat`.

use crate::error::AppError;
use serde_json::{json, Value};

pub(crate) const CONFIG_KEY: &str = "image_limit_compat";
/// The one mode this switch has. A string rather than a bool so a later mode
/// (drop by age, drop by size) can be added without a second key.
pub(crate) const TRIM_OLD_IMAGES: &str = "trim_old_images";
/// How many of the newest images survive the rewrite.
///
/// Well under the 50 most relays enforce, so one trim is enough for any limit a
/// provider is likely to set. The exact limit is never assumed: it is the
/// upstream's number, not ours, and it differs per relay.
const KEEP_LATEST_IMAGES: usize = 10;
pub(crate) const ELIDED_IMAGE: &str = "[ai-switch: an earlier image was omitted because this upstream limits images per request; send it again if it is still needed]";

pub(crate) fn validate(mode: Option<&Value>) -> Result<(), AppError> {
    if matches!(mode, None | Some(Value::Null))
        || mode
            .and_then(Value::as_str)
            .is_some_and(|mode| matches!(mode, "off" | TRIM_OLD_IMAGES))
    {
        return Ok(());
    }
    Err(AppError::Validation {
        code: "validation.image_limit_compat",
        message: "图片超限兼容仅支持 off 或 trim_old_images。".to_string(),
        details: None,
        recoverable: true,
    })
}

pub(crate) fn trim_enabled(config: &Value) -> bool {
    config.get(CONFIG_KEY).and_then(Value::as_str) == Some(TRIM_OLD_IMAGES)
}

/// Replace all but the newest [`KEEP_LATEST_IMAGES`] images with a text
/// placeholder.
///
/// Returns `None` when the body already fits (nothing to rewrite) or cannot be
/// parsed — the caller then sends the original bytes untouched.
///
/// Only the three containers that actually hold conversation parts are walked:
/// Responses `input[]` (`content` and `output`), Chat/Anthropic `messages[]`
/// (`content`). A blanket walk of the whole document would also reach JSON
/// schemas under `tools[]`, where `{"type":"image"}` describes a tool argument
/// rather than an image the user sent.
pub(crate) fn trim_old_images(body: &[u8]) -> Option<Vec<u8>> {
    let mut value = serde_json::from_slice::<Value>(body).ok()?;
    let object = value.as_object_mut()?;
    let total = count_images(object);
    if total <= KEEP_LATEST_IMAGES {
        return None;
    }
    // Replace oldest-first, so the newest images are the ones that stay.
    let mut budget = total - KEEP_LATEST_IMAGES;
    let mut changed = false;
    if let Some(messages) = object.get_mut("messages").and_then(Value::as_array_mut) {
        for message in messages.iter_mut() {
            if budget == 0 {
                break;
            }
            changed |= replace_in_parts(message, &mut budget);
        }
    }
    if let Some(items) = object.get_mut("input").and_then(Value::as_array_mut) {
        for item in items.iter_mut() {
            if budget == 0 {
                break;
            }
            changed |= replace_in_parts(item, &mut budget);
        }
    }
    changed.then(|| serde_json::to_vec(&value).ok()).flatten()
}

fn count_images(object: &serde_json::Map<String, Value>) -> usize {
    let mut total = 0usize;
    for key in ["messages", "input"] {
        if let Some(entries) = object.get(key).and_then(Value::as_array) {
            for entry in entries {
                total = total.saturating_add(count_in_parts(entry));
            }
        }
    }
    total
}

/// An image part in any of the three shapes the proxy can be handed:
/// Responses `input_image`, Chat `image_url`, Anthropic `image`.
fn is_image_part(part: &Value) -> bool {
    part.get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| matches!(kind, "input_image" | "image_url" | "image"))
}

/// The placeholder keeps the part's own dialect: `input_text` inside a Responses
/// body, `text` inside a Chat or Anthropic one. A message whose only part was an
/// image stays a valid message instead of becoming an empty content array.
fn image_placeholder(part: &Value) -> Value {
    let text_type = if part.get("type").and_then(Value::as_str) == Some("input_image") {
        "input_text"
    } else {
        "text"
    };
    json!({ "type": text_type, "text": ELIDED_IMAGE })
}

/// A Responses `input[]` item carries its parts under `content`, a tool output
/// carries them under `output`; a Chat/Anthropic message under `content`. Both
/// may also be a plain string, which never holds an image.
fn count_in_parts(entry: &Value) -> usize {
    ["content", "output"]
        .iter()
        .filter_map(|key| entry.get(*key).and_then(Value::as_array))
        .flatten()
        .filter(|part| is_image_part(part))
        .count()
}

fn replace_in_parts(entry: &mut Value, budget: &mut usize) -> bool {
    let mut changed = false;
    for key in ["content", "output"] {
        if *budget == 0 {
            break;
        }
        let Some(parts) = entry.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        for part in parts.iter_mut() {
            if *budget == 0 {
                break;
            }
            if !is_image_part(part) {
                continue;
            }
            *part = image_placeholder(part);
            *budget -= 1;
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(index: usize) -> Value {
        json!({"type":"input_image","image_url":format!("data:image/png;base64,{index}")})
    }

    fn responses_body(images: usize, texts: usize) -> Vec<u8> {
        let mut content = Vec::new();
        for index in 0..texts {
            content.push(json!({"type":"input_text","text":format!("step-{index}")}));
        }
        for index in 0..images {
            content.push(image(index));
        }
        serde_json::to_vec(&json!({
            "model": "gpt-5",
            "input": [{"type":"message","role":"user","content":content}]
        }))
        .unwrap()
    }

    #[test]
    fn keeps_the_newest_images_and_elides_the_older_ones() {
        let body = responses_body(13, 1);
        let trimmed: Value = serde_json::from_slice(&trim_old_images(&body).unwrap()).unwrap();
        let content = trimmed["input"][0]["content"].as_array().unwrap();
        // 1 text part + 3 placeholders + 10 surviving images.
        assert_eq!(content.len(), 14);
        for part in &content[1..4] {
            assert_eq!(part["type"], "input_text");
            assert_eq!(part["text"], ELIDED_IMAGE);
        }
        for (offset, part) in content[4..].iter().enumerate() {
            assert_eq!(part["type"], "input_image");
            assert_eq!(
                part["image_url"],
                format!("data:image/png;base64,{}", offset + 3)
            );
        }
        // Idempotent: nothing left to trim.
        assert_eq!(
            trim_old_images(&serde_json::to_vec(&trimmed).unwrap()),
            None
        );
    }

    #[test]
    fn exactly_the_kept_number_needs_no_rewrite() {
        assert_eq!(trim_old_images(&responses_body(10, 0)), None);
    }

    #[test]
    fn chat_image_parts_become_text_parts() {
        let messages = (0..12)
            .map(|index| {
                json!({"role":"user","content":[
                    {"type":"image_url","image_url":{"url":format!("https://example.test/{index}.png")}}
                ]})
            })
            .collect::<Vec<_>>();
        let body = serde_json::to_vec(&json!({"model":"gpt-4o","messages":messages})).unwrap();
        let trimmed: Value = serde_json::from_slice(&trim_old_images(&body).unwrap()).unwrap();
        assert_eq!(trimmed["messages"][0]["content"][0]["type"], "text");
        assert_eq!(trimmed["messages"][0]["content"][0]["text"], ELIDED_IMAGE);
        // The newest ten are untouched.
        assert_eq!(trimmed["messages"][2]["content"][0]["type"], "image_url");
        assert_eq!(
            trimmed["messages"][11]["content"][0]["image_url"]["url"],
            "https://example.test/11.png"
        );
    }

    #[test]
    fn anthropic_blocks_and_tool_outputs_are_trimmed_in_place() {
        let messages = (0..6)
            .map(|index| {
                json!({"role":"user","content":[
                    {"type":"text","text":format!("look {index}")},
                    {"type":"image","source":{"type":"base64","data":"AA=="}}
                ]})
            })
            .collect::<Vec<_>>();
        let outputs = (0..6)
            .map(|index| {
                json!({"type":"function_call_output","call_id":format!("call-{index}"),"output":[
                    {"type":"input_text","text":"log"},
                    {"type":"input_image","image_url":"data:image/png;base64,AA=="}
                ]})
            })
            .collect::<Vec<_>>();
        let body = serde_json::to_vec(&json!({"messages": messages, "input": outputs})).unwrap();

        let trimmed: Value = serde_json::from_slice(&trim_old_images(&body).unwrap()).unwrap();
        // Twelve images total, ten survive: the two oldest are replaced.
        assert_eq!(trimmed["messages"][0]["content"][1]["type"], "text");
        assert_eq!(trimmed["messages"][0]["content"][1]["text"], ELIDED_IMAGE);
        assert_eq!(trimmed["messages"][1]["content"][1]["type"], "text");
        assert_eq!(trimmed["messages"][2]["content"][1]["type"], "image");
        // The image inside a tool output keeps its Responses dialect.
        assert_eq!(trimmed["input"][0]["output"][1]["type"], "input_image");
        assert_eq!(trimmed["input"][5]["output"][1]["type"], "input_image");
    }

    #[test]
    fn tool_schemas_that_mention_images_are_not_touched() {
        let body = serde_json::to_vec(&json!({
            "tools": [{"type":"function","name":"Render","parameters":{
                "type":"object","properties":{"image":{"type":"image"}}
            }}],
            "input": [{"type":"message","role":"user","content":[image(0)]}]
        }))
        .unwrap();
        // Only one real image; the schema's `type: image` must not count.
        assert_eq!(trim_old_images(&body), None);
    }

    #[test]
    fn enabled_and_validation_follow_the_config_key() {
        assert!(!trim_enabled(&json!({})));
        assert!(!trim_enabled(&json!({CONFIG_KEY:"off"})));
        assert!(trim_enabled(&json!({CONFIG_KEY:TRIM_OLD_IMAGES})));
        for mode in [
            None,
            Some(Value::Null),
            Some(json!("off")),
            Some(json!(TRIM_OLD_IMAGES)),
        ] {
            assert!(validate(mode.as_ref()).is_ok());
        }
        for mode in [json!("on"), json!(true), json!("trim_all")] {
            assert!(validate(Some(&mode)).is_err());
        }
    }

    #[test]
    fn a_body_without_images_or_without_json_is_left_alone() {
        assert_eq!(trim_old_images(b"not json"), None);
        assert_eq!(
            trim_old_images(br#"{"model":"gpt-5","input":"hello"}"#),
            None
        );
    }
}
