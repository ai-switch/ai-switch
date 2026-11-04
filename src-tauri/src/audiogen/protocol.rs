//! 音频生成协议层（TTS + STT）
//! =================================================================
//! 网关对外暴露两份 OpenAI 兼容契约：
//!
//! ```text
//! POST /v1/audio/speech
//!   { model, input, voice, response_format?, speed?, instructions? }
//! → 200 音频字节流（Content-Type 由上游给，原样透传）
//!
//! POST /v1/audio/transcriptions   （multipart/form-data：file + model 表单字段）
//! POST /v1/audio/translations     （同上）
//! → 200 JSON（`{"text": "…"}` 或按 response_format 的形状，原样透传）
//! ```
//!
//! **供应商差异住在这里**（账号的 `config_json.interface_format`），不在 `platform`
//! 里 —— 与视频同构。目前支持 `openai` 与 `minimax` 两种方言。
//!
//! 本文件只放**纯函数**：方言表、请求校验、字符计数、multipart 解析/重建。
//!
//! # 加第二家时要在这里做什么
//!
//! TTS 的供应商差异**比视频大**，因为不只是请求形状不同，回程的编码方式也不同：
//!
//! | 供应商 | 路径 | 鉴权 | 回程 |
//! | --- | --- | --- | --- |
//! | OpenAI | `/v1/audio/speech` | `Bearer` | 原始字节 |
//! | ElevenLabs | `/v1/text-to-speech/{voice_id}` | `xi-api-key` | 原始字节 |
//! | MiniMax（已支持） | `/v1/t2a_v2` | `Bearer` | **JSON，`data.audio` 是 hex** |
//! | 火山/豆包 | `/api/v1/tts` | `Bearer;<token>` | **JSON，base64** |
//! | Azure | `/cognitiveservices/v1` | `Ocp-Apim-Subscription-Key` | 原始字节（要 SSML） |
//! | Google | `/v1/text:synthesize?key=` | `?key=` | **JSON，base64** |
//!
//! 每加一家要做三样东西：方言变体（含 `speech_path` / 鉴权头口径）、请求转换
//! （[`prepare_speech_request`]）与**回程解码**（[`extract_audio_response`]，把 JSON
//! 里的 hex/base64 还原成字节），以及按方言计的 `input` 上限。MiniMax 当前官方契约
//! 不需要 `GroupId` 查询参数。
//!
//! **鉴权头不统一**这件事与现有链路冲突：`build_audio_upstream_request` 现在硬写
//! `Authorization: Bearer`，加 ElevenLabs / Azure 时要改成按方言取头名。
//!
//! # STT / 翻译（遗留 1 落地）
//!
//! 与 TTS 的根本差异：请求是 **multipart/form-data**，`model` 住在**表单字段**里
//! （不能用 JSON 取），文件在 `file` 字段里。所以这里多了一层最小的 multipart
//! 解析/重建（[`parse_multipart`] / [`MultipartForm::rewrite_field`]）——不引依赖，
//! 只支持 RFC 7578 的常见形状（浏览器 / curl / OpenAI SDK 都是这个形状）：
//!
//! ```text
//! --BOUNDARY\r\n
//! Content-Disposition: form-data; name="model"\r\n
//! \r\n
//! whisper-1\r\n
//! --BOUNDARY\r\n
//! Content-Disposition: form-data; name="file"; filename="a.mp3"\r\n
//! (Content-Type: audio/mpeg\r\n)?      ← 可选
//! \r\n
//! <bytes>\r\n
//! --BOUNDARY--\r\n
//! ```
//!
//! 刻意**不支持** `Content-Transfer-Encoding`（base64/quoted-printable 段）：
//! 浏览器、curl 与 OpenAI SDK 都不发它，支持它等于为不存在的客户端写解码器。
//! 撞上了就让校验失败，报错里说清楚。

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
    /// MiniMax 原生的 `/v1/t2a_v2`。
    MiniMax,
}

