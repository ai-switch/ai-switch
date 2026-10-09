//! Per-account, lossless Brotli request transport.
//!
//! Missing/auto configuration follows the verified site list shared with the
//! account editor. Explicit on is an opt-in for other HTTP model upstreams;
//! explicit off always wins. Unknown values fail closed.
//! Only the wire representation changes: decompression recovers every original
//! byte. Model accounting, diagnostics and client history remain uncompressed.

use crate::services::brotli_codec;
use axum::http::header::{CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue};
use serde::de::IgnoredAny;
use serde_json::Value;
use std::sync::OnceLock;
use url::Url;

pub(crate) const CONFIG_KEY: &str = "request_brotli_compression";

pub(crate) fn validate(mode: Option<&Value>) -> Result<(), crate::error::AppError> {
    if matches!(mode, None | Some(Value::Null))
        || mode
            .and_then(Value::as_str)
            .is_some_and(|mode| matches!(mode, "auto" | "on" | "off"))
    {
        return Ok(());
    }
    Err(crate::error::AppError::Validation {
        code: "validation.request_brotli_compression",
        message: "Brotli 请求压缩仅支持 auto、on、off。".into(),
        details: None,
        recoverable: true,
    })
}

/// Return an encoded wire body, or leave both body and headers untouched.
/// Call after JSON transformations and after capturing readable diagnostics and
/// streaming flags. Response compression negotiation must not change.
pub(crate) fn encode_request_body(
    target_url: &str,
    headers: &mut HeaderMap,
    body: &[u8],
    config: &Value,
) -> Option<Vec<u8>> {
    let manual = match config.get(CONFIG_KEY) {
        Some(Value::String(mode)) if mode == "on" => true,
        None | Some(Value::Null) => false,
        Some(Value::String(mode)) if mode == "auto" => false,
        _ => return None,
    };
    let target = Url::parse(target_url).ok()?;
    if !matches!(target.scheme(), "http" | "https") {
        return None;
    }
    if !manual {
        // Automatic support was verified against these model endpoints on
        // 2026-10-08; don't implicitly enable unverified ports or sibling APIs.
        if target.scheme() != "https"
            || target.port_or_known_default() != Some(443)
            || !matches!(
                target.path().trim_end_matches('/'),
                "/v1/responses" | "/v1/chat/completions" | "/v1/messages"
            )
        {
            return None;
        }
        static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
        let hosts = HOSTS.get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../src/lib/requestCompressionHosts.json"
            ))
            .expect("valid built-in request compression hosts")
        });
        if !target.host_str().is_some_and(|host| {
            hosts
                .iter()
                .any(|allowed| host.eq_ignore_ascii_case(allowed))
        }) {
            return None;
        }
    }
    let content_type = headers.get(CONTENT_TYPE)?.to_str().ok()?;
    if !content_type
        .split(';')
        .next()?
        .trim()
        .eq_ignore_ascii_case("application/json")
        || !headers.get_all(CONTENT_ENCODING).iter().all(|value| {
            value
                .to_str()
                .is_ok_and(|encoding| encoding.trim().eq_ignore_ascii_case("identity"))
        })
    {
        return None;
    }
    // Validate without reserializing, including nested JSON argument strings.
    if body
        .iter()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
        != Some(b'{')
        || serde_json::from_slice::<IgnoredAny>(body).is_err()
    {
        return None;
    }
    let encoded = brotli_codec::compress(body).ok()?;
    headers.insert(CONTENT_ENCODING, HeaderValue::from_static("br"));
    headers.remove(CONTENT_LENGTH);
    Some(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::{
        ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE,
    };
    use axum::http::HeaderValue;
    use std::io::Read;

    const URL: &str = "https://ps.air-outer.com/v1/responses";
    const BODY: &str = r#" {
  "model": "deepseek-v4-flash",
  "input": [{"type":"function_call","name":"Bash","arguments":"{\"command\":\"ls -la; echo \\\"-----\\\"; ls -la\"}"}],
  "stream": true, "text": "中文 🧪", "escaped": "\u003b", "literal": "\\u003b"
} "#;

    fn json_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
        headers
    }

    fn decode_wire_body(body: &[u8]) -> Vec<u8> {
        let mut decoded = Vec::new();
        brotli::Decompressor::new(body, 4096)
            .read_to_end(&mut decoded)
            .expect("valid Brotli wire body");
        decoded
    }

    #[test]
    fn preserves_every_json_byte_including_tool_commands_and_escapes() {
        serde_json::from_str::<serde_json::Value>(BODY).expect("valid fixture");
        let mut headers = json_headers();
        let encoded =
            encode_request_body(URL, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
                .expect("AgentRouter JSON must use Brotli");
        assert_eq!(headers[CONTENT_ENCODING], "br");
        assert_eq!(decode_wire_body(&encoded), BODY.as_bytes());
    }

    #[test]
    fn replaces_identity_and_removes_stale_length_without_changing_other_headers() {
        let mut headers = json_headers();
        headers.insert(CONTENT_ENCODING, HeaderValue::from_static("identity"));
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("999999"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer fixture-key"),
        );
        encode_request_body(URL, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
            .expect("encoded body");
        assert_eq!(headers[CONTENT_ENCODING], "br");
        assert!(!headers.contains_key(CONTENT_LENGTH));
        assert_eq!(headers[ACCEPT_ENCODING], "identity");
        assert_eq!(headers[CONTENT_TYPE], "application/json");
        assert_eq!(headers[AUTHORIZATION], "Bearer fixture-key");
    }

    #[test]
    fn supports_the_verified_model_endpoints_and_canonical_host_names() {
        for url in [
            URL,
            "https://ps.air-outer.com/v1/chat/completions",
            "https://ps.air-outer.com/v1/messages",
            "https://PS.AIR-OUTER.COM:443/v1/responses/?stream=true",
        ] {
            let mut headers = json_headers();
            assert!(
                encode_request_body(url, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
                    .is_some(),
                "{url}"
            );
        }
    }

    #[test]
    fn accepts_json_content_type_parameters() {
        let mut headers = json_headers();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("Application/JSON; charset=utf-8"),
        );
        assert!(
            encode_request_body(URL, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
                .is_some()
        );
    }

    #[test]
    fn leaves_other_hosts_and_non_model_routes_untouched() {
        for url in [
            "https://example.com/v1/responses",
            "https://agentrouter.org/v1/responses",
            "https://ps.air-outer.com.evil.test/v1/responses",
            "https://ps.air-outer.com@evil.test/v1/responses",
            "https://evil.test/ps.air-outer.com/v1/responses",
            "https://ps.air-outer.com:8443/v1/responses",
            "http://ps.air-outer.com/v1/responses",
            "https://ps.air-outer.com/v1/models",
            "https://ps.air-outer.com/api/user/self",
            "https://ps.air-outer.com/v1/responses/other",
            "not a URL",
        ] {
            let mut headers = json_headers();
            let before = headers.clone();
            assert!(
                encode_request_body(url, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
                    .is_none(),
                "{url}"
            );
            assert_eq!(headers, before, "{url}");
        }
    }

    #[test]
    fn does_not_double_compress_existing_content_encodings() {
        for encoding in ["br", "gzip", "deflate", "identity, gzip"] {
            let mut headers = json_headers();
            headers.insert(CONTENT_ENCODING, HeaderValue::from_str(encoding).unwrap());
            let before = headers.clone();
            assert!(encode_request_body(
                URL,
                &mut headers,
                BODY.as_bytes(),
                &serde_json::json!({})
            )
            .is_none());
            assert_eq!(headers, before);
        }
        let mut headers = json_headers();
        headers.append(CONTENT_ENCODING, HeaderValue::from_static("identity"));
        headers.append(CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        let before = headers.clone();
        assert!(
            encode_request_body(URL, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
                .is_none()
        );
        assert_eq!(headers, before);
    }

    #[test]
    fn leaves_non_json_content_types_untouched() {
        for content_type in [
            None,
            Some("text/plain"),
            Some("multipart/form-data; boundary=test"),
        ] {
            let mut headers = json_headers();
            headers.remove(CONTENT_TYPE);
            if let Some(content_type) = content_type {
                headers.insert(CONTENT_TYPE, HeaderValue::from_str(content_type).unwrap());
            }
            let before = headers.clone();
            assert!(encode_request_body(
                URL,
                &mut headers,
                BODY.as_bytes(),
                &serde_json::json!({})
            )
            .is_none());
            assert_eq!(headers, before);
        }
    }

    #[test]
    fn leaves_empty_malformed_and_non_object_json_untouched() {
        for body in ["", "not JSON", "{\"model\":", "[]", "null", "\"a string\""] {
            let mut headers = json_headers();
            let before = headers.clone();
            assert!(encode_request_body(
                URL,
                &mut headers,
                body.as_bytes(),
                &serde_json::json!({})
            )
            .is_none());
            assert_eq!(headers, before);
        }
    }

    #[test]
    fn request_compression_manual_on_supports_non_whitelisted_http_model_endpoints() {
        let mut headers = json_headers();
        let wire = encode_request_body(
            "http://127.0.0.1:12345/custom/chat",
            &mut headers,
            BODY.as_bytes(),
            &serde_json::json!({"request_brotli_compression":"on"}),
        )
        .expect("manual Brotli opt-in");
        assert_eq!(headers[CONTENT_ENCODING], "br");
        assert_eq!(decode_wire_body(&wire), BODY.as_bytes());
    }

    #[test]
    fn request_compression_explicit_off_overrides_the_automatic_allowlist() {
        let mut headers = json_headers();
        let before = headers.clone();
        assert!(encode_request_body(
            URL,
            &mut headers,
            BODY.as_bytes(),
            &serde_json::json!({"request_brotli_compression":"off"})
        )
        .is_none());
        assert_eq!(headers, before);
    }

    #[test]
    fn request_compression_legacy_and_explicit_auto_keep_the_verified_default() {
        for config in [
            serde_json::json!({}),
            serde_json::json!({"request_brotli_compression":null}),
            serde_json::json!({"request_brotli_compression":"auto"}),
        ] {
            let mut headers = json_headers();
            assert!(encode_request_body(URL, &mut headers, BODY.as_bytes(), &config).is_some());
            let mut headers = json_headers();
            assert!(encode_request_body(
                "https://other.example/v1/responses",
                &mut headers,
                BODY.as_bytes(),
                &config
            )
            .is_none());
        }
    }

    #[test]
    fn request_compression_unknown_modes_never_enable_automatic_compression() {
        for value in [
            serde_json::json!("invalid"),
            serde_json::json!(true),
            serde_json::json!(1),
            serde_json::json!({}),
        ] {
            let mut headers = json_headers();
            assert!(encode_request_body(
                URL,
                &mut headers,
                BODY.as_bytes(),
                &serde_json::json!({"request_brotli_compression":value})
            )
            .is_none());
        }
    }

    #[test]
    fn request_compression_manual_mode_still_obeys_wire_safety_guards() {
        let config = serde_json::json!({"request_brotli_compression":"on"});
        let mut headers = json_headers();
        assert!(encode_request_body(
            "file:///tmp/request",
            &mut headers,
            BODY.as_bytes(),
            &config
        )
        .is_none());
        assert!(encode_request_body(URL, &mut headers, b"not JSON", &config).is_none());
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("multipart/form-data"),
        );
        assert!(encode_request_body(URL, &mut headers, BODY.as_bytes(), &config).is_none());
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        let before = headers.clone();
        assert!(encode_request_body(URL, &mut headers, BODY.as_bytes(), &config).is_none());
        assert_eq!(headers, before);
    }

    #[tokio::test]
    async fn sends_a_wire_body_matching_its_encoding_and_length_headers() {
        use axum::{body::Bytes, routing::post, Json, Router};
        let mut headers = json_headers();
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("999999"));
        let wire_body =
            encode_request_body(URL, &mut headers, BODY.as_bytes(), &serde_json::json!({}))
                .expect("encoded body");
        let wire_length = wire_body.len();
        let app = Router::new().route(
            "/v1/responses",
            post(|headers: HeaderMap, body: Bytes| async move {
                Json(serde_json::json!({
                    "encoding": headers[CONTENT_ENCODING].to_str().unwrap(),
                    "declared_length": headers[CONTENT_LENGTH].to_str().unwrap(),
                    "received_length": body.len(),
                    "decoded": String::from_utf8(decode_wire_body(&body)).unwrap(),
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let result = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
            .post(format!("http://{address}/v1/responses"))
            .headers(headers)
            .body(wire_body)
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap();
        server.abort();
        let _ = server.await;
        assert_eq!(result["encoding"], "br");
        assert_eq!(result["declared_length"], wire_length.to_string());
        assert_eq!(result["received_length"], wire_length);
        assert_eq!(result["decoded"], BODY);
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use axum::{
        body::Bytes,
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::post,
        Json, Router,
    };
    use serde_json::{json, Value};
    use std::io::Read;
    use tokio::{net::TcpListener, sync::mpsc, task::JoinHandle};

    pub(crate) struct BrotliPeer {
        pub(crate) base_url: String,
        pub(crate) requests: mpsc::UnboundedReceiver<Value>,
        task: JoinHandle<()>,
    }
    impl Drop for BrotliPeer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }
    pub(crate) async fn start_brotli_peer() -> BrotliPeer {
        let (sender, requests) = mpsc::unbounded_channel();
        let app = Router::new().route("/v1/chat/completions", post(move |headers: HeaderMap, body: Bytes| {
            let sender = sender.clone();
            async move {
                if headers.get("content-encoding").and_then(|v| v.to_str().ok()) != Some("br") {
                    return (StatusCode::UNSUPPORTED_MEDIA_TYPE, "Brotli required").into_response();
                }
                let mut decoded = Vec::new();
                if brotli::Decompressor::new(body.as_ref(), 4096).read_to_end(&mut decoded).is_err() {
                    return (StatusCode::BAD_REQUEST, "invalid Brotli").into_response();
                }
                let Ok(value) = serde_json::from_slice::<Value>(&decoded) else {
                    return (StatusCode::BAD_REQUEST, "invalid decoded JSON").into_response();
                };
                if value.get("model").and_then(Value::as_str).is_none() || !value["messages"].is_array() {
                    return (StatusCode::BAD_REQUEST, "missing model payload").into_response();
                }
                let _ = sender.send(value.clone());
                Json(json!({"id":"chatcmpl-compression","object":"chat.completion","model":value["model"],"choices":[{"index":0,"message":{"role":"assistant","content":"ai-switch-ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}})).into_response()
            }
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        BrotliPeer {
            base_url: format!("http://{address}/v1"),
            requests,
            task,
        }
    }
}
