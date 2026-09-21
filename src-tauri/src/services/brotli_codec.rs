//! brotli for the two places this app has to shrink a lot of JSON text: rotated
//! live-log segments and the diagnostics export.
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
}
