//! Cross-resource Responses replay stripping.
//!
//! Azure OpenAI's Responses API is stateful: item ids (`msg_…`, `rs_…`,
//! `ctc_…`), encrypted reasoning and `previous_response_id` are stored and
//! encrypted per resource. A relay that rotates over several resources without
//! session affinity answers the replayed history of one conversation from a
//! resource that never created it, and Azure rejects the whole turn:
//!
//! `The requested item was created under a different Azure OpenAI resource.
//! Use the same resource that created the item to access it.`
//!
//! This is the local equivalent of `codex-strip-proxy`: drop exactly the
//! resource-bound state before forwarding, so every request becomes a
//! stateless shape any resource in the pool can accept. Message text, tool
//! `call_id`s and arguments, summaries, request headers and the response stream
//! are never touched.
//!
//! Cost: the model stops continuing a hidden reasoning chain across turns and
//! reasons again each turn. A client that replays only `previous_response_id`
//! instead of the full history loses that server-side context too, which is why
//! this stays behind an account switch and a site allow-list rather than being
//! always-on. Conversation content and tool calls are unaffected.
//! Unlike [`crate::services::responses_encrypted_content`], which is
//! shape-aware and deliberately keeps well-formed ciphertext, this pass is
//! unconditional — a well-formed envelope minted by another resource is exactly
//! the case that has to go.
use serde_json::Value;
use std::sync::OnceLock;

pub(crate) const CONFIG_KEY: &str = "responses_cross_resource_strip";

pub(crate) fn validate(mode: Option<&Value>) -> Result<(), crate::error::AppError> {
    if matches!(mode, None | Some(Value::Null))
        || mode
            .and_then(Value::as_str)
            .is_some_and(|s| matches!(s, "auto" | "on" | "off"))
    {
        return Ok(());
    }
    Err(crate::error::AppError::Validation {
        code: "validation.responses_cross_resource_strip",
        message: "跨资源状态剥离仅支持 auto、on、off。".into(),
        details: None,
        recoverable: true,
    })
}

/// Missing/auto follows the verified site list; explicit on is an opt-in for
/// any other relay; explicit off always wins. Unknown values fail closed.
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
            "../../../src/lib/responsesCrossResourceStripHosts.json"
        ))
        .expect("valid built-in hosts")
    });
    url.host_str().is_some_and(|host| {
        hosts
            .iter()
            .any(|allowed| host.eq_ignore_ascii_case(allowed))
    })
}

/// Azure spells the encrypted carriers as `encrypted_content` today; match the
/// whole `encrypted*` family so a renamed carrier cannot slip through.
fn is_encrypted_key(key: &str) -> bool {
    key.len() >= "encrypted".len() && key[.."encrypted".len()].eq_ignore_ascii_case("encrypted")
}

