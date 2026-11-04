use super::*;
use futures_util::StreamExt;

const DELTA: &str = "data: {\"type\":\"speech.audio.delta\",\"audio\":\"SUQz\"}\n\n";
const DONE: &str = "data: {\"type\":\"speech.audio.done\",\"usage\":{\"input_tokens\":4,\"output_tokens\":6,\"total_tokens\":10}}\n\n";

struct AudioUpstream {
    url: String,
    calls: Arc<AtomicUsize>,
    bodies: Arc<std::sync::Mutex<Vec<Value>>>,
    release: Arc<tokio::sync::Notify>,
    task: JoinHandle<()>,
}

impl Drop for AudioUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn audio_upstream(first: &str, last: &str, delayed: bool) -> AudioUpstream {
    let calls = Arc::new(AtomicUsize::new(0));
    let bodies = Arc::new(std::sync::Mutex::new(Vec::new()));
    let release = Arc::new(tokio::sync::Notify::new());
    let call_count = calls.clone();
    let request_bodies = bodies.clone();
    let gate = release.clone();
    let first = first.to_string();
    let last = last.to_string();
    let app = Router::new().fallback(move |body: axum::body::Bytes| {
        let calls = call_count.clone();
        let bodies = request_bodies.clone();
        let release = gate.clone();
        let first = first.clone();
        let last = last.clone();
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
            bodies
                .lock()
                .unwrap()
                .push(serde_json::from_slice(&body).unwrap());
            let stream = futures_util::stream::unfold(0, move |step| {
                let release = release.clone();
                let first = first.clone();
                let last = last.clone();
                async move {
                    match step {
                        0 => Some((Ok::<_, std::io::Error>(axum::body::Bytes::from(first)), 1)),
                        1 if !last.is_empty() => {
                            if delayed {
                                release.notified().await;
                            }
                            Some((Ok(axum::body::Bytes::from(last)), 2))
                        }
                        _ => None,
                    }
                }
            });
            Response::builder()
                .header("content-type", "text/event-stream; charset=utf-8")
                .body(Body::from_stream(stream))
                .unwrap()
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    AudioUpstream {
        url,
        calls,
        bodies,
        release,
        task,
    }
}

async fn audio_state(
    upstreams: &[(&AudioUpstream, &str)],
) -> (SqlitePool, ProxyAppState, Vec<String>) {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let mut ids = Vec::new();
    for (index, (upstream, dialect)) in upstreams.iter().enumerate() {
        ids.push(create_proxy_api_credential_with_config(
            &pool,
            &format!("audio-{index}"),
            &upstream.url,
            json!({
                "interface_format": dialect,
                "failure_policy": {
                    "retry_count": 0,
                    "retry_interval_ms": 0,
                    "error_status_enabled": false,
                    "stream_continue_enabled": true,
                },
                "model_mappings": [{ "from": "speech-test", "to": "speech-upstream", "capabilities": ["audio.generate"] }],
            }),
        ).await);
    }
    RoutePoolRepository::replace_members(&pool, "codex", &ids)
        .await
        .unwrap();
    RouteProxyKeyRepository::ensure_platform_key(&pool, "codex", "sk-ai-switch-test-audio")
        .await
        .unwrap();
    let state = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    (pool, state, ids)
}

async fn audio_request(state: &ProxyAppState) -> Result<Response, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        HeaderValue::from_static("Bearer sk-ai-switch-test-audio"),
    );
    forward_request(
        state,
        Method::POST,
        headers,
        "/v1/audio/speech".parse().unwrap(),
        Body::from(json!({ "model": "speech-test", "input": "hello", "voice": "voice-test", "stream_format": "sse" }).to_string()),
    ).await
}

