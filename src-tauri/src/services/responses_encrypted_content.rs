use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde_json::Value;

// Bound decoding work for untrusted input. The outer-envelope check does not
// decrypt or authenticate ciphertext, so a foreign resource's valid-looking
// encrypted state must still be preserved.
const MAX_REASONING_CIPHERTEXT_LEN: usize = 32 * 1024 * 1024;

fn has_valid_reasoning_ciphertext_shape(content: &str) -> bool {
    if content.len() > MAX_REASONING_CIPHERTEXT_LEN
        || !content.starts_with("gAAAA")
        || content.trim() != content
    {
        return false;
    }
    let Ok(decoded) = URL_SAFE_NO_PAD
        .decode(content)
        .or_else(|_| URL_SAFE.decode(content))
    else {
        return false;
    };
    // Fernet: version (1), timestamp (8), IV (16), AES blocks, HMAC (32).
    decoded.len() >= 73 && decoded[0] == 0x80 && (decoded.len() - 57) % 16 == 0
}

/// Conservative Responses replay compatibility.
/// Only invalid/missing reasoning ciphertext and its orphan id are considered.
/// Never replace an item, resolve an opaque reference, or discard compaction,
/// messages, tool calls, summaries, or valid-looking encrypted state.
///
/// An explicit `store: true` keeps IDs for server-side lookup. The other modes
/// may replay inline reasoning without an ID; this is upstream compatibility,
/// not a guarantee that every Responses provider accepts that shape.
/// Returns `None` for a byte-preserving no-op.
pub(crate) fn sanitize_replayed_reasoning_from_bytes(body: &[u8]) -> Option<Vec<u8>> {
    let mut value = serde_json::from_slice::<Value>(body).ok()?;
    let strip_orphan_ids = value.get("store").and_then(Value::as_bool) != Some(true);
    let input = value.get_mut("input")?.as_array_mut()?;
    let mut changed = false;
    for item in input {
        let Some(item) = item.as_object_mut() else {
            continue;
        };
        if item.get("type").and_then(Value::as_str).map(str::trim) != Some("reasoning") {
            continue;
        }
        if item
            .get("encrypted_content")
            .and_then(Value::as_str)
            .is_some_and(has_valid_reasoning_ciphertext_shape)
        {
            continue;
        }
        changed |= item.remove("encrypted_content").is_some();
        if strip_orphan_ids {
            changed |= item.remove("id").is_some();
        }
    }
    changed.then(|| serde_json::to_vec(&value).ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::sanitize_replayed_reasoning_from_bytes;
    use serde_json::{json, Value};

    // A structurally valid Fernet envelope, not a real upstream secret. Shape
    // validity must not be mistaken for proof that another resource can decrypt it.
    const VALID_CIPHERTEXT: &str = "gAAAAAAAAAAAAQEBAQEBAQEBAQEBAQEBAQICAgICAgICAgICAgICAgIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw==";

    #[test]
    fn conservative_cleanup_preserves_valid_ciphertext_and_ids_in_every_store_mode() {
        for store in [None, Some(false), Some(true)] {
            for ciphertext in [VALID_CIPHERTEXT, VALID_CIPHERTEXT.trim_end_matches('=')] {
                let mut request = json!({"input": [{
                    "type": "reasoning", "id": "rs_valid", "summary": [],
                    "encrypted_content": ciphertext
                }]});
                if let Some(store) = store {
                    request["store"] = json!(store);
                }
                assert!(
                    sanitize_replayed_reasoning_from_bytes(&serde_json::to_vec(&request).unwrap())
                        .is_none(),
                    "must preserve valid replay for store={store:?}"
                );
            }
        }
    }

    #[test]
    fn conservative_cleanup_removes_invalid_ciphertext_and_only_orphan_ids() {
        for store in [None, Some(false), Some(true)] {
            let mut request = json!({
                "include": ["reasoning.encrypted_content"], "previous_response_id": "resp_previous",
                "input": [
                    {"type": "reasoning", "id": "rs_bad", "summary": [{"type": "summary_text", "text": "keep summary"}],
                     "content": [{"type": "reasoning_text", "text": "keep content"}], "status": "completed", "encrypted_content": "invalid"},
                    {"type": "reasoning", "id": "rs_orphan", "summary": []},
                    {"type": "reasoning", "id": "rs_valid", "summary": [], "encrypted_content": VALID_CIPHERTEXT}
                ]
            });
            if let Some(store) = store {
                request["store"] = json!(store);
            }
            let mut expected = request.clone();
            expected["input"][0]
                .as_object_mut()
                .unwrap()
                .remove("encrypted_content");
            if store != Some(true) {
                expected["input"][0].as_object_mut().unwrap().remove("id");
                expected["input"][1].as_object_mut().unwrap().remove("id");
            }
            let rewritten =
                sanitize_replayed_reasoning_from_bytes(&serde_json::to_vec(&request).unwrap())
                    .expect("invalid reasoning fields are cleaned");
            assert_eq!(
                serde_json::from_slice::<Value>(&rewritten).unwrap(),
                expected
            );
            assert!(
                sanitize_replayed_reasoning_from_bytes(&rewritten).is_none(),
                "cleanup must be idempotent"
            );
        }
    }

    #[test]
    fn conservative_cleanup_handles_malformed_ciphertext_without_dropping_the_item() {
        for invalid in [
            Value::Null,
            json!(17),
            json!(false),
            json!({"opaque": "data"}),
            json!([]),
            json!(""),
            json!("not-base64"),
            json!("gAAAAABforeign-encrypted-content"),
            json!(format!(" {VALID_CIPHERTEXT}")),
            json!(format!("{VALID_CIPHERTEXT}\n")),
            json!(VALID_CIPHERTEXT.replace('_', "/").replace("AQE", "+QE")),
        ] {
            let request = json!({"store": false, "input": [{
                "type": "reasoning", "id": "rs_bad", "summary": [], "encrypted_content": invalid
            }]});
            let rewritten =
                sanitize_replayed_reasoning_from_bytes(&serde_json::to_vec(&request).unwrap())
                    .expect("malformed ciphertext is removed");
            assert_eq!(
                serde_json::from_slice::<Value>(&rewritten).unwrap(),
                json!({
                    "store": false, "input": [{"type": "reasoning", "summary": []}]
                }),
                "invalid={invalid}"
            );
        }
    }

    #[test]
    fn conservative_cleanup_keeps_stored_reasoning_references_unchanged() {
        let request =
            br#"{ "store": true, "input": [{"type":"reasoning","id":"rs_stored","summary":[]}] }"#;
        assert!(sanitize_replayed_reasoning_from_bytes(request).is_none());
    }

    #[test]
    fn conservative_cleanup_never_replaces_references_messages_tools_or_compaction() {
        let business_data =
            json!({"type": "reasoning", "id": "rs_business", "encrypted_content": "invalid"});
        let request = json!({
            "store": false, "previous_response_id": "resp_previous",
            "include": ["reasoning.encrypted_content"],
            "input": [
                {"type": "item_reference", "id": "rs_foreign"},
                {"type": "item_reference", "id": "msg_foreign"},
                {"type": "item_reference", "id": "fc_foreign"},
                {"id": "rs_implicit"}, {"type": null, "id": "rs_null_type"},
                {"type": "message", "id": "msg_1", "role": "assistant", "content": [
                    {"type": "output_text", "text": "keep message"}, {"type": "encrypted_content", "encrypted_content": "message-state"}
                ]},
                {"type": "agent_message", "content": [{"type": "encrypted_content", "encrypted_content": "agent-state"}]},
                {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "id": "fco_1", "call_id": "call_1", "output": business_data},
                {"type": "compaction", "id": "cc_1", "encrypted_content": "compacted-history"},
                {"type": "compaction_summary", "encrypted_content": "summary-state"},
                {"type": "context_compaction", "id": "cc_2", "encrypted_content": "context-state"},
                {"type": "compaction_trigger"}
            ],
            "tools": [{"type": "function", "name": "lookup", "parameters": {"type": "object", "default": business_data}}],
            "metadata": {"payload": business_data}
        });
        assert!(
            sanitize_replayed_reasoning_from_bytes(&serde_json::to_vec(&request).unwrap())
                .is_none()
        );
    }

    #[test]
    fn conservative_cleanup_only_touches_top_level_reasoning_fields() {
        let request = json!({
            "input": [{"type": "reasoning", "id": "rs_orphan", "summary": [], "extra": {"id": "nested", "encrypted_content": "keep"}}],
            "metadata": {"type": "reasoning", "id": "rs_metadata", "encrypted_content": "keep"}
        });
        let rewritten =
            sanitize_replayed_reasoning_from_bytes(&serde_json::to_vec(&request).unwrap()).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&rewritten).unwrap(),
            json!({
                "input": [{"type": "reasoning", "summary": [], "extra": {"id": "nested", "encrypted_content": "keep"}}],
                "metadata": {"type": "reasoning", "id": "rs_metadata", "encrypted_content": "keep"}
            })
        );
    }

    #[test]
    fn conservative_cleanup_returns_none_for_unrelated_or_invalid_requests() {
        for request in [
            &b"not json"[..],
            &b"null"[..],
            &b"{}"[..],
            &br#"{"input":"hello"}"#[..],
            &br#"{"input":{}}"#[..],
            &br#"{"input":[null,7,{"role":"user","content":"hello"}]}"#[..],
            &br#"{"input":[{"type":"reasoning","summary":[]}]}"#[..],
        ] {
            assert!(sanitize_replayed_reasoning_from_bytes(request).is_none());
        }
    }
}
