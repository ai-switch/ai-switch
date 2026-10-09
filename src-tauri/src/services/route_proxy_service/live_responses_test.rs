use super::*;
use crate::database::{create_memory_pool, run_migrations};

fn completed_response(body: &[u8]) -> Option<Value> {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        if value.get("status").and_then(Value::as_str) == Some("completed") {
            return Some(value);
        }
    }
    std::str::from_utf8(body).ok()?.lines().find_map(|line| {
        let data = line.trim().strip_prefix("data:")?.trim();
        let value = serde_json::from_str::<Value>(data).ok()?;
        (value.get("type").and_then(Value::as_str) == Some("response.completed"))
            .then(|| value.get("response").cloned())
            .flatten()
    })
}

async fn read_live_responses_credential() -> (String, String, String) {
    let database = std::env::var("AI_SWITCH_LIVE_RESPONSES_DB").expect("set live database path");
    let source_id =
        std::env::var("AI_SWITCH_LIVE_RESPONSES_CREDENTIAL").expect("set live credential ID");
    let model = std::env::var("AI_SWITCH_LIVE_RESPONSES_MODEL").expect("set live model");
    let source = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(database)
                .read_only(true)
                .create_if_missing(false),
        )
        .await
        .expect("open read-only source");
    let (platform, config_json, secret_json) = sqlx::query_as::<_, (String, String, String)>(
        "SELECT platform, config_json, secret_payload_json FROM route_credentials WHERE id = ?",
    )
    .bind(source_id)
    .fetch_one(&source)
    .await
    .expect("read live credential");
    source.close().await;
    assert_eq!(platform, "codex");
    (model, config_json, secret_json)
}