impl AudioDialect {
    pub fn as_str(&self) -> &'static str {
        match self {
            AudioDialect::OpenAi => "openai",
            AudioDialect::MiniMax => "minimax",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openai" | "openai_speech" | "openai-speech" | "speech" | "tts" => {
                Some(AudioDialect::OpenAi)
            }
            "minimax" | "mini-max" | "hailuo" => Some(AudioDialect::MiniMax),
            _ => None,
        }
    }

    /// 上游 TTS 路径。
    pub const fn speech_path(&self) -> &'static str {
        match self {
            AudioDialect::OpenAi => "/v1/audio/speech",
            AudioDialect::MiniMax => "/v1/t2a_v2",
        }
    }

    /// 单次请求 `input` 的**字符**上限。
    ///
    /// **超限必须拒绝，不能截断**：截断会让「计费的文本」与「实际合成的文本」
    /// 不一致 —— 视频那条「计价口径与上游口径必须同源」的同一个教训。
    pub const fn max_input_characters(&self) -> usize {
        match self {
            AudioDialect::OpenAi => 4096,
            AudioDialect::MiniMax => 10_000,
        }
    }

    /// 该方言是否支持 OpenAI 兼容的 STT / 翻译端点。
    pub const fn supports_transcription(&self) -> bool {
        matches!(self, AudioDialect::OpenAi)
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

/// OpenAI 兼容请求声明的音频编码。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpeechAudioFormat {
    Mp3,
    Opus,
    Aac,
    Flac,
    Wav,
    Pcm,
}

impl SpeechAudioFormat {
    fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("mp3").trim().to_ascii_lowercase().as_str() {
            "mp3" => Ok(Self::Mp3),
            "opus" => Ok(Self::Opus),
            "aac" => Ok(Self::Aac),
            "flac" => Ok(Self::Flac),
            "wav" => Ok(Self::Wav),
            "pcm" => Ok(Self::Pcm),
            format => Err(format!("Unsupported speech response format '{format}'")),
        }
    }

    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Mp3 => "mp3",
            Self::Opus => "opus",
            Self::Aac => "aac",
            Self::Flac => "flac",
            Self::Wav => "wav",
            Self::Pcm => "pcm",
        }
    }

    pub const fn content_type(&self) -> &'static str {
        match self {
            Self::Mp3 => "audio/mpeg",
            Self::Opus => "audio/opus",
            Self::Aac => "audio/aac",
            Self::Flac => "audio/flac",
            Self::Wav => "audio/wav",
            Self::Pcm => "audio/pcm",
        }
    }
}

/// 客户端期望的 TTS 回程形状。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpeechStreamFormat {
    /// 完整的音频字节。
    Audio,
}

impl SpeechStreamFormat {
    fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("audio").trim().to_ascii_lowercase().as_str() {
            "audio" => Ok(Self::Audio),
            format => Err(format!("Unsupported speech stream format '{format}'")),
        }
    }
}

/// 发给上游的请求体及解码回程所需的元数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedSpeechRequest {
    pub body: Vec<u8>,
    pub response_format: SpeechAudioFormat,
    pub stream_format: SpeechStreamFormat,
}

/// 把 OpenAI 兼容的 TTS 请求转换成账号方言。
pub fn prepare_speech_request(
    dialect: AudioDialect,
    body: &[u8],
) -> Result<PreparedSpeechRequest, String> {
    validate_speech_request(dialect, body)?;
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| format!("Invalid speech request: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Speech request must be a JSON object".to_string())?;
    let response_format = SpeechAudioFormat::parse(
        object.get("response_format").and_then(Value::as_str),
    )?;
    let stream_format = SpeechStreamFormat::parse(
        object.get("stream_format").and_then(Value::as_str),
    )?;

    if dialect == AudioDialect::OpenAi {
        return Ok(PreparedSpeechRequest {
            body: body.to_vec(),
            response_format,
            stream_format,
        });
    }

    if response_format == SpeechAudioFormat::Aac {
        return Err("MiniMax does not support the 'aac' speech response format".to_string());
    }
    let model = object
        .get("model")
        .and_then(Value::as_str)
        .expect("validated speech model");
    let input = object
        .get("input")
        .and_then(Value::as_str)
        .expect("validated speech input");
    let voice = object
        .get("voice")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if voice.is_empty() {
        return Err("MiniMax speech requests require voice".to_string());
    }

    let mut voice_setting = serde_json::Map::new();
    voice_setting.insert("voice_id".to_string(), Value::String(voice.to_string()));
    if let Some(speed) = object.get("speed") {
        let speed = speed
            .as_f64()
            .ok_or_else(|| "Speech request speed must be a number".to_string())?;
        if !(0.5..=2.0).contains(&speed) {
            return Err("MiniMax speech request speed must be between 0.5 and 2.0".to_string());
        }
        voice_setting.insert("speed".to_string(), speed.into());
    }

    let native = serde_json::json!({
        "model": model,
        "text": input,
        "voice_setting": voice_setting,
        "audio_setting": {
            "format": response_format.as_str(),
        },
        "output_format": "hex",
        "stream": false,
    });
    let body = serde_json::to_vec(&native)
        .map_err(|error| format!("Failed to encode MiniMax speech request: {error}"))?;
    Ok(PreparedSpeechRequest {
        body,
        response_format,
        stream_format,
    })
}

