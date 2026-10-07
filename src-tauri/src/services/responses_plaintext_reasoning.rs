//! 按账号对出站 Responses 明文推理做兼容转换，不改会话存储。
//! 自动名单和前端共用；未知/扩展内容宁可不转换，也不静默丢弃。
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::OnceLock;

pub(crate) const CONFIG_KEY: &str = "responses_plaintext_reasoning_compat";

pub(crate) fn validate(mode: Option<&Value>) -> Result<(), crate::error::AppError> {
    if matches!(mode, None | Some(Value::Null))
        || mode
            .and_then(Value::as_str)
            .is_some_and(|s| matches!(s, "auto" | "on" | "off"))
    {
        return Ok(());
    }
    Err(crate::error::AppError::Validation {
        code: "validation.responses_plaintext_reasoning_compat",
        message: "Responses 明文推理兼容仅支持 auto、on、off。".into(),
        details: None,
        recoverable: true,
    })
}

pub(crate) fn enabled(config: &Value) -> bool {
    match config.get(CONFIG_KEY) {
        Some(Value::String(mode)) if mode == "on" => return true,
        Some(Value::String(mode)) if mode == "off" => return false,
        None | Some(Value::Null) => {}
        Some(Value::String(mode)) if mode == "auto" => {}
        _ => return false,
    }
    let Some(base) = config.get("base_url").and_then(Value::as_str) else {
        return false;
    };
    let Ok(url) = url::Url::parse(base.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    let hosts = HOSTS.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../src/lib/responsesPlaintextReasoningHosts.json"
        ))
        .expect("valid built-in hosts")
    });
    url.host_str().is_some_and(|host| {
        hosts
            .iter()
            .any(|allowed| host.eq_ignore_ascii_case(allowed))
    })
}

