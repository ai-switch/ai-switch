//! 音频 SSE 的增量校验与方言转换；不参与文本续写。

use super::protocol::{extract_audio_response, AudioDialect};
use base64::Engine;
use serde_json::{json, Value};

pub const SPEECH_STREAM_FRAME_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub struct SpeechStreamAdapter {
    dialect: AudioDialect,
    pending: Vec<u8>,
    started: bool,
    completed: bool,
}

impl SpeechStreamAdapter {
    pub fn new(dialect: AudioDialect) -> Self {
        Self {
            dialect,
            pending: Vec::new(),
            started: false,
            completed: false,
        }
    }

    pub fn started(&self) -> bool {
        self.started
    }

    pub fn completed(&self) -> bool {
        self.completed
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<u8>, String> {
        let mut output = Vec::new();
        // 按行收完整帧，CRLF 可以被网络拆成两个 chunk；不能逐 chunk 去掉 CR。
        for byte in chunk {
            self.pending.push(*byte);
            if self.pending.len() > SPEECH_STREAM_FRAME_LIMIT {
                return Err("Speech stream frame exceeds the 4 MiB limit".to_string());
            }
            if self.pending.ends_with(b"\n\n") || self.pending.ends_with(b"\r\n\r\n") {
                let block = std::mem::take(&mut self.pending);
                output.extend(self.convert_block(&block)?);
            }
        }
        Ok(output)
    }

    pub fn finish(&mut self) -> Result<Vec<u8>, String> {
        let mut output = Vec::new();
        if !self.pending.is_empty() {
            let mut block = std::mem::take(&mut self.pending);
            if !block.ends_with(b"\n\n") && !block.ends_with(b"\r\n\r\n") {
                if !block.ends_with(b"\n") {
                    block.push(b'\n');
                }
                block.push(b'\n');
            }
            output.extend(self.convert_block(&block)?);
        }
        if !self.started || !self.completed {
            return Err(
                "Speech stream closed before complete audio and speech.audio.done".to_string(),
            );
        }
        Ok(output)
    }

    fn convert_block(&mut self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        let block = std::str::from_utf8(bytes)
            .map_err(|error| format!("Invalid UTF-8 in speech stream: {error}"))?;
        let event = block
            .lines()
            .find_map(|line| line.strip_prefix("event:").map(str::trim));
        let payload = block
            .lines()
            .filter_map(|line| {
                line.strip_prefix("data:")
                    .map(|data| data.strip_prefix(' ').unwrap_or(data))
            })
            .collect::<Vec<_>>()
            .join("\n");
        if event == Some("error") {
            return Err(format!("Speech stream error: {payload}"));
        }
        for line in block
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with(':'))
        {
            let field = line.split_once(':').map_or(line, |(field, _)| field);
            if !matches!(field, "data" | "event" | "id" | "retry") {
                return Err("Speech stream contains an invalid SSE field".to_string());
            }
        }
        if payload.trim().is_empty() {
            return Ok(bytes.to_vec());
        }
        if payload.trim() == "[DONE]" {
            if !self.completed {
                return Err("Speech stream sent [DONE] before speech.audio.done".to_string());
            }
            return Ok(bytes.to_vec());
        }
        let value: Value = serde_json::from_str(&payload)
            .map_err(|error| format!("Invalid JSON in speech stream: {error}"))?;
        if value["type"].as_str() == Some("error")
            || value.get("error").is_some_and(|error| !error.is_null())
        {
            return Err(format!("Speech stream error: {payload}"));
        }
        if self.completed {
            return Err("Speech stream sent data after speech.audio.done".to_string());
        }
        match self.dialect {
            AudioDialect::OpenAi => {
                match value["type"].as_str() {
                    Some("speech.audio.delta") => {
                        let encoded = value["audio"]
                            .as_str()
                            .ok_or_else(|| "Speech audio delta is missing audio".to_string())?;
                        let audio = base64::engine::general_purpose::STANDARD
                            .decode(encoded)
                            .map_err(|error| format!("Invalid Base64 speech audio: {error}"))?;
                        self.started |= !audio.is_empty();
                    }
                    Some("speech.audio.done") => {
                        if !self.started {
                            return Err("Speech stream completed without audio".to_string());
                        }
                        for counter in ["input_tokens", "output_tokens", "total_tokens"] {
                            if value["usage"][counter].as_u64().is_none() {
                                return Err(format!(
                                    "Speech audio done has invalid usage.{counter}"
                                ));
                            }
                        }
                        self.completed = true;
                    }
                    _ => return Err(format!("Unknown speech stream event: {payload}")),
                }
                Ok(bytes.to_vec())
            }
            AudioDialect::MiniMax => self.convert_minimax(&value),
        }
    }

