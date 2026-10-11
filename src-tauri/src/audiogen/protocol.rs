//! 音频生成协议层（TTS）
//! =================================================================
//! 网关对外只暴露一份 OpenAI 兼容契约：
//!
//! ```text
//! POST /v1/audio/speech
//!   { model, input, voice, response_format?, speed?, instructions? }
//! → 200 音频字节流（Content-Type 由上游给，原样透传）
//! ```
//!
//! **供应商差异住在这里**（账号的 `config_json.interface_format`），不在 `platform`
//! 里 —— 与视频同构。目前只有一个方言 `openai`。
//!
//! 本文件只放**纯函数**：方言表、请求校验、字符计数。
//!
//! # 加第二家时要在这里做什么
//!
//! TTS 的供应商差异**比视频大**，因为不只是请求形状不同，回程的编码方式也不同：
//!
//! | 供应商 | 路径 | 鉴权 | 回程 |
//! | --- | --- | --- | --- |
//! | OpenAI | `/v1/audio/speech` | `Bearer` | 原始字节 |
//! | ElevenLabs | `/v1/text-to-speech/{voice_id}` | `xi-api-key` | 原始字节 |
//! | MiniMax | `/v1/t2a_v2?GroupId=` | `Bearer` | **JSON，`data.audio` 是 hex** |
//! | 火山/豆包 | `/api/v1/tts` | `Bearer;<token>` | **JSON，base64** |
//! | Azure | `/cognitiveservices/v1` | `Ocp-Apim-Subscription-Key` | 原始字节（要 SSML） |
//! | Google | `/v1/text:synthesize?key=` | `?key=` | **JSON，base64** |
//!
//! 所以那时要加三样东西：方言变体（含 `speech_path` / 鉴权头口径）、
//! **回程解码**（把 JSON 里的 hex/base64 还原成字节）、以及按方言计的 `input` 上限。
//! 现在不做回程解码，是因为唯一的方言回的就是原始字节 —— 写一个恒等函数只是噪声。
//!
//! **鉴权头不统一**这件事与现有链路冲突：`build_audio_upstream_request` 现在硬写
//! `Authorization: Bearer`，加 ElevenLabs / Azure 时要改成按方言取头名。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 上游 TTS 方言。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioDialect {
    /// OpenAI 兼容的 `/v1/audio/speech`。
    ///
    /// 刻意就叫 `openai`：这**不是**文本的 `ApiDialect::OpenAi`（两者是不同的
    /// 东西，各自在自己的模块里），而是「这个账号说的是 OpenAI 的音频线协议」。
    /// 视频那边刻意**排除**了 `openai` 别名，因为那里 `interface_format: "openai"`
    /// 会静默变成「Sora」；音频这里 `openai` 是正当取值。结论相反是因为语义不同。
    OpenAi,
}

impl AudioDialect {
    pub fn as_str(&self) -> &'static str {
        match self {
            AudioDialect::OpenAi => "openai",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openai" | "openai_speech" | "openai-speech" | "speech" | "tts" => {
                Some(AudioDialect::OpenAi)
            }
            _ => None,
        }
    }

    /// 上游 TTS 路径。
    ///
    /// OpenAI 兼容端点的上游路径与入站路径**相同**，所以这里就是那个字面量。
    /// 加非兼容方言时它会变成各家自己的路径。
    pub const fn speech_path(&self) -> &'static str {
        "/v1/audio/speech"
    }

    /// 单次请求 `input` 的**字符**上限。
    ///
    /// OpenAI 是 4096（MiniMax 是 10000）。**超限必须拒绝，不能截断**：截断会让
    /// 「计费的文本」与「实际合成的文本」不一致 —— 视频那条「计价口径与上游口径
    /// 必须同源」的同一个教训。
    pub const fn max_input_characters(&self) -> usize {
        match self {
            AudioDialect::OpenAi => 4096,
        }
    }
}

/// 账号的 `config_json.interface_format` → 上游方言。
pub fn dialect_from_interface_format(value: &str) -> Option<AudioDialect> {
    AudioDialect::parse(value)
}

/// `input` 的**字符**数。
///
/// **必须按 `chars()` 数，不是 `len()`**：`len()` 是 UTF-8 字节数，而中文一个字
/// 是 3 个字节 —— 按字节计费会多收 3 倍。
pub fn input_characters(input: &str) -> usize {
    input.chars().count()
}

