//! The diagnostics export: everything needed to explain a proxied request after
//! the fact, packed into one file a user can send.
//!
//! The bundle is brotli-compressed JSONL and self-describing — a `meta` line, a
//! `pool` line, then one `live_log_entry` line per recorded request. JSONL rather
//! than one big object because the live log is the bulk of it and a reader can
//! then work through it a line at a time; the `kind` field is what lets a later
//! version add sections without breaking an older reader.
//!
//! Two properties the shape is built around:
//!
//! * **No secrets.** The live-log stages are redacted where they are captured,
//!   and the settings summary replaces the two fields that carry credentials.
//!   The pool summary selects individual columns instead of loading
//!   `RouteCredential` rows, because those carry `secret_payload_json` and a
//!   `#[derive(Serialize)]` is one refactor away from shipping it.
//! * **Bounded memory.** A full window is ~146 MB of JSON — the ceiling, four
//!   64 KB stages on each of 1000 entries, is 256 MB. Reading it is cheap
//!   because the ring stores entries behind an `Arc`: [`RouteProxyLiveLog::snapshot`]
//!   is a refcount bump per entry, not a deep copy (it *was* a deep copy, and
//!   cost ~70 ms on a full window while holding the lock the request path needs).
//!   Streaming the snapshot into the compressor a line at a time then keeps the
//!   peak at *ring + compressed output*, rather than *ring + a second full-size
//!   JSON string + compressed output*.

use crate::error::AppError;
use crate::models::settings::AppSettings;
use crate::paths::AppPaths;
use crate::services::brotli_codec;
use crate::services::route_proxy_live_log::{
    RouteProxyLiveLog, RouteProxyLiveLogEntry, LIVE_LOG_CAPACITY, LIVE_LOG_FILE_NAME,
    LIVE_LOG_STAGE_LIMIT,
};
use crate::services::settings_service::SettingsService;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::Arc;
use url::Url;

/// Bumped when a reader would have to change to understand the bundle.
pub const DIAGNOSTICS_FORMAT_VERSION: u32 = 1;

/// The save dialog's extension filter, and the fallback suffix for a name the
/// user typed without one.
pub const DIAGNOSTICS_FILE_EXTENSION: &str = "br";

/// How much of an upstream failure message to keep. Long enough for a real
/// gateway error, short enough that a response body echoed into the message
/// cannot take over the bundle.
const DIAGNOSTICS_FAILURE_MESSAGE_LIMIT: usize = 512;

pub struct DiagnosticsBundle {
    /// Brotli-compressed JSONL, ready to write.
    pub bytes: Vec<u8>,
    /// Size before compression, so the UI can say how much was packed.
    pub raw_bytes: usize,
    pub entries: usize,
}

