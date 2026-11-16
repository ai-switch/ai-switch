use super::*;
use crate::database::{create_memory_pool, run_migrations};
use crate::web::event_bridge::{EventEmitter, WebEventBroadcaster};
use std::sync::Arc;
use tokio::sync::{mpsc, Notify};

/// 把广播订阅里积压的事件按序取出（读取端等价于插件版队列的 drain）。
fn drain_events(
    receiver: &mut tokio::sync::broadcast::Receiver<crate::web::event_bridge::WebEvent>,
) -> Vec<Value> {
    let mut events = Vec::new();
    while let Ok(event) = receiver.try_recv() {
        events.push(serde_json::to_value(&event).unwrap());
    }
    events
}

async fn fixture(upstream: &str, config: Value) -> (ProxyAppState, RouteProxyRuntimeState, String) {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let mut config = config;
    config["base_url"] = json!(upstream);
    config["model_mappings"] = json!([{"from":"activity-model","to":"activity-model"}]);
    let credential = RouteCredentialRepository::create(
        &pool, "codex", "api", "Activity account", None, "ok", None,
        r#"{"api_key":"sk-upstream"}"#, &config.to_string(), "{}",
    ).await.unwrap();
    RoutePoolRepository::replace_members(&pool, "codex", std::slice::from_ref(&credential.id)).await.unwrap();
    RouteProxyKeyRepository::ensure_platform_key(&pool, "codex", "sk-activity-fixture").await.unwrap();
    let runtime = RouteProxyRuntimeState::default();
    (build_proxy_state(pool, &runtime), runtime, credential.id)
}

fn request(key: &str, stream: bool) -> (HeaderMap, Body) {
    let mut headers = HeaderMap::new();
    headers.insert("authorization", HeaderValue::from_str(&format!("Bearer {key}")).unwrap());
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    (headers, Body::from(json!({"model":"activity-model","input":"hello","stream":stream}).to_string()))
}

