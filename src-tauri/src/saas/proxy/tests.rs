use super::*;

mod audio_stream {
    include!("audio_stream_tests.rs");
}

use crate::saas::logs::canonical_test_directory;
use crate::saas::{domain, repository};
use crate::services::route_proxy_service::{build_proxy_state, RouteProxyRuntimeState};
use axum::{routing::post, Router};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

/// `execute` takes the whole `AppState` (it now also needs the route-proxy
/// runtime to reach the upstream), so every test needs one. Only `pool` is ever
/// read on the code paths under test; the rest are inert defaults.
fn test_app_state(pool: SqlitePool) -> AppState {
    AppState {
        paths: crate::paths::AppPaths::from_data_dir(
            std::env::temp_dir().join(format!("ai-switch-saas-proxy-test-{}", uuid::Uuid::new_v4())),
        ),
        pool,
        saas: Default::default(),
        config_writes: Default::default(),
        deeplink_protocols: Default::default(),
        close_to_tray: Default::default(),
        route_proxy: Default::default(),
        web_service: Default::default(),
        tailscale: Default::default(),
        terminals: Default::default(),
        terminal_hub: Default::default(),
        event_broadcaster: Default::default(),
    }
}

async fn fixture(
    streaming: bool,
) -> (
    AppState,
    SaasRuntime,
    ProxyAppState,
    HeaderMap,
    tempfile::TempDir,
    Arc<AtomicUsize>,
    tokio::task::JoinHandle<()>,
) {
    let pool = repository::test_pool().await;
    let (user_id, group_id) = repository::test_user_group(&pool).await;
    sqlx::query("UPDATE saas_users SET balance_micros=1000000 WHERE id=?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();
    let directory = canonical_test_directory();
    sqlx::query("UPDATE saas_settings SET value_json=json_set(value_json,'$.logs',json(?)) WHERE key='config'")
        .bind(json!({"directory":directory.path()}).to_string()).execute(&pool).await.unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let upstream_hits = hits.clone();
    let image_hits = hits.clone();
    let app = Router::new()
        .route("/v1/images/generations", post(move |Json(payload):Json<Value>| {
            let image_hits = image_hits.clone();
            async move {
                image_hits.fetch_add(1, Ordering::SeqCst);
                assert_eq!(payload["model"], "gpt-test");
                Json(json!({"data":[{"b64_json":"aGVsbG8="},{"b64_json":"d29ybGQ="}]})).into_response()
            }
        }))
        .route("/v1/chat/completions", post(move |Json(payload):Json<Value>| {
        let upstream_hits = upstream_hits.clone();
        async move {
            upstream_hits.fetch_add(1,Ordering::SeqCst);
            assert_eq!(payload["model"],"gpt-test");
            if streaming {
                ([(header::CONTENT_TYPE,"text/event-stream")],
                    "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":120,\"completion_tokens\":30,\"prompt_tokens_details\":{\"cached_tokens\":50}}}\n\ndata: [DONE]\n\n").into_response()
            } else {
                Json(json!({"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":120,"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":50}}})).into_response()
            }
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    sqlx::query("UPDATE route_credentials SET secret_payload_json=?,config_json=? WHERE id IN ('account-default','account-custom')")
        .bind(r#"{"api_key":"upstream-test-key"}"#)
        .bind(json!({"base_url":format!("http://{address}/v1"),"interface_format":"openai","model_mappings":[{"from":"gpt-test","to":"gpt-test","capabilities":["image.generate"]}]}).to_string())
        .execute(&pool).await.unwrap();
    let mut extension = repository::test_group_payload();
    extension["models"][0]["model"] = json!("public-model");
    extension["models"][0]["upstreamModel"] = json!("gpt-test");
    extension["models"][0]["imagePriceMicros"] = json!(25_000);
    domain::admin(&pool, "groups.save", extension)
        .await
        .unwrap();
    let key = domain::user(
        &pool,
        &user_id,
        "keys.create",
        json!({"name":"request","groupId":group_id}),
    )
    .await
    .unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {}", key["plaintextKey"].as_str().unwrap())
            .parse()
            .unwrap(),
    );
    headers.insert("x-ai-switch-platform", "claude".parse().unwrap());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    (test_app_state(pool), runtime, proxy, headers, directory, hits, task)
}

#[tokio::test]
async fn ordinary_and_sse_saas_requests_bill_once_and_never_write_sqlite_details() {
    for streaming in [false, true] {
        let (state, runtime, proxy, headers, _directory, hits, task) = fixture(streaming).await;
        let response = execute(&state,&runtime,proxy,Method::POST,headers,"/v1/chat/completions".parse().unwrap(),
            Body::from(json!({"model":"public-model","messages":[{"role":"user","content":"hi"}],"max_tokens":50,"stream":streaming}).to_string())).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        assert!(!body.is_empty());
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        let pool = state.pool.clone();
        let ledger: (i64,i64) = sqlx::query_as("SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'").fetch_one(&pool).await.unwrap();
        assert_eq!(ledger, (1, -135));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usage_events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        runtime.logs.shutdown().await.unwrap();
        let logs = runtime
            .logs
            .query(crate::saas::logs::LogQuery::default())
            .await
            .unwrap();
        assert_eq!(logs.total, 1);
        assert_eq!(logs.items[0].amount_usd_micros, 135);
        assert_eq!(logs.items[0].model, "public-model");
        task.abort();
    }
}

#[tokio::test]
async fn image_requests_use_bound_group_and_bill_successful_images() {
    let (state, runtime, proxy, headers, _directory, hits, task) = fixture(false).await;
    let response = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/images/generations".parse().unwrap(),
        Body::from(json!({"model":"public-model","prompt":"a fox","n":2}).to_string()),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["data"].as_array().map(Vec::len), Some(2));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    let pool = state.pool.clone();
    let ledger: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger, (1, -50_000));
    let status: String = sqlx::query_scalar("SELECT status FROM saas_billing_reservations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "settled");
    runtime.logs.shutdown().await.unwrap();
    let logs = runtime
        .logs
        .query(crate::saas::logs::LogQuery::default())
        .await
        .unwrap();
    assert_eq!(logs.items[0].amount_usd_micros, 50_000);
    assert_eq!(logs.items[0].model, "public-model");
    task.abort();
}

#[tokio::test]
async fn dropped_response_is_pending_review_instead_of_silently_refunded() {
    let (state, runtime, proxy, headers, _directory, _hits, task) = fixture(true).await;
    let response = execute(&state,&runtime,proxy,Method::POST,headers,"/v1/chat/completions".parse().unwrap(),
        Body::from(json!({"model":"public-model","messages":[{"role":"user","content":"hi"}],"max_tokens":50,"stream":true}).to_string())).await.unwrap();
    drop(response);
    let pool = state.pool.clone();
    for _ in 0..100 {
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM saas_billing_reservations WHERE status='pending_review'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if pending == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let status: String = sqlx::query_scalar("SELECT status FROM saas_billing_reservations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "pending_review");
    runtime.logs.shutdown().await.unwrap();
    task.abort();
}
#[tokio::test]
async fn claude_models_only_include_active_enabled_models_with_accounts() {
    let pool = repository::test_pool().await;
    let (_principal, plaintext) = repository::claude_principal_and_key(&pool).await;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());

    let pending = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    let pending_body = axum::body::to_bytes(pending.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let pending: Value = serde_json::from_slice(&pending_body).unwrap();
    assert_eq!(pending["data"].as_array().map(Vec::len), Some(0));

    sqlx::query("UPDATE saas_group_models SET sync_state='active',enabled=1,input_price_micros=1000,cache_price_micros=100,output_price_micros=2000 WHERE group_id='claude-saas' AND model='provider-sonnet'")
        .execute(&pool)
        .await
        .unwrap();
    let active = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    let active_body = axum::body::to_bytes(active.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let active: Value = serde_json::from_slice(&active_body).unwrap();
    assert_eq!(active["data"][0]["id"], "provider-sonnet");
    // 定价推断的模态声明：该行只挂文本价格 → capabilities 为空数组（纯文本）。
    assert_eq!(active["data"][0]["capabilities"], json!([]));

    // type 查询参数：文本模型只出现在 type=text；video 过滤为空；未知值 400。
    let text_only = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models?type=text".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    assert_eq!(text_only.status(), StatusCode::OK);
    let text_body = axum::body::to_bytes(text_only.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let text_value: Value = serde_json::from_slice(&text_body).unwrap();
    assert_eq!(text_value["data"][0]["id"], "provider-sonnet");

    let video_only = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models?type=video".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    let video_body = axum::body::to_bytes(video_only.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let video_value: Value = serde_json::from_slice(&video_body).unwrap();
    assert_eq!(video_value["data"].as_array().map(Vec::len), Some(0));

    let bogus = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models?type=bogus".parse().unwrap(),
        Body::empty(),
    )
    .await;
    match bogus {
        Err(error) => assert_eq!(error.code(), "saas.unknown_model_type"),
        Ok(response) => panic!("unknown type must fail, got {}", response.status()),
    }

    sqlx::query("UPDATE saas_group_models SET enabled=0 WHERE group_id='claude-saas'")
        .execute(&pool)
        .await
        .unwrap();
    let disabled = execute(
        &state,
        &runtime,
        proxy,
        Method::GET,
        headers,
        "/v1/models".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    let disabled_body = axum::body::to_bytes(disabled.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let disabled: Value = serde_json::from_slice(&disabled_body).unwrap();
    assert_eq!(disabled["data"].as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn claude_responses_is_allowed_but_chat_completions_is_rejected() {
    let pool = repository::test_pool().await;
    let (_principal, plaintext) = repository::claude_principal_and_key(&pool).await;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());

    let responses = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::POST,
        headers.clone(),
        "/v1/responses".parse().unwrap(),
        Body::from(json!({"model":"provider-sonnet","input":"hi"}).to_string()),
    )
    .await;
    if let Err(error) = responses {
        assert_ne!(error.code(), "saas.endpoint_not_allowed");
    }

    // 统一账号池（G-P8 P4a，用户拍板）：一个 key 全模态 —— 端点不再按 key 的
    // 原平台限制；chat 走到模型/预留链路（消息为空由上游侧语义兜底，不在此断言）。
    let chat = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/chat/completions".parse().unwrap(),
        Body::from(json!({"model":"provider-sonnet","messages":[{"role":"user","content":"hi"}]}).to_string()),
    )
    .await;
    if let Err(error) = chat {
        assert_ne!(error.code(), "saas.endpoint_not_allowed");
    }
}
/// The full Claude SaaS path in one test: automatic discovery, an administrator
/// pricing and enabling the model, the public catalog, a real request, and the
/// reservation it produces.
///
/// The account deliberately carries a mapping chain (`provider-sonnet` is also
/// the `from` of a second mapping). If the proxy re-applied client-facing
/// matching to the already-resolved SaaS model, the upstream would receive
/// `something-else` instead.
#[tokio::test]
async fn claude_saas_end_to_end_sync_price_request_and_bill() {
    let pool = repository::test_pool().await;
    let (_principal, plaintext) = repository::claude_principal_and_key(&pool).await;
    // One account keeps the rotation deterministic.
    sqlx::query("DELETE FROM route_pool_members WHERE route_credential_id='claude-sync-opus'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM route_credentials WHERE id='claude-sync-opus'")
        .execute(&pool)
        .await
        .unwrap();

    let seen = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let seen_upstream = seen.clone();
    let app = Router::new().route(
        "/v1/chat/completions",
        post(move |Json(payload): Json<Value>| {
            let seen = seen_upstream.clone();
            async move {
                seen.lock()
                    .unwrap()
                    .push(payload["model"].as_str().unwrap_or_default().to_string());
                Json(json!({
                    "choices":[{"message":{"content":"ok"}}],
                    "usage":{"prompt_tokens":10,"completion_tokens":5}
                }))
                .into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    sqlx::query(
        "UPDATE route_credentials SET secret_payload_json=?,config_json=?
         WHERE id='claude-sync-sonnet'",
    )
    .bind(r#"{"api_key":"upstream-key"}"#)
    .bind(
        json!({
            "base_url": format!("http://{address}/v1"),
            "interface_format": "openai",
            "model_mappings": [
                {"from":"claude-sonnet-alias","to":"provider-sonnet"},
                {"from":"provider-sonnet","to":"something-else"}
            ]
        })
        .to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();

    // Discovery puts the model in the catalog but leaves it closed.
    domain::admin(&pool, "groups.sync", json!({"groupId":"claude-saas"}))
        .await
        .unwrap();

    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());

    let pending = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    let pending: Value = serde_json::from_slice(
        &axum::body::to_bytes(pending.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(pending["data"].as_array().map(Vec::len), Some(0));

    // The administrator prices and enables it through the normal save flow.
    let mut payload = repository::claude_group_payload();
    payload["models"][0]["syncState"] = json!("pending_pricing");
    payload["models"][0]["enabled"] = json!(true);
    domain::admin(&pool, "groups.save", payload).await.unwrap();

    let listed = execute(
        &state,
        &runtime,
        proxy.clone(),
        Method::GET,
        headers.clone(),
        "/v1/models".parse().unwrap(),
        Body::empty(),
    )
    .await
    .unwrap();
    let listed: Value = serde_json::from_slice(
        &axum::body::to_bytes(listed.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(listed["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|model| model["id"] == "provider-sonnet"));

    let response = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/messages".parse().unwrap(),
        Body::from(
            json!({
                "model":"provider-sonnet",
                "max_tokens":16,
                "messages":[{"role":"user","content":"hi"}]
            })
            .to_string(),
        ),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let _ = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();

    // The upstream saw the resolved public name, not the second mapping's target.
    assert_eq!(seen.lock().unwrap().as_slice(), ["provider-sonnet"]);
    let reservation: (String, String, String, i64) = sqlx::query_as(
        "SELECT model,status,platform,reserved_micros FROM saas_billing_reservations",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reservation.0, "provider-sonnet");
    // 统一账号池后预留的 platform 是唯一池身份。
    assert_eq!(reservation.2, "codex");
    assert!(reservation.3 > 0);
    task.abort();
}

/// SaaS 视频渠道的完整链路（G-P4）：认证 → 预留 → 提交上游 → 按条结算 → 写日志。
///
/// 这条测试是「SaaS 视频到底能不能跑」的唯一证据。在它之前，
/// `execute_video_request` / `reserve_video` / `settle_video` 全是死代码——
/// SaaS 侧有四处硬编码的平台白名单（`authenticate_key` / `core_group` /
/// `keys.create` / `reconcile_group_connection`）各自把视频渠道挡在门外。
#[tokio::test]
async fn saas_video_request_authenticates_reserves_submits_and_bills_per_video() {
    // ── mock 上游：可灵的提交端点 ──
    let upstream_hits = Arc::new(AtomicUsize::new(0));
    let hits = upstream_hits.clone();
    let app = Router::new().route(
        "/v1/videos/text2video",
        post(move |Json(payload): Json<Value>| {
            let hits = hits.clone();
            async move {
                hits.fetch_add(1, Ordering::SeqCst);
                // 上游体必须是可灵方言，且模型已被改写成定价行的 upstream_model
                assert_eq!(payload["model_name"], "kling-v1-upstream");
                // 计价用的时长与发到上游的时长必须是同一个
                assert_eq!(payload["duration"], 10);
                Json(json!({"data": {"task_id": "upstream-video-1"}})).into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // ── 库：视频组 + 账号 + 定价 + 用户 + key ──
    let pool = repository::test_pool().await;
    // `test_pool()` 只跑 SaaS 迁移；`route_pool_groups` / `route_credentials`
    // 这些核心表在 `database::run_migrations` 里。
    crate::database::run_migrations(&pool).await.unwrap();
    repository::test_enable(&pool).await;
    let directory = canonical_test_directory();
    sqlx::query("UPDATE saas_settings SET value_json=json_set(value_json,'$.logs',json(?)) WHERE key='config'")
        .bind(json!({"directory":directory.path()}).to_string()).execute(&pool).await.unwrap();

    // 复用迁移种子里的 `codex-default` 组：一个平台只能有一个 active 组。
    sqlx::query(
        "INSERT INTO route_credentials
           (id,platform,kind,display_name,status,secret_payload_json,config_json,created_at,updated_at)
         VALUES('video-account','codex','api','Kling','ok',?,?,'2026-01-01','2026-01-01')",
    )
    .bind(r#"{"api_key":"upstream-video-key"}"#)
    .bind(
        json!({
            "base_url": format!("http://{address}/v1"),
            "interface_format": "kling",
            "model_mappings": [{
                "from": "kling-v1",
                "to": "kling-v1-upstream",
                "capabilities": ["video.generate"],
            }],
        })
        .to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO route_pool_members
           (id,platform,route_credential_id,enabled,group_id,created_at,updated_at)
         VALUES('video-member','codex','video-account',1,'codex-default','2026-01-01','2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // 管理员定价：按「条」3 万 micros。这一步同时证明 `groups.save`
    // （`saas_group_models` 的唯一写入路径）已经接受视频组。
    let saved = domain::admin(
        &pool,
        "groups.save",
        json!({
            "id": "codex-default",
            "multiplierMicros": 1_000_000,
            "maxOutputTokens": 4096,
            "timeoutSeconds": 120,
            "maxConcurrency": 10,
            "models": [{
                "model": "kling-v1",
                "upstreamModel": "kling-v1-upstream",
                // 三个 token 价是 `GroupModel` 的必填字段（没有 serde default）：
                // 故意不放开成可选——漏填静默变 0 会让文本按 0 计价。
                "inputPriceMicros": 0,
                "cachePriceMicros": 0,
                "outputPriceMicros": 0,
                "videoPriceMicros": 10_000,
                "videoPricePerSecondMicros": 5_000,
                "enabled": true,
            }],
        }),
    )
    .await
    .expect("video group is saveable");
    assert_eq!(saved["id"], "codex-default");

    let user_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO saas_users(id,github_id,login,github_created_at,created_at,updated_at) VALUES(?,?,'video-tester','2020-01-01T00:00:00Z',?,?)")
        .bind(&user_id).bind(&user_id).bind("2026-01-01").bind("2026-01-01")
        .execute(&pool).await.unwrap();
    sqlx::query("UPDATE saas_users SET balance_micros=1000000 WHERE id=?")
        .bind(&user_id).execute(&pool).await.unwrap();
    let key = domain::user(
        &pool,
        &user_id,
        "keys.create",
        json!({"name":"video","groupId":"codex-default"}),
    )
    .await
    .expect("a video group can issue a key");

    // 认证必须认出视频组（`authenticate_key` 的第一道白名单）
    let principal = crate::saas::billing::authenticate_key(
        &pool,
        key["plaintextKey"].as_str().unwrap(),
    )
    .await
    .expect("video key authenticates");
    assert_eq!(principal.platform, "codex");

    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {}", key["plaintextKey"].as_str().unwrap())
            .parse()
            .unwrap(),
    );

    // ── 真正打一次 SaaS 视频请求 ──
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    let response = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/video/generations".parse().unwrap(),
        Body::from(
            // 10 秒 × 1 条：单价 = 10_000 + 5_000×10 = 60_000
            json!({"model":"kling-v1","prompt":"a cat surfing","duration":10,"n":1}).to_string(),
        ),
    )
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["object"], "video");
    assert_eq!(body["status"], "processing");
    assert_eq!(body["model"], "kling-v1");
    assert!(!body["task_id"].as_str().unwrap_or_default().is_empty());
    assert_eq!(upstream_hits.load(Ordering::SeqCst), 1);

    // 任务表要把「客户端看到的」和「上游认的」两个名字分开存：
    // 响应体回显客户端名（`model`），上游体用的是定价行的 `upstream_model`。
    let stored: (String, Option<String>) = sqlx::query_as(
        "SELECT model,upstream_model FROM videogen_tasks WHERE task_id=?",
    )
    .bind(body["task_id"].as_str().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.0, "kling-v1");
    assert_eq!(stored.1.as_deref(), Some("kling-v1-upstream"));

    // 计费：单价 60_000 × 1 条，且账号被收窄到预留算出的那一个
    let reservation: (String, i64) = sqlx::query_as(
        "SELECT status,reserved_micros FROM saas_billing_reservations",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reservation, ("settled".to_string(), 60_000));
    let ledger: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger, (1, -60_000));

    // 日志里要能对上这一单
    runtime.logs.shutdown().await.unwrap();
    let logs = runtime
        .logs
        .query(crate::saas::logs::LogQuery::default())
        .await
        .unwrap();
    assert_eq!(logs.total, 1);
    assert_eq!(logs.items[0].amount_usd_micros, 60_000);
    assert_eq!(logs.items[0].model, "kling-v1");
    assert_eq!(logs.items[0].platform, "codex");
    // 端点也必须是原样的那条，而不是被清洗兜底成 `/other`
    assert_eq!(logs.items[0].endpoint, "/v1/video/generations");

    upstream.abort();
}

// 这里原本有一个 `saas_video_key_cannot_reach_text_endpoints`：它建一个
// `platform='video'` 的组，断言视频 key 打文本端点会被端点白名单拒掉。
//
// 它的前提已经消失 —— **视频不再是平台**，而是账号的模态分类。同一个 `codex`
// 组里同时挂着文本账号与视频账号，所以「一把 key 只能打一种模态」这个约束不再
// 成立（这正是「一个 key 通吃」）。剩下的跨平台守卫（claude 只打 anthropic /
// responses、gemini 只打 images）另有测试覆盖。

/// 建一个最小的视频 SaaS 环境：`video:kling` 组 + 一个支持 `video.generate`
/// 的账号 + 给定定价 + 一个能认证的 key。
///
/// 只在 `reserve_video` 层面用（不发上游），所以不需要 mock 上游。
/// `interface_format` 决定账号的方言（复审 3a 的计价口径按方言折算）。
async fn video_billing_fixture(
    flat_price: i64,
    per_second_price: i64,
    interface_format: &str,
) -> (SqlitePool, crate::saas::billing::ApiPrincipal, String) {
    let pool = repository::test_pool().await;
    crate::database::run_migrations(&pool).await.unwrap();
    repository::test_enable(&pool).await;
    // 复用迁移种子里的 `codex-default` 组：一个平台只能有一个 active 组。
    sqlx::query(
        "INSERT INTO route_credentials
           (id,platform,kind,display_name,status,secret_payload_json,config_json,created_at,updated_at)
         VALUES('video-account','codex','api','Kling','ok','{}',?,'2026-01-01','2026-01-01')",
    )
        .bind(
            json!({
                "base_url": "http://127.0.0.1:1/v1",
                "interface_format": interface_format,
                "model_mappings": [{
                    "from": "kling-v1",
                    "to": "kling-v1",
                    "capabilities": ["video.generate"],
                }],
            })
            .to_string(),
        )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO route_pool_members
           (id,platform,route_credential_id,enabled,group_id,created_at,updated_at)
         VALUES('video-member','codex','video-account',1,'codex-default','2026-01-01','2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();
    domain::admin(
        &pool,
        "groups.save",
        json!({
            "id": "codex-default",
            "multiplierMicros": 1_000_000,
            "maxOutputTokens": 4096,
            "timeoutSeconds": 120,
            "maxConcurrency": 10,
            "models": [{
                "model": "kling-v1",
                "upstreamModel": "kling-v1",
                "inputPriceMicros": 0,
                "cachePriceMicros": 0,
                "outputPriceMicros": 0,
                "videoPriceMicros": flat_price,
                "videoPricePerSecondMicros": per_second_price,
                "enabled": true,
            }],
        }),
    )
    .await
    .expect("video group is saveable");

    let user_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO saas_users(id,github_id,login,github_created_at,created_at,updated_at) VALUES(?,?,'video-tester','2020-01-01T00:00:00Z',?,?)")
        .bind(&user_id).bind(&user_id).bind("2026-01-01").bind("2026-01-01")
        .execute(&pool).await.unwrap();
    sqlx::query("UPDATE saas_users SET balance_micros=100000000 WHERE id=?")
        .bind(&user_id).execute(&pool).await.unwrap();
    let key = domain::user(
        &pool,
        &user_id,
        "keys.create",
        json!({"name":"video","groupId":"codex-default"}),
    )
    .await
    .unwrap();
    let plaintext = key["plaintextKey"].as_str().unwrap().to_string();
    let principal = crate::saas::billing::authenticate_key(&pool, &plaintext)
        .await
        .unwrap();
    (pool, principal, plaintext)
}

#[tokio::test]
async fn native_saas_video_preserves_seconds_size_reference_and_response_contract() {
    let captured = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let sink = captured.clone();
    let app = Router::new().fallback(post(move |Json(payload): Json<Value>| {
        let sink = sink.clone();
        async move {
            sink.lock().unwrap().push(payload);
            Json(json!({"data":{"task_id":"native-task"}}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (pool, _principal, plaintext) = video_billing_fixture(1_000, 2_000, "kling").await;
    let directory = canonical_test_directory();
    sqlx::query("UPDATE saas_settings SET value_json=json_set(value_json,'$.logs',json(?)) WHERE key='config'").bind(json!({"directory":directory.path()}).to_string()).execute(&pool).await.unwrap();
    sqlx::query("UPDATE route_credentials SET secret_payload_json=?,config_json=json_set(config_json,'$.base_url',?) WHERE id='video-account'").bind(r#"{"api_key":"test-key"}"#).bind(format!("http://{address}/v1")).execute(&pool).await.unwrap();
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let mut headers = HeaderMap::new();
    headers.insert(header::AUTHORIZATION, format!("Bearer {plaintext}").parse().unwrap());
    let response = execute(&state, &runtime, build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()), Method::POST, headers, "/v1/videos".parse().unwrap(), Body::from(json!({"model":"kling-v1","prompt":"a cat","seconds":"8","size":"720x1280","input_reference":"https://cdn.example/first.png"}).to_string())).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["object"], "video");
    assert_eq!(response["status"], "queued");
    assert_eq!(response["seconds"], "8");
    assert_eq!(response["size"], "720x1280");
    assert!(response.get("task_id").is_none());
    let body = captured.lock().unwrap()[0].clone();
    assert_eq!(body["duration"], 8);
    assert_eq!(body["aspect_ratio"], "9:16");
    assert_eq!(body["image"], "https://cdn.example/first.png");
    let charge: i64 = sqlx::query_scalar("SELECT reserved_micros FROM saas_billing_reservations").fetch_one(&pool).await.unwrap();
    assert_eq!(charge, 17_000);
    runtime.logs.shutdown().await.unwrap();
    upstream.abort();
}

/// 视频定价矩阵：起步价与按秒价**相加**，且只配一种时也能工作
/// （只配起步价 = 0007 的老行为，向后兼容）。
#[tokio::test]
async fn video_pricing_adds_the_flat_and_per_second_prices() {
    // 只配起步价 → 与迁移 0007 行为一致
    let (pool, principal, _key) = video_billing_fixture(30_000, 0, "kling").await;
    let reservation = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 10)
        .await
        .unwrap();
    assert_eq!(reservation.reserved_micros, 30_000);

    // 只配按秒价 → 纯按秒
    let (pool, principal, _key) = video_billing_fixture(0, 2_000, "kling").await;
    let reservation = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 7)
        .await
        .unwrap();
    assert_eq!(reservation.reserved_micros, 14_000);

    // 两个都配 → 起步价 + 按秒价 × 时长
    let (pool, principal, _key) = video_billing_fixture(1_000, 2_000, "kling").await;
    let reservation = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 7)
        .await
        .unwrap();
    assert_eq!(reservation.reserved_micros, 15_000);

    // 时长直接影响预留额：同一配置下 10 秒应当比 5 秒贵
    let short = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 5)
        .await
        .unwrap();
    let long = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 10)
        .await
        .unwrap();
    assert_eq!(short.reserved_micros, 11_000);
    assert_eq!(long.reserved_micros, 21_000);
}

/// 定价为 0 与时长/条数越界都必须 fail closed。
#[tokio::test]
async fn video_pricing_rejects_unpriced_models_and_out_of_range_inputs() {
    // 两种价都是 0 → 没有任何可用价格
    let (pool, principal, _key) = video_billing_fixture(0, 0, "kling").await;
    let error = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 5)
        .await
        .expect_err("unpriced model must fail closed");
    assert_eq!(error.code(), "saas.model_not_allowed");

    let (pool, principal, _key) = video_billing_fixture(30_000, 0, "kling").await;
    // 条数上限是 1（契约的 `url` 是单值），所以 2 条也必须被拒
    for (count, duration) in [(0, 5), (2, 5), (5, 5), (1, 0), (1, 601)] {
        let error = crate::saas::billing::reserve_video(
            &pool, &principal, "kling-v1", count, duration,
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.code(),
            "saas.request_limits",
            "count={count} duration={duration} should be rejected"
        );
    }
}

/// 复审 3a：计价的时长是**方言折算后**的，不是客户端请求的秒数。
///
/// - Sora 把时长 clamp 到 `1..20`：请求 60 秒只给 20 秒，按 60 收是多收钱；
/// - 智谱的上游体没有时长字段：按秒价按 0 计，只剩起步价；
/// - 只配按秒价 + 不收时长的方言 → 总价为 0 → fail closed（配置错误）。
#[tokio::test]
async fn video_pricing_bills_the_duration_the_dialect_will_actually_run() {
    // Sora：60 秒按 20 秒收（起步 1_000 + 2_000 × 20）
    let (pool, principal, _key) = video_billing_fixture(1_000, 2_000, "sora").await;
    let reservation =
        crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 60)
            .await
            .unwrap();
    assert_eq!(reservation.reserved_micros, 41_000);

    // 智谱：不收时长，按秒价 × 0，只剩起步价
    let (pool, principal, _key) = video_billing_fixture(1_000, 2_000, "zhipu").await;
    let reservation =
        crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 60)
            .await
            .unwrap();
    assert_eq!(reservation.reserved_micros, 1_000);

    // 智谱 + 只配按秒价 → 总价为 0 → fail closed
    let (pool, principal, _key) = video_billing_fixture(0, 2_000, "zhipu").await;
    let error = crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 5)
        .await
        .expect_err("per-second-only pricing on a duration-less dialect must fail closed");
    assert_eq!(error.code(), "saas.model_not_allowed");
}

/// 复审 3e 依赖的兜底分支：`settle_video(None, true)` 把预留转 pending_review
/// —— 冻结的额度挂着等人判，不退也不收。`execute_video_request` 在「提交成功
/// 但结算失败」时走的就是这条，让客户端仍拿到 201。
#[tokio::test]
async fn settle_video_without_a_count_marks_the_reservation_pending_review() {
    let (pool, principal, _key) = video_billing_fixture(30_000, 0, "kling").await;
    let reservation =
        crate::saas::billing::reserve_video(&pool, &principal, "kling-v1", 1, 5)
            .await
            .unwrap();

    let settlement =
        crate::saas::billing::settle_video(&pool, &reservation.request_id, None, true)
            .await
            .unwrap();
    assert_eq!(settlement.status, "pending_review");
    assert_eq!(settlement.price_usd_micros, None);

    // 用户冻结还在（30_000 冻着没动），余额也没被扣（预留只动 frozen）
    let (balance, frozen): (i64, i64) = sqlx::query_as(
        "SELECT balance_micros, frozen_micros FROM saas_users WHERE id=?",
    )
    .bind(&reservation.user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(frozen, 30_000);
    assert_eq!(balance, 100_000_000);
}

/// SaaS 的视频**读取端点**必须可用，且只能读自己的任务。
///
/// 覆盖三条形态：new-api 的 `GET /v1/video/generations/{task_id}`，以及
/// OpenAI 原生的 `GET /v1/videos/{video_id}` 与 `/{video_id}/content`。
///
/// 复审前这条路径完全不可达：`execute` 的守卫是 `method != Method::POST`，
/// 所以 `sk-saas-` key 查任务只会拿到 `saas.endpoint_not_allowed`
/// —— 提交能用、轮询不能用，异步契约断了一半。
#[tokio::test]
async fn saas_video_status_is_available_and_scoped_to_its_owner() {
    use crate::videogen::models::{NewVideoTask, VideoTaskProgress};
    use crate::videogen::repository::VideoGenerationRepository;

    let (pool, principal, plaintext) = video_billing_fixture(10_000, 0, "kling").await;
    let state = test_app_state(pool.clone());

    let mine = VideoGenerationRepository::create_task(
        &pool,
        NewVideoTask {
            task_id: "task-mine".into(),
            session_id: None,
            message_id: None,
            model: "kling-v1".into(),
            upstream_model: Some("kling-v1-upstream".into()),
            dialect: "kling".into(),
            credential_id: Some("video-account".into()),
            upstream_task_id: Some("upstream-1".into()),
            duration_seconds: Some(5),
            size: Some("1280x720".into()),
            callback_url: None,
            owner_user_id: Some(principal.user_id.clone()),
        },
    )
    .await
    .unwrap();
    VideoGenerationRepository::progress_task(
        &pool,
        &mine.task_id,
        VideoTaskProgress {
            status: "succeeded".into(),
            url: Some("https://cdn.example/v.mp4".into()),
            error_message: None,
        },
    )
    .await
    .unwrap();

    VideoGenerationRepository::create_task(
        &pool,
        NewVideoTask {
            task_id: "task-theirs".into(),
            session_id: None,
            message_id: None,
            model: "kling-v1".into(),
            upstream_model: None,
            dialect: "kling".into(),
            credential_id: Some("video-account".into()),
            upstream_task_id: Some("upstream-2".into()),
            duration_seconds: None,
            size: None,
            callback_url: None,
            owner_user_id: Some("someone-else".into()),
        },
    )
    .await
    .unwrap();

    let runtime = SaasRuntime::default();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );

    let response = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::GET,
        headers.clone(),
        "/v1/video/generations/task-mine".parse().unwrap(),
        Body::empty(),
    )
    .await
    .expect("GET on the video status path must be allowed for a video key");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["task_id"], "task-mine");
    assert_eq!(body["status"], "succeeded");
    assert_eq!(body["url"], "https://cdn.example/v.mp4");

    // 别人的任务：回答「不存在」，而不是「无权访问」——后者会泄漏 task_id 是否存在
    let error = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::GET,
        headers.clone(),
        "/v1/video/generations/task-theirs".parse().unwrap(),
        Body::empty(),
    )
    .await
    .expect_err("another user's task must not be readable");
    assert_eq!(error.code(), "videogen.task_not_found");

    // ── OpenAI 原生契约（`/v1/videos`）的两条 GET 形态 ──
    //
    // 它们走的是同一套归属校验。漏掉任何一条，那条契约在 SaaS 侧就是
    // 「提交能用、取不到结果」——与复审前那个 `method != POST` 的 bug 同类。

    let response = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::GET,
        headers.clone(),
        "/v1/videos/task-mine".parse().unwrap(),
        Body::empty(),
    )
    .await
    .expect("GET /v1/videos/{id} must be allowed for a video key");
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["id"], "task-mine");
    assert_eq!(body["object"], "video");
    // OpenAI 的词表：完成是 `completed`（不是 new-api 的 `succeeded`）
    assert_eq!(body["status"], "completed");
    assert_eq!(body["progress"], 100);
    assert_eq!(body["url"], "https://cdn.example/v.mp4");
    // 落库的输出形状要回显（迁移 202610100003 加的两列）
    assert_eq!(body["seconds"], "5");
    assert_eq!(body["size"], "1280x720");

    // new-api 契约 201 体里的 `id` 是 `video-{task_id}`；两条契约指向同一套任务，
    // 客户端拿那个 id 来查 OpenAI 契约也必须查得到。
    let response = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::GET,
        headers.clone(),
        "/v1/videos/video-task-mine".parse().unwrap(),
        Body::empty(),
    )
    .await
    .expect("the new-api id prefix must resolve through /v1/videos too");
    assert_eq!(response.status(), StatusCode::OK);

    // 别人的任务在 OpenAI 契约下同样回答「不存在」
    let error = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::GET,
        headers.clone(),
        "/v1/videos/task-theirs".parse().unwrap(),
        Body::empty(),
    )
    .await
    .expect_err("another user's task must not be readable through /v1/videos");
    assert_eq!(error.code(), "videogen.task_not_found");

    // `/content` 也一样：归属校验发生在去上游取字节**之前**，
    // 否则别人的出片地址就被代理出去了。
    let error = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::GET,
        headers,
        "/v1/videos/task-theirs/content".parse().unwrap(),
        Body::empty(),
    )
    .await
    .expect_err("another user's video content must not be downloadable");
    assert_eq!(error.code(), "videogen.task_not_found");
}

/// `n>1` 必须在预留之前被拒。
///
/// 契约里的 `url` 是单值，而 `upstream_body` 压根不把 `n` 发给上游，
/// 所以允许它就是「按 n 条收钱、只发 1 条」——复审抓到的计费 bug。
#[tokio::test]
async fn saas_video_request_rejects_more_than_one_clip() {
    let (pool, _principal, plaintext) = video_billing_fixture(10_000, 0, "kling").await;
    let state = test_app_state(pool.clone());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );

    let error = execute(
        &state,
        &SaasRuntime::default(),
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::POST,
        headers,
        "/v1/video/generations".parse().unwrap(),
        Body::from(json!({"model":"kling-v1","prompt":"x","n":2}).to_string()),
    )
    .await
    .expect_err("n>1 must be rejected");
    assert_eq!(error.code(), "saas.request_limits");

    // 拒绝必须发生在预留之前：账上不能留下任何冻结
    let reservations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM saas_billing_reservations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(reservations, 0);
}

/// 建一个最小的音频（TTS）SaaS 环境：`codex` 账号 + `audio.generate` 能力 + 定价 + key。
///
/// `base_url` 由调用方给 —— 成功路径要打 mock 上游，失败路径用一个必然连不上的地址。
/// 只在预留/结算层面用时传 `None`（不发上游）。
async fn audio_billing_fixture(
    base_url: &str,
    price_per_1k_chars: i64,
) -> (SqlitePool, String, tempfile::TempDir) {
    audio_billing_fixture_with_dialect(base_url, price_per_1k_chars, "openai").await
}

async fn audio_billing_fixture_with_dialect(
    base_url: &str,
    price_per_1k_chars: i64,
    interface_format: &str,
) -> (SqlitePool, String, tempfile::TempDir) {
    let pool = repository::test_pool().await;
    crate::database::run_migrations(&pool).await.unwrap();
    repository::test_enable(&pool).await;
    // 日志存储是**按目录的文件存储**，默认根目录是所有测试共用的。不隔离的话，
    // 并行跑起来的其他 SaaS 测试会往同一个目录里写记录，`logs.total` 就成了别人
    // 的数量（实测 8/9/10 不等，随并行调度变化）。视频那条测试就是这么做的。
    let directory = canonical_test_directory();
    sqlx::query("UPDATE saas_settings SET value_json=json_set(value_json,'$.logs',json(?)) WHERE key='config'")
        .bind(json!({"directory":directory.path()}).to_string()).execute(&pool).await.unwrap();
    // 复用迁移种子里的 `codex-default` 组：一个平台只能有一个 active 组。
    // 音频账号**不再是独立平台**，它住在这个 codex 组里，靠 `audio.generate` 被认出。
    sqlx::query(
        "INSERT INTO route_credentials
           (id,platform,kind,display_name,status,secret_payload_json,config_json,created_at,updated_at)
         VALUES('audio-account','codex','api','TTS','ok',?,?,'2026-01-01','2026-01-01')",
    )
    .bind(r#"{"api_key":"upstream-tts-key"}"#)
    .bind(
        json!({
            "base_url": base_url,
            "interface_format": interface_format,
            "model_mappings": [{
                "from": "tts-1",
                "to": "tts-1-upstream",
                "capabilities": ["audio.generate"],
            }],
        })
        .to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO route_pool_members
           (id,platform,route_credential_id,enabled,group_id,created_at,updated_at)
         VALUES('audio-member','codex','audio-account',1,'codex-default','2026-01-01','2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();
    // 每千字符 15_000 micros（= $15/1M，OpenAI tts-1 的价位）
    domain::admin(
        &pool,
        "groups.save",
        json!({
            "id": "codex-default",
            "multiplierMicros": 1_000_000,
            "maxOutputTokens": 4096,
            "timeoutSeconds": 120,
            "maxConcurrency": 10,
            "models": [{
                "model": "tts-1",
                "upstreamModel": "tts-1-upstream",
                "inputPriceMicros": 0,
                "cachePriceMicros": 0,
                "outputPriceMicros": 0,
                "audioPriceMicrosPer1kChars": price_per_1k_chars,
                "enabled": true,
            }],
        }),
    )
    .await
    .expect("audio group is saveable");

    let user_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO saas_users(id,github_id,login,github_created_at,created_at,updated_at) VALUES(?,?,'audio-tester','2020-01-01T00:00:00Z',?,?)")
        .bind(&user_id).bind(&user_id).bind("2026-01-01").bind("2026-01-01")
        .execute(&pool).await.unwrap();
    sqlx::query("UPDATE saas_users SET balance_micros=1000000 WHERE id=?")
        .bind(&user_id).execute(&pool).await.unwrap();
    let key = domain::user(
        &pool,
        &user_id,
        "keys.create",
        json!({"name":"audio","groupId":"codex-default"}),
    )
    .await
    .unwrap();
    (pool, key["plaintextKey"].as_str().unwrap().to_string(), directory)
}

/// 音频（TTS）的 SaaS 端到端：认证 → 预留 → 合成 → 按字符计费 → 落账 → 落日志。
///
/// 视频那条（`saas_video_request_authenticates_reserves_submits_and_bills_per_video`）
/// 在账号还是独立平台时就写好了，音频这条一直没有。而音频账号搬进 codex 组之后，
/// `reserve_audio` 的 `groups.platform=?` 绑的是 `principal.platform`（现在是
/// `codex`）—— 没有任何测试证明这条路真的通。
///
/// 同时钉住三件容易回退的事：
///   1. **计费按字符不按字节**：`你好世界` 是 4 个字符、12 个 UTF-8 字节。
///      15_000 micros/千字符 → 4 字符 = 60，按字节会是 180。
///   2. **响应体是二进制，必须原样回到客户端**（`Content-Type` 也一起带回）。
///   3. 上游体里的模型名必须被改写成定价行的 `upstream_model`。
#[tokio::test]
async fn saas_audio_request_authenticates_reserves_synthesizes_and_bills_per_character() {
    let upstream_hits = Arc::new(AtomicUsize::new(0));
    let hits = upstream_hits.clone();
    let app = Router::new().route(
        "/v1/audio/speech",
        post(move |Json(payload): Json<Value>| {
            let hits = hits.clone();
            async move {
                hits.fetch_add(1, Ordering::SeqCst);
                // 模型被改写成定价行的 upstream_model；其余字段原样透传
                assert_eq!(payload["model"], "tts-1-upstream");
                assert_eq!(payload["input"], "你好世界");
                assert_eq!(payload["voice"], "alloy");
                ([(header::CONTENT_TYPE, "audio/mpeg")], b"ID3-fake-mp3".as_slice())
                    .into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (pool, plaintext, _log_dir) =
        audio_billing_fixture(&format!("http://{address}/v1"), 15_000).await;

    // 认证必须认出这个 codex 组（`authenticate_key` 的第一道白名单）
    let principal = crate::saas::billing::authenticate_key(&pool, &plaintext)
        .await
        .expect("audio key authenticates");
    assert_eq!(principal.platform, "codex");

    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );

    // ── 真正打一次 SaaS 音频请求 ──
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    let response = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/audio/speech".parse().unwrap(),
        Body::from(json!({"model":"tts-1","input":"你好世界","voice":"alloy"}).to_string()),
    )
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    // 二进制体原样回来，Content-Type 也是上游那份（不是硬编码 audio/mpeg）
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(content_type.as_deref(), Some("audio/mpeg"));
    assert_eq!(&bytes[..], b"ID3-fake-mp3");
    assert_eq!(upstream_hits.load(Ordering::SeqCst), 1);

    // 计费：4 个字符 × 15_000 micros/千字符 = 60
    let reservation: (String, i64) = sqlx::query_as(
        "SELECT status,reserved_micros FROM saas_billing_reservations",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reservation, ("settled".to_string(), 60));
    let ledger: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger, (1, -60));

    // 日志里要能对上这一单
    runtime.logs.shutdown().await.unwrap();
    let logs = runtime
        .logs
        .query(crate::saas::logs::LogQuery::default())
        .await
        .unwrap();
    assert_eq!(logs.total, 1);
    assert_eq!(logs.items[0].amount_usd_micros, 60);
    assert_eq!(logs.items[0].model, "tts-1");
    assert_eq!(logs.items[0].platform, "codex");
    assert_eq!(logs.items[0].endpoint, "/v1/audio/speech");

    upstream.abort();
}

/// 上游合成失败：预留必须**全退**，账上一分不留。
///
/// 音频的响应体是二进制，数不出「成功合成了几个字」，所以结算只能全有或全无
/// （`settle_audio` 不看响应内容）。这条测试就是那个决策的守卫。
#[tokio::test]
async fn saas_audio_request_refunds_the_whole_reservation_when_the_upstream_fails() {
    let upstream_hits = Arc::new(AtomicUsize::new(0));
    let hits = upstream_hits.clone();
    let app = Router::new().route(
        "/v1/audio/speech",
        post(move || {
            let hits = hits.clone();
            async move {
                hits.fetch_add(1, Ordering::SeqCst);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    r#"{"error":{"code":"upstream_boom"}}"#,
                )
                    .into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (pool, plaintext, _log_dir) =
        audio_billing_fixture(&format!("http://{address}/v1"), 15_000).await;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );

    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let response = execute(
        &state,
        &runtime,
        build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
        Method::POST,
        headers,
        "/v1/audio/speech".parse().unwrap(),
        Body::from(json!({"model":"tts-1","input":"你好世界","voice":"alloy"}).to_string()),
    )
    .await
    .unwrap();

    // 上游的 5xx 是可重试的（`should_retry = !status.is_success()`），所以见到的不是
    // 原样的 500，而是重试用尽后的 502。三次 = 1 次首发 + `DEFAULT_ROUTE_CREDENTIAL_
    // RETRY_COUNT`(2) 次同账号重试。
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(upstream_hits.load(Ordering::SeqCst), 3);

    let reservation: (String, i64) = sqlx::query_as(
        "SELECT status,reserved_micros FROM saas_billing_reservations",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reservation, ("refunded".to_string(), 60));
    // 没有 usage 记账，冻结解除后余额回到原值
    let ledger: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger, (0, 0));
    let frozen: i64 = sqlx::query_scalar("SELECT frozen_micros FROM saas_api_keys")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(frozen, 0);
    let balance: i64 = sqlx::query_scalar("SELECT balance_micros FROM saas_users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, 1_000_000);

    runtime.logs.shutdown().await.unwrap();
    let logs = runtime
        .logs
        .query(crate::saas::logs::LogQuery::default())
        .await
        .unwrap();
    assert_eq!(logs.total, 1);
    assert_eq!(logs.items[0].amount_usd_micros, 0);
    assert_eq!(logs.items[0].status, 502);

    upstream.abort();
}

/// MiniMax 方言端到端：OpenAI 形状的请求被转成 `/v1/t2a_v2` 原生体，JSON+hex
/// 回程被还原成音频字节并带正确的 Content-Type；HTTP 200 里的业务错误必须退款。
#[tokio::test]
async fn saas_minimax_audio_decodes_hex_and_refunds_http_200_provider_errors() {
    let fail = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let fail_flag = fail.clone();
    let app = Router::new().route(
        "/v1/t2a_v2",
        post(move |Json(payload): Json<Value>| {
            let fail = fail_flag.clone();
            async move {
                assert_eq!(payload["model"], "tts-1-upstream");
                assert_eq!(payload["text"], "你好世界");
                assert_eq!(payload["voice_setting"]["voice_id"], "male-qn-qingse");
                assert_eq!(payload["output_format"], "hex");
                let body = if fail.load(Ordering::SeqCst) {
                    json!({"base_resp":{"status_code":1004,"status_msg":"insufficient balance"}})
                } else {
                    json!({"data":{"audio":"4944332d6d696e696d6178"},"base_resp":{"status_code":0,"status_msg":"success"}})
                };
                ([(header::CONTENT_TYPE, "application/json")], body.to_string()).into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (pool, plaintext, _log_dir) =
        audio_billing_fixture_with_dialect(&format!("http://{address}/v1"), 15_000, "minimax")
            .await;
    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let send = || {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {plaintext}").parse().unwrap(),
        );
        execute(
            &state,
            &runtime,
            build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()),
            Method::POST,
            headers,
            "/v1/audio/speech".parse().unwrap(),
            Body::from(
                json!({"model":"tts-1","input":"你好世界","voice":"male-qn-qingse"}).to_string(),
            ),
        )
    };

    let response = send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(content_type.as_deref(), Some("audio/mpeg"));
    assert_eq!(&bytes[..], b"ID3-minimax");

    fail.store(true, Ordering::SeqCst);
    let response = send().await.unwrap();
    assert!(!response.status().is_success(), "{}", response.status());

    let statuses: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status,reserved_micros FROM saas_billing_reservations ORDER BY created_at, rowid",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        statuses,
        vec![("settled".to_string(), 60), ("refunded".to_string(), 60)]
    );
    let ledger: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(amount_micros),0) FROM saas_wallet_ledger WHERE kind='usage'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger, (1, -60));

    runtime.logs.shutdown().await.unwrap();
    upstream.abort();
}

/// `reserve_audio` 在没有账号支持 `audio.generate` 时必须报 `saas.empty_pool`，
/// 而不是放一个空候选集过去（后者会在上游才失败，钱已经预留了）。
#[tokio::test]
async fn audio_reservation_rejects_a_group_without_any_audio_account() {
    let (pool, _plaintext, _log_dir) =
        audio_billing_fixture("http://127.0.0.1:1/v1", 15_000).await;
    // 把账号唯一的能力声明摘掉 —— 现在这个池里没有任何账号能合成
    sqlx::query(
        "UPDATE route_credentials
         SET config_json=json_set(config_json,'$.model_mappings[0].capabilities','[]')
         WHERE id='audio-account'",
    )
    .execute(&pool)
    .await
    .unwrap();

    let principal = crate::saas::billing::authenticate_key(&pool, &_plaintext)
        .await
        .unwrap();
    let error = crate::saas::billing::reserve_audio(&pool, &principal, "tts-1", 4)
        .await
        .expect_err("no account supports audio.generate");
    assert_eq!(error.code(), "saas.empty_pool");

    // 拒绝发生在预留之前：账上什么都没留下
    let reservations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM saas_billing_reservations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(reservations, 0);
}

/// 建一个最小的 STT SaaS 环境：一个声明 `audio.transcribe` 的账号 +
/// 按次定价 + 一个能认证的 key。
async fn transcribe_billing_fixture(
    base_url: &str,
    price_per_request: i64,
) -> (SqlitePool, String, tempfile::TempDir) {
    let pool = repository::test_pool().await;
    crate::database::run_migrations(&pool).await.unwrap();
    repository::test_enable(&pool).await;
    let directory = canonical_test_directory();
    sqlx::query("UPDATE saas_settings SET value_json=json_set(value_json,'$.logs',json(?)) WHERE key='config'")
        .bind(json!({"directory":directory.path()}).to_string()).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO route_credentials
           (id,platform,kind,display_name,status,secret_payload_json,config_json,created_at,updated_at)
         VALUES('transcribe-account','codex','api','STT','ok',?,?,'2026-01-01','2026-01-01')",
    )
    .bind(r#"{"api_key":"upstream-stt-key"}"#)
    .bind(
        json!({
            "base_url": base_url,
            "interface_format": "openai",
            "model_mappings": [{
                "from": "whisper-1",
                "to": "whisper-upstream",
                "capabilities": ["audio.transcribe"],
            }],
        })
        .to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO route_pool_members
           (id,platform,route_credential_id,enabled,group_id,created_at,updated_at)
         VALUES('transcribe-member','codex','transcribe-account',1,'codex-default','2026-01-01','2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();
    domain::admin(
        &pool,
        "groups.save",
        json!({
            "id": "codex-default",
            "multiplierMicros": 1_000_000,
            "maxOutputTokens": 4096,
            "timeoutSeconds": 120,
            "maxConcurrency": 10,
            "models": [{
                "model": "whisper-1",
                "upstreamModel": "whisper-upstream",
                "inputPriceMicros": 0,
                "cachePriceMicros": 0,
                "outputPriceMicros": 0,
                "audioTranscribePriceMicros": price_per_request,
                "enabled": true,
            }],
        }),
    )
    .await
    .expect("transcribe group is saveable");

    let user_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO saas_users(id,github_id,login,github_created_at,created_at,updated_at) VALUES(?,?,'stt-tester','2020-01-01T00:00:00Z',?,?)")
        .bind(&user_id).bind(&user_id).bind("2026-01-01").bind("2026-01-01")
        .execute(&pool).await.unwrap();
    sqlx::query("UPDATE saas_users SET balance_micros=1000000 WHERE id=?")
        .bind(&user_id).execute(&pool).await.unwrap();
    let key = domain::user(
        &pool,
        &user_id,
        "keys.create",
        json!({"name":"stt","groupId":"codex-default"}),
    )
    .await
    .unwrap();
    (pool, key["plaintextKey"].as_str().unwrap().to_string(), directory)
}

/// 组一个最小的 STT multipart 请求体（model + file 两个表单字段）。
fn transcribe_multipart(model: &str) -> (String, Vec<u8>) {
    let boundary = "TestBoundary123";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"model\"\r\n\r\n");
    body.extend_from_slice(model.as_bytes());
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"a.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n",
    );
    body.extend_from_slice(b"ID3-fake-mp3");
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (
        format!("multipart/form-data; boundary={boundary}"),
        body,
    )
}

#[tokio::test]
async fn cancelled_transcription_and_translation_release_reserved_funds() {
    for path in ["/v1/audio/transcriptions", "/v1/audio/translations"] {
        let release = Arc::new(tokio::sync::Notify::new());
        let gate = release.clone();
        let app = Router::new().fallback(move || {
            let gate = gate.clone();
            async move {
                gate.notified().await;
                Json(json!({"text":"hello"}))
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let upstream = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let (pool, plaintext, _directory) = transcribe_billing_fixture(&format!("http://{address}/v1"), 6_000).await;
        let state = test_app_state(pool.clone());
        let runtime = SaasRuntime::default();
        let (content_type, body) = transcribe_multipart("whisper-1");
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, format!("Bearer {plaintext}").parse().unwrap());
        headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
        let mut request = Box::pin(execute(&state, &runtime, build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default()), Method::POST, headers, path.parse().unwrap(), Body::from(body)));
        tokio::select! {
            response = &mut request => panic!("upstream remains blocked: {response:?}"),
            reserved = tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM saas_billing_reservations WHERE status='reserved'").fetch_one(&pool).await.unwrap();
                    if count == 1 { break; }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            }) => reserved.expect("reservation committed before cancellation"),
        }
        drop(request);
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let status: String = sqlx::query_scalar("SELECT status FROM saas_billing_reservations").fetch_one(&pool).await.unwrap();
                if status == "refunded" { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("cancelled STT must refund, not consume concurrency indefinitely");
        let frozen: (i64, i64) = sqlx::query_as("SELECT users.frozen_micros,keys.frozen_micros FROM saas_users users JOIN saas_api_keys keys ON keys.user_id=users.id").fetch_one(&pool).await.unwrap();
        assert_eq!(frozen, (0, 0));
        runtime.logs.shutdown().await.unwrap();
        upstream.abort();
    }
}

/// STT / 翻译的 SaaS 端到端（音频遗留 1）：认证 → 预留（按次）→ 改写 multipart
/// 的 `model` 段 → 上游收到的仍是合法 multipart → 按次结算 → 落日志。
///
/// 钉住三件容易回退的事：
///   1. **`model` 从表单字段取**：multipart 不是 JSON，入口必须在解析 JSON 前
///      分叉（遗留 1 的原话），否则一律 `saas.validation`；
///   2. **改写后 Content-Type 换成重建体的 boundary**：沿用客户端旧 boundary
///      上游解不开；
///   3. **按次计费**：文件多大都是同一个价（上游按时长收费、网关不解码）。
#[tokio::test]
async fn saas_transcribe_request_authenticates_reserves_submits_and_bills_per_request() {
    let upstream_hits = Arc::new(AtomicUsize::new(0));
    let hits = upstream_hits.clone();
    let app = Router::new().route(
        "/v1/audio/transcriptions",
        post(move |headers: HeaderMap, body: axum::body::Bytes| {
            let hits = hits.clone();
            async move {
                hits.fetch_add(1, Ordering::SeqCst);
                // 用协议层自己的解析验证上游收到的体：model 段必须是定价行的
                // upstream_model，文件字节原样保留
                let content_type = headers
                    .get(header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_string();
                let boundary =
                    crate::audiogen::protocol::multipart_boundary(&content_type)
                        .expect("upstream receives a multipart content-type");
                let form = crate::audiogen::protocol::parse_multipart(&body, boundary)
                    .expect("upstream receives a parseable multipart body");
                assert_eq!(form.field("model").as_deref(), Some("whisper-upstream"));
                assert!(form.has_file("file"));
                Json(json!({"text": "hello world"})).into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (pool, plaintext, _log_dir) =
        transcribe_billing_fixture(&format!("http://{address}/v1"), 6_000).await;
    let principal = crate::saas::billing::authenticate_key(&pool, &plaintext)
        .await
        .expect("stt key authenticates");
    assert_eq!(principal.platform, "codex");

    let (content_type, body) = transcribe_multipart("whisper-1");
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );
    headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());

    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    let response = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/audio/transcriptions".parse().unwrap(),
        Body::from(body),
    )
    .await
    .unwrap();

    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(upstream_hits.load(Ordering::SeqCst), 1);
    let payload: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(payload["text"], "hello world");

    // 计费：按次，一条 6_000 micros，与文件大小无关
    let reservation: (String, i64) = sqlx::query_as(
        "SELECT status,reserved_micros FROM saas_billing_reservations",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reservation, ("settled".to_string(), 6_000));

    upstream.abort();
}

/// 上游失败时整笔退款（与 TTS 同一口径），且客户端拿到上游的错误状态。
#[tokio::test]
async fn saas_transcribe_request_refunds_the_whole_reservation_when_the_upstream_fails() {
    let app = Router::new().route(
        "/v1/audio/translations",
        post(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "boom") }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (pool, plaintext, _log_dir) =
        transcribe_billing_fixture(&format!("http://{address}/v1"), 6_000).await;
    let (content_type, body) = transcribe_multipart("whisper-1");
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {plaintext}").parse().unwrap(),
    );
    headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());

    let state = test_app_state(pool.clone());
    let runtime = SaasRuntime::default();
    let proxy = build_proxy_state(pool.clone(), &RouteProxyRuntimeState::default());
    let response = execute(
        &state,
        &runtime,
        proxy,
        Method::POST,
        headers,
        "/v1/audio/translations".parse().unwrap(),
        Body::from(body),
    )
    .await
    .unwrap();
    // 上游 5xx 是可重试的（should_retry = !success），所以网关会把候选账号挨个
    // 打完再回 502 —— 与 TTS 的退款测试同一个口径。
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);

    let reservation: (String, i64) = sqlx::query_as(
        "SELECT status,reserved_micros FROM saas_billing_reservations",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reservation, ("refunded".to_string(), 6_000));

    upstream.abort();
}

/// 未定价（平价为 0）的转写模型必须 fail closed，且拒绝发生在预留之前。
#[tokio::test]
async fn transcribe_reservation_rejects_an_unpriced_model() {
    let (pool, plaintext, _log_dir) =
        transcribe_billing_fixture("http://127.0.0.1:1/v1", 0).await;
    let principal = crate::saas::billing::authenticate_key(&pool, &plaintext)
        .await
        .unwrap();
    let error = crate::saas::billing::reserve_transcribe(&pool, &principal, "whisper-1")
        .await
        .expect_err("unpriced transcribe model must fail closed");
    assert_eq!(error.code(), "saas.model_not_allowed");
    let reservations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM saas_billing_reservations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(reservations, 0);
}