/// 仅处理可无损表达为 summary_text 的 reasoning_text 数组。
/// 保留摘要顺序和元数据；内容合为一个新摘要块，避免把碎片数问题转移到 summary。
/// 不改 ID、密文、签名、消息、工具及引用；没有改动时返回 None。
pub(crate) fn normalize(body: &[u8]) -> Option<Vec<u8>> {
    let mut root: Value = serde_json::from_slice(body).ok()?;
    let input = root.get_mut("input")?.as_array_mut()?;
    let mut changed = false;
    for item in input {
        if item.get("type").and_then(Value::as_str) != Some("reasoning") {
            continue;
        }
        let Some(parts) = item
            .get("content")
            .and_then(Value::as_array)
            .filter(|a| !a.is_empty())
        else {
            continue;
        };
        // 不吞掉未知 part 或扩展字段：密文/签名不应靠字符串转换来“兼容”。
        let texts: Option<Vec<&str>> = parts
            .iter()
            .map(|p| {
                let obj = p.as_object()?;
                if obj.len() != 2 || obj.get("type")?.as_str()? != "reasoning_text" {
                    return None;
                }
                obj.get("text")?.as_str()
            })
            .collect();
        let Some(texts) = texts else {
            continue;
        };
        let mut summary = match item.get("summary") {
            None => Vec::new(),
            Some(Value::Array(parts))
                if parts.iter().all(|p| {
                    p.get("type").and_then(Value::as_str) == Some("summary_text")
                        && p.get("text").is_some_and(Value::is_string)
                }) =>
            {
                parts.clone()
            }
            _ => continue,
        };
        let existing: HashSet<&str> = summary
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect();
        let full_text = texts.join("\n");
        let extra = if existing.contains(full_text.as_str()) {
            String::new()
        } else {
            // 仅跨 summary/content 去掉精确相同的文本，不去掉 content 内有意义的重复。
            texts
                .into_iter()
                .filter(|text| !existing.contains(text))
                .collect::<Vec<_>>()
                .join("\n")
        };
        if !extra.is_empty() {
            summary.push(json!({"type":"summary_text","text":extra}));
        }
        let object = item.as_object_mut().expect("reasoning object");
        object.insert("summary".into(), Value::Array(summary));
        object.remove("content");
        changed = true;
    }
    changed.then(|| serde_json::to_vec(&root).ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn auto_matches_only_exact_verified_hostname_and_off_wins() {
        for (url, expected) in [
            ("https://anyrouter.top/v1", true),
            ("HTTPS://ANYROUTER.TOP:443/v1", true),
            ("https://sub.anyrouter.top/v1", false),
            ("https://anyrouter.top.evil.example/v1", false),
            ("https://evil.example/anyrouter.top", false),
            ("https://anyrouter.top@evil.example/v1", false),
            ("https://anyrouter.top./v1", false),
            ("file://anyrouter.top/v1", false),
            ("not a URL", false),
        ] {
            assert_eq!(enabled(&json!({"base_url":url})), expected, "{url}");
            assert_eq!(
                enabled(&json!({"base_url":url,"responses_plaintext_reasoning_compat":"auto"})),
                expected
            );
            assert!(!enabled(
                &json!({"base_url":url,"responses_plaintext_reasoning_compat":"off"})
            ));
        }
        assert!(enabled(
            &json!({"base_url":"https://another.example/v1","responses_plaintext_reasoning_compat":"on"})
        ));
        assert!(!enabled(
            &json!({"base_url":"https://anyrouter.top","responses_plaintext_reasoning_compat":"invalid"})
        ));
    }

    #[test]
    fn preserves_original_and_opaque_fields_and_is_idempotent() {
        let original = json!({"store":true,"input":[
            {"type":"reasoning","id":"rs_a","encrypted_content":"opaque","status":"completed","summary":[],"content":[{"type":"reasoning_text","text":" A "},{"type":"reasoning_text","text":"B\nC"}]},
            {"type":"message","role":"user","content":[{"type":"input_text","text":"hello"},{"type":"input_image","image_url":"fixture"}]},
            {"type":"function_call","call_id":"c1","name":"lookup","arguments":"{}"},
            {"type":"function_call_output","call_id":"c1","output":"result"}
        ]});
        let raw = serde_json::to_vec(&original).unwrap();
        let converted = normalize(&raw).expect("nonempty content needs adapting");
        assert_eq!(serde_json::from_slice::<Value>(&raw).unwrap(), original);
        let v: Value = serde_json::from_slice(&converted).unwrap();
        let mut expected = original.clone();
        expected["input"][0]
            .as_object_mut()
            .unwrap()
            .remove("content");
        expected["input"][0]["summary"] = json!([{"type":"summary_text","text":" A \nB\nC"}]);
        assert_eq!(v, expected);
        assert!(normalize(&converted).is_none(), "重复转换必须是无操作");
    }

    #[test]
    fn merges_existing_summary_without_substring_dedup_or_repeated_migration() {
        let body = json!({"input":[{"type":"reasoning","summary":[{"type":"summary_text","text":"same","meta":"keep"},{"type":"summary_text","text":"prefix"}],
            "content":[{"type":"reasoning_text","text":"same"},{"type":"reasoning_text","text":"prefix extended"},{"type":"reasoning_text","text":"repeat"},{"type":"reasoning_text","text":"repeat"}]}]});
        let result = normalize(&serde_json::to_vec(&body).unwrap()).unwrap();
        let v: Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(
            v["input"][0]["summary"],
            json!([
                {"type":"summary_text","text":"same","meta":"keep"},
                {"type":"summary_text","text":"prefix"},
                {"type":"summary_text","text":"prefix extended\nrepeat\nrepeat"}
            ])
        );
        assert!(normalize(&result).is_none());
    }

    #[test]
    fn an_existing_complete_text_is_not_added_twice() {
        let body = json!({"input":[{"type":"reasoning","summary":[{"type":"summary_text","text":"A\nB"}],"content":[{"type":"reasoning_text","text":"A"},{"type":"reasoning_text","text":"B"}]}]});
        let v: Value =
            serde_json::from_slice(&normalize(&serde_json::to_vec(&body).unwrap()).unwrap())
                .unwrap();
        assert_eq!(v["input"][0]["summary"], body["input"][0]["summary"]);
        assert!(v["input"][0].get("content").is_none());
    }

    #[test]
    fn unknown_nontext_and_empty_shapes_are_untouched() {
        for item in [
            json!({"type":"reasoning","content":[]}),
            json!({"type":"reasoning","content":[{"type":"image","url":"keep"}]}),
            json!({"type":"reasoning","content":[{"type":"reasoning_text","text":"keep","signature":"opaque"}]}),
            json!({"type":"reasoning","summary":"unsupported shape","content":[{"type":"reasoning_text","text":"keep"}]}),
            json!({"type":"message","content":[{"type":"reasoning_text","text":"keep"}]}),
        ] {
            assert!(normalize(&json!({"input":[item]}).to_string().into_bytes()).is_none());
        }
        assert!(normalize(b"not json").is_none());
    }
}