/// Assemble the bundle for `live_log`, `paths` and the configured pool.
pub async fn build(
    pool: &SqlitePool,
    paths: &AppPaths,
    live_log: &RouteProxyLiveLog,
) -> Result<DiagnosticsBundle, AppError> {
    // Handles, not copies: the ring holds the entries behind an `Arc`, so reading
    // the whole window is a refcount bump rather than a ~146 MB deep copy. It is
    // still taken under the live-log lock, which `record` also takes from the
    // request path — but that is now microseconds instead of the ~70 ms measured
    // when this cloned every entry.
    let entries = live_log.snapshot();
    let entry_count = entries.len();
    let meta = json!({
        "kind": "meta",
        "format_version": DIAGNOSTICS_FORMAT_VERSION,
        "generated_at": chrono::Local::now().to_rfc3339(),
        "app": {
            "name": env!("CARGO_PKG_NAME"),
            "version": env!("CARGO_PKG_VERSION"),
            // Worth recording: a report from a `tauri dev` build is diagnosed
            // against different code than one from the installer.
            "debug_build": cfg!(debug_assertions),
        },
        "os": {
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "live_log": {
            "capacity": LIVE_LOG_CAPACITY,
            "stage_limit_bytes": LIVE_LOG_STAGE_LIMIT,
            "file_name": LIVE_LOG_FILE_NAME,
            "entries": entry_count,
            "summary": summarize(&entries),
        },
        "settings": match SettingsService::load(paths).await {
            Ok(settings) => settings_summary(&settings),
            Err(error) => json!({ "error": error.to_string() }),
        },
    });
    let pool_summary = pool_summary(pool).await;

    let (bytes, raw_bytes) =
        tokio::task::spawn_blocking(move || pack(&meta, &pool_summary, &entries))
            .await
            .map_err(|error| AppError::Filesystem {
                code: "diagnostics.pack_task_failed",
                message: "Could not build the diagnostics export".to_string(),
                details: Some(error.to_string()),
                recoverable: true,
            })??;

    Ok(DiagnosticsBundle {
        bytes,
        raw_bytes,
        entries: entry_count,
    })
}

/// Serialize the three sections and compress them.
fn pack(
    meta: &Value,
    pool_summary: &Value,
    entries: &[Arc<RouteProxyLiveLogEntry>],
) -> Result<(Vec<u8>, usize), AppError> {
    let mut raw_bytes = 0usize;
    let bytes = brotli_codec::compress_with(|out| {
        write_line(out, meta, &mut raw_bytes)?;
        write_line(out, pool_summary, &mut raw_bytes)?;
        for entry in entries {
            let line = json!({ "kind": "live_log_entry", "entry": entry });
            write_line(out, &line, &mut raw_bytes)?;
        }
        Ok(())
    })
    .map_err(|error| AppError::Filesystem {
        code: "diagnostics.compress_failed",
        message: "Could not compress the diagnostics export".to_string(),
        details: Some(error.to_string()),
        recoverable: true,
    })?;
    Ok((bytes, raw_bytes))
}

fn write_line(out: &mut dyn Write, value: &Value, raw_bytes: &mut usize) -> std::io::Result<()> {
    let line = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    out.write_all(&line)?;
    out.write_all(b"\n")?;
    *raw_bytes += line.len() + 1;
    Ok(())
}

/// Counts a reader wants before reading a thousand entries.
///
/// `unknown` is deliberately separate from `none`: an entry recorded before the
/// counter existed, or from a buffered reply, is not evidence that the upstream
/// stayed silent. See [`RouteProxyLiveLogEntry::upstream_reasoning_deltas`].
fn summarize(entries: &[Arc<RouteProxyLiveLogEntry>]) -> Value {
    let mut successes = 0usize;
    let mut bridged = 0usize;
    let mut reasoning_observed = 0usize;
    let mut reasoning_none = 0usize;
    let mut reasoning_unknown = 0usize;
    let mut truncated_stages: BTreeMap<&str, usize> = BTreeMap::new();

    for entry in entries {
        if entry.success {
            successes += 1;
        }
        if entry.bridge.is_some() {
            bridged += 1;
        }
        match entry.upstream_reasoning_deltas {
            Some(0) => reasoning_none += 1,
            Some(_) => reasoning_observed += 1,
            None => reasoning_unknown += 1,
        }
        for stage in &entry.truncated_stages {
            *truncated_stages.entry(stage.as_str()).or_default() += 1;
        }
    }

    json!({
        "successes": successes,
        "failures": entries.len() - successes,
        "bridged": bridged,
        "upstream_reasoning": {
            "observed": reasoning_observed,
            "none": reasoning_none,
            "unknown": reasoning_unknown,
        },
        "truncated_stages": truncated_stages,
    })
}

/// Settings as shipped, with the fields that carry credentials replaced.
///
/// `notification_config_json` holds webhook URLs and channel tokens, and
/// `proxy_url` may carry `user:password@`. Everything else is a preference
/// rather than a credential — and preferences are exactly what explains a
/// behaviour the user is reporting as a bug.
fn settings_summary(settings: &AppSettings) -> Value {
    let Ok(mut value) = serde_json::to_value(settings) else {
        return json!({ "error": "settings could not be serialized" });
    };
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    if let Some(raw) = object
        .get("notification_config_json")
        .and_then(Value::as_str)
    {
        object.insert(
            "notification_config_json".to_string(),
            notification_channels(raw),
        );
    }
    if let Some(raw) = object.get("proxy_url").and_then(Value::as_str) {
        object.insert(
            "proxy_url".to_string(),
            Value::String(redact_url_credentials(raw)),
        );
    }
    value
}

/// Which notification channels are configured, without their endpoints.
fn notification_channels(raw: &str) -> Value {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(object)) => Value::Array(
            object
                .into_iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, _)| Value::String(key))
                .collect(),
        ),
        Ok(_) => json!(["<not an object>"]),
        Err(_) => json!(["<unparseable>"]),
    }
}

