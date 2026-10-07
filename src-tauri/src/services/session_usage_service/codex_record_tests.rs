use super::*;
use serde_json::json;

const MODEL: &str = "anyrouter/gpt-6-astra";
fn context(turn: &str) -> String {
    json!({"type":"turn_context","payload":{"turn_id":turn,"model":MODEL}}).to_string()
}
fn counts(input: i64, cached: i64, write: i64, output: i64) -> Value {
    json!({"input_tokens":input,"cached_input_tokens":cached,"cache_write_input_tokens":write,"output_tokens":output})
}
fn record(id: &str, usage: Value, total: Value) -> String {
    json!({"type":"token_usage_record","timestamp":"2026-10-06T17:25:26.652Z","payload":{
        "response_id":id,"turn_id":"turn-a","usage":usage,"thread_token_usage":total}})
    .to_string()
}
fn legacy(total: Value) -> String {
    json!({"type":"event_msg","timestamp":"2026-10-06T17:25:28.034Z","payload":{"type":"token_count","info":{"total_token_usage":total}}}).to_string()
}
fn call(id: &str) -> String {
    json!({"type":"response_item","payload":{"type":"function_call","id":id}}).to_string()
}
fn parse(lines: &[String]) -> ParsedFile {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("rollout.jsonl");
    std::fs::write(&p, lines.join("\n") + "\n").unwrap();
    parse_codex_file(&p)
}

#[test]
fn real_response_id_wins_over_unrelated_item_ids_and_legacy_heartbeat() {
    let usage = counts(34394, 31555, 2836, 173);
    let parsed = parse(&[
        context("turn-a"),
        call("fc_0d41b7d9e8dee871016ac52f051eec8195982e47c3f20cbaf1"),
        record(
            "resp_0d41b7d9e8dee871016ac52f0033ac8195847fa51ff267326c",
            usage.clone(),
            usage.clone(),
        ),
        legacy(usage.clone()),
        legacy(usage),
    ]);
    assert_eq!(parsed.entries.len(), 1);
    let row = &parsed.entries[0];
    assert_eq!(
        row.response_id.as_deref(),
        Some("resp_0d41b7d9e8dee871016ac52f0033ac8195847fa51ff267326c")
    );
    assert_eq!(row.model, MODEL);
    assert_eq!(row.timestamp_ms, Some(1791307526652));
    // 保持现有会话统计口径，本次不另行修改缓存计费。
    assert_eq!(row.usage.input_tokens, 2839);
    assert_eq!(row.usage.cache_read_tokens, 31555);
    assert_eq!(row.usage.cache_write_tokens, 2836);
    assert_eq!(row.usage.output_tokens, 173);
}

#[test]
fn record_only_response_counts_immediately_and_deduplicates_by_response_id() {
    let usage = counts(100, 60, 0, 10);
    let r = record("resp-real", usage.clone(), usage);
    let parsed = parse(&[context("turn-a"), r.clone(), r]);
    assert_eq!(parsed.entries.len(), 1);
    assert_eq!(parsed.entries[0].response_id.as_deref(), Some("resp-real"));
    assert_eq!(parsed.entries[0].usage.input_tokens, 40);
}

#[test]
fn late_record_replaces_already_seen_legacy_snapshot() {
    let usage = counts(100, 60, 0, 10);
    let parsed = parse(&[
        context("turn-a"),
        call("fc_wrong"),
        legacy(usage.clone()),
        record("resp-real", usage.clone(), usage.clone()),
        legacy(usage),
    ]);
    assert_eq!(parsed.entries.len(), 1);
    assert_eq!(parsed.entries[0].response_id.as_deref(), Some("resp-real"));
}

#[test]
fn mixed_legacy_and_record_requests_keep_legacy_baselines_without_duplicates() {
    let parsed = parse(&[
        context("turn-a"),
        call("fc_old_0"),
        legacy(counts(100, 0, 0, 10)),
        call("fc_wrong"),
        record(
            "resp-modern",
            counts(200, 50, 0, 20),
            counts(300, 50, 0, 30),
        ),
        legacy(counts(300, 50, 0, 30)),
        context("turn-b"),
        call("fc_next_0"),
        legacy(counts(600, 100, 0, 60)),
    ]);
    assert_eq!(
        parsed
            .entries
            .iter()
            .map(|e| e.response_id.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("old"), Some("resp-modern"), Some("next")]
    );
    assert_eq!(
        parsed
            .entries
            .iter()
            .map(|e| e.usage.input_tokens)
            .collect::<Vec<_>>(),
        vec![100, 150, 250]
    );
}

