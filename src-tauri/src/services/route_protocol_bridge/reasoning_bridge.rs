//! Opaque reasoning transport for the Responses ↔ Anthropic bridge.
//!
//! A Codex client speaks the Responses API, whose `reasoning` item carries the
//! model's chain of thought as opaque `encrypted_content` (plus an optional
//! plaintext summary). The Anthropic Messages protocol has no equivalent input
//! slot, so the plain converter drops these items — which breaks stateless tool
//! loops against a Claude upstream: the reasoning that justified a tool call is
//! gone by the next turn.
//!
//! This module round-trips the whole Responses `reasoning` item through the
//! Anthropic `thinking` / `redacted_thinking` block that the client already
//! replays verbatim, by base64-encoding the item into the block's `signature` /
//! `data` field behind a versioned prefix. On the way back the block is decoded
//! into the original `reasoning` item. Ported from cc-switch's
//! `reasoning_bridge.rs`; the prefix is namespaced to ai-switch so the two never
//! decode each other's envelopes.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Value};

/// Marks an Anthropic `signature`/`data` field as an ai-switch reasoning
/// envelope rather than a real upstream thinking signature. Versioned so the
/// decoder can reject anything it did not mint.
pub(super) const OPENAI_REASONING_ITEM_PREFIX: &str = "ai-switch-openai-reasoning-v1:";

/// Flattens a Responses `reasoning` item's `summary` parts into one string.
/// Accepts both `summary_text` (Responses) and `reasoning_text` (some gateways).
pub(super) fn reasoning_summary_text(item: &Value) -> String {
    item.get("summary")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| {
            matches!(
                part.get("type").and_then(Value::as_str),
                Some("summary_text" | "reasoning_text")
            )
            .then(|| part.get("text").and_then(Value::as_str))
            .flatten()
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Encodes a whole Responses `reasoning` item into the prefixed envelope string.
/// Returns `None` for anything that is not a reasoning item.
pub(super) fn encode_openai_reasoning_item(item: &Value) -> Option<String> {
    if item.get("type").and_then(Value::as_str) != Some("reasoning") {
        return None;
    }
    let bytes = serde_json::to_vec(item).ok()?;
    Some(format!(
        "{OPENAI_REASONING_ITEM_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(bytes)
    ))
}

/// Decodes a prefixed envelope string back into the original `reasoning` item.
/// Returns `None` when the string is not one of our envelopes.
pub(super) fn decode_openai_reasoning_item(encoded: &str) -> Option<Value> {
    let payload = encoded.strip_prefix(OPENAI_REASONING_ITEM_PREFIX)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let item: Value = serde_json::from_slice(&bytes).ok()?;
    (item.get("type").and_then(Value::as_str) == Some("reasoning")).then_some(item)
}

/// Converts a Responses `reasoning` item into the Anthropic thinking block that
/// carries it losslessly to the upstream.
///
/// - With opaque `encrypted_content`: the whole item is envelope-encoded into the
///   block's `signature` (`thinking`, when a plaintext summary exists) or `data`
///   (`redacted_thinking`, when it does not), so the round trip is exact.
/// - Plaintext-only reasoning (no ciphertext): emitted as a plain `thinking`
///   block with the summary text and no signature; nothing opaque to preserve.
///
/// Returns `None` when there is nothing to carry (not a reasoning item, or an
/// empty item).
pub(super) fn anthropic_block_from_openai_reasoning_item(item: &Value) -> Option<Value> {
    if item.get("type").and_then(Value::as_str) != Some("reasoning") {
        return None;
    }

    let text = reasoning_summary_text(item);
    let has_encrypted_content = item
        .get("encrypted_content")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty());

    if has_encrypted_content {
        let envelope = encode_openai_reasoning_item(item)?;
        if text.is_empty() {
            return Some(json!({
                "type": "redacted_thinking",
                "data": envelope
            }));
        }
        return Some(json!({
            "type": "thinking",
            "thinking": text,
            "signature": envelope
        }));
    }

    (!text.is_empty()).then(|| {
        json!({
            "type": "thinking",
            "thinking": text
        })
    })
}

/// Recovers the original Responses `reasoning` item from an Anthropic thinking
/// block that carried one. Returns `None` for a native thinking block (a real
/// upstream signature, or plaintext-only) that was not minted by
/// [`anthropic_block_from_openai_reasoning_item`].
pub(super) fn openai_reasoning_item_from_anthropic_block(block: &Value) -> Option<Value> {
    match block.get("type").and_then(Value::as_str) {
        Some("thinking") => block
            .get("signature")
            .and_then(Value::as_str)
            .and_then(decode_openai_reasoning_item),
        Some("redacted_thinking") => block
            .get("data")
            .and_then(Value::as_str)
            .and_then(decode_openai_reasoning_item),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_reasoning_round_trips_through_thinking_signature() {
        let item = json!({
            "id": "rs_1",
            "type": "reasoning",
            "summary": [{"type": "summary_text", "text": "Need a tool."}],
            "encrypted_content": "opaque"
        });
        let block = anthropic_block_from_openai_reasoning_item(&item).unwrap();
        assert_eq!(block["type"], "thinking");
        assert_eq!(block["thinking"], "Need a tool.");
        assert_eq!(
            openai_reasoning_item_from_anthropic_block(&block),
            Some(item)
        );
    }

    #[test]
    fn encrypted_item_without_summary_uses_redacted_thinking() {
        let item = json!({
            "id": "rs_2",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "opaque"
        });
        let block = anthropic_block_from_openai_reasoning_item(&item).unwrap();
        assert_eq!(block["type"], "redacted_thinking");
        assert_eq!(
            openai_reasoning_item_from_anthropic_block(&block),
            Some(item)
        );
    }

    #[test]
    fn plaintext_only_reasoning_becomes_a_plain_thinking_block() {
        let item = json!({
            "id": "rs_3",
            "type": "reasoning",
            "summary": [{"type": "summary_text", "text": "Just thinking."}]
        });
        let block = anthropic_block_from_openai_reasoning_item(&item).unwrap();
        assert_eq!(
            block,
            json!({"type": "thinking", "thinking": "Just thinking."})
        );
        // No envelope, so a plain block does not decode back into an item.
        assert_eq!(openai_reasoning_item_from_anthropic_block(&block), None);
    }

    #[test]
    fn empty_reasoning_item_carries_nothing() {
        let item = json!({"id": "rs_4", "type": "reasoning", "summary": []});
        assert_eq!(anthropic_block_from_openai_reasoning_item(&item), None);
    }

    #[test]
    fn non_reasoning_item_is_ignored() {
        let item = json!({"type": "message", "role": "assistant"});
        assert_eq!(anthropic_block_from_openai_reasoning_item(&item), None);
        assert_eq!(encode_openai_reasoning_item(&item), None);
    }

    #[test]
    fn a_native_thinking_signature_is_not_mistaken_for_an_envelope() {
        // A real upstream signature must not decode into a reasoning item.
        let block = json!({
            "type": "thinking",
            "thinking": "hi",
            "signature": "minted-by-anthropic"
        });
        assert_eq!(openai_reasoning_item_from_anthropic_block(&block), None);
    }

    #[test]
    fn reasoning_text_parts_are_accepted_in_the_summary() {
        let item = json!({
            "type": "reasoning",
            "summary": [{"type": "reasoning_text", "text": "via reasoning_text"}],
            "encrypted_content": "opaque"
        });
        let block = anthropic_block_from_openai_reasoning_item(&item).unwrap();
        assert_eq!(block["thinking"], "via reasoning_text");
    }
}