/// Remove resource-bound state from a Responses request body.
///
/// Only top-level `input` items are rewritten: their `id` and every
/// `encrypted*` field are dropped. The top-level `previous_response_id` chain
/// goes with them. Items keep their order and content; the one exception is a
/// pure `item_reference`, which is nothing but a foreign id — leaving it behind
/// without that id only trades the cross-resource error for a missing-parameter
/// one, so it is dropped whole.
/// Returns `None` for a byte-preserving no-op.
pub(crate) fn strip(body: &[u8]) -> Option<Vec<u8>> {
    let mut root: Value = serde_json::from_slice(body).ok()?;
    let object = root.as_object_mut()?;
    let mut changed = object.remove("previous_response_id").is_some();
    if let Some(Value::Array(items)) = object.get_mut("input") {
        items.retain_mut(|item| {
            let Some(item) = item.as_object_mut() else {
                return true;
            };
            let had_id = item.remove("id").is_some();
            changed |= had_id;
            let encrypted = item
                .keys()
                .filter(|key| is_encrypted_key(key))
                .cloned()
                .collect::<Vec<_>>();
            for key in encrypted {
                changed |= item.remove(&key).is_some();
            }
            let bare_reference = had_id
                && item.len() == 1
                && item.get("type").and_then(Value::as_str) == Some("item_reference");
            changed |= bare_reference;
            !bare_reference
        });
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
            ("https://agentrouter.org/v1", true),
            ("HTTPS://AGENTROUTER.ORG:443/v1", true),
            ("https://ps.air-outer.com/v1", true),
            ("https://sub.agentrouter.org/v1", false),
            ("https://agentrouter.org.evil.example/v1", false),
            ("https://evil.example/agentrouter.org", false),
            ("https://agentrouter.org@evil.example/v1", false),
            ("https://agentrouter.org./v1", false),
            ("file://agentrouter.org/v1", false),
            ("not a URL", false),
        ] {
            assert_eq!(enabled(&json!({"base_url":url})), expected, "{url}");
            assert_eq!(
                enabled(&json!({"base_url":url,"responses_cross_resource_strip":"auto"})),
                expected
            );
            assert!(!enabled(
                &json!({"base_url":url,"responses_cross_resource_strip":"off"})
            ));
        }
        assert!(enabled(
            &json!({"base_url":"https://another.example/v1","responses_cross_resource_strip":"on"})
        ));
        assert!(!enabled(
            &json!({"base_url":"https://agentrouter.org","responses_cross_resource_strip":"invalid"})
        ));
    }

    #[test]
    fn strips_ids_ciphertext_and_previous_response_id_but_nothing_else() {
        let request = json!({
            "store": true,
            "previous_response_id": "resp_foreign",
            "include": ["reasoning.encrypted_content"],
            "input": [
                {"type": "message", "id": "msg_1", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                {"type": "reasoning", "id": "rs_1", "summary": [{"type": "summary_text", "text": "plan"}],
                 "encrypted_content": "gAAAA-opaque", "status": "completed"},
                {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                {"type": "function_call_output", "id": "fco_1", "call_id": "call_1", "output": "result"},
                {"type": "item_reference", "id": "rs_foreign"}
            ]
        });
        let stripped = strip(&serde_json::to_vec(&request).unwrap()).expect("state is removed");
        let value: Value = serde_json::from_slice(&stripped).unwrap();
        assert_eq!(
            value,
            json!({
                "store": true,
                "include": ["reasoning.encrypted_content"],
                "input": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hello"}]},
                    {"type": "reasoning", "summary": [{"type": "summary_text", "text": "plan"}], "status": "completed"},
                    {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
                    {"type": "function_call_output", "call_id": "call_1", "output": "result"}
                ]
            })
        );
        assert!(strip(&stripped).is_none(), "剥离必须幂等");
    }

    #[test]
    fn drops_every_encrypted_carrier_case_insensitively() {
        let request = json!({"input": [{
            "type": "reasoning", "id": "rs_1",
            "encrypted_content": "a", "EncryptedReasoning": "b", "encrypted": "c"
        }]});
        let value: Value =
            serde_json::from_slice(&strip(&serde_json::to_vec(&request).unwrap()).unwrap()).unwrap();
        assert_eq!(value, json!({"input": [{"type": "reasoning"}]}));
    }

    #[test]
    fn a_reference_with_extra_fields_survives_without_its_id() {
        let request = json!({"input": [{"type": "item_reference", "id": "rs_1", "note": "keep"}]});
        let value: Value =
            serde_json::from_slice(&strip(&serde_json::to_vec(&request).unwrap()).unwrap()).unwrap();
        assert_eq!(
            value,
            json!({"input": [{"type": "item_reference", "note": "keep"}]})
        );
    }

    #[test]
    fn leaves_requests_without_resource_bound_state_untouched() {
        for request in [
            &b"not json"[..],
            &b"null"[..],
            &b"[]"[..],
            &b"{}"[..],
            &br#"{"input":"hello"}"#[..],
            &br#"{"input":[null,7,{"role":"user","content":"hello"}]}"#[..],
            &br#"{"input":[{"type":"message","role":"user","content":"hello"}],"tools":[]}"#[..],
        ] {
            assert!(strip(request).is_none(), "unexpected rewrite for {request:?}");
        }
    }
}
