use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticResponseFailure {
    pub code: Option<String>,
    /// The upstream's `error.type`. Gateways that omit `error.code` often still
    /// name the error family here, which is the only way to tell their own
    /// errors apart from the ones they relay.
    pub error_type: Option<String>,
    pub message: String,
}

const CONTENT_REJECTION_CODES: &[&str] = &["sensitive_words_detected", "content-blocked"];

/// Whether the upstream explicitly rejected the request body by its content
/// policy. Match the complete structured code only: the same phrase can appear
/// in ordinary prose, while a gateway's `upstream_status` code is not evidence
/// that content was filtered.
pub(crate) fn is_content_rejection(failure: &SemanticResponseFailure) -> bool {
    failure.code.as_deref().is_some_and(|code| {
        let code = code.trim();
        CONTENT_REJECTION_CODES
            .iter()
            .any(|known| code.eq_ignore_ascii_case(known))
    })
}

/// Upstream codes that name a capacity/overload verdict. These arrive either on
/// a 200 SSE stream (`event: error` / `response.failed`) or as a plain JSON
/// error, so matching the structured code is far more reliable than prose.
const CAPACITY_ERROR_CODES: &[&str] = &[
    "no_capacity",
    "capacity_exceeded",
    "insufficient_capacity",
    "overloaded",
    "overloaded_error",
    "server_overloaded",
    "model_overloaded",
    "high_demand",
];
/// Azure/OpenAI-style "high demand" relays answer with HTTP 200 and this error
/// family; `no_capacity` takes precedence over the generic `too_many_requests`.
///
/// Deliberately phrase-based. A bare "capacity" or "service unavailable" also
/// shows up in context-length, storage and 503 errors that have nothing to do
/// with an exhausted upstream pool — misclassifying those would hand a hard
/// verdict a hundred retries and skip its account penalty.
const CAPACITY_MESSAGE_MARKERS: &[&str] = &[
    "high demand",
    "peak load",
    "provisioned throughput",
    "no capacity",
    "insufficient capacity",
    "out of capacity",
    "currently overloaded",
    "servers are overloaded",
    "model is overloaded",
    "at capacity",
];
const RATE_LIMIT_ERROR_CODES: &[&str] = &[
    "rate_limit_exceeded",
    "rate_limit_error",
    "too_many_requests",
    "requests_per_minute_limit",
    "tokens_per_minute_limit",
];
const RATE_LIMIT_MESSAGE_MARKERS: &[&str] = &[
    "rate limit",
    "too many requests",
    "requests per minute",
    "tokens per minute",
    "please slow down",
];
/// Azure / OpenAI regional deployment throughput verdicts reuse the generic
/// `rate_limit_exceeded` code but describe a *token* rate limit on a region or
/// deployment, not this account's fixed request window. They are upstream-side
/// capacity: re-asking after a short wait often lands in a free window, and
/// parking the key punishes it for the provider's load. Requiring both a
/// rate-limit-family code and one of these phrases keeps ordinary account
/// limits ("Rate limit reached, please slow down") in the RateLimit bucket.
const REGIONAL_THROUGHPUT_CODES: &[&str] = &[
    "rate_limit_exceeded",
    "tokens_per_minute_limit",
    "too_many_requests",
];
const REGIONAL_THROUGHPUT_MESSAGE_MARKERS: &[&str] = &[
    "exceeded token rate limit",
    "token rate limit exceeded",
    "exceeded the token rate limit",
    "exceeded tokens per minute limit",
];
/// An exhausted balance or plan is never an upstream capacity problem, even
/// when the gateway stamps a rate-limit-looking code on the envelope.
const ACCOUNT_QUOTA_MESSAGE_MARKERS: &[&str] = &[
    "your current quota",
    "insufficient_quota",
    "plan and billing",
    "check your plan",
    "billing details",
    "quota exhausted",
    "额度",
];