#[tokio::test]
#[ignore = "requires explicit live Responses DB, credential and model env vars; uses upstream quota"]
async fn live_responses_encrypted_content_recovery() {
    let (model, config_json, secret_json) = read_live_responses_credential().await;
    let proactive_cleanup = std::env::var("AI_SWITCH_LIVE_RESPONSES_CLEANUP").as_deref() == Ok("1");
    let secret: Value = serde_json::from_str(&secret_json).expect("credential secret");
    let api_key = secret["api_key"]
        .as_str()
        .filter(|key| !key.is_empty())
        .expect("API key");
    let mut config: Value = serde_json::from_str(&config_json).expect("credential config");
    assert_eq!(config["interface_format"], "openai-responses");
    config["failure_policy"] = json!({"retry_count": 0});
    config["responses_encrypted_content_cleanup"] = json!(proactive_cleanup);
    let pool = create_memory_pool().await.expect("isolated pool");
    run_migrations(&pool).await.expect("isolated migrations");
    let credential = RouteCredentialRepository::create(
        &pool,
        "codex",
        "api",
        "live-probe",
        None,
        "ok",
        None,
        &secret_json,
        &config.to_string(),
        "{}",
    )
    .await
    .expect("isolated credential");
    RoutePoolRepository::replace_members(&pool, "codex", std::slice::from_ref(&credential.id))
        .await
        .expect("isolated membership");
    let route_key = RouteProxyKeyRepository::ensure_platform_key(
        &pool,
        "codex",
        "sk-ai-switch-live-isolated-probe",
    )
    .await
    .expect("isolated route key");
    let runtime = RouteProxyRuntimeState::default();
    let mut state = build_proxy_state(pool.clone(), &runtime);
    state.upstream_timeouts = OutboundTimeouts {
        total: Some(Duration::from_secs(50)),
        connect: Some(Duration::from_secs(15)),
        read: Some(Duration::from_secs(40)),
    };
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("isolated port");
    let address = listener.local_addr().expect("isolated address");
    let app = Router::new().fallback(any(proxy_handler)).with_state(state);
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(60))
        .build()
        .expect("local client");
    let session_id = uuid::Uuid::new_v4().to_string();
    let turn_id = uuid::Uuid::new_v4().to_string();
    let installation_id = uuid::Uuid::new_v4().to_string();
    let window_id = format!("{session_id}:0");
    let turn_metadata = json!({
        "session_id": session_id, "thread_id": session_id, "turn_id": turn_id,
        "installation_id": installation_id, "window_id": window_id,
        "request_kind": "turn", "thread_source": "user",
        "turn_started_at_unix_ms": Utc::now().timestamp_millis()
    })
    .to_string();
    let mut request = json!({
        "model": model,
        "input": [
            {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "Connectivity test. Do not use tools. Reply with only the answer."}]},
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "What is 19 times 23?"}]}
        ],
        "tool_choice": "auto", "parallel_tool_calls": false,
        "reasoning": {"effort": "low", "context": "all_turns"},
        "store": false, "stream": true, "max_output_tokens": 1024,
        "text": {"verbosity": "low"}, "include": ["reasoning.encrypted_content"],
        "prompt_cache_key": session_id,
        "client_metadata": {
            "session_id": session_id, "thread_id": session_id, "turn_id": turn_id,
            "x-codex-installation-id": installation_id,
            "x-codex-window-id": window_id, "x-codex-turn-metadata": turn_metadata
        }
    });
    let mut captured_headers = HeaderMap::new();
    let mut use_captured_headers = false;
    if let Ok(path) = std::env::var("AI_SWITCH_LIVE_RESPONSES_FIXTURE") {
        use_captured_headers = true;
        let fixture: Value = serde_json::from_slice(&std::fs::read(path).expect("read fixture"))
            .expect("fixture JSON");
        request = fixture.get("body").cloned().expect("fixture body");
        request["model"] = json!(model);
        for name in [
            "user-agent",
            "originator",
            "accept",
            "x-codex-beta-features",
            "x-codex-window-id",
            "x-codex-turn-metadata",
            "x-client-request-id",
            "session-id",
            "thread-id",
            "x-openai-internal-codex-responses-lite",
        ] {
            if let Some(value) = fixture["headers"][name].as_str() {
                captured_headers.insert(
                    HeaderName::from_static(name),
                    HeaderValue::from_str(value).expect("fixture header"),
                );
            }
        }
    }
    let mut completed = Vec::new();
    let phases = if proactive_cleanup {
        vec!["baseline", "encrypted-replay", "encrypted-replay-again"]
    } else {
        vec!["baseline", "encrypted-replay"]
    };
    for phase in &phases {
        let builder = client
            .post(format!("http://{address}/v1/responses"))
            .bearer_auth(&route_key);
        let builder = if use_captured_headers {
            builder.headers(captured_headers.clone())
        } else {
            builder
                .header("user-agent", client_identity::codex_cli_user_agent())
                .header("originator", client_identity::CODEX_CLI_ORIGINATOR)
                .header("accept", "text/event-stream")
                .header("x-openai-internal-codex-responses-lite", "true")
                .header("x-codex-beta-features", "remote_compaction_v2")
                .header("x-codex-window-id", &window_id)
                .header("x-codex-turn-metadata", &turn_metadata)
                .header("x-client-request-id", &session_id)
                .header("session-id", &session_id)
                .header("thread-id", &session_id)
        };
        let response = builder
            .json(&request)
            .send()
            .await
            .expect("isolated live response");
        let status = response.status();
        let bytes = response.bytes().await.expect("live response body");
        let result = completed_response(&bytes);
        eprintln!(
            "live phase={phase} http={status} completed={} session={session_id}",
            result.is_some()
        );
        let Some(result) = result else { break };
        let has_text = result["output"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["content"].as_array().is_some_and(|content| {
                    content.iter().any(|part| {
                        part["type"] == "output_text"
                            && part["text"].as_str().is_some_and(|text| !text.is_empty())
                    })
                })
            })
        });
        if !has_text {
            eprintln!("live phase={phase} completed response has no text output");
            break;
        }
        completed.push(result);
        if *phase == "baseline" {
            request["input"].as_array_mut().unwrap().insert(0, json!({
                "type": "reasoning", "id": "rs_replayed_probe", "summary": [],
                "encrypted_content": "gAAAAABforeign-encrypted-content-for-isolated-recovery-test"
            }));
        }
    }
    server.abort();
    let _ = server.await;
    let records: Vec<String> =
        sqlx::query_scalar("SELECT metadata_json FROM usage_events ORDER BY created_at")
            .fetch_all(&pool)
            .await
            .expect("isolated events");
    let mut statuses = Vec::new();
    let mut errors = Vec::new();
    for record in records {
        let metadata: Value = serde_json::from_str(&record).expect("event metadata");
        let response: Value = metadata["response_body"]
            .as_str()
            .and_then(|body| serde_json::from_str(body).ok())
            .unwrap_or(Value::Null);
        let code = response
            .pointer("/error/code")
            .and_then(Value::as_str)
            .unwrap_or("");
        let message = response
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("");
        let request_id = message
            .split("request id: ")
            .nth(1)
            .and_then(|tail| tail.split(')').next())
            .unwrap_or("");
        let failure_message = metadata["error_message"]
            .as_str()
            .unwrap_or("")
            .replace(api_key, "[REDACTED]");
        let error_preview = if metadata["success"] == false {
            metadata["response_body"]
                .as_str()
                .unwrap_or("")
                .replace(api_key, "[REDACTED]")
                .chars()
                .take(400)
                .collect::<String>()
        } else {
            String::new()
        };
        eprintln!("live upstream status={} code={code} request_id={request_id} error={failure_message} body={error_preview}", metadata["status"]);
        statuses.push(metadata["status"].as_u64().unwrap_or(0));
        errors.push(code.to_string());
    }
    assert_eq!(
        completed.len(),
        phases.len(),
        "live baseline and recovered request must both complete"
    );
    if proactive_cleanup {
        assert_eq!(
            statuses,
            vec![200, 200, 200],
            "each request must succeed without retry"
        );
        assert!(errors.iter().all(String::is_empty));
    } else {
        assert_eq!(
            statuses,
            vec![200, 400, 200],
            "must observe one rewrite retry"
        );
        assert_eq!(errors[1], "invalid_encrypted_content");
    }
    let account = RouteCredentialRepository::get(&pool, &credential.id)
        .await
        .expect("isolated account");
    assert_eq!(account.status, "ok");
    assert_eq!(account.transient_failure_count, 0);
}