#[tokio::test]
async fn buffered_attempt_is_active_before_upstream_finishes_and_logs_client() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (started_handler, release_handler) = (started.clone(), release.clone());
    let app = Router::new().fallback(move || {
        let (started, release) = (started_handler.clone(), release_handler.clone());
        async move {
            started.notify_one();
            release.notified().await;
            ([("content-type", "application/json")], r#"{"choices":[{"message":{"role":"assistant","content":"ok"}}]}"#)
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (state, runtime, id) = fixture(&url, json!({"interface_format":"openai"})).await;
    let (headers, body) = request("sk-activity-fixture.zcode", false);
    let pool = state.pool.clone();
    let call = tokio::spawn(async move {
        forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await
    });
    tokio::time::timeout(Duration::from_secs(5), started.notified()).await.unwrap();
    let active = runtime.active_attempts().snapshot();
    assert_eq!(active.active.len(), 1);
    assert_eq!(active.active[0].credential_id, id);
    assert_eq!(active.active[0].client_key, "zcode");
    release.notify_one();
    let response = call.await.unwrap().unwrap();
    axum::body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert!(runtime.active_attempts().snapshot().active.is_empty());
    let stats = RoutePoolRepository::stats(&pool, "codex", None, 1, 20).await.unwrap();
    let metadata: Value = serde_json::from_str(&stats.requests[0].metadata_json).unwrap();
    assert_eq!(metadata["client_key"], "zcode");
    server.abort();
}

#[tokio::test]
async fn stopping_cancels_an_inflight_request_instead_of_allowing_old_retries() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (started_handler, release_handler) = (started.clone(), release.clone());
    let app = Router::new().fallback(move || {
        let (started, release) = (started_handler.clone(), release_handler.clone());
        async move {
            started.notify_one();
            release.notified().await;
            StatusCode::SERVICE_UNAVAILABLE
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (state, runtime, _) = fixture(&url, json!({"interface_format":"openai","failure_policy":{"retry_count":2}})).await;
    let (headers, body) = request("sk-activity-fixture.zcode", false);
    let call = tokio::spawn(async move {
        forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await
    });
    tokio::time::timeout(Duration::from_secs(3), started.notified()).await.unwrap();
    assert_eq!(runtime.active_attempts().snapshot().active.len(), 1);
    RouteProxyService::stop(&runtime).await.unwrap();
    let result = tokio::time::timeout(Duration::from_secs(1), call).await.expect("stop cancels pending upstream request").unwrap();
    assert!(result.unwrap_err().contains("route_proxy.stopped"));
    assert!(runtime.active_attempts().snapshot().active.is_empty());
    release.notify_one();
    server.abort();
}

#[tokio::test]
async fn dropped_stream_clears_active_attempt_without_waiting_for_accounting() {
    let (chunks, receiver) = mpsc::unbounded_channel::<String>();
    let receiver = Arc::new(tokio::sync::Mutex::new(Some(receiver)));
    let app = Router::new().fallback(move || {
        let receiver = receiver.clone();
        async move {
            let receiver = receiver.lock().await.take().unwrap();
            let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
                receiver.recv().await.map(|chunk| (Ok::<_, std::io::Error>(chunk), receiver))
            });
            Response::builder().header("content-type", "text/event-stream").body(Body::from_stream(stream)).unwrap()
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (state, runtime, _) = fixture(&url, json!({"interface_format":"openai-responses"})).await;
    chunks.send("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n".into()).unwrap();
    let (headers, body) = request("sk-activity-fixture.workbuddy", true);
    let response = forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await.unwrap();
    assert_eq!(runtime.active_attempts().snapshot().active.len(), 1);
    drop(response);
    assert!(runtime.active_attempts().snapshot().active.is_empty());
    drop(chunks);
    server.abort();
}

#[tokio::test]
async fn stop_cancels_a_pending_stream_body_and_does_not_penalize_the_account() {
    let (chunks, receiver) = mpsc::unbounded_channel::<String>();
    let receiver = Arc::new(tokio::sync::Mutex::new(Some(receiver)));
    let app = Router::new().fallback(move || {
        let receiver = receiver.clone();
        async move {
            let receiver = receiver.lock().await.take().unwrap();
            let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
                receiver.recv().await.map(|chunk| (Ok::<_, std::io::Error>(chunk), receiver))
            });
            Response::builder().header("content-type", "text/event-stream").body(Body::from_stream(stream)).unwrap()
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (state, runtime, id) = fixture(&url, json!({"interface_format":"openai-responses"})).await;
    let pool = state.pool.clone();
    chunks.send("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n".into()).unwrap();
    let (headers, body) = request("sk-activity-fixture.workbuddy", true);
    let response = forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await.unwrap();
    let mut body = Box::pin(response.into_body().into_data_stream());
    let first = futures_util::StreamExt::next(&mut body).await.unwrap().unwrap();
    assert!(!first.is_empty());
    RouteProxyService::stop(&runtime).await.unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(1), futures_util::StreamExt::next(&mut body)).await.expect("stop ends body without upstream EOF");
    assert!(ended.is_none() || ended.unwrap().is_err());
    assert!(runtime.active_attempts().snapshot().active.is_empty());
    drop(body);
    tokio::task::yield_now().await;
    let account = RouteCredentialRepository::get(&pool, &id).await.unwrap();
    assert_eq!(account.transient_failure_count, 0);
    drop(chunks);
    server.abort();
}

#[tokio::test]
async fn retry_uses_distinct_attempt_ids_under_the_same_request() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let handler_calls = calls.clone();
    let app = Router::new().fallback(move || {
        let calls = handler_calls.clone();
        async move {
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                (StatusCode::SERVICE_UNAVAILABLE, [("content-type", "application/json")], r#"{"error":{"message":"temporarily unavailable"}}"#)
            } else {
                (StatusCode::OK, [("content-type", "application/json")], r#"{"choices":[{"message":{"role":"assistant","content":"ok"}}]}"#)
            }
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (state, runtime, _) = fixture(&url, json!({"interface_format":"openai","failure_policy":{"retry_count":1,"retry_interval_ms":0}})).await;
    let events = Arc::new(WebEventBroadcaster::new());
    let mut receiver = events.subscribe();
    runtime.active_attempts().set_emitter(EventEmitter::Web(events.clone()));
    let (headers, body) = request("sk-activity-fixture.codex", false);
    let response = forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let events = drain_events(&mut receiver);
    let actions: Vec<_> = events.iter().map(|event| event["payload"]["action"].as_str().unwrap()).collect();
    assert_eq!(actions, vec!["started", "finished", "started", "finished"]);
    assert_eq!(events[0]["payload"]["attempt"]["request_id"], events[2]["payload"]["attempt"]["request_id"]);
    assert_ne!(events[0]["payload"]["attempt"]["attempt_id"], events[2]["payload"]["attempt"]["attempt_id"]);
    assert!(runtime.active_attempts().snapshot().active.is_empty());
    server.abort();
}

#[tokio::test]
async fn continuation_moves_activity_to_the_current_upstream_account() {
    const CUT: &str = "data: {\"type\":\"response.created\",\"sequence_number\":0,\"response\":{\"id\":\"r1\"}}\n\n\
        data: {\"type\":\"response.output_item.added\",\"sequence_number\":1,\"output_index\":0,\"item\":{\"id\":\"m1\",\"type\":\"message\"}}\n\n\
        data: {\"type\":\"response.output_text.delta\",\"sequence_number\":2,\"item_id\":\"m1\",\"delta\":\"first half\"}\n\n";
    let first_app = Router::new().fallback(|| async {
        ([("content-type", "text/event-stream")], CUT)
    });
    let first_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let first_url = format!("http://{}", first_listener.local_addr().unwrap());
    let first_server = tokio::spawn(async move { axum::serve(first_listener, first_app).await.unwrap() });

    let (chunks, receiver) = mpsc::unbounded_channel::<String>();
    let receiver = Arc::new(tokio::sync::Mutex::new(Some(receiver)));
    let started = Arc::new(Notify::new());
    let handler_started = started.clone();
    let next_app = Router::new().fallback(move || {
        let receiver = receiver.clone();
        let started = handler_started.clone();
        async move {
            let receiver = receiver.lock().await.take().unwrap();
            started.notify_one();
            let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
                receiver.recv().await.map(|chunk| (Ok::<_, std::io::Error>(chunk), receiver))
            });
            Response::builder().header("content-type", "text/event-stream")
                .body(Body::from_stream(stream)).unwrap()
        }
    });
    let next_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let next_url = format!("http://{}", next_listener.local_addr().unwrap());
    let next_server = tokio::spawn(async move { axum::serve(next_listener, next_app).await.unwrap() });
    let (state, runtime, first_id) = fixture(&first_url, json!({
        "interface_format":"openai-responses", "failure_policy":{"stream_continue_enabled":true}
    })).await;
    let next_account = RouteCredentialRepository::create(
        &state.pool, "codex", "api", "Next account", None, "ok", None,
        r#"{"api_key":"sk-upstream"}"#,
        &json!({"base_url":next_url,"interface_format":"openai-responses",
            "model_mappings":[{"from":"activity-model","to":"activity-model"}]}).to_string(), "{}",
    ).await.unwrap();
    RoutePoolRepository::replace_members(&state.pool, "codex", &[first_id.clone(), next_account.id.clone()]).await.unwrap();
    RoutePoolRepository::save_model_mode(&state.pool, "codex", PoolModelMode::Aggregate).await.unwrap();
    let events = Arc::new(WebEventBroadcaster::new());
    let mut attempt_events_receiver = events.subscribe();
    runtime.active_attempts().set_emitter(EventEmitter::Web(events.clone()));
    chunks.send("data: {\"type\":\"response.created\",\"sequence_number\":0,\"response\":{\"id\":\"r2\"}}\n\n\
        data: {\"type\":\"response.output_item.added\",\"sequence_number\":1,\"output_index\":0,\"item\":{\"id\":\"m2\",\"type\":\"message\"}}\n\n\
        data: {\"type\":\"response.output_text.delta\",\"sequence_number\":2,\"item_id\":\"m2\",\"delta\":\"second half\"}\n\n".into()).unwrap();
    let (headers, _) = request("sk-activity-fixture.zcode", true);
    let body = Body::from(json!({
        "model":"activity-model", "stream":true,
        "input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}]
    }).to_string());
    let response = forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await.unwrap();
    let consuming = tokio::spawn(async move { axum::body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap() });
    tokio::time::timeout(Duration::from_secs(5), started.notified()).await.unwrap();
    let active = runtime.active_attempts().snapshot();
    assert_eq!(active.active.len(), 1);
    assert_eq!(active.active[0].credential_id, next_account.id);
    assert_eq!(active.active[0].client_key, "zcode");
    chunks.send("data: {\"type\":\"response.output_item.done\",\"sequence_number\":3,\"output_index\":0,\"item\":{\"id\":\"m2\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"second half\"}]}}\n\n\
        data: {\"type\":\"response.completed\",\"sequence_number\":4,\"response\":{\"id\":\"r2\",\"status\":\"completed\"}}\n\n".into()).unwrap();
    drop(chunks);
    let body = tokio::time::timeout(Duration::from_secs(5), consuming).await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(&body).contains("second half"));
    assert!(runtime.active_attempts().snapshot().active.is_empty());
    let events = drain_events(&mut attempt_events_receiver);
    assert_eq!(events.len(), 4);
    assert_eq!(events[0]["payload"]["attempt"]["credential_id"], first_id);
    assert_eq!(events[1]["payload"]["action"], "finished");
    assert_eq!(events[2]["payload"]["attempt"]["credential_id"], next_account.id);
    assert_eq!(events[0]["payload"]["attempt"]["request_id"], events[2]["payload"]["attempt"]["request_id"]);
    first_server.abort();
    next_server.abort();
}

#[tokio::test]
async fn local_model_listing_and_trusted_internal_requests_do_not_emit_client_activity() {
    let (state, runtime, _) = fixture("http://127.0.0.1:1", json!({"interface_format":"openai"})).await;
    let (headers, _) = request("sk-activity-fixture.zcode", false);
    let response = forward_request(&state, Method::GET, headers, "/v1/models".parse().unwrap(), Body::empty()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(runtime.active_attempts().snapshot().sequence, 0);
    let state = state.with_platform_scope(PlatformId::Codex);
    let (headers, body) = request("sk-activity-fixture.zcode", false);
    let _ = forward_request(&state, Method::POST, headers, "/v1/responses".parse().unwrap(), body).await;
    assert_eq!(runtime.active_attempts().snapshot().sequence, 0);
}
