//! 视频生成协议层（G-P2c）
//! =================================================================
//! 网关对外只暴露**一份** new-api 契约：
//!   POST `/v1/video/generations`  → 201 `{ id, object:"video", model, created_at, task_id, status:"processing" }`
//!   GET  `/v1/video/generations/{task_id}` → 200 `{ task_id, status, url, format, metadata, error }`
//!
//! 上游各家（可灵 / 方舟 Seedance / MiniMax / 智谱 / Sora）差异全部在本文件内吃掉：
//! 请求体构造、提交响应取 taskId、状态响应取 status/url、状态枚举统一。
//!
//! 纯函数 + serde_json，便于单测（对齐 `imagegen/protocol.rs` 的写法）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// 上游视频方言（对齐 new-api 的渠道类型；由 `Provider.kind` 的协议段决定）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoDialect {
    Kling,
    Ark,
    MiniMax,
    Zhipu,
    Sora,
}

impl VideoDialect {
    pub fn as_str(&self) -> &'static str {
        match self {
            VideoDialect::Kling => "kling",
            VideoDialect::Ark => "ark",
            VideoDialect::MiniMax => "minimax",
            VideoDialect::Zhipu => "zhipu",
            VideoDialect::Sora => "sora",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "kling" | "klingai" | "可灵" => Some(VideoDialect::Kling),
            "ark" | "seedance" | "volcengine" | "doubao" => Some(VideoDialect::Ark),
            "minimax" | "hailuo" => Some(VideoDialect::MiniMax),
            "zhipu" | "cogvideo" | "bigmodel" => Some(VideoDialect::Zhipu),
            "sora" | "openai" => Some(VideoDialect::Sora),
            _ => None,
        }
    }
}

/// 统一任务状态（new-api 契约的三种取值）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoTaskStatus {
    Processing,
    Succeeded,
    Failed,
}

impl VideoTaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            VideoTaskStatus::Processing => "processing",
            VideoTaskStatus::Succeeded => "succeeded",
            VideoTaskStatus::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "processing" | "queued" | "running" | "pending" | "submitted" | "preparing"
            | "queueing" | "in_progress" | "waiting" => Some(VideoTaskStatus::Processing),
            "succeeded" | "success" | "succeed" | "completed" | "complete" | "done" => {
                Some(VideoTaskStatus::Succeeded)
            }
            "failed" | "fail" | "error" | "cancelled" | "canceled" => Some(VideoTaskStatus::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        !matches!(self, VideoTaskStatus::Processing)
    }
}

/// 上游状态解析结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpstreamStatus {
    pub status: VideoTaskStatus,
    pub url: Option<String>,
    pub error: Option<String>,
}

/// 入站请求（new-api `/v1/video/generations`）
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct VideoGenerationRequest {
    pub model: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub fps: Option<u32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// 首帧图（new-api 字段名 `image`）
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub seed: Option<i64>,
    #[serde(default)]
    pub n: Option<u32>,
    /// 逃逸口：各家私有参数（negative_prompt / aspect_ratio / resolution / callback_url …）
    #[serde(default)]
    pub metadata: Option<Value>,
}

impl VideoGenerationRequest {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let request: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("Invalid video generation request: {error}"))?;
        if request.model.trim().is_empty() {
            return Err("Video generation request is missing model".to_string());
        }
        Ok(request)
    }

    pub fn metadata_str(&self, key: &str) -> Option<&str> {
        self.metadata
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
    }

    pub fn metadata_f64(&self, key: &str) -> Option<f64> {
        self.metadata
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(Value::as_f64)
    }

    /// 画面比例：优先 metadata.aspect_ratio，其次由 width/height 推导
    pub fn aspect_ratio(&self) -> String {
        if let Some(value) = self.metadata_str("aspect_ratio") {
            return value.to_string();
        }
        match (self.width, self.height) {
            (Some(width), Some(height)) if height > 0 => simplify_ratio(width, height),
            _ => "16:9".to_string(),
        }
    }

    pub fn callback_url(&self) -> Option<&str> {
        self.metadata_str("callback_url")
    }
}

fn simplify_ratio(width: u32, height: u32) -> String {
    fn gcd(a: u32, b: u32) -> u32 {
        if b == 0 {
            a
        } else {
            gcd(b, a % b)
        }
    }
    let divisor = gcd(width, height).max(1);
    format!("{}:{}", width / divisor, height / divisor)
}