#[tokio::test]
async fn openai_speech_first_chunk_arrives_before_completion_without_done_sentinel() {
    let upstream = audio_upstream(DELTA, DONE, true).await;
    let (pool, state, _) = audio_state(&[(&upstream, "openai")]).await;
    let response = tokio::time::timeout(Duration::from_secs(2), audio_request(&state))
        .await
        .expect("SSE response must not wait for full synthesis")
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    let mut stream = response.into_body().into_data_stream();
    let first = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("first audio arrives while last is held")
        .unwrap()
        .unwrap();
    assert_eq!(first, DELTA.as_bytes());
    upstream.release.notify_one();
    let mut output = first.to_vec();
    while let Some(chunk) = stream.next().await {
        output.extend(chunk.expect("healthy stream"));
    }
    assert_eq!(output, format!("{DELTA}{DONE}").as_bytes());
    assert_eq!(upstream.calls.load(Ordering::SeqCst), 1);
    let successful: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM usage_events WHERE json_extract(metadata_json,'$.success')=1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(successful, 1);
}

#[tokio::test]
async fn speech_disconnect_after_audio_is_a_body_error_without_text_continuation() {
    let upstream = audio_upstream(DELTA, "", false).await;
    let (_, state, _) = audio_state(&[(&upstream, "openai")]).await;
    let response = audio_request(&state)
        .await
        .expect("first audio starts response");
    let result = axum::body::to_bytes(response.into_body(), 1024 * 1024).await;

    assert!(
        result.is_err(),
        "missing speech.audio.done must be a body error"
    );
    assert_eq!(
        upstream.calls.load(Ordering::SeqCst),
        1,
        "audio cannot use text continuation"
    );
}

#[tokio::test]
async fn minimax_speech_stream_converts_hex_instead_of_buffered_json_decoder() {
    let upstream = audio_upstream(
        "data: {\"data\":{\"audio\":\"494433\",\"status\":1},\"base_resp\":{\"status_code\":0}}\n\n",
        "data: {\"data\":{\"audio\":\"\",\"status\":2},\"base_resp\":{\"status_code\":0}}\n\n",
        false,
    ).await;
    let (_, state, _) = audio_state(&[(&upstream, "minimax")]).await;
    let response = audio_request(&state)
        .await
        .expect("MiniMax stream response");
    assert_eq!(response.status(), StatusCode::OK);
    let output = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let text = std::str::from_utf8(&output).unwrap();

    assert!(text.contains("\"type\":\"speech.audio.delta\""), "{text}");
    assert!(text.contains("\"audio\":\"SUQz\""), "{text}");
    assert_eq!(text.matches("speech.audio.done").count(), 1);
    let bodies = upstream.bodies.lock().unwrap();
    assert_eq!(bodies[0]["model"], "speech-upstream");
    assert_eq!(bodies[0]["stream"], true);
    assert_eq!(
        bodies[0]["stream_options"]["exclude_aggregated_audio"],
        true
    );
}

#[tokio::test]
async fn dropping_unpolled_speech_body_releases_account_slot_and_records_failure() {
    let upstream = audio_upstream(DELTA, DONE, true).await;
    let (pool, state, ids) = audio_state(&[(&upstream, "openai")]).await;
    let response = tokio::time::timeout(Duration::from_secs(2), audio_request(&state))
        .await
        .expect("SSE response")
        .expect("response");
    assert_eq!(state.activity.snapshot(&ids[0]), 1);
    drop(response);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let failures: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM usage_events WHERE json_extract(metadata_json,'$.success')=0",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if state.activity.snapshot(&ids[0]) == 0 && failures == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("drop must free slot and log interrupted audio");
}

#[tokio::test]
async fn speech_opening_provider_error_fails_over_before_any_audio_reaches_client() {
    let failing = audio_upstream(
        "data: {\"base_resp\":{\"status_code\":1004,\"status_msg\":\"insufficient balance\"}}\n\n",
        "",
        false,
    )
    .await;
    let healthy = audio_upstream(DELTA, DONE, false).await;
    let (_, state, _) = audio_state(&[(&failing, "minimax"), (&healthy, "openai")]).await;
    let response = audio_request(&state).await.expect("healthy fallback");
    assert_eq!(response.status(), StatusCode::OK);
    let output = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();

    assert_eq!(output, format!("{DELTA}{DONE}").as_bytes());
    assert_eq!(failing.calls.load(Ordering::SeqCst), 1);
    assert_eq!(healthy.calls.load(Ordering::SeqCst), 1);
}