#[test]
fn record_without_following_heartbeat_does_not_inflate_next_legacy_request() {
    let parsed = parse(&[
        context("turn-a"),
        record("resp-a", counts(100, 0, 0, 10), counts(100, 0, 0, 10)),
        context("turn-b"),
        call("fc_b_0"),
        legacy(counts(300, 0, 0, 30)),
    ]);
    assert_eq!(parsed.entries.len(), 2);
    assert_eq!(parsed.entries[1].usage.input_tokens, 200);
}

#[test]
fn consecutive_records_do_not_require_intermediate_token_count_events() {
    let parsed = parse(&[
        context("turn-a"),
        record("resp-a", counts(100, 20, 0, 10), counts(100, 20, 0, 10)),
        record("resp-b", counts(100, 20, 0, 10), counts(200, 40, 0, 20)),
        legacy(counts(200, 40, 0, 20)),
    ]);
    assert_eq!(parsed.entries.len(), 2);
    assert_eq!(
        parsed
            .entries
            .iter()
            .map(|r| r.usage.input_tokens)
            .sum::<i64>(),
        160
    );
}

#[test]
fn distinct_zero_usage_response_ids_still_count_as_distinct_requests() {
    let parsed = parse(&[
        context("turn-a"),
        record("resp-a", counts(0, 0, 0, 0), counts(0, 0, 0, 0)),
        record("resp-b", counts(0, 0, 0, 0), counts(0, 0, 0, 0)),
        legacy(counts(0, 0, 0, 0)),
    ]);
    assert_eq!(parsed.entries.len(), 2);
}

#[test]
fn invalid_or_idless_records_leave_legacy_fallback_intact() {
    for bad in [
        json!({"response_id":" ","usage":{"input_tokens":100,"output_tokens":10}}),
        json!({"response_id":"resp-a","usage":null}),
        json!({"response_id":"resp-a","usage":{"input_tokens":-5,"output_tokens":10},"thread_token_usage":{"input_tokens":100,"output_tokens":10}}),
        json!({"response_id":"resp-a","usage":{"input_tokens":"broken","output_tokens":10}}),
    ] {
        let bad = json!({"type":"token_usage_record","payload":bad}).to_string();
        let parsed = parse(&[
            context("turn-a"),
            call("fc_old_0"),
            bad,
            legacy(counts(100, 0, 0, 10)),
        ]);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].response_id.as_deref(), Some("old"));
    }
}

#[test]
fn parent_replay_is_not_charged_again_but_its_totals_advance_the_baseline() {
    let usage = counts(100, 0, 0, 10);
    let parsed = parse(&[
        json!({"type":"session_meta","payload":{"forked_from_id":"parent"}}).to_string(),
        record("resp-parent", usage.clone(), usage.clone()),
        legacy(usage),
        context("turn-a"),
        record("resp-child", counts(50, 0, 0, 5), counts(150, 0, 0, 15)),
        legacy(counts(150, 0, 0, 15)),
    ]);
    assert_eq!(parsed.entries.len(), 1);
    assert_eq!(parsed.entries[0].response_id.as_deref(), Some("resp-child"));
    assert_eq!(parsed.entries[0].usage.input_tokens, 50);
}

#[test]
fn counter_reset_and_model_change_keep_request_ids_and_current_model() {
    let parsed = parse(&[
        context("turn-a"),
        record("resp-a", counts(100, 0, 0, 10), counts(100, 0, 0, 10)),
        legacy(counts(100, 0, 0, 10)),
        json!({"type":"turn_context","payload":{"model":"other/model","turn_id":"turn-b"}})
            .to_string(),
        record("resp-b", counts(30, 0, 0, 3), counts(30, 0, 0, 3)),
        legacy(counts(30, 0, 0, 3)),
    ]);
    assert_eq!(parsed.entries.len(), 2);
    assert_eq!(parsed.entries[1].model, "other/model");
    assert_eq!(parsed.entries[1].usage.input_tokens, 30);
}