#[tokio::test]
#[ignore = "requires explicit live Responses DB, AgentRouter credential and model env vars; uses upstream quota"]
async fn live_agentrouter_brotli_workbuddy() {
    let (model, config_json, secret_json) = read_live_responses_credential().await;
    let mut config: Value = serde_json::from_str(&config_json).expect("credential config");
    assert_eq!(config["interface_format"], "openai-responses");
    assert_eq!(
        url::Url::parse(config["base_url"].as_str().expect("base URL"))
            .expect("valid base URL")
            .host_str(),
        Some("ps.air-outer.com"),
        "only the verified AgentRouter endpoint may receive this probe"
    );
    config["failure_policy"] = json!({"retry_count": 0});
    config["request_brotli_compression"] = json!("auto");
    let pool = create_memory_pool().await.expect("isolated pool");
    run_migrations(&pool).await.expect("isolated migrations");
    let credential = RouteCredentialRepository::create(
        &pool,
        "codex",
        "api",
        "live-agentrouter-compat",
        None,
        "ok",
        None,
        &secret_json,
        &config.to_string(),
        "{}",
    )
    .await
    .expect("isolated credential");
    RoutePoolRepository::replace_members(&pool, "codex", std::slice::from_ref(&credential.id))
        .await
        .expect("isolated membership");
    let route_key = RouteProxyKeyRepository::ensure_platform_key(
        &pool,
        "codex",
        "sk-ai-switch-live-agentrouter-probe",
    )
    .await
    .expect("isolated route key");
    let runtime = RouteProxyRuntimeState::default();
    let mut state = build_proxy_state(pool.clone(), &runtime);
    state.upstream_timeouts = OutboundTimeouts {
        total: Some(Duration::from_secs(45)),
        connect: Some(Duration::from_secs(15)),
        read: Some(Duration::from_secs(30)),
    };
    let log = state.live_log.clone();
    let mut headers = HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    headers.insert("user-agent", HeaderValue::from_static("WorkBuddy/5.7.6"));
    headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {route_key}")).unwrap(),
    );
    let command = "ls -la; echo \"-----\"; ls -la";
    let request = json!({
        "model": model, "stream": true, "max_tokens": 128,
        "messages": [
            {"role": "system", "content": "Reply with exactly OK. These tool calls are historical diagnostic examples, not commands to execute."},
            {"role": "user", "content": "Review the recorded example and reply OK."},
            {"role": "assistant", "content": null, "tool_calls": [{
                "id": "call_ai_switch_waf_compat", "type": "function",
                "function": {"name": "Bash", "arguments": json!({"command": command}).to_string()}
            }]},
            {"role": "tool", "tool_call_id": "call_ai_switch_waf_compat", "content": "Recorded example only. No command was executed."},
            {"role": "user", "content": "Reply only OK."}
        ]
    });
    let response = proxy_handler(
        AxumState(state),
        Method::POST,
        headers,
        "/v1/chat/completions".parse().unwrap(),
        Body::from(serde_json::to_vec(&request).unwrap()),
    )
    .await;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("client response body");
    eprintln!(
        "AgentRouter live compatibility: HTTP {status}, {} response bytes",
        bytes.len()
    );
    if status != StatusCode::OK {
        let secret: Value = serde_json::from_str(&secret_json).expect("credential secret");
        let api_key = secret["api_key"].as_str().expect("API key");
        let error_preview = String::from_utf8_lossy(&bytes)
            .replace(api_key, "[REDACTED]")
            .chars()
            .take(500)
            .collect::<String>();
        eprintln!("AgentRouter live failure: {error_preview}");
    }
    assert_eq!(
        status,
        StatusCode::OK,
        "the unmodified historical command must succeed"
    );
    let body = std::str::from_utf8(&bytes).expect("readable client stream");
    let text = body
        .lines()
        .filter_map(|line| {
            serde_json::from_str::<Value>(line.trim().strip_prefix("data:")?.trim()).ok()
        })
        .filter_map(|event| {
            event
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect::<String>();
    assert_eq!(text.trim(), "OK");
    let entry = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(entry) = log
                .snapshot()
                .into_iter()
                .find(|entry| entry.credential_id == credential.id)
            {
                break entry;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("completed live log");
    assert!(entry.success);
    assert_eq!(entry.upstream_model.as_deref(), Some(model.as_str()));
    assert_eq!(entry.bridge.as_deref(), Some("ChatToResponses"));
    assert!(entry
        .upstream_headers
        .as_deref()
        .unwrap()
        .contains("content-encoding: br"));
    let logged: Value = serde_json::from_str(entry.upstream_request.as_deref().unwrap())
        .expect("upstream log must remain decoded JSON, not compressed bytes");
    let call = logged["input"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["type"] == "function_call")
        .expect("historical tool call");
    let arguments: Value = serde_json::from_str(call["arguments"].as_str().unwrap()).unwrap();
    assert_eq!(arguments["command"], command);
    let account = RouteCredentialRepository::get(&pool, &credential.id)
        .await
        .expect("isolated account");
    assert_eq!(account.status, "ok");
    assert_eq!(account.transient_failure_count, 0);
}
