use super::*;

const AUDIO_DELTA: &str = "data: {\"type\":\"speech.audio.delta\",\"audio\":\"SUQz\"}\n\n";
const AUDIO_DONE: &str = "data: {\"type\":\"speech.audio.done\",\"usage\":{\"input_tokens\":4,\"output_tokens\":6,\"total_tokens\":10}}\n\n";

struct StreamingAudioFixture {
    state: AppState,
    runtime: SaasRuntime,
    proxy: ProxyAppState,
    headers: HeaderMap,
    release: Arc<tokio::sync::Notify>,
    _directory: tempfile::TempDir,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for StreamingAudioFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn streaming_audio_fixture(
    dialect: &str,
    first: &str,
    last: &str,
    delayed: bool,
) -> StreamingAudioFixture {
    let first = first.to_string();
    let last = last.to_string();
    let release = Arc::new(tokio::sync::Notify::new());
    let gate = release.clone();
    let app = Router::new().fallback(move || {
        let first = first.clone();
        let last = last.clone();
        let release = gate.clone();
        async move {
            let stream = futures_util::stream::unfold(0, move |at| {
                let first = first.clone();
                let last = last.clone();
                let release = release.clone();
                async move {
                    match at {
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
                .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
                .body(Body::from_stream(stream))
                .unwrap()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (pool, plaintext, directory) =
        audio_billing_fixture_with_dialect(&format!("http://{address}/v1"), 15_000, dialect).await;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    StreamingAudioFixture {
        state: test_app_state(pool),
        runtime: SaasRuntime::default(),
        proxy,
        headers,
        release,
        _directory: directory,
        task,
    }
}

async fn send_audio(fixture: &StreamingAudioFixture) -> Result<Response, AppError> {
    execute(
        &fixture.state, &fixture.runtime, fixture.proxy.clone(), Method::POST,
        fixture.headers.clone(), "/v1/audio/speech".parse().unwrap(),
        Body::from(json!({ "model": "tts-1", "input": "你好世界", "voice": "voice-test", "stream_format": "sse" }).to_string()),
    ).await
}

async fn reservation_state(pool: &SqlitePool) -> (String, i64, i64) {
    sqlx::query_as("SELECT reservations.status,keys.frozen_micros,users.frozen_micros FROM saas_billing_reservations reservations JOIN saas_api_keys keys ON keys.id=reservations.key_id JOIN saas_users users ON users.id=reservations.user_id ORDER BY reservations.created_at LIMIT 1")
        .fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn sse_audio_is_readable_while_reserved_and_bills_only_after_complete_eof() {
    let fixture = streaming_audio_fixture("openai", AUDIO_DELTA, AUDIO_DONE, true).await;
    let response = tokio::time::timeout(Duration::from_secs(2), send_audio(&fixture))
        .await
        .expect("SaaS must return before last audio event")
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let request_id = response.headers()["x-saas-request-id"]
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("reserved".to_string(), 60, 60)
    );
    let mut stream = response.into_body().into_data_stream();
    let first = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(first, AUDIO_DELTA.as_bytes());
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("reserved".to_string(), 60, 60)
    );
    fixture.release.notify_one();
    let mut output = first.to_vec();
    while let Some(chunk) = stream.next().await {
        output.extend(chunk.unwrap());
    }
    assert_eq!(output, format!("{AUDIO_DELTA}{AUDIO_DONE}").as_bytes());
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("settled".to_string(), 0, 0)
    );
    let ledger: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'",
    )
    .fetch_one(&fixture.state.pool)
    .await
    .unwrap();
    assert_eq!(ledger, (1, -60));
    fixture.runtime.logs.shutdown().await.unwrap();
    let logs = fixture
        .runtime
        .logs
        .query(crate::saas::logs::LogQuery::default())
        .await
        .unwrap();
    assert_eq!(logs.total, 1);
    assert_eq!(logs.items[0].request_id, request_id);
    assert_eq!(logs.items[0].amount_usd_micros, 60);
}

#[tokio::test]
async fn interrupted_audio_sse_refunds_every_character_without_usage_charge() {
    for tail in [
        "",
        "data: [DONE]\n\n",
        "data: {\"type\":\"error\",\"error\":{\"message\":\"late synthesis failure\"}}\n\n",
    ] {
        let fixture = streaming_audio_fixture("openai", AUDIO_DELTA, tail, true).await;
        let response = tokio::time::timeout(Duration::from_secs(2), send_audio(&fixture))
            .await
            .expect("speech response")
            .unwrap();
        let mut stream = response.into_body().into_data_stream();
        assert!(stream.next().await.unwrap().is_ok());
        fixture.release.notify_one();
        let mut failed = false;
        while let Some(chunk) = stream.next().await {
            failed |= chunk.is_err();
        }
        assert!(failed, "missing completion must be observable: {tail}");
        assert_eq!(
            reservation_state(&fixture.state.pool).await,
            ("refunded".to_string(), 0, 0)
        );
        let usage: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM saas_wallet_ledger WHERE kind='usage'")
                .fetch_one(&fixture.state.pool)
                .await
                .unwrap();
        assert_eq!(usage, 0);
        fixture.runtime.logs.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn unpolled_audio_body_drop_refunds_and_releases_the_user_concurrency_slot() {
    let fixture = streaming_audio_fixture("openai", AUDIO_DELTA, AUDIO_DONE, true).await;
    let response = tokio::time::timeout(Duration::from_secs(2), send_audio(&fixture))
        .await
        .expect("speech response")
        .unwrap();
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("reserved".to_string(), 60, 60)
    );
    drop(response);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if reservation_state(&fixture.state.pool).await == ("refunded".to_string(), 0, 0) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("client drop must not strand a reservation");
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM saas_billing_reservations WHERE status='reserved'",
    )
    .fetch_one(&fixture.state.pool)
    .await
    .unwrap();
    assert_eq!(active, 0);
    fixture.runtime.logs.shutdown().await.unwrap();
}

#[tokio::test]
async fn speech_sse_body_timeout_refunds_instead_of_leaving_funds_frozen() {
    let fixture = streaming_audio_fixture("openai", AUDIO_DELTA, AUDIO_DONE, true).await;
    sqlx::query("UPDATE saas_group_settings SET timeout_seconds=1 WHERE group_id='codex-default'")
        .execute(&fixture.state.pool)
        .await
        .unwrap();
    let response = send_audio(&fixture).await.unwrap();
    let mut stream = response.into_body().into_data_stream();
    assert!(stream.next().await.unwrap().is_ok());
    let interrupted = tokio::time::timeout(Duration::from_secs(3), stream.next())
        .await
        .expect("absolute request deadline must cover the body")
        .unwrap();
    assert!(interrupted.is_err());
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("refunded".to_string(), 0, 0)
    );
    fixture.runtime.logs.shutdown().await.unwrap();
}

#[tokio::test]
async fn cancelling_speech_before_first_audio_refunds_the_reservation() {
    let fixture = streaming_audio_fixture("openai", ": keepalive\n\n", AUDIO_DELTA, true).await;
    let mut request = Box::pin(send_audio(&fixture));
    tokio::select! {
        response = &mut request => panic!("no audio has been released: {response:?}"),
        _ = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let reserved: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM saas_billing_reservations WHERE status='reserved'")
                    .fetch_one(&fixture.state.pool).await.unwrap();
                if reserved == 1 { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }) => {}
    }
    drop(request);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if reservation_state(&fixture.state.pool).await == ("refunded".to_string(), 0, 0) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cancelled first-audio wait must refund");
    fixture.runtime.logs.shutdown().await.unwrap();
}

#[tokio::test]
async fn dropping_after_speech_done_but_before_eof_still_refunds() {
    let fixture = streaming_audio_fixture(
        "openai",
        &format!("{AUDIO_DELTA}{AUDIO_DONE}"),
        ": keepalive\n\n",
        true,
    )
    .await;
    let response = send_audio(&fixture).await.unwrap();
    let mut stream = response.into_body().into_data_stream();
    let first = stream.next().await.unwrap().unwrap();
    assert!(std::str::from_utf8(&first)
        .unwrap()
        .contains("speech.audio.done"));
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("reserved".to_string(), 60, 60)
    );
    drop(stream);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if reservation_state(&fixture.state.pool).await == ("refunded".to_string(), 0, 0) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("done without EOF is not completed delivery");
    fixture.runtime.logs.shutdown().await.unwrap();
}

#[tokio::test]
async fn audio_settlement_failure_is_logged_as_pending_review_not_successful_billing() {
    let fixture = streaming_audio_fixture("openai", AUDIO_DELTA, AUDIO_DONE, true).await;
    let response = send_audio(&fixture).await.unwrap();
    let mut stream = response.into_body().into_data_stream();
    stream.next().await.unwrap().unwrap();
    sqlx::query("CREATE TRIGGER reject_audio_usage BEFORE INSERT ON saas_wallet_ledger WHEN NEW.kind='usage' BEGIN SELECT RAISE(FAIL,'test settlement failure'); END")
        .execute(&fixture.state.pool).await.unwrap();
    fixture.release.notify_one();
    while let Some(chunk) = stream.next().await {
        chunk.unwrap();
    }
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("pending_review".to_string(), 60, 60)
    );
    let charged: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM saas_wallet_ledger WHERE kind='usage'")
            .fetch_one(&fixture.state.pool)
            .await
            .unwrap();
    assert_eq!(charged, 0);
    fixture.runtime.logs.shutdown().await.unwrap();
    let logs = fixture
        .runtime
        .logs
        .query(crate::saas::logs::LogQuery::default())
        .await
        .unwrap();
    assert_eq!(logs.total, 1);
    assert_eq!(logs.items[0].settlement_status, "pending_review");
    assert_eq!(logs.items[0].amount_usd_micros, 0);
}

#[tokio::test]
async fn minimax_sse_uses_same_character_billing_after_hex_to_base64_streaming() {
    let fixture = streaming_audio_fixture(
        "minimax",
        "data: {\"data\":{\"audio\":\"494433\",\"status\":1},\"base_resp\":{\"status_code\":0}}\n\n",
        "data: {\"data\":{\"status\":2},\"base_resp\":{\"status_code\":0}}\n\n", true,
    ).await;
    let response = tokio::time::timeout(Duration::from_secs(2), send_audio(&fixture))
        .await
        .unwrap()
        .unwrap();
    let mut stream = response.into_body().into_data_stream();
    let first = stream.next().await.unwrap().unwrap();
    let text = std::str::from_utf8(&first).unwrap();
    assert!(text.contains("\"audio\":\"SUQz\""));
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("reserved".to_string(), 60, 60)
    );
    fixture.release.notify_one();
    while let Some(chunk) = stream.next().await {
        chunk.unwrap();
    }
    assert_eq!(
        reservation_state(&fixture.state.pool).await,
        ("settled".to_string(), 0, 0)
    );
    fixture.runtime.logs.shutdown().await.unwrap();
}