/// 校验一次 TTS 请求体，返回 `input` 的字符数。
///
/// 返回的字符数是**计费的唯一来源**。响应是二进制、解析不了，所以用量只能从请求
/// 算 —— 这反而是好事：确定性，且与上游的计费口径一致（上游也是按 `input` 收）。
///
/// 只校验路由与计费真正依赖的两个字段（`model` / `input`），**其余一律原样透传**：
/// `voice` 是各家私有的（OpenAI 的 `alloy`、MiniMax 的 `voice_id`、ElevenLabs 的
/// URL 段），统一词表是自找的抽象泄漏，缺了就让上游去报错。
pub fn validate_speech_request(dialect: AudioDialect, body: &[u8]) -> Result<usize, String> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| format!("Invalid speech request: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Speech request must be a JSON object".to_string())?;

    let model = object
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if model.is_empty() {
        return Err("Speech request is missing model".to_string());
    }

    let input = object
        .get("input")
        .and_then(Value::as_str)
        .ok_or_else(|| "Speech request is missing input".to_string())?;
    let characters = input_characters(input);
    if characters == 0 {
        return Err("Speech request input must not be empty".to_string());
    }
    let limit = dialect.max_input_characters();
    if characters > limit {
        return Err(format!(
            "Speech request input is {characters} characters, over the {limit}-character limit of the '{}' dialect",
            dialect.as_str()
        ));
    }
    Ok(characters)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialect_table_round_trips_and_takes_aliases() {
        for alias in ["openai", "OpenAI", "tts", "speech", "openai-speech"] {
            assert_eq!(
                dialect_from_interface_format(alias),
                Some(AudioDialect::OpenAi),
                "{alias}"
            );
        }
        assert_eq!(AudioDialect::OpenAi.as_str(), "openai");
        assert_eq!(
            dialect_from_interface_format(AudioDialect::OpenAi.as_str()),
            Some(AudioDialect::OpenAi)
        );
        // 视频方言不能落进音频表里（反过来也一样）—— 两个方向的静默死数据
        for foreign in ["kling", "ark", "minimax", "zhipu", "sora", "anthropic", "gemini"] {
            assert_eq!(dialect_from_interface_format(foreign), None, "{foreign}");
        }
    }

    /// 中文必须按**字符**数，不是字节数。
    ///
    /// 这条是计费正确性的地基：`"你好".len()` 是 6，按字节收费会多收 3 倍。
    #[test]
    fn counts_characters_not_utf8_bytes() {
        assert_eq!(input_characters("你好"), 2);
        assert_eq!("你好".len(), 6);
        assert_eq!(input_characters("hello"), 5);
        assert_eq!(input_characters("a你b"), 3);
        // emoji 是单个字符（多个字节）
        assert_eq!(input_characters("🙂"), 1);
    }

    #[test]
    fn validates_speech_requests_and_returns_the_character_count() {
        let dialect = AudioDialect::OpenAi;
        // 中文必须按**字符**数（5），不是字节数（15）
        let chinese = serde_json::to_vec(&serde_json::json!({
            "model": "tts-1",
            "input": "你好，世界",
            "voice": "alloy",
        }))
        .unwrap();
        assert_eq!(validate_speech_request(dialect, &chinese), Ok(5));
        // 只认 model / input，其余原样（voice 缺了也不在这里拦）
        assert_eq!(
            validate_speech_request(dialect, br#"{"model":"tts-1","input":"hi"}"#),
            Ok(2)
        );

        for body in [
            &b"not json"[..],
            &b"[]"[..],
            &br#"{"input":"hi"}"#[..],
            &br#"{"model":"  ","input":"hi"}"#[..],
            &br#"{"model":"tts-1"}"#[..],
            &br#"{"model":"tts-1","input":""}"#[..],
            &br#"{"model":"tts-1","input":123}"#[..],
        ] {
            assert!(
                validate_speech_request(dialect, body).is_err(),
                "{}",
                String::from_utf8_lossy(body)
            );
        }
    }

    /// 超限必须**拒绝**，不能截断：截断会让计费的文本与实际合成的文本不一致。
    #[test]
    fn rejects_input_over_the_dialect_limit() {
        let dialect = AudioDialect::OpenAi;
        let limit = dialect.max_input_characters();
        let exact = "a".repeat(limit);
        assert_eq!(
            validate_speech_request(
                dialect,
                serde_json::to_vec(&serde_json::json!({"model": "tts-1", "input": exact}))
                    .unwrap()
                    .as_slice()
            ),
            Ok(limit)
        );

        let over = "a".repeat(limit + 1);
        let error = validate_speech_request(
            dialect,
            serde_json::to_vec(&serde_json::json!({"model": "tts-1", "input": over}))
                .unwrap()
                .as_slice(),
        )
        .expect_err("over the limit must be rejected");
        assert!(error.contains("over the"), "{error}");
        // 上限是按**字符**算的，所以 4096 个中文字符是合法的
        let chinese = "你".repeat(limit);
        assert_eq!(
            validate_speech_request(
                dialect,
                serde_json::to_vec(&serde_json::json!({"model": "tts-1", "input": chinese}))
                    .unwrap()
                    .as_slice()
            ),
            Ok(limit)
        );
    }
}
