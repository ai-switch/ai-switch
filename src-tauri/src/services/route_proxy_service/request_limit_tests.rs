use super::*;
use crate::database::repositories::route_credential_repository::RouteCredentialRepository;

/// 中转站把上游的图片数量上限包在自己的信封里，`code` 是 null，只有正文能认。
const TOO_MANY_IMAGES: &str = r#"{"error":{"message":"OpenAI Responses bad request: Exceeded maximum number of images (50) allowed in the request. [trace_id=223c8d6543609aba62b8ae7897679cbf]","type":"invalid_request_error","param":"","code":null}}"#;
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

async fn upstream(status: StatusCode, body: String, sse: bool) -> Upstream {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = calls.clone();
    let app = Router::new().fallback(move || {
        let body = body.clone();
        let calls = count.clone();
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
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
                .body(Body::from(body))
                .unwrap()
        }
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Upstream { url, calls, task }
}

/// An upstream that records every inbound body and replays `responses` in call
/// order (the last entry repeats). Used to assert what the proxy actually sent.
struct Recorder {
    url: String,
    bodies: Arc<std::sync::Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Recorder {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn recorder(responses: Vec<(StatusCode, String)>) -> Recorder {
    let bodies: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = bodies.clone();
    let cursor = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let index = cursor.clone();
    let responses = Arc::new(responses);
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let app = Router::new().fallback(move |body: axum::body::Bytes| {
            let recorded = recorded.clone();
            let index = index.clone();
            let responses = responses.clone();
            async move {
                recorded
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&body).into_owned());
                let call = index.fetch_add(1, Ordering::SeqCst);
                let (status, body) = &responses[call.min(responses.len() - 1)];
                Response::builder()
                    .status(*status)
                    .header("content-type", "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap()
            }
        });
        axum::serve(listener, app).await.unwrap();
    });
    Recorder { url, bodies, task }
}

/// Count the image parts in a request body, across the three shapes the proxy
/// can emit: Responses `input_image`, Chat `image_url`, Anthropic `image`.
fn count_images(body: &str) -> usize {
    let value: Value = serde_json::from_str(body).expect("recorded body is json");
    let mut total = 0usize;
    for key in ["input", "messages"] {
        let Some(entries) = value.get(key).and_then(Value::as_array) else {
            continue;
        };
        for entry in entries {
            for part_key in ["content", "output"] {
                let Some(parts) = entry.get(part_key).and_then(Value::as_array) else {
                    continue;
                };
                total += parts
                    .iter()
                    .filter(|part| {
                        part.get("type")
                            .and_then(Value::as_str)
                            .is_some_and(|kind| {
                                matches!(kind, "input_image" | "image_url" | "image")
                            })
                    })
                    .count();
            }
        }
    }
    total
}

async fn setup(
    upstream_urls: &[String],
    extra_configs: &[Value],
) -> (SqlitePool, ProxyAppState, Vec<String>) {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let mut ids = Vec::new();
    for (i, url) in upstream_urls.iter().enumerate() {
        let mut config = json!({
            "interface_format": "openai-responses",
            "failure_policy": {
                "retry_count": 4,
                "retry_interval_ms": 0,
                "error_status_enabled": false,
                "stream_continue_enabled": true
            }
        });
        if let Some(extra) = extra_configs.get(i).and_then(Value::as_object) {
            config.as_object_mut().unwrap().extend(extra.clone());
        }
        ids.push(
            create_proxy_api_credential_with_config(&pool, &format!("account-{i}"), url, config)
                .await,
        );
    }
    RoutePoolRepository::replace_members(&pool, "codex", &ids)
        .await
        .unwrap();
    RoutePoolRepository::save_model_mode(&pool, "codex", PoolModelMode::Aggregate)
        .await
        .unwrap();
    let runtime = RouteProxyRuntimeState::default();
    let state = build_proxy_state(pool.clone(), &runtime)
        .with_access_scope(PlatformId::Codex, ids.iter().cloned().collect());
    (pool, state, ids)
}

/// A Responses body carrying `count` images, all in one user turn.
fn image_body(count: usize, stream: bool) -> Value {
    let content = (0..count)
        .map(|i| json!({"type":"input_image","image_url":format!("data:image/png;base64,{i}")}))
        .collect::<Vec<_>>();
    json!({
        "model": "gpt-6-astra",
        "stream": stream,
        "input": [{"role": "user", "content": content}]
    })
}

