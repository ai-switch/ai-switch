use super::*;

fn event(value: Value) -> String {
    format!("data: {value}\n\n")
}

fn created(id: &str) -> String {
    event(json!({"type":"response.created","sequence_number":0,
        "response":{"id":id,"status":"in_progress","object":"response"}}))
}

fn message(id: &str, index: u64, sequence: u64, text: &str, done: bool) -> Vec<String> {
    let item = json!({"id":id,"type":"message","role":"assistant",
        "status":"in_progress","content":[]});
    let mut events = vec![
        event(
            json!({"type":"response.output_item.added","sequence_number":sequence,
            "output_index":index,"item":item}),
        ),
        event(
            json!({"type":"response.output_text.delta","sequence_number":sequence+1,
            "output_index":index,"item_id":id,"content_index":0,"delta":text}),
        ),
    ];
    if done {
        events.push(event(
            json!({"type":"response.output_item.done","sequence_number":sequence+2,
            "output_index":index,"item":{"id":id,"type":"message","role":"assistant",
                "status":"completed","content":[{"type":"output_text","text":text}]}}),
        ));
    }
    events
}

fn call(id: &str, index: u64, sequence: u64, done: bool) -> Vec<String> {
    let mut events = vec![
        event(
            json!({"type":"response.output_item.added","sequence_number":sequence,
            "output_index":index,"item":{"id":id,"type":"function_call",
                "call_id":format!("call_{id}"),"name":"read","arguments":""}}),
        ),
        event(
            json!({"type":"response.function_call_arguments.delta","sequence_number":sequence+1,
            "output_index":index,"item_id":id,"delta":if done { r#"{"path":"a.txt"}"# } else { r#"{"path":"# }}),
        ),
    ];
    if done {
        events.push(event(
            json!({"type":"response.output_item.done","sequence_number":sequence+2,
            "output_index":index,"item":{"id":id,"type":"function_call",
                "call_id":format!("call_{id}"),"name":"read","arguments":r#"{"path":"a.txt"}"#}}),
        ));
    }
    events
}

fn completed(id: &str, sequence: u64) -> String {
    event(
        json!({"type":"response.completed","sequence_number":sequence,
        "response":{"id":id,"status":"completed","output":[]}}),
    )
}

struct Fixture {
    response: Response,
    requests: Arc<std::sync::Mutex<Vec<Value>>>,
    server: tokio::task::JoinHandle<()>,
    gate: Arc<tokio::sync::Notify>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl Fixture {
    async fn body(&mut self) -> String {
        let body = std::mem::replace(self.response.body_mut(), Body::empty());
        String::from_utf8(
            axum::body::to_bytes(body, usize::MAX)
                .await
                .expect("body")
                .to_vec(),
        )
        .unwrap()
    }
}

async fn fixture(scripts: Vec<Vec<String>>, budget: u32) -> Fixture {
    fixture_request(
        scripts,
        budget,
        "openai-responses",
        json!([
            {"type":"function","name":"read","parameters":{"type":"object"}}
        ]),
    )
    .await
}

async fn fixture_request(
    scripts: Vec<Vec<String>>,
    budget: u32,
    dialect: &str,
    tools: Value,
) -> Fixture {
    let requests = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let recorded = requests.clone();
    let gate = Arc::new(tokio::sync::Notify::new());
    let upstream_gate = gate.clone();
    let app = Router::new().fallback(move |body: axum::body::Bytes| {
        let recorded = recorded.clone();
        let scripts = scripts.clone();
        let gate = upstream_gate.clone();
        async move {
            let index = {
                let mut requests = recorded.lock().unwrap();
                let index = requests.len();
                requests.push(serde_json::from_slice(&body).expect("request JSON"));
                index
            };
            let chunks = scripts
                .get(index)
                .unwrap_or_else(|| scripts.last().unwrap())
                .clone();
            let stream =
                futures_util::StreamExt::then(futures_util::stream::iter(chunks), move |chunk| {
                    let gate = gate.clone();
                    async move {
                        if chunk == "__CUT_TRANSPORT__" {
                            // 客户端确认前缀已经抵达后才断开，避免 Hyper 丢掉尚未 flush 的最后一块。
                            gate.notified().await;
                            return Err(std::io::Error::other("scripted upstream disconnect"));
                        }
                        if chunk == "__WAIT_FOR_DONE__" {
                            gate.notified().await;
                            return Ok::<_, std::io::Error>(axum::body::Bytes::from_static(
                                b": released\n\n",
                            ));
                        }
                        // 保证 prime 只读取开头，失败帧与断点确实发生在流式透传之后。
                        tokio::time::sleep(Duration::from_millis(2)).await;
                        Ok::<_, std::io::Error>(axum::body::Bytes::from(chunk))
                    }
                });
            Response::builder()
                .header("content-type", "text/event-stream")
                .body(Body::from_stream(stream))
                .unwrap()
        }
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let upstream = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let first = create_proxy_api_credential_with_config(
        &pool,
        "first",
        &upstream,
        json!({"interface_format":dialect,"responses_custom_tool_compat":true}),
    )
    .await;
    let second = create_proxy_api_credential_with_config(
        &pool,
        "second",
        &upstream,
        json!({"interface_format":dialect,"responses_custom_tool_compat":true}),
    )
    .await;
    RoutePoolRepository::replace_members(&pool, "codex", &[first.clone(), second.clone()])
        .await
        .unwrap();
    let runtime = RouteProxyRuntimeState::default();
    runtime.set_stream_continue_max(budget);
    let state = build_proxy_state(pool, &runtime)
        .with_access_scope(PlatformId::Codex, HashSet::from([first, second]));
    let response = proxy_handler(
        AxumState(state),
        Method::POST,
        HeaderMap::new(),
        "/v1/responses".parse().unwrap(),
        Body::from(
            json!({
                "model":"gpt-6-astra","stream":true,"reasoning":{"effort":"high"},
                "input":[{"role":"user","content":"读 a.txt"}],
                "tools":tools
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    Fixture {
        response,
        requests,
        server,
        gate,
    }
}

fn assert_increasing_sequences(body: &str) {
    let seqs: Vec<_> = responses_events(body)
        .iter()
        .filter_map(|ev| ev["sequence_number"].as_u64())
        .collect();
    assert!(
        seqs.windows(2).all(|pair| pair[0] < pair[1]),
        "乱序: {body}"
    );
}

#[tokio::test]
async fn primary_tool_cut_without_text_is_held_and_reissued() {
    let mut first = vec![created("r1")];
    first.extend(call("partial_tool", 0, 1, false));
    let mut second = vec![created("r2")];
    second.extend(call("complete_tool", 0, 1, true));
    second.push(completed("r2", 4));
    let mut f = fixture(vec![first, second], 2).await;
    let body = f.body().await;
    assert!(
        !body.contains("partial_tool"),
        "首次流泄漏了半截调用: {body}"
    );
    assert!(body.contains("complete_tool"), "应重新生成完整调用: {body}");
    assert_eq!(f.requests.lock().unwrap().len(), 2);
    assert_increasing_sequences(&body);
}

#[tokio::test]
async fn primary_tool_cut_with_budget_zero_never_leaks_arguments() {
    let mut first = vec![created("r1")];
    first.extend(call("partial_tool", 0, 1, false));
    let mut f = fixture(vec![first], 0).await;
    let body = f.body().await;
    assert!(
        !body.contains("partial_tool"),
        "关闭续写也不能提交半截调用: {body}"
    );
    assert!(!body.contains("response.completed"));
    assert_eq!(f.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn completed_primary_items_do_not_trigger_a_redundant_continuation() {
    let mut first = vec![created("r1")];
    first.extend(message("m1", 0, 1, "完整回答", true));
    let mut f = fixture(vec![first], 2).await;
    let body = f.body().await;
    assert_eq!(
        f.requests.lock().unwrap().len(),
        1,
        "只缺收尾不能再请求模型: {body}"
    );
    assert_eq!(body.matches("response.completed").count(), 1);
}

#[tokio::test]
async fn every_interrupted_text_round_is_closed_before_the_next_item() {
    let mut scripts = Vec::new();
    for (round, text) in ["第一段", "第二段", "第三段"].iter().enumerate() {
        let rid = format!("r{round}");
        let mut frames = vec![created(&rid)];
        frames.extend(message(&format!("m{round}"), 0, 1, text, round == 2));
        if round == 2 {
            frames.push(completed(&rid, 4));
        }
        scripts.push(frames);
    }
    let mut f = fixture(scripts, 2).await;
    let body = f.body().await;
    let events = responses_events(&body);
    let done: Vec<_> = events
        .iter()
        .filter(|ev| ev["type"] == "response.output_item.done")
        .collect();
    assert_eq!(done.len(), 3, "每轮文本都必须提交: {body}");
    for (i, text) in ["第一段", "第二段", "第三段"].iter().enumerate() {
        assert_eq!(done[i]["item"]["content"][0]["text"], *text);
        assert_eq!(done[i]["output_index"], i);
    }
    assert_increasing_sequences(&body);
    let requests = f.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[2].to_string().contains("第一段第二段"));
    assert_eq!(requests[2]["reasoning"]["effort"], "high");
}

#[tokio::test]
async fn primary_call_is_invisible_until_its_done_event_arrives() {
    let mut frames = vec![created("root")];
    let call_frames = call("complete_tool", 0, 1, true);
    frames.extend_from_slice(&call_frames[..2]);
    frames.push("__WAIT_FOR_DONE__".into());
    frames.push(call_frames[2].clone());
    frames.push(completed("root", 4));
    let mut f = fixture(vec![frames], 0).await;
    let mut stream = std::mem::replace(f.response.body_mut(), Body::empty()).into_data_stream();
    let first = futures_util::StreamExt::next(&mut stream)
        .await
        .unwrap()
        .unwrap();
    assert!(!String::from_utf8_lossy(&first).contains("complete_tool"));
    assert!(
        tokio::time::timeout(
            Duration::from_millis(60),
            futures_util::StreamExt::next(&mut stream)
        )
        .await
        .is_err(),
        "done 到达前不应放行工具的 added/delta"
    );
    f.gate.notify_one();
    let mut output = first.to_vec();
    while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
        output.extend(chunk.unwrap());
    }
    let body = String::from_utf8(output).unwrap();
    let events = responses_events(&body);
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "response.output_item.added")
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "response.output_item.done")
            .count(),
        1
    );
}

#[tokio::test]
async fn primary_interleaved_tools_are_not_dropped_or_reordered() {
    let a = call("a", 0, 1, true);
    let b = call("b", 1, 2, true);
    let frames = [
        created("root"),
        a[0].clone(),
        b[0].clone(),
        a[1].clone(),
        b[1].clone(),
        b[2].clone(),
        a[2].clone(),
        completed("root", 7),
    ];
    let frames: Vec<_> = frames
        .iter()
        .enumerate()
        .map(|(seq, frame)| {
            let mut value: Value =
                serde_json::from_str(frame.trim().trim_start_matches("data: ")).unwrap();
            value["sequence_number"] = seq.into();
            event(value)
        })
        .collect();
    let expected = frames.concat();
    let mut f = fixture(vec![frames], 2).await;
    assert_eq!(f.body().await, expected, "健康流不应变化");
    assert_eq!(f.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_cut_after_a_committed_tool_never_replays_that_call() {
    let mut frames = vec![created("root")];
    frames.extend(call("committed", 0, 1, true));
    frames.extend(message("m", 1, 4, "调用已经发出", false));
    let mut f = fixture(vec![frames], 2).await;
    let body = f.body().await;
    assert_eq!(
        f.requests.lock().unwrap().len(),
        1,
        "缺少工具结果时重发会重复执行副作用"
    );
    assert_eq!(body.matches("response.output_item.done").count(), 1);
    assert!(!body.contains("response.completed"));
}

#[tokio::test]
async fn explicit_failure_is_not_continued_or_replaced_by_success() {
    let mut frames = vec![created("root")];
    frames.extend(message("m", 0, 1, "半句", true));
    frames.push(event(json!({"type":"response.failed","sequence_number":4,
        "response":{"id":"root","status":"failed","error":{"message":"upstream failed"}}})));
    let mut f = fixture(vec![frames], 2).await;
    let body = f.body().await;
    assert!(body.contains("response.failed"));
    assert!(!body.contains("response.completed"));
    assert_eq!(f.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn encrypted_reasoning_cut_stops_on_primary_and_resumed_streams() {
    for in_resume in [false, true] {
        let mut cut = vec![created("encrypted")];
        cut.push(event(json!({"type":"response.output_item.added","sequence_number":1,
            "output_index":0,"item":{"id":"rs","type":"reasoning","encrypted_content":"incomplete"}})));
        let mut scripts = Vec::new();
        if in_resume {
            let mut first = vec![created("root")];
            first.extend(message("m", 0, 1, "半句", false));
            scripts.push(first);
        }
        scripts.push(cut);
        let mut f = fixture(scripts, 3).await;
        let body = f.body().await;
        assert!(
            !body.contains("encrypted_content"),
            "半截密文不可转发: {body}"
        );
        assert!(!body.contains("response.completed"));
        assert_eq!(
            f.requests.lock().unwrap().len(),
            if in_resume { 2 } else { 1 }
        );
    }
}

#[tokio::test]
async fn partial_json_tails_never_join_the_next_upstream_stream() {
    let mut first = vec![created("root")];
    first.extend(message("m1", 0, 1, "前半句", false));
    first.push("data: {\"type\":\"response.output_text.delta\",\"delta\":\"被截".into());
    let mut last = vec![created("last")];
    last.extend(message("m2", 0, 1, "后半句", true));
    last.push(completed("last", 4).trim_end().to_owned());
    let mut f = fixture(vec![first, last], 2).await;
    let body = f.body().await;
    assert!(!body.contains("被截"));
    assert!(body.contains("response.completed"));
    assert_eq!(
        responses_events(&body)
            .iter()
            .filter(|e| e["type"] == "response.output_item.done")
            .count(),
        2
    );
    assert_increasing_sequences(&body);
}

#[tokio::test]
async fn primary_open_text_survives_an_interleaved_unfinished_tool() {
    let mut first = vec![created("root")];
    first.extend(message("before_tool", 0, 1, "工具前的正文", false));
    first.extend(call("partial_tool", 1, 3, false));
    let mut last = vec![created("last")];
    last.extend(message("after_tool", 0, 1, "接着回答", true));
    last.push(completed("last", 4));
    let mut f = fixture(vec![first, last], 2).await;
    let body = f.body().await;
    let events = responses_events(&body);
    assert!(!body.contains("partial_tool"));
    assert!(
        events
            .iter()
            .any(|e| e["type"] == "response.output_item.done"
                && e["item"]["id"] == "before_tool"
                && e["item"]["content"][0]["text"] == "工具前的正文"),
        "新工具不能覆盖尚未收尾的文本 item: {body}"
    );
    assert_increasing_sequences(&body);
}

#[tokio::test]
async fn continuation_restores_custom_tool_types_before_commit() {
    let mut first = vec![created("root")];
    first.extend(message("m", 0, 1, "先说一句", false));
    let mut last = vec![created("last")];
    last.extend(call("custom_read", 0, 1, true));
    last.push(completed("last", 4));
    let mut f = fixture_request(
        vec![first, last],
        2,
        "openai-responses",
        json!([
            {"type":"custom","name":"read","description":"Read a file"}
        ]),
    )
    .await;
    let body = f.body().await;
    let events = responses_events(&body);
    let done = events
        .iter()
        .find(|e| e["type"] == "response.output_item.done" && e["item"]["id"] == "custom_read")
        .unwrap();
    assert_eq!(
        done["item"]["type"], "custom_tool_call",
        "续写不能跳过工具类型恢复: {body}"
    );
    assert!(done["item"].get("input").is_some());
}

#[tokio::test]
async fn a_partial_chat_tool_never_gets_synthesized_done_or_reused_arguments() {
    let frames = vec![
        event(
            json!({"id":"chat1","choices":[{"index":0,"delta":{"role":"assistant","content":"先说明"}}]}),
        ),
        event(
            json!({"id":"chat1","choices":[{"index":0,"delta":{"tool_calls":[
                {"index":0,"id":"partial_tool","type":"function","function":{"name":"read","arguments":"{"}}
            ]}}]}),
        ),
    ];
    let mut f = fixture_request(
        vec![frames],
        2,
        "openai",
        json!([
            {"type":"function","name":"read","parameters":{"type":"object"}}
        ]),
    )
    .await;
    let body = f.body().await;
    assert!(
        !body.contains("partial_tool"),
        "Chat 桥也不能把半截调用标成完成: {body}"
    );
    assert!(!body.contains("response.completed"));
    assert_eq!(
        f.requests.lock().unwrap().len(),
        1,
        "Chat 桥没有回滚工具参数的接口，必须保守停止"
    );
}

#[tokio::test]
async fn chat_reasoning_does_not_hold_back_ordinary_text_until_stream_end() {
    let frames = vec![
        event(
            json!({"id":"chat1","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"想一想"}}]}),
        ),
        event(json!({"id":"chat1","choices":[{"index":0,"delta":{"content":"正文要立即出现"}}]})),
        "__WAIT_FOR_DONE__".into(),
        event(json!({"id":"chat1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]})),
    ];
    let mut f = fixture_request(vec![frames], 0, "openai", json!([])).await;
    let mut stream = std::mem::replace(f.response.body_mut(), Body::empty()).into_data_stream();
    let text = tokio::time::timeout(Duration::from_millis(100), async {
        let mut output = String::new();
        while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
            output.push_str(&String::from_utf8_lossy(&chunk.unwrap()));
            if output.contains("正文要立即出现") {
                break;
            }
        }
        output
    })
    .await;
    f.gate.notify_one();
    assert!(
        text.is_ok(),
        "Chat 的明文 reasoning 在 finish 才发 done，不能因此把整条回答变成缓冲输出"
    );
}

#[tokio::test]
async fn transport_errors_close_the_text_seam_before_resuming() {
    let mut first = vec![created("root")];
    first.extend(message("before", 0, 1, "网络断前", false));
    first.push("__CUT_TRANSPORT__".into());
    let mut last = vec![created("last")];
    last.extend(message("after", 0, 1, "网络断后", true));
    last.push(completed("last", 4));
    let mut f = fixture(vec![first, last], 2).await;
    let mut stream = std::mem::replace(f.response.body_mut(), Body::empty()).into_data_stream();
    let mut body = String::new();
    tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
            body.push_str(&String::from_utf8_lossy(&chunk.unwrap()));
            if body.contains("网络断前") {
                break;
            }
        }
    })
    .await
    .expect("read prefix before cutting transport");
    assert!(body.contains("网络断前"));
    f.gate.notify_one();
    while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
        body.push_str(&String::from_utf8_lossy(&chunk.unwrap()));
    }
    assert_eq!(
        responses_events(&body)
            .iter()
            .filter(|e| e["type"] == "response.output_item.done")
            .count(),
        2
    );
    assert!(body.contains("网络断前") && body.contains("网络断后"));
    assert_eq!(f.requests.lock().unwrap().len(), 2);
    assert_increasing_sequences(&body);
}
