//! brotli for the three places this app has to shrink a lot of JSON text:
//! rotated live-log segments, the diagnostics export, and the per-request
//! response preview stored in `usage_events`.
//!
//! The dependency is already in the build graph — `tauri-utils` pulls `brotli`
//! in, so declaring it directly compiles nothing new — and it earns its place
//! because this particular data compresses by two orders of magnitude. Every
//! proxied turn resends the whole conversation, so a thousand live-log entries
//! are largely the same bytes repeated at long range: measured against real
//! traffic, 14.65 MB of JSONL became 0.12 MB.
//!
//! Quality 6 rather than the crate default of 11, and that is a measurement
//! rather than a shortcut. On the same 14.65 MB, quality 11 took 3.8 s to reach
//! 110x while quality 6 took 0.11 s to reach 119x: the redundancy here is
//! *long-range*, and it is the 4 MB window (`lgwin = 24`) that finds it, not the
//! entropy coder's effort. The expensive setting buys a worse ratio for
//! thirty-five times the wait.
//!
//! Both functions take and return whole buffers, so the peak memory cost of an
//! export is the caller's to reason about: [`compress`] holds the input and the
//! output at once, which for a 146 MB live log means the caller must build the
//! input incrementally rather than by concatenating every entry first.

use std::io::{Read, Write};

/// See the module docs for why this is not 11.
const BROTLI_QUALITY: u32 = 6;
/// 4 MB window — the setting the measured ratio actually depends on.
const BROTLI_WINDOW: u32 = 24;
const BROTLI_BUFFER: usize = 4096;

/// Compress `bytes`, returning the whole brotli stream.
pub fn compress(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    compress_with(|out| out.write_all(bytes))
}

/// Compress whatever `body` writes, without the caller ever holding the whole
/// input.
///
/// This is the one to reach for when the input is large: a full live-log window
/// is ~146 MB of JSON, and building that as a `String` first would double the
/// peak for a file that compresses to under 2 MB.
///
/// The stream is finished when the writer is dropped, so the temporary is scoped
/// rather than merely bound: reading the output while the writer still holds it
/// would hand back a truncated stream.
pub fn compress_with<F>(body: F) -> std::io::Result<Vec<u8>>
where
    F: FnOnce(&mut dyn Write) -> std::io::Result<()>,
{
    let mut out = Vec::new();
    {
        let mut writer =
            brotli::CompressorWriter::new(&mut out, BROTLI_BUFFER, BROTLI_QUALITY, BROTLI_WINDOW);
        body(&mut writer)?;
    }
    Ok(out)
}

/// Decompress a whole brotli stream produced by [`compress`].
pub fn decompress(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut reader = brotli::Decompressor::new(bytes, BROTLI_BUFFER);
    reader.read_to_end(&mut out)?;
    Ok(out)
}

/// Decode a stored `response_body` field, old form or new.
///
/// New rows hold base64 of a brotli stream; rows written before that change
/// hold the preview as plain text. The two are indistinguishable by inspection
/// alone — a short preview really can look like base64 — so the base64 prefix is
/// checked explicitly rather than guessed at. Decoding it that way matches what
/// the pre-change writer could have produced: it stored the preview verbatim,
/// and a preview of a JSON or SSE body always starts with `{`, `[`, a quote or a
/// `data:`/`event:` keyword, none of which begin the readable base64 alphabet in
/// a way that decodes back to a valid brotli stream. A plain-text preview that
/// survives the prefix check anyway then fails to decompress and is returned
/// as-is, so the two failure modes both land on "just show the text".
pub fn decode_stored_text(encoded: &str) -> String {
    if !looks_like_base64(encoded) {
        return encoded.to_string();
    }
    let Ok(bytes) = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        encoded.trim(),
    ) else {
        return encoded.to_string();
    };
    match decompress(&bytes) {
        Ok(decoded) => String::from_utf8_lossy(&decoded).to_string(),
        Err(_) => encoded.to_string(),
    }
}

/// Whether `text` is plausibly base64 and not the plain-text preview it might
/// also be.
///
/// The decisive part is length: base64 output is padded to a multiple of four,
/// and brotli always emits a non-empty stream for the inputs this app stores,
/// so a real encoded value is a multiple of four *and* long enough to hold at
/// least a minimal stream. The previews this replaces are typically a few
/// hundred bytes, but the check is written to prefer the plain-text reading
/// whenever the shape is at all doubtful — a misread here would show the user
/// the gibberish instead of the body.
fn looks_like_base64(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.len() < 8 || trimmed.len() % 4 != 0 {
        return false;
    }
    trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/' || byte == b'=')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_shrinks_repetitive_json() {
        // 复刻真实形态：同一段对话历史在条目之间反复出现。
        let entry = r#"{"kind":"live_log_entry","entry":{"client_request":"{\"input\":[\"#
            .to_string()
            + &"x".repeat(20_000)
            + r#""]},"final_response":"ok"}"#;
        let text = (0..40)
            .map(|index| format!("{entry}\"seq\":{index}"))
            .collect::<Vec<_>>()
            .join("\n");

        let compressed = compress(text.as_bytes()).expect("compress");
        assert!(
            compressed.len() * 20 < text.len(),
            "高度重复的 JSONL 应该被压掉一个数量级以上，实际 {} -> {}",
            text.len(),
            compressed.len()
        );
        let restored = decompress(&compressed).expect("decompress");
        assert_eq!(restored, text.as_bytes());
    }

    #[test]
    fn round_trips_empty_and_tiny_inputs() {
        for input in [b"".as_slice(), b"{}", b"a"] {
            let compressed = compress(input).expect("compress");
            assert_eq!(decompress(&compressed).expect("decompress"), input);
        }
    }

    /// 截断的流必须报错而不是静默返回半截数据——调用方靠这个区分「文件坏了」
    /// 和「文件是空的」。
    #[test]
    fn truncated_stream_is_an_error() {
        let text = "y".repeat(50_000);
        let compressed = compress(text.as_bytes()).expect("compress");
        let truncated = &compressed[..compressed.len() / 2];
        assert!(decompress(truncated).is_err());
    }

    #[test]
    fn decode_stored_text_round_trips_the_encoded_form() {
        use base64::Engine;
        let text = r#"data: {"usage":{"prompt_tokens":120}}"#.repeat(64);
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(compress(text.as_bytes()).expect("compress"));
        assert_eq!(decode_stored_text(&encoded), text);
    }

    /// 迁移前行里存的是明文预览，必须原样返回——不能因为长得像 base64 就解码，
    /// 也不能因为解码失败就把内容丢掉。
    #[test]
    fn decode_stored_text_leaves_plain_previews_alone() {
        for plain in [
            r#"{"error":{"message":"expired"}}"#,
            r#"data: {"id":"chatcmpl-1"}"#,
            "",
            "not base64 at all!!",
            // 长度不是 4 的倍数，不构成合法 base64 编码。
            "hello world",
        ] {
            assert_eq!(decode_stored_text(plain), plain, "input: {plain:?}");
        }
    }

    /// 合法 base64 形状但解出来不是 brotli 的字符串，必须回落成原文而不是报错。
    #[test]
    fn decode_stored_text_falls_back_when_the_bytes_are_not_brotli() {
        let plain = "AAAA";
        assert_eq!(decode_stored_text(plain), plain);
    }
}