#[test]
fn screenshot_pairs_merge_by_real_id_despite_exact_mode_prefix_and_keep_failure() {
    use crate::models::route_pool::ProxyRequestRow;
    use crate::services::usage_overview_service::{merge_entries, UsageRowSource};
    let mut sessions = Vec::new();
    let mut proxies = Vec::new();
    for (id, input, cache, write, output) in [
        ("resp-19", 45531, 42401, 3127, 312),
        ("resp-26", 34394, 31555, 2836, 173),
    ] {
        let usage = counts(input, cache, write, output);
        let parsed = parse(&[
            context("turn-a"),
            call("fc_item-not-response"),
            record(id, usage.clone(), usage.clone()),
            legacy(usage),
        ]);
        sessions.extend(parsed.entries.into_iter().map(|e| SessionUsageEntry {
            provider: e.provider,
            model: e.model,
            response_id: e.response_id,
            timestamp_ms: e.timestamp_ms,
            usage: e.usage,
        }));
        proxies.push(ProxyRequestRow {
            id: format!("proxy-{id}"),
            platform: "codex".into(),
            account_id: Some("anyrouter-id".into()),
            account_name: Some("anyrouter".into()),
            source_label: "route_proxy".into(),
            metadata_json: json!({"status":200,"success":true,"upstream_model":"gpt-6-astra"})
                .to_string(),
            created_at: "2026-10-06T17:25:26Z".into(),
            input_tokens: Some(input),
            output_tokens: Some(output),
            cache_tokens: Some(cache),
            price_usd_micros: None,
            price_cny_micros: None,
            price_currency: None,
            price_source: None,
            upstream_response_id: Some(id.into()),
        });
    }
    let mut failure = proxies[0].clone();
    failure.id = "failed-attempt".into();
    failure.upstream_response_id = Some("resp-failure".into());
    failure.input_tokens = None;
    failure.output_tokens = None;
    failure.cache_tokens = None;
    failure.metadata_json=json!({"status":200,"success":false,"error_message":"stream disconnected before completion"}).to_string();
    proxies.push(failure);
    let merged = merge_entries(sessions, proxies);
    assert_eq!(merged.len(), 3, "两个成功请求只计两次，断流失败单独保留");
    assert_eq!(
        merged
            .iter()
            .filter(|r| r.source == UsageRowSource::Matched)
            .count(),
        2
    );
    assert_eq!(
        merged
            .iter()
            .filter(|r| r.source == UsageRowSource::SessionOnly)
            .count(),
        0
    );
    assert!(merged
        .iter()
        .any(|r| r.id == "failed-attempt" && r.source == UsageRowSource::ProxyOnly && !r.success));
    assert_eq!(merged.iter().map(|r| r.output_tokens).sum::<i64>(), 485);
}

#[test]
fn cross_file_duplicates_are_removed_and_appends_invalidate_cached_parses() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let first = dir.path().join("a.jsonl");
    let second = dir.path().join("b.jsonl");
    let usage = counts(100, 0, 0, 10);
    let body = [
        context("turn-a"),
        record("resp-shared", usage.clone(), usage.clone()),
        legacy(usage),
    ]
    .join("\n")
        + "\n";
    std::fs::write(&first, &body).unwrap();
    std::fs::write(&second, &body).unwrap();
    let mut seen = HashSet::new();
    let entries: [Arc<ParsedFile>; 2] = [
        parsed_file(&first, Provider::Codex),
        parsed_file(&second, Provider::Codex),
    ];
    let unique = entries
        .iter()
        .flat_map(|f| &f.entries)
        .filter(|e| seen.insert(e.dedup_key.clone()))
        .count();
    assert_eq!(unique, 1);
    let before = parsed_file(&first, Provider::Codex);
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&first)
        .unwrap();
    writeln!(
        file,
        "{}",
        record("resp-next", counts(20, 0, 0, 2), counts(120, 0, 0, 12))
    )
    .unwrap();
    drop(file);
    let after = parsed_file(&first, Provider::Codex);
    assert!(!Arc::ptr_eq(&before, &after));
    assert_eq!(after.entries.len(), 2);
    assert_eq!(after.entries[1].response_id.as_deref(), Some("resp-next"));
}