    fn convert_minimax(&mut self, value: &Value) -> Result<Vec<u8>, String> {
        if let Some(status) = value.pointer("/base_resp/status_code") {
            let code = status
                .as_i64()
                .ok_or_else(|| "Invalid MiniMax base_resp.status_code".to_string())?;
            if code != 0 {
                let message = value
                    .pointer("/base_resp/status_msg")
                    .and_then(Value::as_str)
                    .unwrap_or("provider error");
                return Err(format!(
                    "MiniMax speech stream failed with status {code}: {message}"
                ));
            }
        }
        let status = value
            .pointer("/data/status")
            .and_then(Value::as_i64)
            .ok_or_else(|| "MiniMax speech stream is missing data.status".to_string())?;
        if !matches!(status, 0..=2) {
            return Err(format!("Unknown MiniMax speech stream status {status}"));
        }
        let mut output = Vec::new();
        if let Some(audio) = value.pointer("/data/audio") {
            let hex = audio
                .as_str()
                .ok_or_else(|| "MiniMax speech stream audio must be a hex string".to_string())?;
            if !hex.is_empty() {
                let response =
                    json!({ "data": { "audio": hex }, "base_resp": { "status_code": 0 } });
                let bytes =
                    extract_audio_response(AudioDialect::MiniMax, response.to_string().as_bytes())?;
                self.started = true;
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                output.extend(speech_event(
                    &json!({ "type": "speech.audio.delta", "audio": encoded }),
                )?);
            }
        }
        if status == 2 {
            if !self.started {
                return Err("MiniMax speech stream completed without audio".to_string());
            }
            self.completed = true;
            output.extend(speech_event(&json!({
                "type": "speech.audio.done",
                "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 },
            }))?);
        }
        Ok(output)
    }
}