async fn request_with_body(
    state: ProxyAppState,
    stream: bool,
    body: Value,
) -> (StatusCode, String) {
    let response = proxy_handler(
        AxumState(state),
        Method::POST,
        HeaderMap::new(),
        "/v1/responses".parse().unwrap(),
        Body::from(body.to_string()),
    )
    .await;
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

async fn request(state: ProxyAppState, stream: bool) -> (StatusCode, String) {
    request_with_body(
        state,
        stream,
        json!({"model":"gpt-6-astra","stream":stream,"input":[{"role":"user","content":"hi"}]}),
    )
    .await
}

/// 图片张数是客户端发来的 body 的属性：同一池里每个账号都会数出同一个数字并同样
/// 拒绝。所以这张票只能原样交回客户端，不能换号、不能重试、更不能记成账号的瞬时
/// 失败——否则一次超限的会话会把整个号池逐个记脏，还把唯一说明该改什么的那句话
/// 埋进「所有账号都失败了」。
async fn assert_untouched(pool: &SqlitePool, id: &str) {
    let account = RouteCredentialRepository::get(pool, id).await.unwrap();
    assert_eq!(account.status, "ok", "请求体的问题不能动账号状态");
    assert_eq!(
        account.transient_failure_count, 0,
        "不能把请求超限记成账号的瞬时失败"
    );
    assert!(
        account.last_failure_kind.is_none(),
        "不该留下任何失败分类: {:?}",
        account.last_failure_kind
    );
}

#[tokio::test]
async fn too_many_images_is_returned_once_without_charging_the_account() {
    let images = upstream(StatusCode::BAD_REQUEST, TOO_MANY_IMAGES.to_string(), false).await;
    let good = upstream(StatusCode::OK, HEALTHY.to_string(), false).await;
    let (pool, state, ids) = setup(
        &[images.url.clone(), good.url.clone()],
        &[Value::Null, Value::Null],
    )
    .await;

    let (status, body) = request(state, false).await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body.contains("maximum number of images"),
        "上游原文要原样交给客户端: {body}"
    );
    assert!(
        !body.contains("route credentials failed"),
        "不能退化成聚合错误: {body}"
    );
    assert_eq!(images.calls.load(Ordering::SeqCst), 1, "同账号不该重试");
    assert_eq!(
        good.calls.load(Ordering::SeqCst),
        0,
        "换号只会让下一个账号也白挨一次"
    );
    assert_untouched(&pool, &ids[0]).await;
    assert_untouched(&pool, &ids[1]).await;
}

/// 同样的拒绝也可能以 200 流的首帧形式出现。那时同样不能换号、不能记账。
#[tokio::test]
async fn too_many_images_in_a_stream_opening_frame_does_not_charge_the_account() {
    let images = upstream(StatusCode::OK, format!("data: {TOO_MANY_IMAGES}\n\n"), true).await;
    let good = upstream(
        StatusCode::OK,
        "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"healthy\",\"status\":\"completed\"}}\n\n"
            .to_string(),
        true,
    )
    .await;
    let (pool, state, ids) = setup(
        &[images.url.clone(), good.url.clone()],
        &[Value::Null, Value::Null],
    )
    .await;

    let (_, body) = request(state, true).await;

    assert!(body.contains("maximum number of images"), "{body}");
    assert!(!body.contains("healthy"), "不该换号续写: {body}");
    assert_eq!(images.calls.load(Ordering::SeqCst), 1);
    assert_eq!(good.calls.load(Ordering::SeqCst), 0);
    assert_untouched(&pool, &ids[0]).await;
    assert_untouched(&pool, &ids[1]).await;
}

/// 开关打开后，后续请求在发往上游前就只保留最新的图片，不必再撞一次上限。
#[tokio::test]
async fn proactive_trim_sends_only_the_newest_images_when_the_switch_is_on() {
    let rec = recorder(vec![(StatusCode::OK, HEALTHY.to_string())]).await;
    let (pool, state, ids) = setup(
        &[rec.url.clone()],
        &[json!({"image_limit_compat": "trim_old_images"})],
    )
    .await;

    let (status, body) = request_with_body(state, false, image_body(13, false)).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let sent = rec.bodies.lock().unwrap();
    assert_eq!(sent.len(), 1, "一次请求，不该重试");
    assert_eq!(
        count_images(&sent[0]),
        10,
        "只保留最新的 10 张图片: {}",
        sent[0]
    );
    // 开关是账号自己的设置，写一次之后每次请求都生效。
    let account = RouteCredentialRepository::get(&pool, &ids[0])
        .await
        .unwrap();
    let config: Value = serde_json::from_str(&account.config_json).unwrap();
    assert_eq!(config["image_limit_compat"], "trim_old_images");
}

/// 开关没开时撞上图片上限：自动打开开关，裁掉较旧图片，向同一个账号再问一次。
#[tokio::test]
async fn image_limit_self_heal_enables_the_switch_and_retries_trimmed() {
    let rec = recorder(vec![
        (StatusCode::BAD_REQUEST, TOO_MANY_IMAGES.to_string()),
        (StatusCode::OK, HEALTHY.to_string()),
    ])
    .await;
    let (pool, state, ids) = setup(&[rec.url.clone()], &[Value::Null]).await;

    let (status, body) = request_with_body(state, false, image_body(13, false)).await;

    assert_eq!(status, StatusCode::OK, "裁剪后应当成功: {body}");
    assert!(body.contains("healthy"), "{body}");
    {
        let sent = rec.bodies.lock().unwrap();
        assert_eq!(sent.len(), 2, "第一次被拒，裁剪后重试一次");
        assert_eq!(count_images(&sent[0]), 13, "第一次原样发出");
        assert_eq!(count_images(&sent[1]), 10, "重试时只发最新的 10 张");
    }
    // 自愈写入是后台任务，等它落库。
    let mut config = Value::Null;
    for _ in 0..100 {
        let account = RouteCredentialRepository::get(&pool, &ids[0])
            .await
            .unwrap();
        config = serde_json::from_str(&account.config_json).unwrap();
        if config["image_limit_compat"] == "trim_old_images" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(
        config["image_limit_compat"], "trim_old_images",
        "自愈后开关应当被持久化，后续请求不再撞上限"
    );
}