/// 把供应商回程还原成 OpenAI 音频端点的原始字节。
pub fn extract_audio_response(dialect: AudioDialect, body: &[u8]) -> Result<Vec<u8>, String> {
    if dialect == AudioDialect::OpenAi {
        return Ok(body.to_vec());
    }

    let value: Value = serde_json::from_slice(body)
        .map_err(|error| format!("Invalid MiniMax speech response: {error}"))?;
    let status_code = value
        .pointer("/base_resp/status_code")
        .and_then(Value::as_i64)
        .ok_or_else(|| "MiniMax speech response is missing base_resp.status_code".to_string())?;
    if status_code != 0 {
        let message = value
            .pointer("/base_resp/status_msg")
            .and_then(Value::as_str)
            .unwrap_or("unknown provider error");
        return Err(format!(
            "MiniMax speech request failed with status {status_code}: {message}"
        ));
    }
    let audio = value
        .pointer("/data/audio")
        .and_then(Value::as_str)
        .ok_or_else(|| "MiniMax speech response is missing data.audio".to_string())?;
    decode_hex_audio(audio)
}

fn decode_hex_audio(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 {
        return Err("MiniMax speech audio has an odd-length hex payload".to_string());
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = hex_nibble(pair[0])?;
            let low = hex_nibble(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_nibble(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(format!(
            "MiniMax speech audio contains non-hex character '{}'",
            char::from(value)
        )),
    }
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

// ─────────────── STT / 翻译（multipart） ───────────────

/// STT / 翻译的入站端点。OpenAI 兼容方言的**上游路径与入站相同**（与 TTS 同理，
/// 见 `AudioDialect::speech_path` 的注释）。
pub fn is_transcribe_path(path: &str) -> bool {
    matches!(
        path.trim().trim_end_matches('/'),
        "/v1/audio/transcriptions" | "/v1/audio/translations"
    )
}

/// 从 `Content-Type` 里取 multipart 的 `boundary` 参数。
///
/// 只认 `multipart/form-data`；boundary 可能带引号（RFC 7578 允许），这里统一剥掉。
pub fn multipart_boundary(content_type: &str) -> Option<&str> {
    if !content_type
        .trim()
        .to_ascii_lowercase()
        .starts_with("multipart/form-data")
    {
        return None;
    }
    for param in content_type.split(';').skip(1) {
        let param = param.trim();
        if let Some(value) = param.strip_prefix("boundary=") {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// 一个 multipart 段：头部块 + 负载。
///
/// `head` 是该段除分隔行外的全部头部（含结尾的空行），`payload` 是负载。
/// 保存原始字节而不是解析后的字段，是为了 `rewrite_field` 能把**没动的段原样
/// 放回去**（文件段可能很大，任何无谓的重编码都是浪费与风险）。
#[derive(Debug, Clone, PartialEq, Eq)]
struct MultipartPart {
    head: Vec<u8>,
    payload: Vec<u8>,
    name: String,
}

/// 解析后的 multipart/form-data 体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultipartForm {
    parts: Vec<MultipartPart>,
}

impl MultipartForm {
    /// 取一个**文本**字段的值（`model` / `language` / `prompt` 这些）。
    ///
    /// 只有该字段确实是文本（能按 UTF-8 解）时才返回 `Some`；文件段按名命中
    /// 会返回 `None`（拿二进制当文本是错的）。
    pub fn field(&self, name: &str) -> Option<String> {
        self.parts
            .iter()
            .find(|part| part.name == name)
            .map(|part| String::from_utf8_lossy(&part.payload).into_owned())
    }

    /// 是否带了一个非空的文件段（STT 的 `file` 字段）。
    pub fn has_file(&self, name: &str) -> bool {
        self.parts
            .iter()
            .any(|part| part.name == name && !part.payload.is_empty())
    }

    /// 把一个文本字段的值替换成 `value`，返回重建后的完整请求体。
    ///
    /// 只动这一个段的负载，其余段（包括文件段的原始字节）逐字节原样保留。
    /// 没有这个字段时返回 `None` —— 调用方应当保持原请求体不变。
    pub fn rewrite_field(&self, name: &str, value: &str) -> Option<Vec<u8>> {
        let index = self.parts.iter().position(|part| part.name == name)?;
        Some(self.serialize_with(|at, part| {
            if at == index {
                value.as_bytes().to_vec()
            } else {
                part.payload.clone()
            }
        }))
    }

    /// 把所有段重新序列化成一个 multipart 体（沿用解析时的段序与头部）。
    fn serialize_with(&self, payload: impl Fn(usize, &MultipartPart) -> Vec<u8>) -> Vec<u8> {
        // boundary 只是序列化的分隔符：重建时用哪个都合法，只要不与内容冲突。
        // 用一个固定值而不是从原请求继承，免得「boundary 出现在被改写的字段值里」
        // 这种巧合把体截断 —— OpenAI 兼容的上游按头里的 boundary 解，这里写什么都行。
        let boundary = "ai-switch-form";
        let mut body = Vec::new();
        for (at, part) in self.parts.iter().enumerate() {
            body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
            body.extend_from_slice(&part.head);
            body.extend_from_slice(&payload(at, part));
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        body
    }

    /// 重建体所用的 boundary（写进 Content-Type 头的那个）。
    pub const REBUILD_BOUNDARY: &'static str = "ai-switch-form";
}

/// 解析 multipart/form-data。
///
/// 只支持 RFC 7578 的常见形状（见模块注释）。解析失败返回可读的错误 ——
/// multipart 的坑几乎都是「分隔符没对齐」（少 CRLF、boundary 出现在负载里）。
pub fn parse_multipart(body: &[u8], boundary: &str) -> Result<MultipartForm, String> {
    let delimiter = format!("\r\n--{boundary}");
    let opening = format!("--{boundary}");
    if !body.starts_with(opening.as_bytes()) {
        return Err("Multipart body does not start with the boundary".to_string());
    }
    let mut parts = Vec::new();
    let mut cursor = opening.len();
    loop {
        if body[cursor..].starts_with(b"--") {
            // 终止段（`--boundary--`）；后面允许一个可选的 CRLF。
            break;
        }
        // 段与段之间必须恰好是 CRLF（opening 之后 / 上一个分隔符之后）
        let rest = &body[cursor..];
        if !rest.starts_with(b"\r\n") {
            return Err("Multipart boundary is not followed by CRLF".to_string());
        }
        let segment_start = cursor + 2;
        let segment_end = body[segment_start..]
            .windows(delimiter.len())
            .position(|window| window == delimiter.as_bytes())
            .map(|at| segment_start + at)
            .ok_or_else(|| "Multipart body is missing a closing boundary".to_string())?;
        let segment = &body[segment_start..segment_end];
        // head 保存**完整的头部块**（含头与负载之间的空行 CRLFCRLF）——重建时
        // 原样放回去，头/体分隔才不会丢。payload 从空行之后开始。
        let head_end = segment
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|at| at + 4)
            .ok_or_else(|| "Multipart part is missing its header block".to_string())?;
        let head = segment[..head_end].to_vec();
        let payload = segment[head_end..].to_vec();
        let name = part_name(&head)
            .ok_or_else(|| "Multipart part is missing a form name".to_string())?;
        parts.push(MultipartPart { head, payload, name });
        cursor = segment_end + delimiter.len();
    }
    if parts.is_empty() {
        return Err("Multipart body has no parts".to_string());
    }
    Ok(MultipartForm { parts })
}

/// 从段的头部块里取 `Content-Disposition` 的 `name` 参数。
///
/// 只认 `name="…"`（引号形式，浏览器 / curl / 各 SDK 都发这个）与
/// `name=token`（无引号）两种；`filename` 不参与。
fn part_name(head: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(head);
    for line in text.split("\r\n") {
        let Some((header, value)) = line.split_once(':') else {
            continue;
        };
        if !header.trim().eq_ignore_ascii_case("content-disposition") {
            continue;
        }
        for param in value.split(';') {
            let param = param.trim();
            let Some(rest) = param.strip_prefix("name=") else {
                continue;
            };
            let name = rest.trim().trim_matches('"');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// 校验一次 STT / 翻译请求，返回 `model` 表单字段的值。
///
/// multipart 与 TTS 的 JSON 是两种世界：`model` 在**表单字段**里，文件在 `file`
/// 里。校验只看路由与计费真正依赖的这两个字段，其余（`language` / `prompt` /
/// `response_format` / `temperature` …）一律原样透传，缺了让上游去报错。
pub fn validate_transcribe_request(content_type: &str, body: &[u8]) -> Result<String, String> {
    let boundary = multipart_boundary(content_type)
        .ok_or_else(|| "Transcription request must be multipart/form-data with a boundary".to_string())?;
    let form = parse_multipart(body, boundary)?;
    let model = form
        .field("model")
        .map(|model| model.trim().to_string())
        .unwrap_or_default();
    if model.is_empty() {
        return Err("Transcription request is missing model".to_string());
    }
    if !form.has_file("file") {
        return Err("Transcription request is missing the audio file".to_string());
    }
    Ok(model)
}

/// 供转发层从 multipart 请求里取 `model`（账号匹配用）。
///
/// 不是 multipart、或解析不了时返回 `None` —— 调用方把它当「读不出模型」处理，
/// 与 JSON 请求走同一条兜底。
pub fn multipart_requested_model(content_type: Option<&str>, body: &[u8]) -> Option<String> {
    let boundary = multipart_boundary(content_type?)?;
    parse_multipart(body, boundary).ok()?.field("model")
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
        for alias in ["minimax", "MiniMax", "mini-max", "hailuo"] {
            assert_eq!(
                dialect_from_interface_format(alias),
                Some(AudioDialect::MiniMax),
                "{alias}"
            );
        }
        assert_eq!(AudioDialect::OpenAi.as_str(), "openai");
        assert_eq!(AudioDialect::MiniMax.as_str(), "minimax");
        assert_eq!(AudioDialect::OpenAi.speech_path(), "/v1/audio/speech");
        assert_eq!(AudioDialect::MiniMax.speech_path(), "/v1/t2a_v2");
        assert_eq!(AudioDialect::OpenAi.max_input_characters(), 4096);
        assert_eq!(AudioDialect::MiniMax.max_input_characters(), 10_000);
        assert!(AudioDialect::OpenAi.supports_transcription());
        assert!(!AudioDialect::MiniMax.supports_transcription());
        // 其它视频方言与文本方言不能静默落进音频表里。
        for foreign in ["kling", "ark", "zhipu", "sora", "anthropic", "gemini"] {
            assert_eq!(dialect_from_interface_format(foreign), None, "{foreign}");
        }
    }

    #[test]
    fn maps_openai_speech_request_to_minimax_without_changing_the_billing_text() {
        let request = serde_json::to_vec(&serde_json::json!({
            "model": "speech-02-hd",
            "input": "你好，世界",
            "voice": "male-qn-qingse",
            "response_format": "wav",
            "speed": 1.25,
            "stream_format": "audio",
        }))
        .expect("json");
        let prepared = prepare_speech_request(AudioDialect::MiniMax, &request).expect("request");
        let body: Value = serde_json::from_slice(&prepared.body).expect("json");

        assert_eq!(body["model"], "speech-02-hd");
        assert_eq!(body["text"], "你好，世界");
        assert_eq!(body["voice_setting"]["voice_id"], "male-qn-qingse");
        assert_eq!(body["voice_setting"]["speed"], 1.25);
        assert_eq!(body["audio_setting"]["format"], "wav");
        assert_eq!(body["output_format"], "hex");
        assert_eq!(body["stream"], false);
        assert_eq!(prepared.response_format, SpeechAudioFormat::Wav);
        assert_eq!(prepared.stream_format, SpeechStreamFormat::Audio);
        assert_eq!(prepared.response_format.content_type(), "audio/wav");
        assert_eq!(validate_speech_request(AudioDialect::MiniMax, &request), Ok(5));
    }

    #[test]
    fn keeps_openai_speech_requests_wire_compatible() {
        let request = br#"{"model":"tts-1","input":"hello","voice":"alloy"}"#;
        let prepared = prepare_speech_request(AudioDialect::OpenAi, request).expect("request");

        assert_eq!(prepared.body, request);
        assert_eq!(prepared.response_format, SpeechAudioFormat::Mp3);
        assert_eq!(prepared.stream_format, SpeechStreamFormat::Audio);
    }

    #[test]
    fn rejects_minimax_settings_that_cannot_be_mapped_safely() {
        for request in [
            serde_json::json!({
                "model": "speech-02-hd",
                "input": "hello",
            }),
            serde_json::json!({
                "model": "speech-02-hd",
                "input": "hello",
                "voice": "male-qn-qingse",
                "response_format": "aac",
            }),
            serde_json::json!({
                "model": "speech-02-hd",
                "input": "hello",
                "voice": "male-qn-qingse",
                "speed": 0.49,
            }),
            serde_json::json!({
                "model": "speech-02-hd",
                "input": "hello",
                "voice": "male-qn-qingse",
                "speed": 2.01,
            }),
        ] {
            let body = serde_json::to_vec(&request).expect("json");
            assert!(
                prepare_speech_request(AudioDialect::MiniMax, &body).is_err(),
                "{request}"
            );
        }
    }

    #[test]
    fn decodes_minimax_hex_audio_and_rejects_provider_or_encoding_failures() {
        let audio = extract_audio_response(
            AudioDialect::MiniMax,
            br#"{"data":{"audio":"49443300ff"},"base_resp":{"status_code":0,"status_msg":"success"}}"#,
        )
        .expect("audio");
        assert_eq!(audio, [b'I', b'D', b'3', 0, 0xff]);

        for body in [
            br#"{"data":{"audio":"abc"},"base_resp":{"status_code":0}}"#.as_slice(),
            br#"{"data":{"audio":"gg"},"base_resp":{"status_code":0}}"#.as_slice(),
            br#"{"base_resp":{"status_code":0}}"#.as_slice(),
        ] {
            assert!(extract_audio_response(AudioDialect::MiniMax, body).is_err());
        }
        let error = extract_audio_response(
            AudioDialect::MiniMax,
            br#"{"base_resp":{"status_code":1004,"status_msg":"insufficient balance"}}"#,
        )
        .expect_err("provider-level failures are not audio");
        assert!(error.contains("1004") && error.contains("insufficient balance"), "{error}");
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

    // ── STT / 翻译（multipart）──

    const MP_BOUNDARY: &str = "XyZ123";
    /// 一个典型的 STT 请求：model 文本字段 + file 文件段（带可选 Content-Type）。
    fn sample_multipart(model: &str) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{MP_BOUNDARY}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"model\"\r\n\r\n",
        );
        body.extend_from_slice(model.as_bytes());
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("--{MP_BOUNDARY}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file\"; filename=\"a.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n",
        );
        // 二进制负载（含 0x00 与接近分隔符的形状，钉住「负载原样保留」）
        body.extend_from_slice(&[0x00, 0xff, b'-', b'-', 0x7f]);
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("--{MP_BOUNDARY}--\r\n").as_bytes());
        body
    }

    #[test]
    fn extracts_the_boundary_from_content_type() {
        assert_eq!(
            multipart_boundary("multipart/form-data; boundary=XyZ123"),
            Some("XyZ123")
        );
        // 带引号、带空格、大小写不一的 media type 都要认
        assert_eq!(
            multipart_boundary("Multipart/Form-Data; boundary=\"quoted-boundary\""),
            Some("quoted-boundary")
        );
        assert_eq!(
            multipart_boundary("multipart/form-data;boundary=nosep"),
            Some("nosep")
        );
        // 不是 multipart、或没有 boundary → None
        assert_eq!(multipart_boundary("application/json"), None);
        assert_eq!(multipart_boundary("multipart/form-data"), None);
        assert_eq!(multipart_boundary("multipart/form-data; boundary="), None);
    }

    #[test]
    fn parses_multipart_and_keeps_file_bytes_intact() {
        let body = sample_multipart("whisper-1");
        let form = parse_multipart(&body, MP_BOUNDARY).expect("parses");
        assert_eq!(form.field("model").as_deref(), Some("whisper-1"));
        assert!(form.has_file("file"));

        // 重建请求体再把改写与原文对齐：改写 model 后，文件段必须逐字节原样
        let rewritten = form
            .rewrite_field("model", "upstream-whisper")
            .expect("model field exists");
        let rebuilt = parse_multipart(&rewritten, MultipartForm::REBUILD_BOUNDARY)
            .expect("rebuilt body parses");
        assert_eq!(rebuilt.field("model").as_deref(), Some("upstream-whisper"));
        assert_eq!(
            rebuilt.parts_file_bytes(),
            [0x00, 0xff, b'-', b'-', 0x7f],
        );
    }

    #[test]
    fn rewrite_field_returns_none_without_the_field() {
        let body = sample_multipart("whisper-1");
        let form = parse_multipart(&body, MP_BOUNDARY).expect("parses");
        assert_eq!(form.rewrite_field("language", "zh"), None);
    }

    #[test]
    fn transcribe_paths_are_recognised_exactly() {
        assert!(is_transcribe_path("/v1/audio/transcriptions"));
        assert!(is_transcribe_path("/v1/audio/translations/"));
        assert!(!is_transcribe_path("/v1/audio/speech"));
        // 与 TTS 的同理：不提供无 /v1 的别名（图像那套换不来真实客户端）
        assert!(!is_transcribe_path("/v1/audio/transcribe"));
    }

    #[test]
    fn validates_transcribe_requests_from_the_form_fields() {
        let content_type = format!("multipart/form-data; boundary={MP_BOUNDARY}");
        assert_eq!(
            validate_transcribe_request(&content_type, &sample_multipart("whisper-1")),
            Ok("whisper-1".to_string())
        );

        let missing_model = sample_multipart("  ");
        assert!(validate_transcribe_request(&content_type, &missing_model).is_err());
        // 没有 file 段 / 空文件段 → 拒绝
        let mut no_file = Vec::new();
        no_file.extend_from_slice(format!("--{MP_BOUNDARY}\r\n").as_bytes());
        no_file.extend_from_slice(b"Content-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n");
        no_file.extend_from_slice(format!("--{MP_BOUNDARY}--\r\n").as_bytes());
        assert!(validate_transcribe_request(&content_type, &no_file).is_err());
        // 不是 multipart → 拒绝
        assert!(validate_transcribe_request("application/json", b"{}").is_err());
    }

    #[test]
    fn multipart_requested_model_reads_the_form_field() {
        let body = sample_multipart("whisper-1");
        let content_type = format!("multipart/form-data; boundary={MP_BOUNDARY}");
        assert_eq!(
            multipart_requested_model(Some(&content_type), &body),
            Some("whisper-1".to_string())
        );
        // JSON 请求（TTS）在这里就是 None：调用方按「读不出」兜底
        assert_eq!(multipart_requested_model(Some("application/json"), b"{}"), None);
        assert_eq!(multipart_requested_model(None, &body), None);
    }

    /// 解析后取 file 段的负载（测试辅助：把第一个名为 file 的段字节拿出来）。
    impl MultipartForm {
        fn parts_file_bytes(&self) -> Vec<u8> {
            self.parts
                .iter()
                .find(|part| part.name == "file")
                .map(|part| part.payload.clone())
                .unwrap_or_default()
        }
    }
}