/// Drop `user:password@` from a URL.
fn redact_url_credentials(raw: &str) -> String {
    let Ok(mut url) = Url::parse(raw) else {
        return raw.to_string();
    };
    if url.username().is_empty() && url.password().is_none() {
        return raw.to_string();
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.to_string()
}

/// One entry per configured account: enough to explain a routing decision, with
/// nothing that could be replayed against the upstream.
async fn pool_summary(pool: &SqlitePool) -> Value {
    // Both queries report their error instead of collapsing to an empty list.
    // "This platform has no accounts" and "this query no longer compiles against
    // the schema" are indistinguishable to the person reading the bundle, and
    // the second one is exactly the case the bundle exists to diagnose.
    let platforms = match sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT platform FROM route_credentials
         WHERE archived_at IS NULL
         ORDER BY platform",
    )
    .fetch_all(pool)
    .await
    {
        Ok(platforms) => platforms,
        Err(error) => {
            return json!({
                "kind": "pool",
                "platforms": [],
                "error": error.to_string(),
            })
        }
    };

    let mut summaries = Vec::new();
    for platform in platforms {
        let rows = match sqlx::query(
            "SELECT id, kind, display_name, status, batch_id, sort_order,
                    cooldown_until, last_failure_kind, last_failure_message,
                    transient_failure_count
             FROM route_credentials
             WHERE platform = ? AND archived_at IS NULL
             ORDER BY sort_order",
        )
        .bind(&platform)
        .fetch_all(pool)
        .await
        {
            Ok(rows) => rows,
            Err(error) => {
                summaries.push(json!({
                    "platform": platform,
                    "accounts": [],
                    "error": error.to_string(),
                }));
                continue;
            }
        };
        let accounts: Vec<Value> = rows
            .iter()
            .map(|row| {
                json!({
                    "id": row.get::<String, _>("id"),
                    "kind": row.get::<String, _>("kind"),
                    "name": row.get::<String, _>("display_name"),
                    "status": row.get::<String, _>("status"),
                    "batch_id": row.get::<Option<String>, _>("batch_id"),
                    "sort_order": row.get::<i64, _>("sort_order"),
                    "cooldown_until": row.get::<Option<String>, _>("cooldown_until"),
                    "last_failure_kind": row.get::<Option<String>, _>("last_failure_kind"),
                    "last_failure_message": clipped(
                        row.get::<Option<String>, _>("last_failure_message"),
                        DIAGNOSTICS_FAILURE_MESSAGE_LIMIT,
                    ),
                    "transient_failure_count": row.get::<i64, _>("transient_failure_count"),
                })
            })
            .collect();
        summaries.push(json!({ "platform": platform, "accounts": accounts }));
    }

    json!({ "kind": "pool", "platforms": summaries })
}

/// Truncate on a character boundary, keeping the dropped byte count visible.
fn clipped(value: Option<String>, limit: usize) -> Option<String> {
    let text = value?;
    if text.len() <= limit {
        return Some(text);
    }
    let mut end = limit;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    Some(format!(
        "{}…[{} bytes dropped]",
        &text[..end],
        text.len() - end
    ))
}

