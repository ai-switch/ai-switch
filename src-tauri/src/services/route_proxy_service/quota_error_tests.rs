use super::*;

const QUOTA_ERROR: &str = r#"{"error":{"message":"user quota is not enough (request id: test-quota)","type":"new_api_error","param":"","code":"insufficient_user_quota"}}"#;
const HEALTHY: &str = r#"{"id":"healthy","object":"response","output":[]}"#;

struct Upstream {
    url: String,
    calls: Arc<std::sync::atomic::AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Upstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn upstream(status: StatusCode, chunks: Vec<String>, sse: bool) -> Upstream {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = calls.clone();
    let app = Router::new().fallback(move || {
        let chunks = chunks.clone();
        let calls = count.clone();
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
            let stream = futures_util::StreamExt::then(
                futures_util::stream::iter(chunks),
                |chunk| async move {
                    tokio::time::sleep(Duration::from_millis(3)).await;
                    Ok::<_, std::io::Error>(axum::body::Bytes::from(chunk))
                },
            );
            Response::builder()
                .status(status)
                .header(
                    "content-type",
                    if sse {
                        "text/event-stream"
                    } else {
                        "application/json"
                    },
                )
                .body(Body::from_stream(stream))
                .unwrap()
        }
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Upstream { url, calls, task }
}

async fn setup(
    upstreams: &[&Upstream],
    mode: PoolModelMode,
) -> (SqlitePool, ProxyAppState, Vec<String>) {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let mut ids = Vec::new();
    for (i, upstream) in upstreams.iter().enumerate() {
        ids.push(
            create_proxy_api_credential_with_config(
                &pool,
                &format!("account-{i}"),
                &upstream.url,
                json!({"interface_format":"openai-responses","failure_policy":{
                    "retry_count":4,"retry_interval_ms":0,"error_status_enabled":false
                }}),
            )
            .await,
        );
    }
    RoutePoolRepository::replace_members(&pool, "codex", &ids)
        .await
        .unwrap();
    RoutePoolRepository::save_model_mode(&pool, "codex", mode)
        .await
        .unwrap();
    let runtime = RouteProxyRuntimeState::default();
    runtime.set_stream_continue_max(2);
    let state = build_proxy_state(pool.clone(), &runtime)
        .with_access_scope(PlatformId::Codex, ids.iter().cloned().collect());
    (pool, state, ids)
}

async fn request(state: ProxyAppState, stream: bool, model: &str) -> (StatusCode, String) {
    let response = proxy_handler(
        AxumState(state),
        Method::POST,
        HeaderMap::new(),
        "/v1/responses".parse().unwrap(),
        Body::from(
            json!({"model":model,"stream":stream,
            "input":[{"role":"user","content":"hi"}]})
            .to_string(),
        ),
    )
    .await;
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

async fn assert_exhausted(pool: &SqlitePool, id: &str) {
    let account = RouteCredentialRepository::get(pool, id).await.unwrap();
    assert_eq!(
        account.status, "error",
        "明确额度耗尽应立即异常，不能受普通重试/错误阈值开关影响"
    );
    assert_eq!(
        account.last_failure_kind.as_deref(),
        Some("semantic_response_failed")
    );
    assert!(account
        .last_failure_message
        .unwrap_or_default()
        .contains("user quota is not enough"));
    assert!(account
        .last_failure_response_json
        .unwrap_or_default()
        .contains("insufficient_user_quota"));
    assert!(account.next_retry_at.is_none());
}

#[tokio::test]
async fn new_api_user_quota_marks_error_and_switches_once_in_aggregate_mode() {
    for status in [
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::OK,
    ] {
        let quota = upstream(status, vec![QUOTA_ERROR.into()], false).await;
        let good = upstream(StatusCode::OK, vec![HEALTHY.into()], false).await;
        let (pool, state, ids) = setup(&[&quota, &good], PoolModelMode::Aggregate).await;
        let (status, body) = request(state, false, "gpt-6-astra").await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert!(body.contains("healthy"));
        assert_eq!(
            quota.calls.load(Ordering::SeqCst),
            1,
            "不能用完同账号重试预算才换账号"
        );
        assert_eq!(good.calls.load(Ordering::SeqCst), 1);
        assert_exhausted(&pool, &ids[0]).await;
        assert_eq!(
            RouteCredentialRepository::get(&pool, &ids[1])
                .await
                .unwrap()
                .status,
            "ok"
        );
    }
}

#[tokio::test]
async fn new_api_user_quota_without_another_account_stops_after_one_call() {
    let quota = upstream(
        StatusCode::TOO_MANY_REQUESTS,
        vec![QUOTA_ERROR.into()],
        false,
    )
    .await;
    let (pool, state, ids) = setup(&[&quota], PoolModelMode::Aggregate).await;
    let (status, _) = request(state, false, "gpt-6-astra").await;
    assert!(!status.is_success());
    assert_eq!(quota.calls.load(Ordering::SeqCst), 1);
    assert_exhausted(&pool, &ids[0]).await;
}

#[tokio::test]
async fn new_api_user_quota_precise_mode_does_not_use_another_account() {
    for model in ["account-0/gpt-6-astra", "gpt-6-astra"] {
        let quota = upstream(
            StatusCode::TOO_MANY_REQUESTS,
            vec![QUOTA_ERROR.into()],
            false,
        )
        .await;
        let good = upstream(StatusCode::OK, vec![HEALTHY.into()], false).await;
        let (pool, state, ids) = setup(&[&quota, &good], PoolModelMode::Precise).await;
        let (status, _) = request(state, false, model).await;
        assert!(!status.is_success());
        assert_eq!(quota.calls.load(Ordering::SeqCst), 1);
        assert_eq!(good.calls.load(Ordering::SeqCst), 0, "精确模式不能跨账号");
        assert_exhausted(&pool, &ids[0]).await;
    }
}

#[tokio::test]
async fn new_api_user_quota_in_a_stream_opening_skips_same_account_retries() {
    for body in [QUOTA_ERROR.to_string(), format!("data: {QUOTA_ERROR}\n\n")] {
        let quota = upstream(StatusCode::OK, vec![body], true).await;
        let good = upstream(StatusCode::OK,vec![
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"healthy\",\"status\":\"completed\"}}\n\n".into()
        ],true).await;
        let (pool, state, ids) = setup(&[&quota, &good], PoolModelMode::Aggregate).await;
        let (_, body) = request(state, true, "gpt-6-astra").await;
        assert!(body.contains("healthy"), "{body}");
        assert!(!body.contains("insufficient_user_quota"));
        assert_eq!(
            quota.calls.load(Ordering::SeqCst),
            1,
            "首帧失败不得反复打同一账号"
        );
        assert_eq!(good.calls.load(Ordering::SeqCst), 1);
        assert_exhausted(&pool, &ids[0]).await;
    }
}

fn text_stream(id: &str, text: &str, complete: bool) -> Vec<String> {
    let event = |value: Value| format!("data: {value}\n\n");
    let message_id = format!("message_{id}");
    let mut events = vec![
        event(json!({"type":"response.created","sequence_number":0,"response":{"id":id}})),
        event(
            json!({"type":"response.output_item.added","sequence_number":1,"output_index":0,
            "item":{"id":message_id,"type":"message","role":"assistant","status":"in_progress","content":[]}}),
        ),
        event(
            json!({"type":"response.output_text.delta","sequence_number":2,"output_index":0,
            "item_id":message_id,"content_index":0,"delta":text}),
        ),
    ];
    if complete {
        events.push(event(
            json!({"type":"response.output_item.done","sequence_number":3,"output_index":0,
            "item":{"id":message_id,"type":"message","role":"assistant","status":"completed",
                "content":[{"type":"output_text","text":text}]}}),
        ));
        events.push(event(
            json!({"type":"response.completed","sequence_number":4,
            "response":{"id":id,"status":"completed","output":[]}}),
        ));
    }
    events
}

#[tokio::test]
async fn new_api_user_quota_during_continuation_skips_the_exhausted_account() {
    for (status, body, sse) in [
        (StatusCode::FORBIDDEN, QUOTA_ERROR.to_string(), false),
        (StatusCode::OK, QUOTA_ERROR.to_string(), false),
        (StatusCode::OK, format!("data: {QUOTA_ERROR}\n\n"), true),
    ] {
        let first = upstream(StatusCode::OK, text_stream("root", "前半句", false), true).await;
        let quota = upstream(status, vec![body], sse).await;
        let good = upstream(StatusCode::OK, text_stream("healthy", "后半句", true), true).await;
        let (pool, state, ids) = setup(&[&first, &quota, &good], PoolModelMode::Aggregate).await;
        let (_, body) = request(state, true, "gpt-6-astra").await;
        assert!(
            body.contains("前半句") && body.contains("后半句"),
            "续写应跳过无额度账号: {body}"
        );
        assert!(!body.contains("insufficient_user_quota"));
        assert_eq!(first.calls.load(Ordering::SeqCst), 1);
        assert_eq!(quota.calls.load(Ordering::SeqCst), 1);
        assert_eq!(good.calls.load(Ordering::SeqCst), 1);
        assert_exhausted(&pool, &ids[1]).await;
        assert_eq!(
            RouteCredentialRepository::get(&pool, &ids[0])
                .await
                .unwrap()
                .status,
            "ok",
            "不能把续写账号的余额错误记在原始账号上"
        );
    }
}

#[tokio::test]
async fn new_api_user_quota_during_continuation_stops_when_candidates_run_out() {
    let first = upstream(StatusCode::OK, text_stream("root", "前半句", false), true).await;
    let quota = upstream(StatusCode::FORBIDDEN, vec![QUOTA_ERROR.into()], false).await;
    let (pool, state, ids) = setup(&[&first, &quota], PoolModelMode::Aggregate).await;
    let (_, body) = request(state, true, "gpt-6-astra").await;
    assert!(!body.contains("response.completed"));
    assert_eq!(first.calls.load(Ordering::SeqCst), 1);
    assert_eq!(quota.calls.load(Ordering::SeqCst), 1);
    assert_exhausted(&pool, &ids[1]).await;
}

#[tokio::test]
async fn new_api_user_quota_after_stream_output_marks_the_actual_account() {
    for in_continuation in [false, true] {
        let first = upstream(StatusCode::OK, text_stream("root", "前半句", false), true).await;
        let mut events = text_stream("late", "已开始回答", false);
        events.push(format!("data: {QUOTA_ERROR}\n\n"));
        let quota = upstream(StatusCode::OK, events, true).await;
        let endpoints = if in_continuation {
            vec![&first, &quota]
        } else {
            vec![&quota]
        };
        let (pool, state, ids) = setup(&endpoints, PoolModelMode::Aggregate).await;
        let (_, body) = request(state, true, "gpt-6-astra").await;
        assert!(
            body.contains("insufficient_user_quota"),
            "已提交流内的错误应保留: {body}"
        );
        assert!(!body.contains("response.completed"));
        assert_exhausted(&pool, ids.last().unwrap()).await;
        assert_eq!(quota.calls.load(Ordering::SeqCst), 1);
        if in_continuation {
            assert_eq!(
                RouteCredentialRepository::get(&pool, &ids[0])
                    .await
                    .unwrap()
                    .status,
                "ok"
            );
        }
    }
}


#[tokio::test]
async fn new_api_user_quota_followed_by_done_is_not_synthesized_as_success() {
    let first = upstream(StatusCode::OK, text_stream("root", "前半句", false), true).await;
    let mut events = text_stream("late", "未写完", false);
    events.push(format!("data: {QUOTA_ERROR}\n\ndata: [DONE]\n\n"));
    let quota = upstream(StatusCode::OK, events, true).await;
    let (pool, state, ids) = setup(&[&first, &quota], PoolModelMode::Aggregate).await;
    let (_, body) = request(state, true, "gpt-6-astra").await;
    assert!(body.contains("insufficient_user_quota"));
    assert!(!body.contains("response.completed"), "[DONE] 不能把额度错误变成成功: {body}");
    assert_exhausted(&pool, &ids[1]).await;
}
