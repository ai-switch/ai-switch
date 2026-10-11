//! 音频生成（多模态网关的 audio 渠道）
//!
//! 目前只做 **TTS**（`POST /v1/audio/speech`）。STT / 翻译（multipart 上传）是
//! 独立的后续档，见计划文档。
//!
//! **与 `videogen` 的结构差异（重要）**：TTS 是**同步**的——一次调用就返回音频
//! 字节本身，没有任务表、没有轮询、没有回调。所以这个模块只有 `protocol.rs`：
//! 上游请求体就是客户端给的 JSON（只改写 `model`），上游路径就是入站路径，
//! 两者都在 `route_proxy_service::build_audio_upstream_request` 里完成，
//! 不需要服务层与持久化层。
//!
//! 供应商（OpenAI / MiniMax / 火山 / Azure / ElevenLabs …）住在账号的
//! `config_json.interface_format` 里，与视频同构。

pub mod protocol;
