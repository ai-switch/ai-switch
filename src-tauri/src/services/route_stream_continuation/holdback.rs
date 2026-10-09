//! 按 item 延迟提交，首次 Responses 流与续写流共用。
use super::{ensure_terminator, is_holdback_item, json_item_id, json_item_kind};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

const HOLDBACK_BYTE_LIMIT: usize = 1024 * 1024;
const HOLDBACK_FRAME_LIMIT: usize = 16_384;

#[derive(Default)]
pub(crate) struct ResponsesItemHoldback {
    pending: HashMap<String, PendingItem>,
    queue: VecDeque<(Option<String>, String)>,
    bytes: usize,
    encrypted_cut: bool,
    discarded: bool,
    committed_tool: bool,
    pass_plain_reasoning: bool,
    failed: bool,
}

struct PendingItem {
    output_index: Option<u64>,
    encrypted: bool,
}

impl ResponsesItemHoldback {
    pub(crate) fn for_chat_bridge() -> Self {
        Self {
            pass_plain_reasoning: true,
            ..Self::default()
        }
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }
    pub(crate) fn discarded(&self) -> bool {
        self.discarded
    }
    pub(crate) fn can_continue(&self) -> bool {
        !self.failed
            && !self.encrypted_cut
            && !self.pending.values().any(|item| item.encrypted)
            && !self.committed_tool
    }

    pub(crate) fn push_block(&mut self, block: &str) -> Result<Vec<String>, String> {
        if self.failed {
            return Ok(Vec::new());
        }
        let payload = super::block_payload(block);
        let parsed = serde_json::from_str::<Value>(&payload).ok();
        let value = parsed.as_ref().unwrap_or(&Value::Null);
        let event = value["type"].as_str().unwrap_or_default();
        let index = value["output_index"].as_u64();
        let id = json_item_id(value).or_else(|| {
            index.and_then(|index| {
                self.pending
                    .iter()
                    .find(|(_, item)| item.output_index == Some(index))
                    .map(|(id, _)| id.clone())
            })
        });
        if event == "response.output_item.added"
            && json_item_kind(value).is_some_and(|kind| {
                is_holdback_item(kind)
                    && !(self.pass_plain_reasoning
                        && kind == crate::services::route_proxy_stream::OpenItemKind::Reasoning
                        && !has_encrypted_content(value))
            })
        {
            let id = id
                .as_ref()
                .filter(|id| !id.is_empty())
                .ok_or("tool/reasoning item has no id")?;
            if self.pending.contains_key(id) {
                return Err("duplicate in-progress item id".into());
            }
            self.pending.insert(
                id.clone(),
                PendingItem {
                    output_index: index,
                    encrypted: has_encrypted_content(value),
                },
            );
        }
        if let Some(item) = id.as_ref().and_then(|id| self.pending.get_mut(id)) {
            item.encrypted |= has_encrypted_content(value);
        }
        // 明确失败不能被续写/收尾掩盖，也不应泄漏尚未提交的调用。
        if matches!(event, "response.failed" | "response.incomplete" | "error") {
            let mut output = self.discard_incomplete();
            self.failed = true;
            output.push(ensure_terminator(block));
            return Ok(output);
        }
        if event == "response.completed" && self.has_pending() {
            return Err("response completed with unfinished tool/reasoning items".into());
        }
        if parsed.is_none() && !payload.is_empty() && payload != "[DONE]" {
            // 半截 JSON 不能同下一次请求的第一帧拼起来，也不能交给客户端执行。
            return Ok(Vec::new());
        }
        if event == "response.output_item.done" {
            if let Some(id) = id.as_ref() {
                if self.pending.contains_key(id) {
                    if value.pointer("/item/type").and_then(Value::as_str) == Some("function_call")
                    {
                        let arguments = value
                            .pointer("/item/arguments")
                            .and_then(Value::as_str)
                            .ok_or("completed function call has no arguments")?;
                        serde_json::from_str::<Value>(arguments)
                            .map_err(|_| "completed function call has invalid JSON arguments")?;
                    }
                    self.pending.remove(id);
                }
            }
        }
        let block = ensure_terminator(block);
        if !self.queue.is_empty() || self.has_pending() {
            if self.bytes.saturating_add(block.len()) > HOLDBACK_BYTE_LIMIT
                || self.queue.len() >= HOLDBACK_FRAME_LIMIT
            {
                return Err("Responses item holdback exceeded its safety limit".into());
            }
            self.bytes += block.len();
            self.queue.push_back((id, block));
            if self.has_pending() {
                return Ok(Vec::new());
            }
            let output: Vec<_> = self.queue.drain(..).map(|(_, block)| block).collect();
            self.bytes = 0;
            self.note_committed(&output);
            return Ok(output);
        }
        let output = vec![block];
        self.note_committed(&output);
        Ok(output)
    }

