//! Incremental inspection of a streamed upstream response.
//!
//! When the proxy buffers a response it can parse the finished body with the
//! whole-body helpers. A streamed response never exists as one buffer, so the
//! same facts — token usage, the served model, whether the stream ended
//! properly — have to be accumulated as bytes pass through.
//!
//! Two pieces live here:
//!
//! - [`SseFramer`] splits a byte stream into complete SSE frames. Chunk
//!   boundaries fall wherever the network puts them, routinely mid-frame, so
//!   the tail of each chunk is carried until its terminator arrives.
//! - [`StreamObserver`] folds those frames into the values the request log and
//!   health bookkeeping need once the stream finishes.

use super::response_failure_service::{
    detect_response_failed_value, is_new_api_user_quota_failure, SemanticResponseFailure,
};
use crate::models::route_pool::RouteUsageBreakdown;
use serde_json::Value;
use std::collections::BTreeMap;

/// Terminal markers that mean "this stream ended on purpose".
///
/// Kept byte-identical to the whole-body check in
/// [`crate::services::response_failure_service::stream_disconnected_before_completion`]
/// so a stream is judged the same way whether it was buffered or passed
/// through. Changing one without the other splits the two paths' verdicts.
const STREAM_TERMINAL_MARKERS: [&str; 5] = [
    "response.completed",
    "data: [DONE]",
    "message_stop",
    "\"finish_reason\":\"stop\"",
    "\"finishReason\":\"STOP\"",
];

/// The longest terminal marker, minus one byte: the most that can be pending
/// across a chunk boundary while still being able to complete into a match.
const MAX_MARKER_OVERLAP: usize = 24;

/// Splits a byte stream into complete SSE frames.
///
/// Feed it chunks; it returns whichever frames became complete. Anything after
/// the last `\n\n` stays buffered until more bytes arrive, so a frame split
/// across chunks is never handed out as two malformed halves.
#[derive(Debug, Default)]
pub struct SseFramer {
    buffer: Vec<u8>,
}

impl SseFramer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a chunk and take whatever frames are now complete.
    ///
    /// Frame payloads are the joined `data:` lines, matching how the buffered
    /// parser in `route_protocol_bridge::sse` reads a body. Empty frames and
    /// the `[DONE]` sentinel carry no JSON and are skipped.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.push_blocks(chunk)
            .iter()
            .filter_map(|block| frame_payload(block))
            .collect()
    }

    /// Push a chunk and take whatever raw SSE blocks are now complete.
    ///
    /// Same framing as [`Self::push`], but the blocks come back verbatim. A
    /// caller that has to *forward* a frame — rather than only read its payload
    /// — needs this: `push` drops the `event:` lines and the `[DONE]` sentinel,
    /// and forwarding those is part of the contract with the client.
    pub fn push_blocks(&mut self, chunk: &[u8]) -> Vec<String> {
        // 先积累原始字节，整帧之后才解码。网络包可以劈开一个中文/emoji 字符，
        // 逐包 from_utf8_lossy 会把仍未收全的字符永久替换成乱码。
        self.buffer.extend_from_slice(chunk);
        if self.buffer.contains(&b'\r') {
            let mut normalized = Vec::with_capacity(self.buffer.len());
            for (index, byte) in self.buffer.iter().copied().enumerate() {
                if byte != b'\r' || self.buffer.get(index + 1) != Some(&b'\n') {
                    normalized.push(byte);
                }
            }
            self.buffer = normalized;
        }
        let mut blocks = Vec::new();
        while let Some(index) = self.buffer.windows(2).position(|pair| pair == b"\n\n") {
            let bytes: Vec<_> = self.buffer.drain(..index + 2).collect();
            blocks.push(String::from_utf8_lossy(&bytes).into_owned());
        }
        blocks
    }

    /// Flush the trailing bytes as a final frame.
    ///
    /// An upstream that ends without a blank line after its last frame is
    /// common enough that dropping the remainder would lose the usage totals
    /// that often ride on exactly that frame.
    pub fn finish(&mut self) -> Option<String> {
        let block = std::mem::take(&mut self.buffer);
        frame_payload(&String::from_utf8_lossy(&block))
    }

    /// Flush the trailing bytes as a final raw block, keeping its framing.
    ///
    /// The [`Self::push_blocks`] counterpart of [`Self::finish`].
    pub fn finish_block(&mut self) -> Option<String> {
        let bytes = std::mem::take(&mut self.buffer);
        let block = String::from_utf8_lossy(&bytes).into_owned();
        (!block.trim().is_empty()).then_some(block)
    }
}

/// 一帧是不是「这一轮写完了」。
///
/// Responses 上游用 `response.completed`；Chat 上游用带 `finish_reason` 的
/// chunk。两种都要认，续写流是哪一种由上游决定。
fn continuation_frame_is_terminal(value: &Value) -> bool {
    if value.get("type").and_then(Value::as_str) == Some("response.completed") {
        return true;
    }
    value
        .pointer("/choices/0/finish_reason")
        .is_some_and(|reason| !reason.is_null())
}