fn normalized_failure_text(message: &str) -> String {
    message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn code_matches(failure: &SemanticResponseFailure, known: &[&str]) -> bool {
    failure.code.as_deref().is_some_and(|code| {
        let code = code.trim();
        known
            .iter()
            .any(|candidate| code.eq_ignore_ascii_case(candidate))
    })
}

fn error_type_matches(failure: &SemanticResponseFailure, known: &[&str]) -> bool {
    failure.error_type.as_deref().is_some_and(|kind| {
        let kind = kind.trim();
        known
            .iter()
            .any(|candidate| kind.eq_ignore_ascii_case(candidate))
    })
}

/// Whether the upstream refused because it is out of capacity right now, not
/// because this account or this request is at fault. This is the class users
/// most want to keep retrying long after ordinary errors have given up.
pub fn is_capacity_response_failure(failure: &SemanticResponseFailure) -> bool {
    if code_matches(failure, CAPACITY_ERROR_CODES) {
        return true;
    }
    if is_regional_throughput_rate_limit(failure) {
        return true;
    }
    let message = normalized_failure_text(&failure.message);
    CAPACITY_MESSAGE_MARKERS
        .iter()
        .any(|marker| message.contains(marker))
}

/// The regional/per-deployment token budget is a pool-side throughput window,
/// not a verdict on this account. Only a rate-limit-family code plus an
/// explicit "token rate limit" sentence counts; a bare `rate_limit_exceeded`
/// stays in the ordinary RateLimit class.
fn is_regional_throughput_rate_limit(failure: &SemanticResponseFailure) -> bool {
    if !(code_matches(failure, REGIONAL_THROUGHPUT_CODES)
        || error_type_matches(failure, REGIONAL_THROUGHPUT_CODES))
    {
        return false;
    }
    let message = normalized_failure_text(&failure.message);
    if ACCOUNT_QUOTA_MESSAGE_MARKERS
        .iter()
        .any(|marker| message.contains(marker))
    {
        return false;
    }
    REGIONAL_THROUGHPUT_MESSAGE_MARKERS
        .iter()
        .any(|marker| message.contains(marker))
}

/// Whether the failure is an ordinary rate limit, distinct from capacity: the
/// account has a fixed window to wait out, so hammering it 100 times is wrong.
pub fn is_rate_limit_response_failure(failure: &SemanticResponseFailure) -> bool {
    if is_capacity_response_failure(failure) {
        return false;
    }
    if code_matches(failure, RATE_LIMIT_ERROR_CODES)
        || error_type_matches(failure, RATE_LIMIT_ERROR_CODES)
    {
        return true;
    }
    let message = normalized_failure_text(&failure.message);
    RATE_LIMIT_MESSAGE_MARKERS
        .iter()
        .any(|marker| message.contains(marker))
}

/// Kept for callers that only have the message; equivalent to recognising the
/// "overloaded" family. The classifier above is the one the proxy uses.
pub fn is_transient_response_failure(message: &str) -> bool {
    is_capacity_response_failure(&SemanticResponseFailure {
        code: None,
        error_type: None,
        message: message.to_string(),
    })
}

/// The `error.type` new-api style gateways stamp on their own errors, as
/// opposed to the ones they relay from a real upstream.
const NEW_API_ERROR_TYPE: &str = "new_api_error";
/// How those gateways open the message once the account's balance is spent.
const NEW_API_INSUFFICIENT_BALANCE_PREFIX: &str = "用户额度不足";
/// How a relay in front of a prepaid account opens the message once that
/// account is out of money.
///
/// Unlike the new-api rule there is nothing to key on besides the phrase: the
/// relay stamps its own generic envelope on top (`code: invalid_request_error`,
/// `type: unknown_error`) and appends its own `request_id`, so neither field
/// names the cause. The opener is all that is left.
const INSUFFICIENT_BALANCE_MESSAGE_PREFIX: &str = "insufficient balance";

/// new-api 自己返回的账号额度耗尽码。必须同时匹配 type/code，不能仅凭英文消息误伤其它错误。
pub(crate) fn is_new_api_user_quota_failure(failure: &SemanticResponseFailure) -> bool {
    failure
        .error_type
        .as_deref()
        .is_some_and(|kind| kind.trim().eq_ignore_ascii_case(NEW_API_ERROR_TYPE))
        && failure
            .code
            .as_deref()
            .is_some_and(|code| code.trim().eq_ignore_ascii_case("insufficient_user_quota"))
}

/// Returns whether a new-api gateway is reporting a spent account balance.
///
/// These bodies carry no `error.code` at all — only `error.type` — so the
/// code-based rules cannot see them, and the message is too specific to match
/// on alone (the same gateway relays upstream 用户额度不足 text for other
/// accounts). Requiring both keeps the rule narrow. By the time this arrives
/// the remaining balance is already negative, which makes it every bit as
/// deterministic as a quota reset boundary.
fn is_new_api_insufficient_balance(failure: &SemanticResponseFailure) -> bool {
    failure
        .error_type
        .as_deref()
        .is_some_and(|error_type| error_type.trim().eq_ignore_ascii_case(NEW_API_ERROR_TYPE))
        && failure
            .message
            .trim_start()
            .starts_with(NEW_API_INSUFFICIENT_BALANCE_PREFIX)
}

/// Returns whether an upstream reported that the account behind the credential
/// is out of money, e.g.
/// `Insufficient Balance (request_id: 8634272f-…)`.
///
/// The rest of the sentence is the relay's own bookkeeping (request id,
/// remaining balance), so the rule is anchored on the opener exactly like the
/// new-api one above. Anchoring matters in both directions: the same words
/// quoted in the middle of a longer sentence describe some *other* account's
/// balance — a relay relaying a relay — and must not settle this one.
fn is_insufficient_balance_failure(failure: &SemanticResponseFailure) -> bool {
    failure
        .message
        .trim_start()
        .to_ascii_lowercase()
        .starts_with(INSUFFICIENT_BALANCE_MESSAGE_PREFIX)
}

/// Returns whether a quota failure settles the account on its own: the balance
/// behind the credential is provably spent, so the account is marked abnormal
/// on the first occurrence instead of after the configured failure threshold,
/// and no retry budget is spent on it.
///
/// The proxy's quota branch uses this to choose between the immediate path and
/// the threshold-gated one; the stream observer uses the same rule to spot the
/// error in a frame that already went out.
pub fn is_definitive_quota_exhaustion_failure(failure: &SemanticResponseFailure) -> bool {
    is_new_api_user_quota_failure(failure) || is_insufficient_balance_failure(failure)
}

/// Returns whether an upstream error is a definitive quota exhaustion signal.
/// These errors should mark the account as abnormal immediately instead of
/// spending the configured retry budget.
pub fn is_quota_exhaustion_failure(failure: &SemanticResponseFailure) -> bool {
    if is_definitive_quota_exhaustion_failure(failure) || is_new_api_insufficient_balance(failure) {
        return true;
    }

    let code = failure
        .code
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace(['_', '-', ':', ' '], "");
    if code.contains("insufficientquota")
        || code.contains("quotaexhausted")
        || code.contains("usageexhausted")
    {
        return true;
    }

    let message = failure.message.to_ascii_lowercase();
    let compact_message = message.split_whitespace().collect::<String>();
    compact_message.contains("额度已耗尽")
        || compact_message.contains("额度耗尽")
        || compact_message.contains("额度已用完")
        || compact_message.contains("配额已耗尽")
        || compact_message.contains("配额耗尽")
        || compact_message.contains("配额已用完")
        || message.contains("quota exhausted")
        || message.contains("quota has been exhausted")
        || message.contains("insufficient quota")
        || message.contains("used all the included free usage")
        || message.contains("free usage exhausted")
}

/// Returns whether an upstream refused the credential for lacking a permission
/// it needs — an OpenAI restricted key without the scope the endpoint requires
/// (`api.responses.write` for `/v1/responses`, `model.request` for the older
/// endpoints) — rather than for anything about this request.
///
/// This is as deterministic as quota exhaustion and less recoverable: the missing
/// permission has to be granted in the provider's console, so every model on the
/// key is refused identically and no retry, model swap or cooldown can change the
/// answer. Charging it to one model would park the pool a model at a time while
/// the account still reads as healthy, and bury the one sentence that names the
/// fix under the aggregated "all route credentials failed" error.
///
/// `error.code` is the reliable signal; the message pair backs it up for gateways
/// that relay the sentence without the code. Both phrases are required because
/// "insufficient permissions" on its own is also how file, container and console
/// ACL errors open, and those say nothing about the key's scopes.
pub fn is_insufficient_permissions_failure(failure: &SemanticResponseFailure) -> bool {
    let code = failure
        .code
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace(['_', '-', ':', ' '], "");
    if code.contains("insufficientpermissions") {
        return true;
    }
    let message = failure
        .message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    message.contains("insufficient permissions") && message.contains("missing scopes")
}

/// Returns whether an upstream rejected a `thinking` block that the client
/// replayed from an earlier turn.
///
/// A thinking block's `signature` only verifies against the upstream that minted
/// it. Claude Code replays assistant thinking blocks in every later turn, so a
/// pooled conversation breaks as soon as one turn lands on a different account
/// than the turn that produced the reasoning — and a relay that re-signs into
/// another platform's API (Bedrock validates strictly) rejects it outright.
/// Neither the credential nor the model is at fault, and no other account in the
/// pool can accept the same history, so this must not be charged to the account.
///
/// The rule needs both nouns plus an invalidity marker because relays word it
/// differently and wrap it in their own prose, which rules out matching one
/// phrase. Requiring `thinking` keeps it clear of request-signing and TLS errors,
/// which also say "signature". A *missing* signature lands here too: same cause,
/// same recovery.
pub fn is_thinking_signature_failure(text: &str) -> bool {
    // Upstreams quote the field names (`` `signature` ``), so drop the backticks
    // before matching rather than spelling both forms.
    let normalized = text.to_lowercase().replace('`', " ");
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let names_a_replayed_block = compact.contains("thinking") && compact.contains("signature");
    let rejected = compact.contains("invalid")
        || compact.contains("无效")
        || compact.contains("verification failed")
        || compact.contains("does not match")
        || compact.contains("is required");
    names_a_replayed_block && rejected
}

/// Returns whether a Chat upstream rejected a follow-up turn because the
/// assistant's reasoning from the previous turn was not passed back.
///
/// DeepSeek/MiMo-style thinking models require every replayed assistant turn to
/// carry its original `reasoning_content`. When it is missing they answer with
/// HTTP 400 and a code such as `reasoning_content_missing` (seen wrapped by
/// new-api/one-api gateways as `{"code":11155,...}`). Unlike the tool-call case
/// this also fires on plain (no tool_calls) assistant turns, which the tool-call
/// reasoning guarantee does not cover. The credential and model are both fine —
/// only the request body is missing a field — so recovery is to add the
/// reasoning and re-ask the same account, not to fail over.
///
/// Matches on the field name plus a missing/required marker (or the numeric
/// gateway code) so relay prose and either spelling still resolve. Requiring the
/// field name keeps generic "field is required" validation errors out.
pub fn is_missing_reasoning_failure(failure: &SemanticResponseFailure) -> bool {
    let code = failure
        .code
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '-', ':', ' '], "");
    if code == "reasoningcontentmissing" || code == "11155" {
        return true;
    }

    let message = failure
        .message
        .to_ascii_lowercase()
        .replace(['`', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if message.contains("11155") {
        return true;
    }
    let names_reasoning = message.contains("reasoning content") || message.contains("reasoning");
    let names_thinking_mode = message.contains("thinking mode");
    let missing_marker = message.contains("must be passed back")
        || message.contains("must be passed")
        || message.contains("is missing")
        || message.contains("is required")
        || message.contains("missing")
        || message.contains("必须") // "reasoning_content 必须回传"
        || message.contains("缺少");
    names_reasoning && names_thinking_mode && missing_marker
}

pub fn is_encrypted_content_failure(failure: &SemanticResponseFailure) -> bool {
    let code = failure
        .code
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '-', ':', ' '], "");
    if code == "invalidencryptedcontent" {
        return true;
    }

    let message = failure
        .message
        .to_ascii_lowercase()
        .replace(['`', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    message.contains("encrypted content")
        && (message.contains("could not be verified")
            || message.contains("could not be decrypted")
            || message.contains("cannot be verified")
            || message.contains("cannot be decrypted")
            || message.contains("invalid encrypted content")
            || message.contains("encrypted content is invalid"))
}

/// Azure cannot resolve an input item created by another resource. This is a
/// request-history failure, not evidence of an unhealthy account or model. An
/// opaque reference cannot be expanded without the real original item.
pub fn is_cross_resource_item_failure(text: &str) -> bool {
    let message = text
        .replace(['`', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    message.contains("azure openai resource")
        && (message.contains("created under a different")
            || message.contains("created by a different"))
        && (message.contains("the item") || message.contains("requested item"))
        && message.contains("use the same resource")
}

/// Returns whether an upstream rejected the request because the assembled prompt
/// exceeds the model's context window.
///
/// This is a verdict on the *request*, not on the account or the model. Every
/// credential in the pool would reject the same bytes identically, so a failover
/// walk cannot recover the turn, a retry cannot either, and charging it to the
/// credential parks a healthy account for a request the caller has to shrink.
/// The gateway this was observed on reports it as an HTTP 502 with
/// `type: server_error` — indistinguishable from a transient upstream wobble by
/// status alone — so the message (or a structured code) is the only signal.
///
/// Structured codes are checked first because they are unambiguous. The prose
/// fallback stays narrow on purpose: it needs the *context length / window*
/// vocabulary, or the one gateway sentence about "more tokens than this model's
/// maximum context length allows". A bare "too long" or "too large" that names
/// the response, `max_tokens`, or a list instead of the prompt must not match,
/// or a genuine account failure would be excused.
pub fn is_context_length_failure(failure: &SemanticResponseFailure) -> bool {
    let code = failure
        .code
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '-', ':', ' '], "");
    if code.contains("contextlengthexceeded")
        || code.contains("modelcontextwindowexceeded")
        || code.contains("stringabovemaxlength")
        || code.contains("maximumnumberoftokens")
    {
        return true;
    }

    let message = failure
        .message
        .to_ascii_lowercase()
        .replace(['`', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // The gateway that produced the report this rule exists for.
    if message.contains("run compaction") && message.contains("maximum context length") {
        return true;
    }
    // The OpenAI / Azure structured sentence and its close paraphrases. Both
    // the "maximum context length" and "context window" spellings are accepted,
    // and the "prompt is too long" form Anthropic uses. Each requires a token
    // count alongside the window so a stray mention of the phrase alone — say a
    // help link — does not match.
    (message.contains("maximum context length") && message.contains("token"))
        || (message.contains("context window") && message.contains("token"))
        || (message.contains("context length") && message.contains("exceed"))
        || message.contains("prompt is too long")
}

/// Returns whether an upstream refused the request because the conversation
/// carries more images than one request may hold
/// (`Exceeded maximum number of images (50) allowed in the request.`).
///
/// Same verdict-on-the-request class as an oversized prompt: the count is a
/// property of the bytes the client sent, so every credential in the pool counts
/// the same images and refuses the same history identically. A failover walk
/// cannot recover the turn, and charging it to the credential parks healthy
/// accounts for a request only the caller can shrink — while the aggregated
/// "all route credentials failed" error buries the one sentence that names the
/// fix.
///
/// Matched on prose alone: the relays that enforce this limit report it under
/// their own generic `invalid_request_error` envelope with `code: null`, so
/// there is no structured field to key on.
pub fn is_too_many_images_failure(failure: &SemanticResponseFailure) -> bool {
    let message = failure
        .message
        .to_ascii_lowercase()
        .replace(['`', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    message.contains("maximum number of images")
        || message.contains("max number of images")
        || message.contains("too many images")
}

/// Returns whether a Chat upstream rejected a conversation because a content
/// part's `type` is outside its text-only allowed list.
///
/// GLM-style Chat gateways word this as `***.***.type 参数非法，取值范围 ['text']`.
/// The masked path is expected: the gateway hides message indices from clients.
/// Requiring the allowed list to contain `text` keeps tool-type and schema-type
/// rejections out of this rule.
pub fn is_text_only_chat_content_failure(failure: &SemanticResponseFailure) -> bool {
    let message = failure.message.to_ascii_lowercase();
    message.contains(".type")
        && message.contains("参数非法")
        && message.contains("取值范围")
        && (message.contains("['text']")
            || message.contains("[\"text\"]")
            || message.contains("[text]"))
}

/// Detects a stream that delivered data but never emitted a terminal marker.
/// A partial Responses stream is commonly surfaced to the caller as
/// `stream disconnected before completion`.
pub fn stream_disconnected_before_completion(
    body: &[u8],
    content_type: Option<&str>,
    streaming_request: bool,
) -> bool {
    if !streaming_request {
        return false;
    }
    let text = String::from_utf8_lossy(body);
    let looks_like_sse = content_type
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        || text.lines().any(|line| {
            let line = line.trim_start();
            line.starts_with("data:") || line.starts_with("event:")
        });
    if !looks_like_sse {
        return false;
    }
    if text.contains("response.completed")
        || text.contains("data: [DONE]")
        || text.contains("message_stop")
        || text.contains("\"finish_reason\":\"stop\"")
        || text.contains("\"finishReason\":\"STOP\"")
    {
        return false;
    }
    text.lines().any(|line| {
        let line = line.trim_start();
        line.strip_prefix("data:")
            .map(str::trim)
            .is_some_and(|data| !data.is_empty() && data != "[DONE]")
    })
}

pub const STREAM_DISCONNECTED_FAILURE_MESSAGE: &str =
    "stream disconnected before completion: stream closed before response.completed";

pub fn detect_response_failed(body: &[u8]) -> Option<SemanticResponseFailure> {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        if let Some(failure) = detect_response_failed_value(&value) {
            return Some(failure);
        }
    }
    let text = std::str::from_utf8(body).ok()?;
    for line in text.lines() {
        let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else {
            continue;
        };
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            if let Some(failure) = detect_response_failed_value(&value) {
                return Some(failure);
            }
        }
    }
    let normalized = text.trim();
    let lower = normalized.to_ascii_lowercase();
    let is_known_error_text = lower.contains("stream disconnected before completion")
        || lower.contains("gateway timeout")
        || lower.contains("bad gateway")
        || lower.contains("service unavailable")
        || lower.contains("connection reset")
        || lower.contains("temporarily unavailable")
        || lower.contains("our servers are currently overloaded")
        || lower.contains("insufficient_quota")
        || lower.contains("quota exhausted")
        || lower.starts_with(INSUFFICIENT_BALANCE_MESSAGE_PREFIX)
        || normalized.contains("额度已耗尽")
        || normalized.contains("额度耗尽")
        || normalized.contains("配额已耗尽");
    if is_known_error_text && !normalized.is_empty() {
        return Some(SemanticResponseFailure {
            code: None,
            error_type: None,
            message: normalized.chars().take(512).collect(),
        });
    }
    None
}

/// Stamp the structured `context_length_exceeded` code onto a semantic failure
/// whose upstream reported the context overflow only in prose.
///
/// Codex decides whether to compact from `error.code`, not from the sentence.
/// One real gateway answers an oversized prompt with `code: null` and only the
/// text "…maximum context length…run compaction", so every bridge that forwards
/// its error to Codex has to supply the code the client keys on. The structured
/// code is only added when the value is already a recognized semantic failure
/// and the code is absent, null, or blank; an unrelated error keeps its own code
/// and an error that already names a code is left alone.
///
/// Returns whether the value was changed.
pub fn stamp_context_length_exceeded_code(value: &mut Value) -> bool {
    let Some(failure) = detect_response_failed_value(value) else {
        return false;
    };
    if failure
        .code
        .as_deref()
        .is_some_and(|code| !code.trim().is_empty())
    {
        return false;
    }
    if !is_context_length_failure(&failure) {
        return false;
    }
    let code = Value::String("context_length_exceeded".to_string());
    // Three possible homes for the error object, tried in order. Chained
    // `or_else` closures cannot borrow `value` mutably twice, so each probe is
    // its own statement.
    for pointer in ["/response/error", "/error", "/extError"] {
        if let Some(error) = value.pointer_mut(pointer).and_then(Value::as_object_mut) {
            error.insert("code".to_string(), code);
            return true;
        }
    }
    if let Some(object) = value.as_object_mut() {
        object.insert("code".to_string(), code);
        return true;
    }
    false
}

pub(crate) fn detect_response_failed_value(value: &Value) -> Option<SemanticResponseFailure> {
    let failed = value.get("type").and_then(Value::as_str) == Some("response.failed")
        || value.pointer("/response/status").and_then(Value::as_str) == Some("failed")
        || value.pointer("/status").and_then(Value::as_str) == Some("failed");
    let has_error = value
        .pointer("/response/error")
        .or_else(|| value.pointer("/error"))
        // new-api/one-api gateways wrap the real upstream error under `extError`.
        .or_else(|| value.pointer("/extError"))
        .is_some_and(|error| {
            error.is_object()
                && (error.get("message").and_then(Value::as_str).is_some()
                    || error.get("code").and_then(Value::as_str).is_some())
        })
        // A gateway envelope with a top-level code (string or numeric, e.g.
        // new-api's `{"code":11155,"msg":...}`) plus a human message under
        // `message` or `msg`.
        || ((value.get("code").and_then(Value::as_str).is_some()
            || value.get("code").and_then(Value::as_i64).is_some())
            && (value.get("message").and_then(Value::as_str).is_some()
                || value.get("msg").and_then(Value::as_str).is_some()));
    if !failed && !has_error {
        return None;
    }
    let code = value
        .pointer("/response/error/code")
        .or_else(|| value.pointer("/error/code"))
        .or_else(|| value.pointer("/extError/code"))
        .or_else(|| value.get("code"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(str::to_string)
        // Fall back to a numeric gateway code (`{"code":11155}`) rendered as text.
        .or_else(|| {
            value
                .pointer("/response/error/code")
                .or_else(|| value.pointer("/error/code"))
                .or_else(|| value.pointer("/extError/code"))
                .or_else(|| value.get("code"))
                .and_then(Value::as_i64)
                .map(|code| code.to_string())
        });
    // Only the error object's own `type` — a top-level one names the envelope
    // (`error`, `response.failed`), not the error family.
    let error_type = value
        .pointer("/response/error/type")
        .or_else(|| value.pointer("/error/type"))
        .or_else(|| value.pointer("/extError/type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|error_type| !error_type.is_empty())
        .map(str::to_string);
    let message = value
        .pointer("/response/error/message")
        .or_else(|| value.pointer("/error/message"))
        .or_else(|| value.pointer("/extError/message"))
        .or_else(|| value.get("message"))
        .or_else(|| value.get("msg"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .unwrap_or("Upstream response reported failure")
        .chars()
        .take(512)
        .collect();
    Some(SemanticResponseFailure {
        code,
        error_type,
        message,
    })
}

/// Upstream `error.code` values that mean the account should be auto-paused
/// (暂停): the gateway hit a hard, time-windowed quota that won't recover by
/// retrying the same account this window, so we stop routing to it.
pub const AUTO_PAUSE_ERROR_CODES: &[&str] = &["global_fixed_window_quota_exhausted"];

/// Returns the matched upstream error code when the response body carries one of
/// [`AUTO_PAUSE_ERROR_CODES`], inspecting both plain JSON and SSE `data:` frames.
pub fn detect_auto_pause_code(body: &[u8]) -> Option<String> {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        if let Some(code) = detect_pause_code_value(&value) {
            return Some(code);
        }
    }
    let text = std::str::from_utf8(body).ok()?;
    for line in text.lines() {
        let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else {
            continue;
        };
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            if let Some(code) = detect_pause_code_value(&value) {
                return Some(code);
            }
        }
    }
    None
}

fn detect_pause_code_value(value: &Value) -> Option<String> {
    let code = value
        .pointer("/error/code")
        .or_else(|| value.pointer("/code"))
        .and_then(Value::as_str)?;
    if AUTO_PAUSE_ERROR_CODES.contains(&code) {
        Some(code.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_response_failed_json_and_nested_status() {
        let body = br#"{"type":"response.failed","response":{"status":"failed","error":{"message":"maintenance"}}}"#;
        assert_eq!(detect_response_failed(body).unwrap().message, "maintenance");
        assert!(detect_response_failed(br#"{"response":{"status":"failed"}}"#).is_some());
    }

    #[test]
    fn recognizes_content_rejection_codes_as_complete_case_insensitive_values() {
        for code in ["sensitive_words_detected", "CONTENT-BLOCKED"] {
            let failure = SemanticResponseFailure {
                code: Some(code.to_string()),
                error_type: Some("new_api_error".to_string()),
                message: "opaque upstream text".to_string(),
            };
            assert!(is_content_rejection(&failure), "{code}");
        }

        for failure in [
            SemanticResponseFailure {
                code: Some("sensitive_words_detected_extra".to_string()),
                error_type: None,
                message: "sensitive_words_detected".to_string(),
            },
            SemanticResponseFailure {
                code: Some("upstream_status".to_string()),
                error_type: None,
                message: "content-blocked".to_string(),
            },
            SemanticResponseFailure {
                code: None,
                error_type: None,
                message: "sensitive words detected".to_string(),
            },
        ] {
            assert!(!is_content_rejection(&failure));
        }
    }

    #[test]
    fn detects_sse_and_ignores_done_and_success() {
        let body = br#": keepalive
data: [DONE]
data: {"type":"response.failed","error":{"message":"down"}}
"#;
        assert_eq!(detect_response_failed(body).unwrap().message, "down");
        assert!(detect_response_failed(br#"{"type":"response.completed"}"#).is_none());
    }

    #[test]
    fn identifies_overloaded_server_response_as_transient() {
        assert!(is_transient_response_failure(
            "Our servers are currently overloaded. Please try again later."
        ));
        assert!(is_transient_response_failure(
            " our   servers are currently overloaded "
        ));
        assert!(!is_transient_response_failure("invalid model"));
    }

    /// The real 200 SSE failure from the live log: `event: error` carries
    /// `too_many_requests` + `no_capacity`, then `response.failed` repeats it.
    #[test]
    fn classifies_high_demand_relay_failure_as_capacity() {
        let body = br#"event: error
data: {"type":"error","error":{"type":"too_many_requests","code":"no_capacity","message":"The system is currently experiencing high demand and cannot process your request. Your request exceeds the maximum usage size allowed during peak load. For improved capacity reliability, consider switching to Provisioned Throughput."}}

event: response.failed
data: {"type":"response.failed","response":{"status":"failed","error":{"code":"no_capacity","message":"The system is currently experiencing high demand"}}}
"#;
        let failure = detect_response_failed(body).expect("semantic failure");
        assert_eq!(failure.code.as_deref(), Some("no_capacity"));
        assert_eq!(failure.error_type.as_deref(), Some("too_many_requests"));
        assert!(is_capacity_response_failure(&failure));
        // Capacity wins over the generic `too_many_requests` family.
        assert!(!is_rate_limit_response_failure(&failure));
    }

    #[test]
    fn separates_capacity_from_account_rate_limits_and_hard_verdicts() {
        let rate_limit = detect_response_failed(
            br#"{"error":{"code":"rate_limit_exceeded","type":"too_many_requests","message":"Rate limit reached, please slow down"}}"#,
        )
        .expect("rate limit failure");
        assert!(!is_capacity_response_failure(&rate_limit));
        assert!(is_rate_limit_response_failure(&rate_limit));

        let quota = detect_response_failed(
            br#"{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}"#,
        )
        .expect("quota failure");
        assert!(!is_capacity_response_failure(&quota));
        assert!(!is_rate_limit_response_failure(&quota));

        let overload = SemanticResponseFailure {
            code: None,
            error_type: None,
            message: "Our servers are currently overloaded. Please try again later.".to_string(),
        };
        assert!(is_capacity_response_failure(&overload));
    }

    /// The exact refusal reported after v0.1.2: HTTP 200, `response.created`,
    /// then a generic `rate_limit_exceeded` naming an Azure region's token
    /// budget. It describes the upstream pool, not this account, so it belongs
    /// to the long-retry Capacity class.
    #[test]
    fn classifies_regional_token_rate_limit_as_capacity() {
        let body = br#"event: error
data: {"type":"error","error":{"type":"too_many_requests","code":"rate_limit_exceeded","message":"Your requests to gpt-6.1-sol for gpt-6.1-sol in eastus2 have exceeded token rate limit.","param":null}}

event: response.failed
data: {"type":"response.failed","response":{"status":"failed","error":{"code":"rate_limit_exceeded","message":"Your requests to gpt-6.1-sol for gpt-6.1-sol in eastus2 have exceeded token rate limit."}}}
"#;
        let failure = detect_response_failed(body).expect("semantic failure");
        assert_eq!(failure.code.as_deref(), Some("rate_limit_exceeded"));
        assert_eq!(failure.error_type.as_deref(), Some("too_many_requests"));
        assert!(is_capacity_response_failure(&failure));
        assert!(!is_rate_limit_response_failure(&failure));

        let bare = SemanticResponseFailure {
            code: Some("tokens_per_minute_limit".to_string()),
            error_type: None,
            message: "Exceeded tokens per minute limit, please retry.".to_string(),
        };
        assert!(is_capacity_response_failure(&bare));
    }

    #[test]
    fn regional_throughput_rule_does_not_swallow_account_limits() {
        let candidates = [
            r#"{"error":{"code":"rate_limit_exceeded","type":"too_many_requests","message":"Rate limit reached, please slow down"}}"#,
            r#"{"error":{"code":"rate_limit_exceeded","message":"You exceeded your current quota, please check your plan and billing details"}}"#,
            r#"{"error":{"code":"rate_limit_exceeded","message":"Requests per minute limit reached for this account"}}"#,
            r#"{"error":{"code":"insufficient_quota","message":"Your requests have exceeded token rate limit"}}"#,
        ];
        for body in candidates {
            let failure = detect_response_failed(body.as_bytes()).expect("semantic failure");
            assert!(
                !is_capacity_response_failure(&failure),
                "misclassified as capacity: {}",
                failure.message
            );
        }
    }

    /// Broad words must not turn a hard verdict into a hundred-retry class.
    #[test]
    fn generic_capacity_wording_does_not_claim_an_upstream_shortage() {
        let candidates = [
            r#"{"error":{"message":"This model's maximum context capacity is 128000 tokens"}}"#,
            r#"{"error":{"message":"Service Unavailable"}}"#,
            r#"{"error":{"message":"The upstream is temporarily unavailable"}}"#,
            r#"{"error":{"code":"storage_capacity_exceeded","message":"Storage capacity is full"}}"#,
        ];
        for body in candidates {
            let failure = detect_response_failed(body.as_bytes()).expect("semantic failure");
            assert!(
                !is_capacity_response_failure(&failure),
                "misclassified as capacity: {}",
                failure.message
            );
        }
    }

    #[test]
    fn detects_generic_error_messages_and_quota_exhaustion() {
        let failure = detect_response_failed(
            r#"{"error":{"code":"insufficient_quota","message":"当日订阅额度已耗尽，请重置或购买新订阅。"}}"#.as_bytes(),
        )
        .expect("error message");
        assert_eq!(failure.code.as_deref(), Some("insufficient_quota"));
        assert!(is_quota_exhaustion_failure(&failure));

        let failure = detect_response_failed(
            br#"{"error":{"message":"stream disconnected before completion"}}"#,
        )
        .expect("generic error message");
        assert!(!is_quota_exhaustion_failure(&failure));

        let failure = detect_response_failed(
            "stream disconnected before completion: stream closed before response.completed"
                .as_bytes(),
        )
        .expect("plain text stream error");
        assert_eq!(failure.message, STREAM_DISCONNECTED_FAILURE_MESSAGE);
    }

    #[test]
    fn new_api_insufficient_user_quota_code_is_definitive_without_message_matching() {
        for body in [
            r#"{"error":{"message":"user quota is not enough (request id: test)","type":"new_api_error","param":"","code":"insufficient_user_quota"}}"#,
            r#"{"error":{"message":"localized message","type":"new_api_error","code":"insufficient_user_quota"}}"#,
            r#"{"type":"response.failed","response":{"error":{"message":"quota","type":"new_api_error","code":"insufficient_user_quota"}}}"#,
        ] {
            let failure = detect_response_failed(body.as_bytes()).unwrap();
            assert!(
                is_quota_exhaustion_failure(&failure),
                "must be account quota: {body}"
            );
        }
    }

    #[test]
    fn insufficient_user_quota_code_does_not_match_another_error_family() {
        for body in [
            r#"{"error":{"message":"user quota is not enough","type":"invalid_request_error","code":"insufficient_user_quota"}}"#,
            r#"{"error":{"message":"user quota is not enough","type":"new_api_error","code":"channel_not_available"}}"#,
        ] {
            let failure = detect_response_failed(body.as_bytes()).unwrap();
            assert!(
                !is_quota_exhaustion_failure(&failure),
                "must not broaden matching: {body}"
            );
        }
    }

    #[test]
    fn treats_new_api_insufficient_user_balance_as_quota_exhaustion() {
        let failure = detect_response_failed(
            r#"{"error":{"type":"new_api_error","message":"用户额度不足, 剩余额度: ＄-0.398052 (request id: 202609020218166141364498268d9d6A3V7Qkt0)"},"type":"error"}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(is_quota_exhaustion_failure(&failure));
    }

    /// A relay in front of a prepaid account stamps its own envelope on the
    /// balance error, so only the opening phrase names the cause.
    #[test]
    fn treats_an_insufficient_balance_message_as_quota_exhaustion() {
        for body in [
            r#"{"error":{"code":"invalid_request_error","message":"Insufficient Balance (request_id: 8634272f-3a00-46f4-8a0a-d526a83c2c00)","param":null,"type":"unknown_error"}}"#,
            r#"{"error":{"message":"insufficient balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}"#,
        ] {
            let failure = detect_response_failed(body.as_bytes()).expect("semantic failure");
            assert!(
                is_quota_exhaustion_failure(&failure),
                "must be account balance: {body}"
            );
            assert!(
                is_definitive_quota_exhaustion_failure(&failure),
                "must settle the account on the first occurrence: {body}"
            );
        }
    }

    /// The phrase has to open the message: the same words mid-sentence describe
    /// an account this request was never routed to.
    #[test]
    fn insufficient_balance_rule_requires_the_message_prefix() {
        let relayed = SemanticResponseFailure {
            code: None,
            error_type: None,
            message: "upstream channel error: Insufficient Balance on channel 3".to_string(),
        };
        assert!(!is_definitive_quota_exhaustion_failure(&relayed));
        assert!(!is_quota_exhaustion_failure(&relayed));

        let unrelated = SemanticResponseFailure {
            code: None,
            error_type: None,
            message: "insufficient permissions for this operation".to_string(),
        };
        assert!(!is_definitive_quota_exhaustion_failure(&unrelated));
    }

    /// A relay that answers in plain text instead of JSON still has to reach the
    /// same verdict.
    #[test]
    fn treats_a_plain_text_insufficient_balance_as_quota_exhaustion() {
        let failure = detect_response_failed(
            b"Insufficient Balance (request_id: 8634272f-3a00-46f4-8a0a-d526a83c2c00)",
        )
        .expect("semantic failure");
        assert!(is_quota_exhaustion_failure(&failure));
    }

    /// A relay whose shared budget pool ran dry answers with this body, and the
    /// generic `quota has been exhausted` message rule already catches it. The
    /// account list explains the difference to the user in a hover hint, and that
    /// copy only makes sense on an 异常 account — so pin the classification here.
    #[test]
    fn treats_an_exhausted_shared_budget_pool_as_quota_exhaustion() {
        let failure = detect_response_failed(
            r#"{"error":{"message":"Budget pool quota has been exhausted. Please ask an administrator to increase the limit or select another budget pool.","type":"bad_response_status_code","param":"","code":"bad_response_status_code"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(is_quota_exhaustion_failure(&failure));
    }

    #[test]
    fn new_api_quota_rule_requires_the_error_type_and_the_message_prefix() {
        let other_new_api_error = detect_response_failed(
            r#"{"error":{"type":"new_api_error","message":"当前分组 default 下对于模型 gpt-5.5 无可用渠道"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(!is_quota_exhaustion_failure(&other_new_api_error));

        let other_error_type = detect_response_failed(
            r#"{"error":{"type":"invalid_request_error","message":"用户额度不足, 剩余额度: ＄-0.398052"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(!is_quota_exhaustion_failure(&other_error_type));

        let prefix_only_in_the_middle = detect_response_failed(
            r#"{"error":{"type":"new_api_error","message":"上游渠道报错：用户额度不足"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(!is_quota_exhaustion_failure(&prefix_only_in_the_middle));
    }

    /// The body OpenAI returns for a restricted key that may call the older
    /// endpoints but was never granted the Responses API. Nothing about it is
    /// specific to the model that was asked for, so it has to settle the account.
    #[test]
    fn treats_a_missing_scope_rejection_as_a_permission_failure() {
        let failure = detect_response_failed(
            r#"{"error":{"message":"You have insufficient permissions for this operation. Missing scopes: api.responses.write. Check that you have the correct role in your organization (Reader, Writer, Owner) and project (Member, Owner), and if you're using a restricted API key, that it has the necessary scopes.","type":"invalid_request_error","param":null,"code":"insufficient_permissions"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(is_insufficient_permissions_failure(&failure));
        // The key still has budget and the model is fine — only the scope is
        // missing, so neither of the neighbouring rules may claim it.
        assert!(!is_quota_exhaustion_failure(&failure));
        assert!(!is_thinking_signature_failure(&failure.message));
    }

    #[test]
    fn detects_a_text_only_chat_content_type_rejection() {
        let failure = detect_response_failed(
            r#"{"error":{"message":"***.***.type 参数非法，取值范围 ['text'] [trace_id=6bd754407a538295f96be0c99106c25c]","type":"invalid_request_error","param":"","code":null}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(is_text_only_chat_content_failure(&failure));

        let unrelated = detect_response_failed(
            r#"{"error":{"message":"tools.0.type 参数非法，取值范围 ['function']","type":"invalid_request_error"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(!is_text_only_chat_content_failure(&unrelated));
    }

    #[test]
    fn detects_a_too_many_images_rejection() {
        // The relay's own wrapper text is part of the sentence; the count is
        // whatever the upstream enforces.
        for message in [
            "OpenAI Responses bad request: Exceeded maximum number of images (50) allowed in the request. [trace_id=223c8d6543609aba62b8ae7897679cbf]",
            "exceeded MAXIMUM  number of images (20) allowed in the request",
            "too many images in this request",
        ] {
            let failure = SemanticResponseFailure {
                code: None,
                error_type: Some("invalid_request_error".to_string()),
                message: message.to_string(),
            };
            assert!(is_too_many_images_failure(&failure), "{message}");
        }

        // Neighbouring verdicts on the request must not be claimed: an image
        // *generation* failure is not an image *count* failure, and an oversized
        // prompt is handled by its own rule.
        for message in [
            "image generation failed: content policy violation",
            "maximum number of tokens exceeded",
            "prompt is too long: 250000 tokens > 200000 maximum",
        ] {
            let failure = SemanticResponseFailure {
                code: None,
                error_type: None,
                message: message.to_string(),
            };
            assert!(!is_too_many_images_failure(&failure), "{message}");
        }
    }

    #[test]
    fn permission_rule_reads_the_message_when_a_gateway_drops_the_code() {
        let relayed = detect_response_failed(
            r#"{"error":{"message":"upstream error: You have insufficient permissions for this operation.\nMissing scopes: model.request.","type":"upstream_error"}}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(is_insufficient_permissions_failure(&relayed));

        // "insufficient permissions" opens plenty of errors that have nothing to
        // do with the key's scopes; without the second phrase it stays generic.
        let unrelated = detect_response_failed(
            br#"{"error":{"message":"insufficient permissions to write /var/lib/model-cache"}}"#,
        )
        .expect("semantic failure");
        assert!(!is_insufficient_permissions_failure(&unrelated));

        let quota = detect_response_failed(
            br#"{"error":{"code":"insufficient_quota","message":"You exceeded your current quota."}}"#,
        )
        .expect("semantic failure");
        assert!(!is_insufficient_permissions_failure(&quota));
    }

    /// The body a Bedrock-backed relay returns once Claude Code replays a
    /// `thinking` block that a *different* upstream produced. Its `error.type` is
    /// the literal string `<nil>` — the gateway formatted a Go nil into JSON — so
    /// the type-based rules cannot see it and the message is all there is.
    #[test]
    fn detects_a_replayed_thinking_signature_rejection() {
        let failure = detect_response_failed(
            r#"{"error":{"message":"Anthropic Claude bad request: InvokeModelWithResponseStream: operation error Bedrock Runtime: InvokeModelWithResponseStream, https response error StatusCode: 400, , ValidationException: messages.5.content.0: Invalid `signature` in `thinking` block (request id: cf669ff644885c3d88c0febf9d08bc37)","type":"<nil>"},"type":"error"}"#
                .as_bytes(),
        )
        .expect("semantic failure");
        assert!(is_thinking_signature_failure(&failure.message));
        // Not the account's fault, so it must not read as spent quota.
        assert!(!is_quota_exhaustion_failure(&failure));
    }

    /// The exact user-reported gateway body: new-api wraps the DeepSeek Chat
    /// rejection as `{"code":11155,...,"extError":{"code":"reasoning_content_missing"}}`.
    #[test]
    fn detects_missing_reasoning_by_code_and_message() {
        let coded = SemanticResponseFailure {
            code: Some("reasoning_content_missing".to_string()),
            error_type: Some("invalid_request_error".to_string()),
            message:
                "the reasoning content from the previous turn must be passed back in thinking mode"
                    .to_string(),
        };
        assert!(is_missing_reasoning_failure(&coded));

        let numeric = SemanticResponseFailure {
            code: Some("11155".to_string()),
            error_type: None,
            message:
                "the reasoning content from the previous turn must be passed back in thinking mode"
                    .to_string(),
        };
        assert!(is_missing_reasoning_failure(&numeric));

        let message_only = SemanticResponseFailure {
            code: None,
            error_type: None,
            message: "The reasoning_content in the thinking mode must be passed back to the API"
                .to_string(),
        };
        assert!(is_missing_reasoning_failure(&message_only));
    }

    /// The verbatim gateway body from the user report: numeric top-level `code`,
    /// `msg` (not `message`), and the real error nested under `extError`. The
    /// detector must extract it and the rule must recognise it.
    #[test]
    fn detects_missing_reasoning_from_verbatim_new_api_envelope() {
        let failure = detect_response_failed(
            br#"{"code":11155,"msg":"the reasoning content from the previous turn must be passed back in thinking mode","requestId":"3d756099a4f609f734f62c52d5f9ae90","extError":{"code":"reasoning_content_missing","message":"the reasoning content from the previous turn must be passed back in thinking mode","param":"","type":"invalid_request_error","StatusCode":400}}"#,
        )
        .expect("gateway envelope is a semantic failure");
        assert!(is_missing_reasoning_failure(&failure));
    }

    /// Must not fire on unrelated validation or on the sibling thinking-signature
    /// failure, which has its own recovery.
    #[test]
    fn missing_reasoning_rule_stays_narrow() {
        for failure in [
            SemanticResponseFailure {
                code: Some("invalid_request_error".to_string()),
                error_type: None,
                message: "field `model` is required".to_string(),
            },
            SemanticResponseFailure {
                code: None,
                error_type: None,
                message: "Invalid `signature` in `thinking` block".to_string(),
            },
            SemanticResponseFailure {
                code: None,
                error_type: None,
                message: "reasoning_effort must be one of low, medium, high".to_string(),
            },
        ] {
            assert!(
                !is_missing_reasoning_failure(&failure),
                "{}",
                failure.message
            );
        }
    }

    #[test]
    fn detects_invalid_encrypted_content_by_code_and_narrow_message_fallback() {
        let coded = detect_response_failed(
            br#"{"error":{"code":"invalid_encrypted_content","message":"The encrypted content could not be verified"}}"#,
        )
        .expect("semantic failure");
        assert!(is_encrypted_content_failure(&coded));

        let relayed = detect_response_failed(
            br#"{"error":{"message":"invalid encrypted content: could not be verified"}}"#,
        )
        .expect("semantic failure");
        assert!(is_encrypted_content_failure(&relayed));

        let unrelated = detect_response_failed(
            br#"{"error":{"code":"invalid_request_error","message":"encrypted content is required"}}"#,
        )
        .expect("semantic failure");
        assert!(!is_encrypted_content_failure(&unrelated));
    }

    #[test]
    fn encrypted_content_failure_does_not_claim_unrelated_invalid_requests() {
        for message in [
            "invalid codex request",
            "invalid max_output_tokens when encrypted content is requested",
            "encrypted content is valid, but the model is invalid",
            "encrypted content is required",
        ] {
            let failure = SemanticResponseFailure {
                code: Some("invalid_responses_request".to_string()),
                error_type: Some("new_api_error".to_string()),
                message: message.to_string(),
            };
            assert!(!is_encrypted_content_failure(&failure), "{message}");
        }
    }

    /// Relays word this differently and wrap it in their own prose, so the rule
    /// matches on the two nouns plus an invalidity marker rather than one phrase.
    #[test]
    fn accepts_other_wordings_of_the_same_rejection() {
        for message in [
            "Invalid signature for thinking block",
            "messages.3.content.0.thinking.signature: signature verification failed",
            "上游报错：thinking 块的 signature 无效",
        ] {
            assert!(
                is_thinking_signature_failure(message),
                "must match: {message}"
            );
        }
    }

    /// `signature` alone belongs to request signing and TLS; `thinking` alone
    /// belongs to every reasoning-parameter complaint. Only together do they name
    /// a replayed reasoning block.
    #[test]
    fn thinking_signature_rule_needs_both_nouns_and_an_invalidity_marker() {
        for message in [
            "SignatureDoesNotMatch: The request signature we calculated does not match the signature you provided",
            "thinking.budget_tokens must be less than max_tokens",
            "invalid_request_error: model not found",
            "thinking block signature accepted",
        ] {
            assert!(
                !is_thinking_signature_failure(message),
                "must not match: {message}"
            );
        }
    }

    #[test]
    fn detects_incomplete_streams_without_terminal_markers() {
        assert!(stream_disconnected_before_completion(
            b"event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\n",
            Some("text/event-stream"),
            true,
        ));
        assert!(!stream_disconnected_before_completion(
            b"data: {\"delta\":\"hello\"}\n\ndata: [DONE]\n\n",
            Some("text/event-stream"),
            true,
        ));
        assert!(!stream_disconnected_before_completion(
            br#"{"error":{"message":"stream disconnected"}}"#,
            Some("application/json"),
            true,
        ));
    }

    #[test]
    fn detects_auto_pause_error_code_in_json() {
        let body = r#"{"error":{"message":"本时段全站额度已用完","type":"rate_limit_error","code":"global_fixed_window_quota_exhausted"}}"#;
        assert_eq!(
            detect_auto_pause_code(body.as_bytes()).as_deref(),
            Some("global_fixed_window_quota_exhausted")
        );
    }

    #[test]
    fn detects_auto_pause_error_code_in_sse_frames() {
        let body = br#": keepalive
data: {"error":{"code":"global_fixed_window_quota_exhausted"}}
"#;
        assert_eq!(
            detect_auto_pause_code(body).as_deref(),
            Some("global_fixed_window_quota_exhausted")
        );
    }

    #[test]
    fn ignores_unrelated_error_codes() {
        assert!(detect_auto_pause_code(br#"{"error":{"code":"rate_limit_error"}}"#).is_none());
        assert!(detect_auto_pause_code(br#"{"error":{"message":"boom"}}"#).is_none());
        assert!(detect_auto_pause_code(br#"{}"#).is_none());
    }
    /// A too-large request is a verdict on the request itself: every account
    /// rejects the same bytes identically, so it must never be charged to a
    /// credential or retried. The gateway words it as an HTTP 502 with
    /// `type: server_error`, which is why the status alone classifies it as a
    /// transient upstream wobble — the message is the only signal.
    #[test]
    fn context_length_failure_matches_the_real_gateway_wording() {
        for message in [
            "Your request resulted in more tokens than this model's maximum context length allows. Please reduce the length of the messages or run compaction.",
            "This model's maximum context length is 128000 tokens. However, your messages resulted in 140000 tokens.",
            "Requested token count exceeds the model's maximum context length of 200000 tokens.",
            "prompt is too long: 250000 tokens > 200000 maximum",
            "This model's maximum context length is 8192 tokens, however you requested 9000 tokens",
        ] {
            let failure = SemanticResponseFailure {
                code: None,
                error_type: Some("server_error".to_string()),
                message: message.to_string(),
            };
            assert!(
                is_context_length_failure(&failure),
                "must match: {message}"
            );
        }
    }

    #[test]
    fn context_length_failure_matches_structured_codes() {
        for code in [
            "context_length_exceeded",
            "model_context_window_exceeded",
            "string_above_max_length",
        ] {
            let failure = SemanticResponseFailure {
                code: Some(code.to_string()),
                error_type: None,
                message: "some localized relay prose".to_string(),
            };
            assert!(
                is_context_length_failure(&failure),
                "must match code {code}"
            );
        }
    }

    /// The rule has to stay narrow: generic "too long" prose about anything but
    /// the prompt (a response, an argument, a list) must not match, or a real
    /// account failure would be excused.
    #[test]
    fn context_length_failure_ignores_unrelated_too_long_errors() {
        for message in [
            "The response took too long to generate",
            "max_tokens is too long for this model",
            "input array is too large",
            "Your request contains too many items",
            "the requested model is too long to resolve",
            "",
        ] {
            let failure = SemanticResponseFailure {
                code: Some("invalid_request_error".to_string()),
                error_type: None,
                message: message.to_string(),
            };
            assert!(
                !is_context_length_failure(&failure),
                "must not match: {message}"
            );
        }
    }

    /// The gateway's context rejection carries only prose and `code: null`.
    /// Codex keys its compaction path on the structured code, so the stamping
    /// pass has to add it — while leaving an existing code or an unrelated
    /// failure alone.
    #[test]
    fn stamps_only_prose_only_context_rejections() {
        let mut null_code = serde_json::json!({
            "type": "response.failed",
            "response": {
                "status": "failed",
                "error": {
                    "code": null,
                    "message": "Your request resulted in more tokens than this model's maximum context length allows. Please reduce the length of the messages or run compaction."
                }
            }
        });
        assert!(stamp_context_length_exceeded_code(&mut null_code));
        assert_eq!(
            null_code
                .pointer("/response/error/code")
                .and_then(Value::as_str),
            Some("context_length_exceeded")
        );

        // An error that already names a code keeps it: the structured code is
        // only a fallback for the prose-only wording.
        let mut other_code = serde_json::json!({
            "error": {
                "code": "rate_limit_error",
                "message": "maximum context length was mentioned"
            }
        });
        assert!(!stamp_context_length_exceeded_code(&mut other_code));
        assert_eq!(
            other_code.pointer("/error/code").and_then(Value::as_str),
            Some("rate_limit_error")
        );

        // An unrelated failure keeps whatever shape it had, code included.
        let mut unrelated = serde_json::json!({
            "type": "response.failed",
            "response": { "status": "failed", "error": { "message": "maintenance" } }
        });
        assert!(!stamp_context_length_exceeded_code(&mut unrelated));
        assert!(unrelated.pointer("/response/error/code").is_none());
    }

    /// Chat-shaped envelopes put the error at the top level; the stamp has to
    /// land on that object, never at the document root.
    #[test]
    fn stamps_a_top_level_error_envelope() {
        let mut value = serde_json::json!({
            "error": {
                "code": null,
                "message": "prompt is too long: 250000 tokens > 200000 maximum"
            }
        });
        assert!(stamp_context_length_exceeded_code(&mut value));
        assert_eq!(
            value.pointer("/error/code").and_then(Value::as_str),
            Some("context_length_exceeded")
        );
        assert!(
            value.get("code").is_none(),
            "the code belongs on the error object: {value}"
        );
    }

    #[test]
    fn cross_resource_item_failure_matches_only_the_resource_reuse_error() {
        for message in [
            "The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.",
            "relay 400: The requested item was created by a different Azure OpenAI resource. Use the same resource that created the item to access it.",
            "The requested item was created under a different `Azure_OpenAI_resource`. Use the same resource that created the item to access it.",
        ] {
            assert!(is_cross_resource_item_failure(message), "{message}");
        }
        for message in [
            "", "The requested item was created under a different subscription.",
            "This deployment belongs to a different Azure OpenAI resource.",
            "Use the same resource that created the item to access it.",
            "The requested item was created under a different Azure OpenAI resource for another request.",
        ] {
            assert!(!is_cross_resource_item_failure(message), "{message}");
        }
        let sse = b"event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.\"}}}\n\n";
        let failure = detect_response_failed(sse).expect("SSE failure");
        assert!(is_cross_resource_item_failure(&failure.message));
        assert!(!is_encrypted_content_failure(&failure));
        assert!(!is_quota_exhaustion_failure(&failure));
    }
}