fn speech_event(value: &Value) -> Result<Vec<u8>, String> {
    let payload = serde_json::to_string(value)
        .map_err(|error| format!("Could not encode speech stream event: {error}"))?;
    Ok(format!("data: {payload}\n\n").into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audiogen::protocol::AudioDialect;
    use serde_json::Value;

    const OPENAI_DELTA: &str = "data: {\"type\":\"speech.audio.delta\",\"audio\":\"SUQz\"}\n\n";
    const OPENAI_DONE: &str = "data: {\"type\":\"speech.audio.done\",\"usage\":{\"input_tokens\":4,\"output_tokens\":6,\"total_tokens\":10}}\n\n";

    #[test]
    fn openai_audio_stream_preserves_frames_split_at_every_byte_boundary() {
        let wire = format!("{OPENAI_DELTA}{OPENAI_DONE}");
        for split in 0..=wire.len() {
            let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
            let mut output = adapter.push(&wire.as_bytes()[..split]).expect("first half");
            output.extend(
                adapter
                    .push(&wire.as_bytes()[split..])
                    .expect("second half"),
            );
            output.extend(adapter.finish().expect("semantic completion"));

            assert_eq!(output, wire.as_bytes(), "split {split}");
        }
    }

    #[test]
    fn openai_audio_stream_requires_audio_and_speech_done_not_the_done_sentinel() {
        for wire in [
            OPENAI_DELTA.to_string(),
            format!("{OPENAI_DELTA}data: [DONE]\n\n"),
            OPENAI_DONE.to_string(),
            "data: [DONE]\n\n".to_string(),
        ] {
            let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
            let result = adapter.push(wire.as_bytes()).and_then(|_| adapter.finish());
            assert!(result.is_err(), "incomplete wire: {wire}");
        }
    }

    #[test]
    fn audio_stream_rejects_malformed_base64_and_explicit_error_frames() {
        for wire in [
            "data: {\"type\":\"speech.audio.delta\",\"audio\":\"bad!\"}\n\n",
            "data: {\"type\":\"error\",\"error\":{\"message\":\"voice unavailable\"}}\n\n",
            "event: error\ndata: {\"message\":\"voice unavailable\"}\n\n",
            "data: {broken json}\n\n",
        ] {
            let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
            assert!(adapter.push(wire.as_bytes()).is_err(), "{wire}");
        }
    }

    #[test]
    fn minimax_audio_stream_maps_hex_to_openai_base64_and_finishes_once() {
        let mut adapter = SpeechStreamAdapter::new(AudioDialect::MiniMax);
        let mut output = adapter
            .push(b"data: {\"data\":{\"audio\":\"494433\",\"status\":1},\"base_resp\":{\"status_code\":0}}\n\n")
            .expect("audio delta");
        assert!(adapter.started());
        assert!(!adapter.completed());
        output.extend(
            adapter
                .push(b"data: {\"data\":{\"audio\":\"\",\"status\":2},\"base_resp\":{\"status_code\":0}}\n\n")
                .expect("complete"),
        );
        output.extend(adapter.finish().expect("complete audio"));
        let events: Vec<Value> = std::str::from_utf8(&output)
            .expect("SSE")
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .filter(|payload| *payload != "[DONE]")
            .map(|payload| serde_json::from_str(payload).expect("event"))
            .collect();

        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["type"], "speech.audio.delta");
        assert_eq!(events[0]["audio"], "SUQz");
        assert_eq!(events[1]["type"], "speech.audio.done");
        assert_eq!(events[1]["usage"]["total_tokens"], 0);
        assert!(adapter.completed());
    }

    #[test]
    fn minimax_audio_stream_rejects_business_errors_and_invalid_hex() {
        for payload in [
            r#"{"base_resp":{"status_code":1004,"status_msg":"insufficient balance"}}"#,
            r#"{"data":{"audio":"abc","status":1},"base_resp":{"status_code":0}}"#,
            r#"{"data":{"audio":"gg","status":1},"base_resp":{"status_code":0}}"#,
        ] {
            let mut adapter = SpeechStreamAdapter::new(AudioDialect::MiniMax);
            let wire = format!("data: {payload}\n\n");
            assert!(adapter.push(wire.as_bytes()).is_err(), "{payload}");
        }
    }

    #[test]
    fn audio_stream_handles_split_crlf_and_unterminated_final_done_frame() {
        let wire = format!(": keepalive\r\n\r\n{OPENAI_DELTA}{OPENAI_DONE}")
            .replace("\n", "\r\n")
            .replace("\r\r\n", "\r\n");
        let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
        let mut output = Vec::new();
        for byte in wire.trim_end().as_bytes() {
            output.extend(adapter.push(&[*byte]).expect("bytewise CRLF"));
        }
        output.extend(adapter.finish().expect("final frame without separator"));
        let text = String::from_utf8(output).expect("SSE");

        assert!(text.contains("speech.audio.delta"));
        assert!(text.contains("speech.audio.done"));
    }

    #[test]
    fn audio_stream_rejects_a_done_sentinel_before_the_semantic_done() {
        let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
        adapter.push(OPENAI_DELTA.as_bytes()).expect("audio");
        assert!(adapter.push(b"data: [DONE]\n\n").is_err());
    }

    #[test]
    fn audio_stream_rejects_done_with_missing_or_invalid_usage() {
        for usage in [
            Value::Null,
            serde_json::json!({ "input_tokens": -1, "output_tokens": 6, "total_tokens": 5 }),
            serde_json::json!({ "input_tokens": 4, "output_tokens": 6 }),
        ] {
            let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
            adapter.push(OPENAI_DELTA.as_bytes()).expect("audio");
            let done = format!(
                "data: {}\n\n",
                serde_json::json!({ "type": "speech.audio.done", "usage": usage })
            );
            assert!(adapter.push(done.as_bytes()).is_err());
        }
    }

    #[test]
    fn audio_stream_finishes_an_unterminated_final_done_frame_for_the_client() {
        let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
        adapter.push(OPENAI_DELTA.as_bytes()).expect("audio");
        let final_done = OPENAI_DONE.trim_end();
        assert!(adapter.push(final_done.as_bytes()).unwrap().is_empty());
        let tail = adapter.finish().expect("final complete event");
        assert!(tail.ends_with(b"\n\n"));
    }

    #[test]
    fn audio_stream_rejects_garbage_without_sse_fields_after_done() {
        let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
        adapter
            .push(format!("{OPENAI_DELTA}{OPENAI_DONE}").as_bytes())
            .expect("speech");
        adapter
            .push(b"broken trailing body")
            .expect("incomplete tail");
        assert!(adapter.finish().is_err());
    }

    #[test]
    fn audio_stream_rejects_incomplete_oversized_frames() {
        let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
        assert!(adapter.push(&vec![b'x'; 4 * 1024 * 1024 + 1]).is_err());
    }

    #[test]
    fn audio_stream_rejects_audio_or_errors_after_semantic_completion() {
        for extra in [
            OPENAI_DELTA,
            "data: {\"type\":\"error\",\"error\":{\"message\":\"late failure\"}}\n\n",
        ] {
            let mut adapter = SpeechStreamAdapter::new(AudioDialect::OpenAi);
            adapter
                .push(format!("{OPENAI_DELTA}{OPENAI_DONE}").as_bytes())
                .expect("completed speech");
            assert!(adapter.push(extra.as_bytes()).is_err());
        }
    }
}