/// Extract the joined `data:` payload of one SSE block, if it carries one.
fn frame_payload(block: &str) -> Option<String> {
    let data = block
        .lines()
        .filter_map(|line| line.trim().strip_prefix("data:").map(str::trim))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    Some(data)
}

/// Whether a buffered prefix already carries an SSE payload frame.
///
/// Gateways that have to queue a request answer with keepalive comments before
/// any real frame — OpenRouter sends `: OPENROUTER PROCESSING` while it waits.
/// Those bytes say nothing about how the request ended, so a caller deciding
/// "is this attempt still retryable?" has to look past them.
///
/// Deliberately the same test as the "did any data frame arrive?" check in
/// [`crate::services::response_failure_service::stream_disconnected_before_completion`]:
/// the two have to agree on when a stream really started, or a stream gets one
/// verdict when it is streamed and another when it is buffered.
pub fn sse_payload_started(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    text.lines().any(|line| {
        line.trim_start()
            .strip_prefix("data:")
            .map(str::trim)
            .is_some_and(|data| !data.is_empty() && data != "[DONE]")
    })
}

#[cfg(test)]
mod payload_started_tests {
    use super::sse_payload_started;

    /// The shape that made this rule necessary: a gateway parks the client on
    /// comment frames, then reports the failure. Nothing was delivered, so the
    /// attempt is still retryable.
    #[test]
    fn keepalive_comments_alone_are_not_content() {
        let padding = ": OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n";
        assert!(!sse_payload_started(padding.as_bytes()));
    }

    #[test]
    fn a_failure_frame_counts_as_content_so_it_can_be_inspected() {
        let padding = ": OPENROUTER PROCESSING\n\n";
        let failure = "data: {\"choices\":[],\"error\":{\"code\":502}}\n\n";
        assert!(!sse_payload_started(padding.as_bytes()));
        assert!(sse_payload_started(
            format!("{padding}{failure}").as_bytes()
        ));
    }

    #[test]
    fn the_done_sentinel_and_bare_data_lines_are_not_content() {
        assert!(!sse_payload_started(b"data: [DONE]\n\n"));
        assert!(!sse_payload_started(b"data:\n\n"));
        assert!(!sse_payload_started(b""));
    }

    /// A frame split across chunks still counts once its `data:` prefix lands,
    /// which is all this predicate claims.
    #[test]
    fn a_data_prefix_is_enough() {
        assert!(sse_payload_started(
            b"data: {\"type\":\"response.created\"}"
        ));
    }
}

/// What a finished stream turned out to contain.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StreamOutcome {
    pub usage: RouteUsageBreakdown,
    pub response_model: Option<String>,
    /// Payload bytes seen, for the request log's duration/size reporting.
    pub byte_count: usize,
    /// True when data frames arrived but no terminal marker ever did — the
    /// streaming counterpart of `stream_disconnected_before_completion`.
    pub disconnected_before_completion: bool,
    /// How many frames carried reasoning text. `0` on a stream that was watched
    /// from start to finish means the upstream really did not reason — see
    /// [`StreamObserver::reasoning_deltas`].
    pub reasoning_deltas: usize,
    /// 续写所需的 item / 正文状态（spec 第 5 节）。
    pub continuation: StreamContinuationState,
}

/// `Some(text)` unless the text is absent or empty — a reasoning delta that
/// carries no characters is not evidence that the upstream reasoned.
fn non_empty_text(text: Option<&str>) -> Option<&str> {
    text.filter(|text| !text.is_empty())
}

/// The reasoning text one SSE frame carries, or `None` when it carries none.
///
/// Three shapes have to be recognised, because the observer watches the
/// *upstream* stream and the upstream's protocol is the bridge's choice, not the
/// client's:
///
/// - Anthropic extended thinking — `content_block_delta` whose `delta` is
///   `{"type":"thinking_delta","thinking":"…"}`.
/// - Chat Completions gateways that surface the model's thinking as
///   `choices[0].delta.reasoning_content` (or the shorter `reasoning`).
/// - The Responses API's `response.reasoning_summary_text.delta` (and
///   `reasoning_text.delta`) events, where the type names the channel.
///
/// Matching on the *content* rather than on a field name alone is what keeps
/// this from counting the wrong thing: a Responses gateway echoes the request
/// back as `"reasoning":{"effort":null,"summary":null}`, which is the reasoning
/// *configuration* and would otherwise be read as reasoning output.
fn reasoning_text_in_frame(value: &Value) -> Option<&str> {
    // Anthropic, and any gateway that mirrors its delta shape.
    if let Some(text) = non_empty_text(
        value
            .pointer("/delta/thinking")
            .or_else(|| value.pointer("/delta/reasoning_content"))
            .and_then(Value::as_str),
    ) {
        return Some(text);
    }

    // Chat Completions.
    if let Some(text) = non_empty_text(
        value
            .pointer("/choices/0/delta/reasoning_content")
            .or_else(|| value.pointer("/choices/0/delta/reasoning"))
            .and_then(Value::as_str),
    ) {
        return Some(text);
    }

    // Responses: the event type is the signal, and `delta` is the payload.
    let kind = value.get("type").and_then(Value::as_str)?;
    if matches!(
        kind,
        "response.reasoning_summary_text.delta" | "response.reasoning_text.delta"
    ) {
        return non_empty_text(value.get("delta").and_then(Value::as_str));
    }
    None
}

