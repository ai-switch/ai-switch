//! 音频生成（多模态网关的 audio 渠道）
//!
//! 支持 TTS（`POST /v1/audio/speech`）与 STT / 翻译（multipart 上传）。
//!
//! **与 `videogen` 的结构差异（重要）**：TTS 一次调用就返回音频字节或 SSE，
//! 没有任务表、没有轮询、没有回调。`protocol` 负责校验与请求/响应转换，
//! `stream` 负责音频 SSE 的增量适配；转发与计费由既有服务负责，不需要持久化层。
//!
//! 供应商（OpenAI / MiniMax / 火山 / Azure / ElevenLabs …）住在账号的
//! `config_json.interface_format` 里，与视频同构。

pub mod protocol;
pub mod stream;