    /// 只有确认断流时才丢弃未完成 item。交错的完整 item 与普通正文仍按原顺序释放。
    pub(crate) fn discard_incomplete(&mut self) -> Vec<String> {
        self.encrypted_cut |= self.pending.values().any(|item| item.encrypted);
        self.discarded |= self.has_pending();
        let output: Vec<_> = self
            .queue
            .drain(..)
            .filter_map(|(id, block)| {
                (!id.as_ref().is_some_and(|id| self.pending.contains_key(id))).then_some(block)
            })
            .collect();
        self.pending.clear();
        self.bytes = 0;
        self.note_committed(&output);
        output
    }

    fn note_committed(&mut self, blocks: &[String]) {
        self.committed_tool |= blocks.iter().any(|block| {
            serde_json::from_str::<Value>(&super::block_payload(block))
                .ok()
                .is_some_and(|value| {
                    value["type"] == "response.output_item.done"
                        && matches!(
                            value.pointer("/item/type").and_then(Value::as_str),
                            Some("function_call" | "custom_tool_call")
                        )
                })
        });
    }
}

fn has_encrypted_content(value: &Value) -> bool {
    value
        .pointer("/item/encrypted_content")
        .or_else(|| value.get("encrypted_content"))
        .and_then(Value::as_str)
        .is_some_and(|text| !text.is_empty())
        || value["type"]
            .as_str()
            .is_some_and(|kind| kind.contains("encrypted_content"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn block(value: Value) -> String {
        format!("data: {value}\n\n")
    }
    fn added(id: &str, index: u64) -> String {
        block(
            json!({"type":"response.output_item.added","output_index":index,
            "item":{"id":id,"type":"function_call"}}),
        )
    }
    fn done(id: &str, index: u64) -> String {
        block(
            json!({"type":"response.output_item.done","output_index":index,
            "item":{"id":id,"type":"function_call","arguments":"{}"}}),
        )
    }
    #[test]
    fn interleaved_tools_are_committed_once_in_arrival_order() {
        let mut hold = ResponsesItemHoldback::default();
        let events = [added("a", 0), added("b", 1), done("b", 1), done("a", 0)];
        for event in &events[..3] {
            assert!(hold.push_block(event).unwrap().is_empty());
        }
        assert_eq!(hold.push_block(&events[3]).unwrap(), events);
    }
    #[test]
    fn a_cut_discards_only_unfinished_items() {
        let mut hold = ResponsesItemHoldback::default();
        let a = added("a", 0);
        let b = added("b", 1);
        let bd = done("b", 1);
        for event in [&a, &b, &bd] {
            assert!(hold.push_block(event).unwrap().is_empty());
        }
        assert_eq!(hold.discard_incomplete(), [b, bd]);
        assert!(!hold.can_continue(), "已提交的工具不能让下一轮再执行一次");
    }
    #[test]
    fn held_bytes_are_bounded_and_bad_arguments_are_never_committed() {
        let mut hold = ResponsesItemHoldback::default();
        hold.push_block(&added("a", 0)).unwrap();
        let delta = block(
            json!({"type":"response.function_call_arguments.delta","item_id":"a",
            "delta":"x".repeat(HOLDBACK_BYTE_LIMIT)}),
        );
        assert!(hold.push_block(&delta).is_err());
        let bad = block(json!({"type":"response.output_item.done","item":{"id":"a",
            "type":"function_call","arguments":"{"}}));
        assert!(hold.push_block(&bad).is_err());
    }
}