/// The file name the save dialog proposes.
pub fn suggested_file_name() -> String {
    format!(
        "ai-switch-diagnostics-{}.jsonl.{DIAGNOSTICS_FILE_EXTENSION}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> RouteProxyLiveLogEntry {
        RouteProxyLiveLogEntry {
            id: id.to_string(),
            trace_id: None,
            platform: "codex".to_string(),
            credential_id: "cred".to_string(),
            credential_name: "Cred".to_string(),
            attempt: 0,
            path: "/v1/messages".to_string(),
            target_url: None,
            upstream_headers: None,
            requested_model: Some("gpt-5".to_string()),
            upstream_model: None,
            status: Some(200),
            success: true,
            error_message: None,
            duration_ms: 1,
            bridge: None,
            client_request: Some("{\"input\":\"hi\"}".to_string()),
            upstream_request: None,
            upstream_response: None,
            final_response: None,
            upstream_reasoning_deltas: None,
            notes: Vec::new(),
            truncated: false,
            truncated_stages: Vec::new(),
            created_at: "now".to_string(),
        }
    }

    fn pack_lines(entries: &[RouteProxyLiveLogEntry]) -> Vec<Value> {
        let entries: Vec<Arc<RouteProxyLiveLogEntry>> =
            entries.iter().cloned().map(Arc::new).collect();
        let (bytes, _) =
            pack(&json!({"kind": "meta"}), &json!({"kind": "pool"}), &entries).expect("pack");
        let text =
            String::from_utf8(brotli_codec::decompress(&bytes).expect("decompress")).expect("utf8");
        text.lines()
            .map(|line| serde_json::from_str(line).expect("line"))
            .collect()
    }

    /// 导出包是 JSONL：一行一个 JSON 对象，第一行是 meta。
    #[test]
    fn bundle_is_jsonl_with_meta_first_and_one_line_per_entry() {
        let entries = vec![entry("a"), entry("b")];
        let lines = pack_lines(&entries);
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0]["kind"], "meta");
        assert_eq!(lines[1]["kind"], "pool");
        assert_eq!(lines[2]["kind"], "live_log_entry");
        assert_eq!(lines[2]["entry"]["id"], "a");
        assert_eq!(lines[3]["entry"]["id"], "b");
    }

    /// 每个条目都完整带上四个阶段——排错要的就是原始报文，导出不能顺手裁剪。
    #[test]
    fn every_entry_keeps_its_stage_bodies() {
        let mut entry = entry("a");
        entry.upstream_response = Some("raw upstream".to_string());
        entry.final_response = Some("final".to_string());
        entry.truncated_stages = vec!["upstream_response".to_string()];
        let lines = pack_lines(&[entry]);
        let packed = &lines[2]["entry"];
        assert_eq!(packed["client_request"], "{\"input\":\"hi\"}");
        assert_eq!(packed["upstream_response"], "raw upstream");
        assert_eq!(packed["final_response"], "final");
        assert_eq!(packed["truncated_stages"][0], "upstream_response");
    }

    /// 用户要的是「能当附件发出去」，所以压缩比是**需求**，不是实现细节。
    /// 压缩一旦被关掉、窗口被调小，包会大两个数量级，而别的功能测试全绿。
    ///
    /// 样本要照真实日志的冗余形状造，否则这条测试是自欺欺人：
    ///
    /// * 冗余是**长距离**的——同一段对话历史在多个条目里反复出现，中间隔着
    ///   几十 KB。起作用的是 4 MB 窗口，不是熵编码器多花的力气。
    /// * 所以历史段用**不可压的伪随机内容**（否则一整块相同字符会压到近乎零，
    ///   真实比值 119x 会变成假的 3000x，什么也守不住），每条只多一个短尾巴。
    ///
    /// 比值实测见下方阈值注释；样本是确定性的，所以比值稳定，不受运行环境影响。
    #[test]
    fn a_realistic_window_stays_small_enough_to_attach() {
        let history = noise(0x5eed, 8 * 1024);
        let entries: Vec<Arc<RouteProxyLiveLogEntry>> = (0..200)
            .map(|index| {
                let mut item = entry(&format!("e{index}"));
                // 共享的长前缀 + 每条独有的短尾巴：这正是真实窗口的样子。
                item.client_request = Some(format!("{history}{}", noise(index as u64, 64)));
                item.upstream_request = Some(format!("{history}{}", noise(index as u64, 64)));
                Arc::new(item)
            })
            .collect();

        let (bytes, raw) = pack(
            &json!({ "kind": "meta" }),
            &json!({ "kind": "pool" }),
            &entries,
        )
        .expect("pack");

        assert!(raw > 3 * 1024 * 1024, "样本本身得够大才有意义：{raw} bytes");
        // 实测 229x（真实日志 119x，同一个量级）。阈值取 30x 留 7 倍余量：
        // 既挡得住「压缩没了」，也不会因为 brotli 版本升级的正常波动而白红。
        assert!(
            bytes.len() * 30 < raw,
            "压缩比至少要 30x，否则这个包发不出去：{raw} -> {}（{:.1}x）",
            bytes.len(),
            raw as f64 / bytes.len() as f64
        );
    }

    /// 确定性的伪随机文本，压缩器压不动——用来模拟真实日志里那些没法靠
    /// 「一整块重复字符」蒙过去的正文。
    fn noise(seed: u64, len: usize) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut state = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        (0..len)
            .map(|_| {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                HEX[(state >> 33) as usize & 0xf] as char
            })
            .collect()
    }

    #[test]
    fn summary_separates_no_reasoning_from_nobody_looking() {
        let mut with_reasoning = entry("a");
        with_reasoning.upstream_reasoning_deltas = Some(7);
        let mut without = entry("b");
        without.upstream_reasoning_deltas = Some(0);
        let never_counted = entry("c");
        let mut failed = entry("d");
        failed.success = false;
        failed.bridge = Some("codex.responses_to_chat".to_string());

        let summary = summarize(&[
            Arc::new(with_reasoning),
            Arc::new(without),
            Arc::new(never_counted),
            Arc::new(failed),
        ]);
        assert_eq!(summary["successes"], 3);
        assert_eq!(summary["failures"], 1);
        assert_eq!(summary["bridged"], 1);
        assert_eq!(summary["upstream_reasoning"]["observed"], 1);
        assert_eq!(summary["upstream_reasoning"]["none"], 1);
        assert_eq!(summary["upstream_reasoning"]["unknown"], 2);
    }

    #[test]
    fn summary_counts_each_truncated_stage_separately() {
        let mut both = entry("a");
        both.truncated_stages = vec![
            "client_request".to_string(),
            "upstream_response".to_string(),
        ];
        let mut one = entry("b");
        one.truncated_stages = vec!["client_request".to_string()];
        let summary = summarize(&[Arc::new(both), Arc::new(one)]);
        assert_eq!(summary["truncated_stages"]["client_request"], 2);
        assert_eq!(summary["truncated_stages"]["upstream_response"], 1);
    }

    /// 通知配置里有 webhook 地址和令牌，导出包里只能留下「配了哪些通道」。
    #[test]
    fn settings_summary_keeps_channel_names_but_not_their_endpoints() {
        let mut settings = AppSettings {
            language: "zh-CN".to_string(),
            theme: "dark".to_string(),
            copy_import_sources: false,
            logging_enabled: true,
            secret_storage: "keyring".to_string(),
            data_dir: "/home/me/.ai-switch".to_string(),
            ccswitch_deeplink_compat_enabled: false,
            close_to_tray: true,
            image_generation_enabled: false,
            claude_client_config_json: None,
            config_write_clients_json: None,
            deepseek_harness_config_path: None,
            notification_config_json: None,
            proxy_enabled: false,
            proxy_url: None,
        };
        settings.notification_config_json = Some(
            json!({
                "feishu": { "webhook_url": "https://open.feishu.cn/hook/SECRET" },
                "bark": null,
            })
            .to_string(),
        );
        settings.proxy_enabled = true;
        settings.proxy_url = Some("http://user:pass@127.0.0.1:7890".to_string());

        let summary = settings_summary(&settings);
        assert_eq!(summary["theme"], "dark", "偏好本身要留着，它解释行为差异");
        assert_eq!(summary["notification_config_json"][0], "feishu");
        assert_eq!(
            summary["notification_config_json"].as_array().map(Vec::len),
            Some(1),
            "没配置的通道不列"
        );
        let text = summary.to_string();
        assert!(!text.contains("SECRET"), "webhook 地址不能进导出包：{text}");
        assert!(!text.contains("pass"), "代理密码不能进导出包：{text}");
        assert_eq!(summary["proxy_url"], "http://127.0.0.1:7890/");
    }

    #[test]
    fn notification_channels_survives_junk() {
        assert_eq!(notification_channels("not json"), json!(["<unparseable>"]));
        assert_eq!(notification_channels("[1]"), json!(["<not an object>"]));
        assert_eq!(notification_channels("{}"), json!([]));
    }

    #[test]
    fn url_credentials_are_stripped_only_when_present() {
        assert_eq!(
            redact_url_credentials("http://127.0.0.1:7890"),
            "http://127.0.0.1:7890"
        );
        assert_eq!(
            redact_url_credentials("socks5://u:p@host:1080"),
            "socks5://host:1080"
        );
        assert_eq!(redact_url_credentials("not a url"), "not a url");
    }

    #[test]
    fn clipped_truncates_on_a_character_boundary() {
        assert_eq!(
            clipped(Some("short".to_string()), 64).as_deref(),
            Some("short")
        );
        assert_eq!(clipped(None, 64), None);

        let long = "上".repeat(10);
        let clipped_long = clipped(Some(long.clone()), 7).expect("clipped");
        assert!(clipped_long.starts_with("上上"));
        assert!(clipped_long.ends_with("bytes dropped]"));
        assert!(
            clipped_long.chars().count() < long.chars().count() + 20,
            "只丢掉超出上限的部分"
        );
    }

    /// 账号概况是**手写 SQL**：列名或语义一变，只有用户点导出那一刻才会暴露。
    /// 所以这里不手搓表，跑**真实迁移**、走**真实仓库**写入，再断言概况。
    ///
    /// 手搓表会骗人，而且已经骗过一次：之前那张表把 `kind` 写成
    /// `api_key`/`oauth`，真实 DDL 的 CHECK 只允许 `official`/`api`。
    /// 同时守着这个包最不能破的性质：凭据不进导出。
    #[tokio::test]
    async fn pool_summary_matches_the_real_migrated_schema() {
        use crate::database::repositories::route_credential_repository::RouteCredentialRepository;
        use crate::models::route_credential_model::FailureScope;

        let pool = crate::database::create_memory_pool().await.expect("pool");
        crate::database::run_migrations(&pool)
            .await
            .expect("migrations");

        async fn create(
            pool: &SqlitePool,
            platform: &str,
            kind: &str,
            name: &str,
            status: &str,
            secret: &str,
        ) -> crate::models::route_credential::RouteCredential {
            RouteCredentialRepository::create(
                pool, platform, kind, name, None, status, None, secret, "{}", "{}",
            )
            .await
            .unwrap_or_else(|error| panic!("create {name}: {error}"))
        }

        let codex_a = create(
            &pool,
            "codex",
            "api",
            "Codex A",
            "ok",
            r#"{"api_key":"sk-SECRET"}"#,
        )
        .await;
        create(
            &pool,
            "codex",
            "api",
            "Codex B",
            "disabled",
            r#"{"api_key":"sk-SECRET"}"#,
        )
        .await;
        create(
            &pool,
            "claude",
            "official",
            "Claude A",
            "ok",
            r#"{"refresh_token":"rt-SECRET"}"#,
        )
        .await;
        let claude_gone = create(
            &pool,
            "claude",
            "official",
            "Claude gone",
            "ok",
            r#"{"refresh_token":"rt-SECRET"}"#,
        )
        .await;

        RouteCredentialRepository::record_transient_failure(
            &pool,
            &codex_a.id,
            "rate_limited",
            "429 from upstream",
            None,
            FailureScope::Account,
        )
        .await
        .expect("record failure");
        RouteCredentialRepository::set_archived(&pool, &[claude_gone.id.clone()], true)
            .await
            .expect("archive");

        let summary = pool_summary(&pool).await;
        assert_eq!(summary["kind"], "pool");
        let platforms = summary["platforms"].as_array().expect("platforms");
        let names: Vec<&str> = platforms
            .iter()
            .map(|entry| entry["platform"].as_str().expect("platform"))
            .collect();
        assert_eq!(names, ["claude", "codex"], "平台按名字排序，claude 在前");

        // 空账号列表同时意味着「查不到」和「查询炸了」，所以先钉死不是后者。
        for entry in platforms {
            assert_eq!(entry.get("error"), None, "概况查询本身不能出错：{entry}");
        }

        let claude = &platforms[0];
        assert_eq!(
            claude["accounts"].as_array().map(Vec::len),
            Some(1),
            "归档的账号不算在内"
        );
        assert_eq!(claude["accounts"][0]["name"], "Claude A");
        assert_eq!(claude["accounts"][0]["kind"], "official");

        let codex = &platforms[1];
        let accounts = codex["accounts"].as_array().expect("accounts");
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0]["name"], "Codex A");
        assert_eq!(accounts[0]["kind"], "api");
        assert_eq!(
            accounts[0]["last_failure_kind"], "rate_limited",
            "上次失败原因是排查路由问题的关键，不能丢"
        );
        assert_eq!(
            accounts[0]["last_failure_message"], "429 from upstream",
            "失败原文也在，只有超长时才截断"
        );
        assert_eq!(accounts[0]["transient_failure_count"], 1);
        assert_eq!(accounts[1]["status"], "disabled");

        let text = summary.to_string();
        assert!(!text.contains("SECRET"), "凭据不能进导出包：{text}");
        assert!(!text.contains("secret_payload_json"), "{text}");
    }

    /// 逐平台查询炸了必须留下 `error`，而不是静默跳过——「这个平台没有账号」
    /// 和「列名对不上了」在读者眼里一模一样，而后者正是这个包要排查的场景。
    #[tokio::test]
    async fn pool_summary_reports_a_broken_query_instead_of_an_empty_pool() {
        let pool = crate::database::create_memory_pool().await.expect("pool");
        // 只建出第一个查询要用的两列，让逐平台的明细查询失败。
        sqlx::query("CREATE TABLE route_credentials (platform TEXT, archived_at TEXT)")
            .execute(&pool)
            .await
            .expect("schema");
        sqlx::query("INSERT INTO route_credentials (platform, archived_at) VALUES ('codex', NULL)")
            .execute(&pool)
            .await
            .expect("seed");

        let summary = pool_summary(&pool).await;
        let platforms = summary["platforms"].as_array().expect("platforms");
        assert_eq!(platforms.len(), 1);
        assert_eq!(platforms[0]["platform"], "codex");
        assert_eq!(
            platforms[0]["accounts"].as_array().map(Vec::len),
            Some(0),
            "查不到就如实报空数组"
        );
        assert!(
            platforms[0]["error"].is_string(),
            "但错误必须带上，不能只剩一个空数组：{}",
            platforms[0]
        );

        // 连平台列表都查不出来时，`platforms` 仍然是数组，读者不必写特例。
        let broken = crate::database::create_memory_pool().await.expect("pool");
        sqlx::query("CREATE TABLE route_credentials (id TEXT PRIMARY KEY)")
            .execute(&broken)
            .await
            .expect("schema");

        let summary = pool_summary(&broken).await;
        assert!(
            summary["error"].is_string(),
            "列名对不上时要报错：{summary}"
        );
        assert_eq!(
            summary["platforms"].as_array().map(Vec::len),
            Some(0),
            "platforms 始终是数组"
        );
    }

    #[test]
    fn suggested_file_name_is_timestamped_and_filterable() {
        let name = suggested_file_name();
        assert!(name.starts_with("ai-switch-diagnostics-"), "{name}");
        assert!(name.ends_with(".jsonl.br"), "{name}");
    }

    /// `build` 是命令真正调用的那个函数，但上面几条只分别测了 `pack` 和
    /// `pool_summary`——中间这段接线（真实 `AppPaths`、真实设置文件、真实实时日志）
    /// 一直是没人走过的路。这里把它们串起来再解压读回来。
    ///
    /// 顺带把设置摘要的脱敏也端到端验一次：脱敏漏一个字段，用户发出去的包里
    /// 就带着他的 webhook 和代理口令。
    #[tokio::test]
    async fn build_packs_settings_and_live_log_end_to_end() {
        use crate::database::repositories::route_credential_repository::RouteCredentialRepository;

        let dir = tempfile::tempdir().expect("temp dir");
        let paths = AppPaths::from_data_dir(dir.path().to_path_buf());

        let mut settings = AppSettings::defaults_for_data_dir(paths.data_dir.display().to_string());
        settings.proxy_enabled = true;
        settings.proxy_url = Some("http://user:s3cret@127.0.0.1:7890".to_string());
        // `bark` 是 null，代表没配——只该剩下 feishu 一个名字。
        settings.notification_config_json = Some(
            r#"{"feishu":{"webhook":"https://open.feishu.cn/open-apis/bot/v2/hook/SECRET"},"bark":null}"#
                .to_string(),
        );
        SettingsService::save(&paths, &settings)
            .await
            .expect("save settings");

        let pool = crate::database::create_memory_pool().await.expect("pool");
        crate::database::run_migrations(&pool)
            .await
            .expect("migrations");
        RouteCredentialRepository::create(
            &pool,
            "codex",
            "api",
            "Codex A",
            None,
            "ok",
            None,
            r#"{"api_key":"sk-SECRET"}"#,
            "{}",
            "{}",
        )
        .await
        .expect("create account");

        let live_log = RouteProxyLiveLog::default();
        live_log.record(entry("e1"));

        let bundle = build(&pool, &paths, &live_log).await.expect("build");
        assert_eq!(bundle.entries, 1);
        assert!(
            bundle.bytes.len() < bundle.raw_bytes,
            "包是压缩过的：{} vs {}",
            bundle.bytes.len(),
            bundle.raw_bytes
        );

        let text = String::from_utf8(brotli_codec::decompress(&bundle.bytes).expect("decompress"))
            .expect("utf8");
        let lines: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).expect("line"))
            .collect();
        assert_eq!(lines.len(), 3, "meta + pool + 1 条日志");

        let meta = &lines[0];
        assert_eq!(meta["kind"], "meta");
        assert_eq!(meta["format_version"], DIAGNOSTICS_FORMAT_VERSION);
        assert!(
            meta["app"]["name"]
                .as_str()
                .is_some_and(|name| !name.is_empty()),
            "{meta}"
        );
        assert!(
            meta["app"]["version"]
                .as_str()
                .is_some_and(|version| !version.is_empty()),
            "版本号是排错第一件事：{meta}"
        );
        assert!(meta["os"]["platform"]
            .as_str()
            .is_some_and(|v| !v.is_empty()));
        assert_eq!(meta["live_log"]["capacity"], LIVE_LOG_CAPACITY);
        assert_eq!(meta["live_log"]["entries"], 1);
        assert_eq!(meta["live_log"]["summary"]["successes"], 1);
        // 断言「保留了什么、抹掉了什么」，不钉 `Url` 补的那个尾斜杠——
        // 那是 url crate 的序列化细节，钉住只会让升级时白红一次。
        let proxy = meta["settings"]["proxy_url"].as_str().expect("proxy_url");
        assert!(proxy.contains("127.0.0.1:7890"), "地址要保留：{proxy}");
        assert!(!proxy.contains("user"), "用户名要被抹掉：{proxy}");
        assert!(!proxy.contains("s3cret"), "口令要被抹掉：{proxy}");
        assert_eq!(
            meta["settings"]["notification_config_json"],
            json!(["feishu"]),
            "只留配置了哪几个渠道，不留端点"
        );

        assert_eq!(lines[1]["kind"], "pool");
        assert_eq!(lines[1]["platforms"][0]["platform"], "codex");
        assert_eq!(lines[1]["platforms"][0]["accounts"][0]["name"], "Codex A");

        assert_eq!(lines[2]["kind"], "live_log_entry");
        assert_eq!(lines[2]["entry"]["id"], "e1");
        assert_eq!(
            lines[2]["entry"]["client_request"], "{\"input\":\"hi\"}",
            "四个阶段原文照发，不裁"
        );

        // 这一条是整条链路的底线：设置里的 webhook、口令、账号密钥，一个都不许出现。
        assert!(!text.contains("SECRET"), "凭据不能进导出包：{text}");
        assert!(!text.contains("s3cret"), "代理口令不能进导出包：{text}");
        assert!(!text.contains("secret_payload_json"), "{text}");
    }
}