/// `Provider.kind` 形如 `video:kling`（G-P1：模态:协议）→ 方言
pub fn dialect_from_provider_kind(kind: &str) -> Option<VideoDialect> {
    let (modality, protocol) = kind.split_once(':')?;
    if !modality.trim().eq_ignore_ascii_case("video") {
        return None;
    }
    VideoDialect::parse(protocol)
}

// ─────────────── 对外（new-api 契约）响应 ───────────────

/// 提交成功响应体（HTTP 201）
pub fn submit_response(model: &str, task_id: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "id": format!("video-{task_id}"),
        "object": "video",
        "model": model,
        "created_at": chrono::Utc::now().timestamp(),
        "task_id": task_id,
        "status": VideoTaskStatus::Processing.as_str(),
    }))
    .expect("static video submit response serializes")
}

/// 状态查询响应体（HTTP 200）
pub fn status_response(
    task_id: &str,
    status: VideoTaskStatus,
    url: Option<&str>,
    error: Option<&str>,
) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "task_id": task_id,
        "status": status.as_str(),
        "url": url,
        "format": "mp4",
        "metadata": Value::Null,
        "error": error,
    }))
    .expect("static video status response serializes")
}

// ─────────────── 上游路径 ───────────────

/// 上游提交路径（可灵按有无首帧图分 text2video / image2video）
pub fn upstream_submit_path(dialect: VideoDialect, has_image: bool) -> String {
    match dialect {
        VideoDialect::Kling => {
            if has_image {
                "/v1/videos/image2video".to_string()
            } else {
                "/v1/videos/text2video".to_string()
            }
        }
        VideoDialect::Ark => "/api/v3/contents/generations/tasks".to_string(),
        VideoDialect::MiniMax => "/v1/video_generation".to_string(),
        VideoDialect::Zhipu => "/v4/videos/generations".to_string(),
        VideoDialect::Sora => "/v1/videos".to_string(),
    }
}

/// 上游状态查询路径（`{task_id}` 占位替换）
pub fn upstream_status_path(dialect: VideoDialect, upstream_task_id: &str) -> String {
    match dialect {
        VideoDialect::Kling => format!("/v1/videos/text2video/{upstream_task_id}"),
        VideoDialect::Ark => format!("/api/v3/contents/generations/tasks/{upstream_task_id}"),
        // MiniMax 轮询走 query string，由调用方拼接（这里给出不带 task_id 的基路径）
        VideoDialect::MiniMax => "/v1/query/video_generation".to_string(),
        VideoDialect::Zhipu => format!("/v4/async-result/{upstream_task_id}"),
        VideoDialect::Sora => format!("/v1/videos/{upstream_task_id}"),
    }
}

// ─────────────── 上游请求体 ───────────────

/// 把统一的 new-api 请求体转成某方言的上游请求体
pub fn upstream_body(
    dialect: VideoDialect,
    model: &str,
    request: &VideoGenerationRequest,
) -> Result<Vec<u8>, String> {
    let prompt = request.prompt.trim();
    let negative_prompt = request.metadata_str("negative_prompt");
    let duration = request.duration.unwrap_or(5.0);
    let ratio = request.aspect_ratio();

    let body = match dialect {
        VideoDialect::Kling => {
            let mut body = json!({
                "model_name": model,
                "prompt": prompt,
                "cfg_scale": request.metadata_f64("cfg_scale").unwrap_or(0.5),
                "mode": request.metadata_str("mode").unwrap_or("std"),
                "duration": duration.round() as i64,
                "aspect_ratio": ratio,
            });
            if let Some(negative) = negative_prompt {
                body["negative_prompt"] = json!(negative);
            }
            if let Some(image) = request.image.as_deref() {
                body["image"] = json!(image);
            }
            body
        }
        VideoDialect::Ark => {
            let mut content = vec![json!({"type": "text", "text": prompt})];
            if let Some(image) = request.image.as_deref() {
                content.push(json!({"type": "image_url", "image_url": {"url": image}}));
            }
            json!({
                "model": model,
                "content": content,
                "duration": duration.round() as i64,
                "ratio": ratio,
            })
        }
        VideoDialect::MiniMax => {
            let mut body = json!({
                "model": model,
                "prompt": prompt,
                "duration": duration.round() as i64,
                "resolution": request.metadata_str("resolution").unwrap_or("1080P"),
            });
            if let Some(image) = request.image.as_deref() {
                body["first_frame_image"] = json!(image);
            }
            if let Some(callback) = request.callback_url() {
                body["callback_url"] = json!(callback);
            }
            body
        }
        VideoDialect::Zhipu => {
            let mut body = json!({
                "model": model,
                "prompt": prompt,
                "with_audio": request.metadata.as_ref().and_then(|m| m.get("with_audio")).and_then(Value::as_bool).unwrap_or(false),
            });
            if let Some(image) = request.image.as_deref() {
                body["image_url"] = json!(image);
            }
            body
        }
        VideoDialect::Sora => {
            let mut body = json!({
                "model": model,
                "prompt": prompt,
                "seconds": duration.round().clamp(1.0, 20.0) as i64,
                "size": request.metadata_str("size").unwrap_or("1280x720"),
            });
            if let Some(image) = request.image.as_deref() {
                body["input_reference"] = json!(image);
            }
            body
        }
    };

    serde_json::to_vec(&body).map_err(|error| format!("Could not serialize upstream video body: {error}"))
}