/// 最多保留多少正文用于续写；超过就放弃续写（spec 第 5 节）。
const PARTIAL_TEXT_LIMIT: usize = 1024 * 1024;

/// 续写所需的、从流式事件里攒出来的状态。
///
/// 只覆盖上游是 Responses 协议的情形：上游是 Chat 时，客户端看到的 Responses
/// 事件由 `ChatStreamBridge` 自己合成，状态在它那边维护。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StreamContinuationState {
    pub response_id: Option<String>,
    pub last_sequence_number: u64,
    pub completed_items: Vec<String>,
    pub open_item: Option<OpenItem>,
    pub partial_text: String,
    /// 正文超过 [`PARTIAL_TEXT_LIMIT`]：续写不再可行，只能按断流处理。
    pub text_truncated: bool,
    /// **当前这个 open message item 自己**的正文。
    ///
    /// 和 `partial_text` 的区别：后者是整个 response 已生成的正文（跨多个 item
    /// 累加），用于构造续写请求；这个是断流时那条 item 的内容，用来给它补一条
    /// 合成的 `output_item.done`——客户端是从 `output_item.*` 记录会话历史的，
    /// 不补这条，断流前那一段在客户端就整段丢了。
    pub open_item_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenItem {
    pub id: String,
    pub kind: OpenItemKind,
    pub output_index: u64,
    /// 该 reasoning item 带着加密内容：密文断在半截就无法重建，续写只能放弃
    /// （spec 第 8.3 节）。
    pub encrypted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenItemKind {
    Message,
    FunctionCall,
    Reasoning,
}

fn open_item_kind(kind: &str) -> Option<OpenItemKind> {
    match kind {
        "message" => Some(OpenItemKind::Message),
        "function_call" | "custom_tool_call" => Some(OpenItemKind::FunctionCall),
        "reasoning" => Some(OpenItemKind::Reasoning),
        _ => None,
    }
}

/// Accumulates the facts a finished request needs, one chunk at a time.
///
/// Everything it keeps is bounded: a usage struct, an optional model name, a
/// capped prefix, two flags, a counter and a small carry buffer. A long response
/// costs no more memory than a short one, which is the point of streaming at
/// all.
#[derive(Debug)]
pub struct StreamObserver {
    framer: SseFramer,
    usage: RouteUsageBreakdown,
    response_model: Option<String>,
    preview: Vec<u8>,
    preview_limit: usize,
    byte_count: usize,
    saw_data_frame: bool,
    saw_terminal_marker: bool,
    /// Frames carrying reasoning text, counted as they go by.
    ///
    /// Deliberately a counter rather than something read back out of
    /// [`StreamObserver::preview`]. The preview is a capped, redacted,
    /// head-and-tail-cut string meant for a human to read; whether the upstream
    /// reasoned at all is a binary fact, and answering it from that string
    /// means the answer depends on whether the deltas happened to land inside
    /// the retained head. They do not always: a gateway that echoes the request
    /// can fill the whole budget before the first delta arrives. Counting every
    /// frame costs one branch and cannot be truncated away.
    reasoning_deltas: usize,
    /// Tail of the previous chunk, so a terminal marker straddling a chunk
    /// boundary is still found.
    marker_carry: String,
    streaming_request: bool,
    semantic_failure: bool,
    new_api_quota_failure: Option<SemanticResponseFailure>,
    pending_messages: BTreeMap<String, (u64, String)>,
    pending_text_bytes: usize,
    next_output_index: u64,
    /// 续写用状态；非 Responses 事件不会写它。
    continuation: StreamContinuationState,
    /// 专门给续写流按帧读用量：续写流的帧不能走 `continuation`，
    /// 否则会把原 response 的 id / 序号覆盖成续写流自己的值。
    continuation_framer: SseFramer,
    /// 最近一轮续写流有没有出现终止标记。预算用尽时要靠它区分「续写流正常收尾」
    /// 与「续写流又断了」——后者要按断流处理，不能补一条假的完成事件。
    continuation_saw_terminal: bool,
    /// 给「客户端看到的 Responses 事件」分帧：Chat 上游的客户端事件是桥自己
    /// 合成的，续写状态只能从这条流里读（见 [`Self::observe_client_events`]）。
    client_event_framer: SseFramer,
}

impl StreamObserver {
    pub fn new(preview_limit: usize, streaming_request: bool) -> Self {
        Self {
            framer: SseFramer::new(),
            usage: RouteUsageBreakdown::default(),
            response_model: None,
            preview: Vec::new(),
            preview_limit,
            byte_count: 0,
            saw_data_frame: false,
            saw_terminal_marker: false,
            reasoning_deltas: 0,
            marker_carry: String::new(),
            streaming_request,
            semantic_failure: false,
            new_api_quota_failure: None,
            pending_messages: BTreeMap::new(),
            pending_text_bytes: 0,
            next_output_index: 0,
            continuation: StreamContinuationState::default(),
            continuation_framer: SseFramer::new(),
            continuation_saw_terminal: false,
            client_event_framer: SseFramer::new(),
        }
    }

    /// 收续写流的帧：并 token 用量、接着累加半截正文，但不碰
    /// `response_id` / `sequence_number` / `completed_items`。
    ///
    /// 续写流属于「新的一次上游请求」，它的 id 与序号是重写器自己在管的；
    /// 若走 [`StreamObserver::observe`]，续写流的 id 会覆盖原 response 的 id，
    /// 让下一轮续写错位、把错误的事件拼到一起。所以这里只做两件事：
    ///
    /// - 合并 usage（Responses 与 Chat 两种上游的形状都认）；
    /// - 把文本增量接到 `partial_text` 后面——它正是下一轮续写请求要带上的
    ///   「已经写出来的内容」，少接一段模型就会重复上一轮的话。
    pub fn observe_continuation(&mut self, chunk: &[u8]) {
        for payload in self.continuation_framer.push(chunk) {
            self.absorb_continuation_frame(&payload);
        }
    }

    fn absorb_continuation_frame(&mut self, payload: &str) {
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            return;
        };
        self.note_semantic_failure(&value);
        self.usage
            .merge_from(super::route_proxy_service::usage_breakdown_from_value(
                &value,
            ));
        self.continuation_saw_terminal |= continuation_frame_is_terminal(&value);
        match value["type"].as_str() {
            Some(
                "response.output_item.added"
                | "response.output_item.done"
                | "response.output_text.delta",
            ) => {
                // 仅保留当前 item 的断点事实。根 response id 仍属于第一次请求，
                // 客户端序号与跨轮索引由重写器维护，不从新 response.created 重置。
                let sequence = self.continuation.last_sequence_number;
                self.observe_continuation_event(&value);
                self.continuation.last_sequence_number = sequence;
            }
            _ => {
                if let Some(delta) = value
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    self.append_partial_text(delta);
                }
            }
        }
    }

    pub fn has_semantic_failure(&self) -> bool {
        self.semantic_failure
    }
    pub fn mark_stream_failed(&mut self) {
        self.semantic_failure = true;
    }

    pub fn new_api_user_quota_failure(&self) -> Option<&SemanticResponseFailure> {
        self.new_api_quota_failure.as_ref()
    }

    fn note_semantic_failure(&mut self, value: &Value) {
        if self.new_api_quota_failure.is_none() {
            self.new_api_quota_failure =
                detect_response_failed_value(value).filter(is_new_api_user_quota_failure);
        }
        self.semantic_failure |= matches!(
            value["type"].as_str(),
            Some("response.failed" | "response.incomplete" | "error")
        ) || value.get("error").is_some_and(|value| !value.is_null())
            || value.pointer("/response/status").and_then(Value::as_str) == Some("failed");
    }

    /// 每一条上游流各自分帧，断在 JSON 中间的尾巴不能拼到下一条流里。
    pub fn begin_continuation(&mut self) {
        self.continuation_framer = SseFramer::new();
        self.continuation_saw_terminal = false;
        self.new_api_quota_failure = None;
        self.pending_messages.clear();
        self.pending_text_bytes = 0;
        self.clear_open_item();
    }

    pub fn next_output_index(&self) -> u64 {
        self.next_output_index
    }
    pub fn has_open_messages(&self) -> bool {
        !self.pending_messages.is_empty()
    }

    pub fn seen_item_ids(&self) -> Vec<String> {
        self.continuation
            .completed_items
            .iter()
            .cloned()
            .chain(
                self.continuation
                    .open_item
                    .iter()
                    .map(|item| item.id.clone()),
            )
            .chain(self.pending_messages.keys().cloned())
            .collect()
    }

    /// 工具和文本可以交错出现；为每条仍打开的文本单独补 done，而不是仅关最后一条 item。
    pub fn take_dangling_messages_done(&mut self, sequence: &mut u64) -> Option<String> {
        if self.pending_messages.is_empty() || self.continuation.text_truncated {
            return None;
        }
        let mut messages: Vec<_> = std::mem::take(&mut self.pending_messages)
            .into_iter()
            .collect();
        messages.sort_by_key(|(_, (index, _))| *index);
        let mut output = String::new();
        for (id, (index, text)) in messages {
            output.push_str(
                &super::route_stream_continuation::synthesized_item_done_block(
                    *sequence, &id, index, &text,
                ),
            );
            *sequence = sequence.saturating_add(1);
        }
        self.pending_text_bytes = 0;
        Some(output)
    }

    pub fn flush_pending_frame(&mut self, continuing: bool) {
        if continuing {
            if let Some(payload) = self.continuation_framer.finish() {
                self.absorb_continuation_frame(&payload);
            }
        } else if let Some(payload) = self.framer.finish() {
            self.absorb_frame(&payload);
        }
    }

    pub fn observe(&mut self, chunk: &[u8]) {
        self.byte_count += chunk.len();
        if self.preview.len() < self.preview_limit {
            let take = (self.preview_limit - self.preview.len()).min(chunk.len());
            self.preview.extend_from_slice(&chunk[..take]);
        }
        self.scan_for_terminal_marker(chunk);

        for payload in self.framer.push(chunk) {
            self.absorb_frame(&payload);
        }
    }

    /// Finish the stream and report what it contained.
    pub fn finish(mut self) -> StreamOutcome {
        if let Some(payload) = self.framer.finish() {
            self.absorb_frame(&payload);
        }
        StreamOutcome {
            usage: self.usage,
            response_model: self.response_model,
            byte_count: self.byte_count,
            // Only a streaming request can be truncated in this sense; a plain
            // JSON reply has no terminal event to miss.
            disconnected_before_completion: self.streaming_request
                && self.saw_data_frame
                && (!self.saw_terminal_marker || self.semantic_failure),
            reasoning_deltas: self.reasoning_deltas,
            continuation: self.continuation,
        }
    }

    /// The leading bytes of the response, for the live log's stage preview.
    pub fn preview(&self) -> &[u8] {
        &self.preview
    }

    /// 续写所需的状态快照。
    pub fn continuation(&self) -> &StreamContinuationState {
        &self.continuation
    }

    /// 原上游流有没有出现终止标记。
    pub fn saw_terminal_marker(&self) -> bool {
        self.saw_terminal_marker
    }

    /// 最近一轮续写流有没有正常收尾（见字段说明）。
    pub fn continuation_saw_terminal(&self) -> bool {
        self.continuation_saw_terminal
    }

    /// 有数据帧、但从未见过终止标记 —— 「只缺收尾」与「断流」都以它为前提。
    pub fn ended_without_terminal_event(&self) -> bool {
        self.saw_data_frame && !self.saw_terminal_marker
    }

    /// 网关替上游补上了收尾事件：之后的判定按「正常结束」走。
    pub fn mark_completed(&mut self) {
        self.saw_terminal_marker = true;
    }

    /// 当前累计的用量，用于合成收尾事件。
    pub fn usage_snapshot(&self) -> RouteUsageBreakdown {
        self.usage.clone()
    }

    fn absorb_frame(&mut self, payload: &str) {
        self.saw_data_frame = true;
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            // A frame that is not JSON still proves data flowed; only its
            // contents are unusable. Matches the lossy buffered parser.
            return;
        };
        self.note_semantic_failure(&value);
        if reasoning_text_in_frame(&value).is_some() {
            self.reasoning_deltas += 1;
        }
        self.usage
            .merge_from(super::route_proxy_service::usage_breakdown_from_value(
                &value,
            ));
        if self.response_model.is_none() {
            self.response_model = super::route_proxy_service::response_model_from_value(&value);
        }
        self.observe_continuation_event(&value);
    }

    /// 把 Responses 事件折进续写状态；其它协议的帧原样忽略。
    fn observe_continuation_event(&mut self, value: &Value) {
        let Some(event) = value.get("type").and_then(Value::as_str) else {
            return;
        };
        if let Some(sequence_number) = value.get("sequence_number").and_then(Value::as_u64) {
            self.continuation.last_sequence_number =
                self.continuation.last_sequence_number.max(sequence_number);
        }
        if let Some(index) = value["output_index"].as_u64() {
            self.next_output_index = self.next_output_index.max(index.saturating_add(1));
        }
        match event {
            "response.created" => {
                if let Some(id) = value
                    .get("response")
                    .and_then(|response| response.get("id"))
                    .and_then(Value::as_str)
                {
                    self.continuation.response_id = Some(id.to_string());
                }
            }
            "response.output_item.added" => {
                let item = value.get("item");
                let id = item.and_then(|item| item.get("id")).and_then(Value::as_str);
                let kind = item
                    .and_then(|item| item.get("type"))
                    .and_then(Value::as_str)
                    .and_then(open_item_kind);
                if let (Some(id), Some(kind)) = (id, kind) {
                    self.continuation.open_item_text.clear();
                    if kind == OpenItemKind::Message {
                        if self.pending_messages.len() >= 4096 {
                            self.continuation.text_truncated = true;
                        } else {
                            self.pending_messages
                                .entry(id.to_string())
                                .or_insert_with(|| {
                                    (
                                        value["output_index"].as_u64().unwrap_or_default(),
                                        String::new(),
                                    )
                                });
                        }
                    }
                    let encrypted = item
                        .and_then(|item| item.get("encrypted_content"))
                        .and_then(Value::as_str)
                        .is_some_and(|content| !content.is_empty());
                    self.continuation.open_item = Some(OpenItem {
                        id: id.to_string(),
                        kind,
                        output_index: value
                            .get("output_index")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        encrypted,
                    });
                }
            }
            "response.output_text.delta" => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    self.append_partial_text(delta);
                    let id = value["item_id"].as_str().map(str::to_string).or_else(|| {
                        (self.pending_messages.len() == 1)
                            .then(|| self.pending_messages.keys().next().unwrap().clone())
                    });
                    if let Some((_, text)) =
                        id.as_ref().and_then(|id| self.pending_messages.get_mut(id))
                    {
                        let mut end = delta
                            .len()
                            .min(PARTIAL_TEXT_LIMIT.saturating_sub(self.pending_text_bytes));
                        while !delta.is_char_boundary(end) {
                            end -= 1;
                        }
                        text.push_str(&delta[..end]);
                        self.pending_text_bytes += end;
                    }
                    let belongs_to_open = value
                        .get("item_id")
                        .and_then(Value::as_str)
                        .map(|id| {
                            self.continuation
                                .open_item
                                .as_ref()
                                .is_some_and(|open| open.id == id)
                        })
                        .unwrap_or(true);
                    if belongs_to_open {
                        self.append_open_item_text(delta);
                    }
                }
            }
            "response.output_item.done" => {
                if let Some(id) = value
                    .get("item")
                    .and_then(|item| item.get("id"))
                    .and_then(Value::as_str)
                {
                    if self.continuation.completed_items.len() < 4096 {
                        self.continuation.completed_items.push(id.to_string());
                    } else {
                        self.continuation.text_truncated = true;
                    }
                    if let Some((_, text)) = self.pending_messages.remove(id) {
                        self.pending_text_bytes =
                            self.pending_text_bytes.saturating_sub(text.len());
                    }
                }
                if self.continuation.open_item.as_ref().is_some_and(|open| {
                    value.pointer("/item/id").and_then(Value::as_str) == Some(open.id.as_str())
                }) {
                    self.continuation.open_item = None;
                    self.continuation.open_item_text.clear();
                }
            }
            _ => {}
        }
    }

    /// 只把「客户端看到的那串 Responses 事件」喂给续写状态。
    ///
    /// Chat 上游的客户端事件（`response.created`、`response.output_text.delta`…）
    /// 是 `ChatStreamBridge` 自己合成的，原始 Chat 帧里什么都没有，所以续写
    /// 需要的 response_id 与半截正文只能从桥的输出里读。用法与断流判定不走这里，
    /// 免得同原始帧重复记账。
    pub fn observe_client_events(&mut self, events: &[u8]) {
        for payload in self.client_event_framer.push(events) {
            if let Ok(value) = serde_json::from_str::<Value>(&payload) {
                self.observe_continuation_event(&value);
            }
        }
    }

    /// 往「当前 open item 自己」的正文尾部接一段（只截断，不动 `text_truncated`：
    /// 真超限的话 `partial_text` 已经先标了）。
    fn append_open_item_text(&mut self, delta: &str) {
        let remaining = PARTIAL_TEXT_LIMIT.saturating_sub(self.continuation.open_item_text.len());
        let mut end = remaining.min(delta.len());
        while end > 0 && !delta.is_char_boundary(end) {
            end -= 1;
        }
        self.continuation.open_item_text.push_str(&delta[..end]);
    }

    /// 断流时那条 open item 已经由网关补过收尾：别再当成「还开着」。
    pub fn clear_open_item(&mut self) {
        self.continuation.open_item = None;
        self.continuation.open_item_text.clear();
    }

    /// 往半截正文尾部接一段增量；超过内存上限就标记不可续并只截到上限。
    fn append_partial_text(&mut self, delta: &str) {
        let remaining = PARTIAL_TEXT_LIMIT.saturating_sub(self.continuation.partial_text.len());
        if delta.len() > remaining {
            self.continuation.text_truncated = true;
        }
        // 只按 UTF-8 边界截，别把多字节字符劈开。
        let mut end = remaining.min(delta.len());
        while end > 0 && !delta.is_char_boundary(end) {
            end -= 1;
        }
        self.continuation.partial_text.push_str(&delta[..end]);
    }

    fn scan_for_terminal_marker(&mut self, chunk: &[u8]) {
        if self.saw_terminal_marker {
            return;
        }
        let text = String::from_utf8_lossy(chunk);
        // Prepend the carry so a marker split across chunks is still matched.
        let haystack = if self.marker_carry.is_empty() {
            text.into_owned()
        } else {
            format!("{}{}", self.marker_carry, text)
        };
        if STREAM_TERMINAL_MARKERS
            .iter()
            .any(|marker| haystack.contains(marker))
        {
            self.saw_terminal_marker = true;
            self.marker_carry.clear();
            return;
        }
        // Keep only enough tail to complete the longest marker next time.
        let keep = haystack
            .char_indices()
            .rev()
            .take(MAX_MARKER_OVERLAP)
            .last()
            .map(|(index, _)| index)
            .unwrap_or(0);
        self.marker_carry = haystack[keep..].to_string();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framer_keeps_utf8_text_and_crlf_across_every_byte_boundary() {
        let input = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"中文🙂\"}\r\n\r\n";
        for split in 0..=input.len() {
            let mut framer = SseFramer::new();
            let mut frames = framer.push_blocks(&input.as_bytes()[..split]);
            frames.extend(framer.push_blocks(&input.as_bytes()[split..]));
            assert_eq!(frames, [input.replace("\r\n", "\n")], "split={split}");
        }
    }

    #[test]
    fn framer_joins_a_frame_split_across_chunks() {
        let mut framer = SseFramer::new();
        // The split lands inside the JSON payload, the worst case for a naive
        // splitter: neither half is valid on its own.
        assert!(framer.push(b"data: {\"usage\":{\"input_to").is_empty());
        let frames = framer.push(b"kens\":5}}\n\n");
        assert_eq!(frames, vec![r#"{"usage":{"input_tokens":5}}"#.to_string()]);
    }

    #[test]
    fn framer_handles_a_split_inside_the_blank_line_terminator() {
        let mut framer = SseFramer::new();
        assert!(framer.push(b"data: {\"a\":1}\n").is_empty());
        assert_eq!(framer.push(b"\n"), vec![r#"{"a":1}"#.to_string()]);
    }

    #[test]
    fn framer_skips_done_and_empty_frames() {
        let mut framer = SseFramer::new();
        let frames = framer.push(b"data: [DONE]\n\ndata:\n\ndata: {\"a\":1}\n\n");
        assert_eq!(frames, vec![r#"{"a":1}"#.to_string()]);
    }

    #[test]
    fn framer_normalizes_crlf_frames() {
        let mut framer = SseFramer::new();
        let frames = framer.push(b"event: message\r\ndata: {\"a\":1}\r\n\r\n");
        assert_eq!(frames, vec![r#"{"a":1}"#.to_string()]);
    }

    #[test]
    fn framer_flushes_a_trailing_frame_without_blank_line() {
        let mut framer = SseFramer::new();
        assert!(framer.push(b"data: {\"a\":1}").is_empty());
        assert_eq!(framer.finish(), Some(r#"{"a":1}"#.to_string()));
    }

    #[test]
    fn observer_merges_usage_across_frames_like_the_buffered_parser() {
        let mut observer = StreamObserver::new(1024, true);
        observer.observe(
            br#"data: {"type":"message_start","message":{"model":"claude-opus-4-8","usage":{"input_tokens":120,"cache_read_input_tokens":80}}}

"#,
        );
        observer.observe(
            br#"data: {"type":"message_delta","usage":{"output_tokens":30}}

data: {"type":"message_stop"}

"#,
        );
        let outcome = observer.finish();
        assert_eq!(outcome.usage.input_tokens, Some(120));
        assert_eq!(outcome.usage.output_tokens, Some(30));
        assert_eq!(outcome.usage.cache_tokens, Some(80));
        assert_eq!(outcome.response_model.as_deref(), Some("claude-opus-4-8"));
        assert!(!outcome.disconnected_before_completion);
    }

    #[test]
    fn observer_reads_usage_from_a_final_chunk_split_mid_frame() {
        let mut observer = StreamObserver::new(1024, true);
        observer.observe(b"data: {\"choices\":[],\"usage\":null}\n\ndata: {\"usage\":{\"prompt_to");
        observer.observe(b"kens\":7,\"completion_tokens\":9}}\n\ndata: [DONE]\n\n");
        let outcome = observer.finish();
        assert_eq!(outcome.usage.input_tokens, Some(7));
        assert_eq!(outcome.usage.output_tokens, Some(9));
        assert!(!outcome.disconnected_before_completion);
    }

    #[test]
    fn observer_flags_a_stream_that_never_terminated() {
        let mut observer = StreamObserver::new(1024, true);
        observer.observe(b"data: {\"type\":\"content_block_delta\"}\n\n");
        let outcome = observer.finish();
        assert!(outcome.disconnected_before_completion);
    }

    #[test]
    fn observer_finds_a_terminal_marker_split_across_chunks() {
        let mut observer = StreamObserver::new(1024, true);
        observer.observe(b"data: {\"type\":\"content_block_delta\"}\n\ndata: {\"type\":\"mess");
        observer.observe(b"age_stop\"}\n\n");
        let outcome = observer.finish();
        assert!(
            !outcome.disconnected_before_completion,
            "a marker split across chunks must still count as a clean end"
        );
    }

    #[test]
    fn observer_does_not_flag_a_non_streaming_response() {
        let mut observer = StreamObserver::new(1024, false);
        observer.observe(br#"{"usage":{"input_tokens":3}}"#);
        let outcome = observer.finish();
        assert!(!outcome.disconnected_before_completion);
    }

    #[test]
    fn observer_caps_the_preview_but_keeps_counting_bytes() {
        let mut observer = StreamObserver::new(8, true);
        observer.observe(b"data: {\"type\":\"message_stop\"}\n\n");
        assert_eq!(observer.preview().len(), 8);
        let outcome = observer.finish();
        assert_eq!(outcome.byte_count, 31);
    }

    /// The whole reason the count exists: the preview is capped, so a delta past
    /// the cap is invisible in it. The count has to survive that, because the
    /// question it answers — did the upstream reason at all — is asked exactly
    /// when the preview is too full of boilerplate to tell.
    #[test]
    fn observer_counts_thinking_deltas_the_preview_had_to_drop() {
        let mut observer = StreamObserver::new(64, true);
        observer.observe(
            br#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a long answer that pushes the thinking well past the preview cap"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" see"}}

data: {"type":"message_stop"}

"#,
        );
        assert!(
            !String::from_utf8_lossy(observer.preview()).contains("thinking_delta"),
            "前提：这些增量确实落在预览上限之外，否则这条测试什么都没验证"
        );
        let outcome = observer.finish();
        assert_eq!(outcome.reasoning_deltas, 2);
    }

    #[test]
    fn observer_counts_chat_reasoning_content_but_not_the_answer_text() {
        let mut observer = StreamObserver::new(4096, true);
        observer.observe(
            b"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Think\"}}]}\n\n\
              data: {\"choices\":[{\"delta\":{\"reasoning_content\":\" harder\"}}]}\n\n\
              data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"\"}}]}\n\n\
              data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n\
              data: [DONE]\n\n",
        );
        let outcome = observer.finish();
        assert_eq!(
            outcome.reasoning_deltas, 2,
            "正文不算，空增量也不算——它不证明上游想了什么"
        );
    }

    #[test]
    fn observer_counts_responses_reasoning_summary_deltas() {
        let mut observer = StreamObserver::new(4096, true);
        observer.observe(
            br#"data: {"type":"response.reasoning_summary_text.delta","delta":"weighing options"}

data: {"type":"response.output_text.delta","delta":"answer"}

data: {"type":"response.completed"}

"#,
        );
        let outcome = observer.finish();
        assert_eq!(outcome.reasoning_deltas, 1);
    }

    /// A Responses gateway echoes the request back as
    /// `"reasoning":{"effort":null,"summary":null}`. That is the reasoning
    /// *configuration*, not its output, and counting it would report thinking on
    /// every single turn — including the turns whose entire problem is that no
    /// thinking arrived.
    #[test]
    fn observer_does_not_count_the_echoed_reasoning_configuration() {
        let mut observer = StreamObserver::new(4096, true);
        observer.observe(
            br#"data: {"type":"response.created","response":{"id":"resp_1","reasoning":{"effort":null,"summary":null}}}

data: {"type":"response.output_text.delta","delta":"answer"}

"#,
        );
        let outcome = observer.finish();
        assert_eq!(outcome.reasoning_deltas, 0);
    }
    #[test]
    fn observer_collects_continuation_state() {
        let mut observer = StreamObserver::new(4096, true);
        for frame in [
            r#"{"type":"response.created","sequence_number":0,"response":{"id":"resp_1"}}"#,
            r#"{"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"msg_1","type":"message"}}"#,
            r#"{"type":"response.output_text.delta","sequence_number":2,"item_id":"msg_1","delta":"你好，"}"#,
            r#"{"type":"response.output_text.delta","sequence_number":3,"item_id":"msg_1","delta":"世界"}"#,
        ] {
            observer.observe(format!("data: {frame}\n\n").as_bytes());
        }
        let state = observer.continuation();
        assert_eq!(state.response_id.as_deref(), Some("resp_1"));
        assert_eq!(state.last_sequence_number, 3);
        assert_eq!(state.partial_text, "你好，世界");
        assert_eq!(
            state.open_item.as_ref().map(|item| item.id.as_str()),
            Some("msg_1")
        );
        assert_eq!(
            state.open_item.as_ref().map(|item| item.kind),
            Some(OpenItemKind::Message)
        );
        assert!(state.completed_items.is_empty());
    }

    #[test]
    fn observer_stops_appending_past_the_partial_text_limit() {
        let mut observer = StreamObserver::new(4096, true);
        let big = "x".repeat(PARTIAL_TEXT_LIMIT + 10);
        observer.observe(
            format!(
                "data: {{\"type\":\"response.created\",\"sequence_number\":0,\"response\":{{\"id\":\"r\"}}}}\n\n\
                 data: {{\"type\":\"response.output_item.added\",\"sequence_number\":1,\"output_index\":0,\"item\":{{\"id\":\"m\",\"type\":\"message\"}}}}\n\n\
                 data: {{\"type\":\"response.output_text.delta\",\"sequence_number\":2,\"item_id\":\"m\",\"delta\":\"{big}\"}}\n\n\
                 data: {{\"type\":\"response.output_item.done\",\"sequence_number\":3,\"output_index\":0,\"item\":{{\"id\":\"m\",\"type\":\"message\"}}}}\n\n"
            )
            .as_bytes(),
        );
        let state = observer.continuation();
        assert!(state.text_truncated);
        assert!(state.partial_text.len() <= PARTIAL_TEXT_LIMIT);
        assert_eq!(state.completed_items, vec!["m".to_string()]);
        assert!(state.open_item.is_none());
    }
}