/// 手工验收：只读指定数据库和会话文件，不扫描或修改其他用户数据。
#[tokio::test]
#[ignore = "requires explicit read-only usage DB, rollouts and response IDs"]
async fn verify_live_codex_response_id_matching() {
    use crate::database::repositories::route_pool_repository::RoutePoolRepository;
    use crate::services::usage_overview_service::{merge_entries, UsageRowSource};
    let database = std::env::var("AI_SWITCH_USAGE_VERIFY_DB").expect("explicit database path");
    let paths: Vec<String> = serde_json::from_str(
        &std::env::var("AI_SWITCH_USAGE_VERIFY_ROLLOUTS").expect("explicit rollout paths"),
    )
    .unwrap();
    let expected: Vec<String> = serde_json::from_str(
        &std::env::var("AI_SWITCH_USAGE_VERIFY_IDS").expect("explicit response IDs"),
    )
    .unwrap();
    let since = std::env::var("AI_SWITCH_USAGE_VERIFY_SINCE").expect("inclusive start timestamp");
    let until = std::env::var("AI_SWITCH_USAGE_VERIFY_UNTIL").expect("exclusive end timestamp");
    let start = chrono::DateTime::parse_from_rfc3339(&since)
        .unwrap()
        .timestamp_millis();
    let end = chrono::DateTime::parse_from_rfc3339(&until)
        .unwrap()
        .timestamp_millis();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(database)
                .read_only(true)
                .create_if_missing(false),
        )
        .await
        .unwrap();
    let proxies = RoutePoolRepository::list_request_events(&pool, Some(&since))
        .await
        .unwrap()
        .into_iter()
        .filter(|p| {
            chrono::DateTime::parse_from_rfc3339(&p.created_at)
                .unwrap()
                .timestamp_millis()
                < end
        })
        .collect::<Vec<_>>();
    pool.close().await;
    let proxy_count = proxies.len();
    let mut seen = HashSet::new();
    let sessions = paths
        .iter()
        .flat_map(|p| parse_codex_file(Path::new(p)).entries)
        .filter(|e| e.timestamp_ms.is_some_and(|t| start <= t && t < end))
        .filter(|e| seen.insert(e.dedup_key.clone()))
        .map(|e| SessionUsageEntry {
            provider: e.provider,
            model: e.model,
            response_id: e.response_id,
            timestamp_ms: e.timestamp_ms,
            usage: e.usage,
        })
        .collect::<Vec<_>>();
    let session_count = sessions.len();
    let merged = merge_entries(sessions, proxies);
    for id in expected {
        let rows: Vec<_> = merged
            .iter()
            .filter(|r| r.upstream_response_id.as_deref() == Some(&id))
            .collect();
        assert_eq!(rows.len(), 1, "one row per response");
        let row = rows[0];
        assert_eq!(row.source, UsageRowSource::Matched);
        println!(
            "verified response={id} model={} output={} source=matched",
            row.model, row.output_tokens
        );
    }
    println!("read-only verification: sessions={session_count} proxy_attempts={proxy_count} merged_rows={} matched={} session_only={} proxy_only_failures={}",merged.len(),
        merged.iter().filter(|r|r.source==UsageRowSource::Matched).count(),
        merged.iter().filter(|r|r.source==UsageRowSource::SessionOnly).count(),
        merged.iter().filter(|r|r.source==UsageRowSource::ProxyOnly&&!r.success).count());
}

#[test]
fn late_records_after_aggregate_heartbeat_do_not_regress_cumulative_baseline() {
    let parsed = parse(&[
        context("turn-a"),
        call("fc_wrong"),
        legacy(counts(300, 0, 0, 30)),
        record("resp-a", counts(100, 0, 0, 10), counts(100, 0, 0, 10)),
        record("resp-b", counts(200, 0, 0, 20), counts(300, 0, 0, 30)),
        legacy(counts(300, 0, 0, 30)),
        call("fc_next_0"),
        legacy(counts(400, 0, 0, 40)),
    ]);
    assert_eq!(parsed.entries.len(), 3);
    assert_eq!(
        parsed
            .entries
            .iter()
            .map(|r| r.usage.input_tokens)
            .sum::<i64>(),
        400
    );
    assert_eq!(parsed.entries[2].usage.input_tokens, 100);
}

#[test]
fn incomplete_record_keeps_legacy_and_foreign_payloads_cannot_inject_records() {
    let malformed=json!({"type":"token_usage_record","payload":{"response_id":"resp-unusable","usage":{"input_tokens":100,"output_tokens":10}}}).to_string();
    let tool_output=json!({"type":"response_item","payload":{"type":"function_call_output","output":{"type":"token_usage_record","response_id":"not-real","usage":{"input_tokens":1,"output_tokens":1}}}}).to_string();
    let parsed = parse(&[
        context("turn-a"),
        call("fc_legacy_0"),
        malformed,
        tool_output,
        legacy(counts(100, 0, 0, 10)),
    ]);
    assert_eq!(parsed.entries.len(), 1);
    assert_eq!(parsed.entries[0].response_id.as_deref(), Some("legacy"));
}