// ─────────────── 上游响应解析 ───────────────

/// 按点号路径取值（`data.task_id` → `/data/task_id`）
fn dig<'a>(value: &'a Value, dotted: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in dotted.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn dig_str<'a>(value: &'a Value, dotted: &str) -> Option<&'a str> {
    dig(value, dotted).and_then(Value::as_str)
}

fn parse_json(bytes: &[u8], what: &str) -> Result<Value, String> {
    serde_json::from_slice(bytes).map_err(|error| format!("Invalid {what}: {error}"))
}

/// 从上游「提交」响应里取出上游 task_id
pub fn parse_upstream_submit(dialect: VideoDialect, bytes: &[u8]) -> Result<String, String> {
    let value = parse_json(bytes, "upstream video submit response")?;
    let path = match dialect {
        VideoDialect::Kling => "data.task_id",
        VideoDialect::Ark => "id",
        VideoDialect::MiniMax => "task_id",
        VideoDialect::Zhipu => "id",
        VideoDialect::Sora => "id",
    };
    dig_str(&value, path)
        .map(str::to_string)
        .ok_or_else(|| format!("Upstream {} submit response is missing {path}", dialect.as_str()))
}

/// 把上游「状态」响应统一成 `UpstreamStatus`
pub fn parse_upstream_status(dialect: VideoDialect, bytes: &[u8]) -> Result<UpstreamStatus, String> {
    let value = parse_json(bytes, "upstream video status response")?;

    let (status_path, url_path, error_path) = match dialect {
        VideoDialect::Kling => (
            "data.task_status",
            "data.task_result.videos.0.url",
            "data.task_status_msg",
        ),
        VideoDialect::Ark => ("status", "content.video_url", "error.message"),
        VideoDialect::MiniMax => ("status", "file.download_url", "base_resp.status_msg"),
        VideoDialect::Zhipu => ("task_status", "video_result.0.url", "error.message"),
        VideoDialect::Sora => ("status", "output.0.url", "error.message"),
    };

    let raw_status = dig_str(&value, status_path)
        .ok_or_else(|| format!("Upstream {} status response is missing {status_path}", dialect.as_str()))?;
    let status = VideoTaskStatus::parse(raw_status)
        .ok_or_else(|| format!("Unknown {} task status: {raw_status}", dialect.as_str()))?;

    // Sora 完成时视频在 `output[].url`；未完成时 url 为空即可
    let url = dig_str(&value, url_path).map(str::to_string);
    let error = dig_str(&value, error_path).map(str::to_string);

    Ok(UpstreamStatus { status, url, error })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialect_from_kind_and_status_mapping() {
        assert_eq!(
            dialect_from_provider_kind("video:kling"),
            Some(VideoDialect::Kling)
        );
        assert_eq!(
            dialect_from_provider_kind("video:seedance"),
            Some(VideoDialect::Ark)
        );
        assert_eq!(dialect_from_provider_kind("text:openai"), None);
        assert_eq!(dialect_from_provider_kind("video"), None);

        assert_eq!(
            VideoTaskStatus::parse("succeed"),
            Some(VideoTaskStatus::Succeeded)
        );
        assert_eq!(
            VideoTaskStatus::parse("in_progress"),
            Some(VideoTaskStatus::Processing)
        );
        assert_eq!(VideoTaskStatus::parse("Fail"), Some(VideoTaskStatus::Failed));
        assert!(VideoTaskStatus::Succeeded.is_terminal());
        assert!(!VideoTaskStatus::Processing.is_terminal());
    }

    #[test]
    fn builds_kling_and_ark_upstream_bodies() {
        let request = VideoGenerationRequest::parse(
            br#"{"model":"kling-v2-6","prompt":"a fox","duration":5,
                 "image":"https://img/1.png",
                 "metadata":{"negative_prompt":"blur","aspect_ratio":"9:16"}}"#,
        )
        .expect("request");

        let kling = upstream_body(VideoDialect::Kling, "kling-v2-6", &request).expect("kling");
        let kling: Value = serde_json::from_slice(&kling).expect("json");
        assert_eq!(kling["model_name"], "kling-v2-6");
        assert_eq!(kling["negative_prompt"], "blur");
        assert_eq!(kling["aspect_ratio"], "9:16");
        assert_eq!(kling["image"], "https://img/1.png");
        assert_eq!(upstream_submit_path(VideoDialect::Kling, true), "/v1/videos/image2video");

        let ark = upstream_body(VideoDialect::Ark, "doubao-seedance", &request).expect("ark");
        let ark: Value = serde_json::from_slice(&ark).expect("json");
        assert_eq!(ark["content"][0]["type"], "text");
        assert_eq!(ark["content"][1]["image_url"]["url"], "https://img/1.png");
    }

    #[test]
    fn parses_upstream_submit_and_status() {
        let kling_task = parse_upstream_submit(
            VideoDialect::Kling,
            br#"{"code":0,"data":{"task_id":"k-1","task_status":"submitted"}}"#,
        )
        .expect("kling submit");
        assert_eq!(kling_task, "k-1");

        let ark_status = parse_upstream_status(
            VideoDialect::Ark,
            br#"{"status":"succeeded","content":{"video_url":"https://cdn/v.mp4"}}"#,
        )
        .expect("ark status");
        assert_eq!(ark_status.status, VideoTaskStatus::Succeeded);
        assert_eq!(ark_status.url.as_deref(), Some("https://cdn/v.mp4"));

        let zhipu_failed = parse_upstream_status(
            VideoDialect::Zhipu,
            br#"{"task_status":"FAIL","error":{"message":"quota"}}"#,
        )
        .expect("zhipu status");
        assert_eq!(zhipu_failed.status, VideoTaskStatus::Failed);
        assert_eq!(zhipu_failed.error.as_deref(), Some("quota"));

        let sora_processing =
            parse_upstream_status(VideoDialect::Sora, br#"{"status":"in_progress"}"#)
                .expect("sora status");
        assert_eq!(sora_processing.status, VideoTaskStatus::Processing);
    }

    #[test]
    fn emits_new_api_contract_responses() {
        let submit: Value = serde_json::from_slice(&submit_response("kling-v2-6", "t-1")).expect("json");
        assert_eq!(submit["object"], "video");
        assert_eq!(submit["task_id"], "t-1");
        assert_eq!(submit["status"], "processing");

        let status: Value = serde_json::from_slice(&status_response(
            "t-1",
            VideoTaskStatus::Succeeded,
            Some("https://cdn/v.mp4"),
            None,
        ))
        .expect("json");
        assert_eq!(status["task_id"], "t-1");
        assert_eq!(status["status"], "succeeded");
        assert_eq!(status["url"], "https://cdn/v.mp4");
        assert_eq!(status["format"], "mp4");
    }

    #[test]
    fn derives_aspect_ratio_from_dimensions() {
        let request =
            VideoGenerationRequest::parse(br#"{"model":"m","prompt":"p","width":1920,"height":1080}"#)
                .expect("request");
        assert_eq!(request.aspect_ratio(), "16:9");
        assert_eq!(request.callback_url(), None);
    }
}
