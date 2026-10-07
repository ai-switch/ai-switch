//! Aggregate token usage and cost from local CLI session transcripts.
//!
//! Complements the proxy-route statistics: the route stats only see traffic that
//! went through this app's proxy, while Claude Code and Codex also record every
//! request they made directly. Reading their session logs gives a complete
//! picture of spend, including work done outside the proxy.
//!
//! Two provider formats are supported, each with a counting rule that must not
//! be got wrong:
//!
//! * **Claude Code** (`~/.claude/projects/**/*.jsonl`) — one JSON object per
//!   line; assistant messages carry `message.usage`. The same message is
//!   re-serialized into multiple files by resume and compaction, so rows must be
//!   deduplicated by `message.id`. On a real machine this cut a 4020-row scan to
//!   2008 unique messages — counting raw lines overstated cost by 93%.
//! * **Codex CLI** (`~/.codex/sessions/**/*.jsonl`) — durable
//!   `token_usage_record` entries provide the response id and per-request usage.
//!   Legacy `token_count.total_token_usage` is cumulative, not per-request, so
//!   only its deltas are counted when no authoritative record covers them.
//!   Forked parent history is excluded, and duplicate records are deduplicated.

use crate::services::model_pricing::{self, TokenUsage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Usage statistics scans read the full history rather than a recent window, so
/// the cap only exists to bound pathological directories. Well above the ~1.2k
/// files a heavy user accumulates; when it does trip, the truncation is reported
/// rather than passed off as a complete total.
const USAGE_SCAN_FILE_LIMIT: usize = 50_000;

/// Directory depth limit, matching the session list's traversal.
const USAGE_SCAN_DEPTH: usize = 8;

/// Rolled-up usage for one grouping key (a model, a provider, or the total).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionUsageTotals {
    /// Billable requests counted (deduplicated).
    pub request_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_write_tokens: i64,
    pub cache_read_tokens: i64,
    /// Estimated cost in USD micros (1 USD = 1_000_000).
    pub cost_micros: i64,
    /// Requests whose model had no known rate, so they contribute no cost.
    /// Surfaced so a partial total is never mistaken for a complete one.
    pub unpriced_request_count: i64,
}

impl SessionUsageTotals {
    fn add(&mut self, other: &SessionUsageTotals) {
        self.request_count += other.request_count;
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cost_micros += other.cost_micros;
        self.unpriced_request_count += other.unpriced_request_count;
    }

    pub fn total_tokens(&self) -> i64 {
        self.input_tokens + self.output_tokens + self.cache_write_tokens + self.cache_read_tokens
    }
}

/// Per-model breakdown row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionUsageModelRow {
    /// Provider id: `claude` or `codex`.
    pub provider: String,
    /// Model id as recorded, before price-table normalization.
    pub model: String,
    /// Whether a rate was found for this model.
    pub priced: bool,
    #[serde(flatten)]
    pub totals: SessionUsageTotals,
}

/// Full result of a session usage scan.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionUsageStats {
    pub totals: SessionUsageTotals,
    /// Per-provider rollup, keyed by provider id.
    pub by_provider: Vec<SessionUsageModelRow>,
    /// Per-model rollup, highest cost first.
    pub by_model: Vec<SessionUsageModelRow>,
    /// Session files read.
    pub scanned_file_count: i64,
    /// True when the file cap was hit and the totals are therefore incomplete.
    pub truncated: bool,
}

/// Inclusive-start, exclusive-end epoch-millisecond filter.
#[derive(Debug, Clone, Copy, Default)]
pub struct TimeWindow {
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

impl TimeWindow {
    fn contains(&self, timestamp_ms: Option<i64>) -> bool {
        // Entries without a timestamp are only counted for an unbounded window,
        // so a period filter cannot silently absorb undated rows.
        let Some(timestamp) = timestamp_ms else {
            return self.start_ms.is_none() && self.end_ms.is_none();
        };
        if self.start_ms.is_some_and(|start| timestamp < start) {
            return false;
        }
        if self.end_ms.is_some_and(|end| timestamp >= end) {
            return false;
        }
        true
    }
}

/// One billable request extracted from a transcript, before time filtering and
/// cross-file deduplication.
#[derive(Debug, Clone, PartialEq, Eq)]
struct UsageEntry {
    provider: &'static str,
    model: String,
    /// Dedup key (Claude `message.id`); `None` when the transcript has none.
    dedup_key: Option<String>,
    /// Upstream response id, the join key against a proxy usage row.
    response_id: Option<String>,
    timestamp_ms: Option<i64>,
    usage: TokenUsage,
}

/// Parsed contents of one session file.
///
/// Cached per file so a refresh only re-reads files that changed. Entries are
/// stored un-filtered and un-deduplicated so one cache entry serves every time
/// window and participates in cross-file dedup.
#[derive(Debug, Clone, Default)]
struct ParsedFile {
    entries: Vec<UsageEntry>,
}

/// Identity of a file version: changing either field invalidates the cache.
/// Session transcripts are append-only, so size alone would nearly suffice;
/// mtime also catches rewrites (compaction) that keep the length the same.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileVersion {
    modified_ms: i64,
    size: u64,
}

fn file_version(path: &Path) -> Option<FileVersion> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();
    Some(FileVersion {
        modified_ms,
        size: metadata.len(),
    })
}

/// Process-wide parse cache.
///
/// Statistics refresh on a timer while the panel is open, and the transcript
/// corpus reaches multiple gigabytes; without this every refresh would re-read
/// all of it. Keyed by path, invalidated by [`FileVersion`].
type ParseCache = HashMap<PathBuf, (FileVersion, Arc<ParsedFile>)>;

static PARSE_CACHE: OnceLock<Mutex<ParseCache>> = OnceLock::new();

fn parse_cache() -> &'static Mutex<ParseCache> {
    PARSE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Return the parsed contents of `path`, reusing the cached parse when the file
/// is unchanged.
fn parsed_file(path: &Path, provider: Provider) -> Arc<ParsedFile> {
    let version = file_version(path);

    if let (Some(version), Ok(cache)) = (version, parse_cache().lock()) {
        if let Some((cached_version, parsed)) = cache.get(path) {
            if *cached_version == version {
                return Arc::clone(parsed);
            }
        }
    }

    let parsed = Arc::new(match provider {
        Provider::Claude => parse_claude_file(path),
        Provider::Codex => parse_codex_file(path),
    });

    if let (Some(version), Ok(mut cache)) = (version, parse_cache().lock()) {
        // Bound the map so a long-lived process cannot grow it without limit.
        if cache.len() >= MAX_CACHED_FILES {
            cache.clear();
        }
        cache.insert(path.to_path_buf(), (version, Arc::clone(&parsed)));
    }

    parsed
}

/// Cap on cached file parses; cleared wholesale when exceeded.
const MAX_CACHED_FILES: usize = 8_192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provider {
    Claude,
    Codex,
}

fn home_dir() -> PathBuf {
    directories::BaseDirs::new()
        .map(|base| base.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Resolve an env var that may hold a path, expanding a leading `~`.
///
/// Mirrors the MCP client helper of the same name; duplicated here rather than
/// widening the private `mcp::clients` API for a services-layer caller.
fn env_path(name: &str, fallback: PathBuf) -> PathBuf {
    let Some(value) = std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return fallback;
    };
    if value == "~" {
        return home_dir();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(value)
}

/// Roots to scan for Claude Code transcripts.
///
/// `CLAUDE_CONFIG_DIR` is honored because a relocated install would otherwise be
/// missed entirely.
fn claude_roots() -> Vec<PathBuf> {
    let home = home_dir();
    let configured = env_path("CLAUDE_CONFIG_DIR", home.join(".claude"));
    let mut roots = vec![configured.join("projects")];
    let fallback = home.join(".cache").join("claude").join("projects");
    if !roots.contains(&fallback) {
        roots.push(fallback);
    }
    roots
}

/// Roots to scan for Codex CLI transcripts. `CODEX_HOME` is honored to match the
/// rest of the app's Codex handling.
fn codex_roots() -> Vec<PathBuf> {
    let codex_home = env_path("CODEX_HOME", home_dir().join(".codex"));
    vec![codex_home.join("sessions")]
}

/// Scan local session transcripts and aggregate usage within `window`.
///
/// Blocking file IO — call from `spawn_blocking`.
pub fn scan_session_usage(window: TimeWindow) -> SessionUsageStats {
    let mut accumulator = Accumulator::default();
    let mut scanned = 0_i64;
    let mut truncated = false;

    // One dedup set across every root and provider: the same Claude message can
    // appear in both the primary projects directory and the cache mirror.
    let mut seen_dedup_keys = HashSet::new();

    for (root, provider) in scan_roots() {
        if !root.exists() {
            continue;
        }
        let files = collect_files(&root, &mut truncated);
        scanned += files.len() as i64;
        for path in files {
            let parsed = parsed_file(&path, provider);
            accumulator.absorb(&parsed, window, &mut seen_dedup_keys);
        }
    }

    let mut stats = accumulator.finish();
    stats.scanned_file_count = scanned;
    stats.truncated = truncated;
    stats
}

/// One billable request from a transcript, after time filtering and dedup.
///
/// The public counterpart of the internal parse entry, for callers that merge
/// transcript records with proxy usage rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionUsageEntry {
    /// `claude` or `codex`.
    pub provider: &'static str,
    pub model: String,
    /// Upstream response id: the join key against a proxy usage row.
    pub response_id: Option<String>,
    pub timestamp_ms: Option<i64>,
    pub usage: TokenUsage,
}

/// Scan local transcripts and return the deduplicated per-request entries
/// within `window`, plus the scanned file count and whether the cap was hit.
///
/// Shares the parse cache with [`scan_session_usage`], so a caller that needs
/// both rows and rollups pays for the file reads once.
///
/// Blocking file IO — call from `spawn_blocking`.
pub fn collect_session_entries(window: TimeWindow) -> (Vec<SessionUsageEntry>, i64, bool) {
    let mut entries = Vec::new();
    let mut scanned = 0_i64;
    let mut truncated = false;
    let mut seen_dedup_keys = HashSet::new();

    for (root, provider) in scan_roots() {
        if !root.exists() {
            continue;
        }
        let files = collect_files(&root, &mut truncated);
        scanned += files.len() as i64;
        for path in files {
            let parsed = parsed_file(&path, provider);
            for entry in &parsed.entries {
                if !window.contains(entry.timestamp_ms) {
                    continue;
                }
                if let Some(key) = &entry.dedup_key {
                    if !seen_dedup_keys.insert(key.clone()) {
                        continue;
                    }
                }
                entries.push(SessionUsageEntry {
                    provider: entry.provider,
                    model: entry.model.clone(),
                    response_id: entry.response_id.clone(),
                    timestamp_ms: entry.timestamp_ms,
                    usage: entry.usage,
                });
            }
        }
    }

    (entries, scanned, truncated)
}

/// Every transcript root paired with the provider that writes it.
fn scan_roots() -> impl Iterator<Item = (PathBuf, Provider)> {
    claude_roots()
        .into_iter()
        .map(|root| (root, Provider::Claude))
        .chain(
            codex_roots()
                .into_iter()
                .map(|root| (root, Provider::Codex)),
        )
}

fn collect_files(root: &Path, truncated: &mut bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    crate::session_manager::collect_session_files(
        root,
        &["jsonl"],
        USAGE_SCAN_DEPTH,
        USAGE_SCAN_FILE_LIMIT,
        &mut files,
    );
    if files.len() >= USAGE_SCAN_FILE_LIMIT {
        *truncated = true;
    }
    files
}

#[derive(Default)]
struct Accumulator {
    /// Keyed by (provider, model).
    by_model: HashMap<(String, String), SessionUsageTotals>,
}

impl Accumulator {
    /// Fold one parsed file into the running totals, applying the time filter
    /// and cross-file deduplication.
    fn absorb(
        &mut self,
        parsed: &ParsedFile,
        window: TimeWindow,
        seen_dedup_keys: &mut HashSet<String>,
    ) {
        for entry in &parsed.entries {
            if !window.contains(entry.timestamp_ms) {
                continue;
            }
            if let Some(key) = &entry.dedup_key {
                if !seen_dedup_keys.insert(key.clone()) {
                    continue;
                }
            }
            self.record(entry.provider, &entry.model, entry.usage);
        }
    }

    fn record(&mut self, provider: &str, model: &str, usage: TokenUsage) {
        let priced_cost = model_pricing::estimate_cost_micros(model, usage);
        let entry = self
            .by_model
            .entry((provider.to_string(), model.to_string()))
            .or_default();

        entry.request_count += 1;
        entry.input_tokens += usage.input_tokens.max(0);
        entry.output_tokens += usage.output_tokens.max(0);
        entry.cache_write_tokens += usage.cache_write_tokens.max(0);
        entry.cache_read_tokens += usage.cache_read_tokens.max(0);
        match priced_cost {
            Some(cost) => entry.cost_micros += cost,
            None => entry.unpriced_request_count += 1,
        }
    }

    fn finish(self) -> SessionUsageStats {
        let mut totals = SessionUsageTotals::default();
        let mut provider_totals: HashMap<String, SessionUsageTotals> = HashMap::new();
        let mut by_model = Vec::with_capacity(self.by_model.len());

        for ((provider, model), model_totals) in self.by_model {
            totals.add(&model_totals);
            provider_totals
                .entry(provider.clone())
                .or_default()
                .add(&model_totals);
            by_model.push(SessionUsageModelRow {
                priced: model_pricing::rate_for_model(&model).is_some(),
                provider,
                model,
                totals: model_totals,
            });
        }

        // Highest cost first, then by tokens so unpriced rows still order sensibly.
        by_model.sort_by(|left, right| {
            right
                .totals
                .cost_micros
                .cmp(&left.totals.cost_micros)
                .then_with(|| right.totals.total_tokens().cmp(&left.totals.total_tokens()))
                .then_with(|| left.model.cmp(&right.model))
        });

        let mut by_provider: Vec<SessionUsageModelRow> = provider_totals
            .into_iter()
            .map(|(provider, provider_total)| SessionUsageModelRow {
                provider,
                model: String::new(),
                priced: true,
                totals: provider_total,
            })
            .collect();
        by_provider.sort_by(|left, right| {
            right
                .totals
                .cost_micros
                .cmp(&left.totals.cost_micros)
                .then_with(|| left.provider.cmp(&right.provider))
        });

        SessionUsageStats {
            totals,
            by_provider,
            by_model,
            scanned_file_count: 0,
            truncated: false,
        }
    }
}

fn read_lines(path: &Path) -> Option<impl Iterator<Item = String>> {
    let file = File::open(path).ok()?;
    Some(
        BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .filter(|line| !line.trim().is_empty()),
    )
}

/// Parse one Claude Code transcript into its billable entries.
///
/// Sidechain (subagent) messages are included: their tokens are real spend, even
/// though the session *list* hides them. Deduplication and time filtering happen
/// later so this parse can be cached once and reused for any time window.
fn parse_claude_file(path: &Path) -> ParsedFile {
    let Some(lines) = read_lines(path) else {
        return ParsedFile::default();
    };

    let mut entries = Vec::new();
    for line in lines {
        // Transcripts are dominated by user turns and tool results that carry no
        // usage. A substring check is far cheaper than parsing every line, and
        // these files run to gigabytes.
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(message) = entry.get("message") else {
            continue;
        };
        let Some(usage) = message.get("usage") else {
            continue;
        };

        // `<synthetic>` marks locally generated messages that were never billed;
        // `normalize_model_id` rejects them, and skipping here also keeps them
        // out of the request count.
        let Some(model) = message.get("model").and_then(Value::as_str) else {
            continue;
        };
        if model_pricing::normalize_model_id(model).is_none() {
            continue;
        }

        // Resume and compaction rewrite the same assistant message into several
        // files, so `message.id` is the cross-file dedup key. It is also the
        // upstream response id, which is what joins this entry to a proxy usage
        // row for the same request. Rows with no id are kept unconditionally —
        // every observed id-less row was a distinct request, and undercounting
        // spend is worse.
        let message_id = message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string);

        entries.push(UsageEntry {
            provider: "claude",
            model: model.to_string(),
            dedup_key: message_id.clone(),
            response_id: message_id,
            timestamp_ms: entry_timestamp_ms(&entry),
            usage: claude_token_usage(usage),
        });
    }

    ParsedFile { entries }
}

fn claude_token_usage(usage: &Value) -> TokenUsage {
    TokenUsage {
        input_tokens: json_i64(usage.get("input_tokens")),
        output_tokens: json_i64(usage.get("output_tokens")),
        cache_write_tokens: json_i64(usage.get("cache_creation_input_tokens")),
        cache_read_tokens: json_i64(usage.get("cache_read_input_tokens")),
    }
}

/// Parse one Codex rollout, preferring the explicit per-response usage record.
///
/// Native Responses output-item ids (`fc_…`, `rs_…`) are NOT response ids.
/// `token_usage_record` supplies the authoritative id plus this request's usage;
/// `thread_token_usage` is the exact cumulative checkpoint also emitted by the
/// legacy `token_count` heartbeat. Reconcile those checkpoints, not timestamps,
/// model spelling, or token similarity, so concurrent requests are never guessed.
/// Legacy-only requests keep the original cumulative-delta parser.
fn parse_codex_file(path: &Path) -> ParsedFile {
    let Some(lines) = read_lines(path) else {
        return ParsedFile::default();
    };

    let mut model: Option<String> = None;
    let mut previous: Option<CodexCumulative> = None;
    let mut pending_response_id: Option<String> = None;
    let mut entries: Vec<Option<UsageEntry>> = Vec::new();
    let mut seen_record_ids = HashSet::new();
    // Per-turn checkpoints: counters may restart at the same values in a later
    // turn. A late explicit record can replace a legacy entry already read.
    let mut record_checkpoints = HashSet::new();
    let mut legacy_checkpoints: HashMap<CodexCumulative, usize> = HashMap::new();
    let mut replaying_parent = false;

    for (index, line) in lines.enumerate() {
        if index == 0 {
            replaying_parent = replays_parent_history(&line);
        }
        if !line.contains("token_count")
            && !line.contains("token_usage_record")
            && !line.contains("turn_context")
            && !line.contains("response_item")
            && !line.contains("\"model\"")
        {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let payload = entry.get("payload").unwrap_or(&Value::Null);
        let entry_type = entry.get("type").and_then(Value::as_str);
        // Older rollouts may omit the envelope type. Keep that legacy model
        // carrier supported without reading model names out of tool results.
        if entry_type.is_none() {
            if let Some(found) = payload
                .get("model")
                .and_then(Value::as_str)
                .filter(|m| !m.trim().is_empty())
            {
                model = Some(found.to_string());
            }
        }
        if entry_type == Some("turn_context") {
            replaying_parent = false;
            pending_response_id = None;
            record_checkpoints.clear();
            legacy_checkpoints.clear();
            if let Some(found) = payload
                .get("model")
                .and_then(Value::as_str)
                .filter(|m| !m.trim().is_empty())
            {
                model = Some(found.to_string());
            }
            continue;
        }

        if entry_type == Some("token_usage_record") {
            let Some(record) = CodexUsageRecord::parse(payload) else {
                // Invalid/truncated or id-less new records must not swallow the
                // legacy accounting event for that request.
                continue;
            };
            if replaying_parent {
                previous = Some(record.total);
                continue;
            }
            if !seen_record_ids.insert(record.id.clone()) {
                record_checkpoints.insert(record.total);
                pending_response_id = None;
                continue;
            }
            // Some writers flush the aggregate heartbeat before its individual
            // records. Do not rewind a checkpoint already seen in this turn;
            // otherwise the next legacy delta charges these records again.
            let older_checkpoint = previous.is_some_and(|previous| {
                record.total.delta_from(previous).is_none()
                    && (legacy_checkpoints.contains_key(&previous)
                        || record_checkpoints.contains(&previous))
            });
            let replaced = legacy_checkpoints.remove(&record.total);
            if let Some(index) = replaced {
                entries[index] = None;
            }
            if !older_checkpoint {
                // Also advances the baseline when no token_count follows (e.g.
                // the client exits while a tool is running). The next legacy
                // request must not include this record's usage again.
                previous = Some(record.total);
            }
            record_checkpoints.insert(record.total);
            pending_response_id = None;
            let entry_model = model.clone().unwrap_or_else(|| "unknown".to_string());
            let timestamp_ms = entry_timestamp_ms(&entry);
            entries.push(Some(UsageEntry {
                provider: "codex",
                dedup_key: codex_dedup_key(
                    Some(&record.id),
                    &entry_model,
                    &record.usage,
                    timestamp_ms,
                ),
                response_id: Some(record.id),
                model: entry_model,
                timestamp_ms,
                usage: record.usage,
            }));
            continue;
        }

        if matches!(entry_type, None | Some("response_item")) {
            if let Some(id) = codex_assistant_response_id(payload) {
                pending_response_id = Some(id);
            }
            if entry_type.is_some() {
                continue;
            }
        }
        if !matches!(entry_type, None | Some("event_msg"))
            || payload.get("type").and_then(Value::as_str) != Some("token_count")
        {
            continue;
        }
        let Some(total) = payload.pointer("/info/total_token_usage") else {
            continue;
        };
        let current = CodexCumulative::from_value(total);
        // A skipped heartbeat must not leave its guessed output-item id pending
        // for another request whose own output supplied no usable id.
        let response_id = pending_response_id.take();
        if record_checkpoints.contains(&current) {
            continue;
        }
        let delta = match previous {
            Some(previous) if previous == current => continue,
            Some(previous) => current.delta_from(previous),
            None => Some(current.usage()),
        };
        let usage = delta.unwrap_or_else(|| current.usage());
        previous = Some(current);
        if replaying_parent {
            continue;
        }

        let entry_model = model.clone().unwrap_or_else(|| "unknown".to_string());
        let timestamp_ms = entry_timestamp_ms(&entry);
        legacy_checkpoints.insert(current, entries.len());
        entries.push(Some(UsageEntry {
            provider: "codex",
            dedup_key: codex_dedup_key(response_id.as_deref(), &entry_model, &usage, timestamp_ms),
            model: entry_model,
            response_id,
            timestamp_ms,
            usage,
        }));
    }
    ParsedFile {
        entries: entries.into_iter().flatten().collect(),
    }
}

/// Both usage and the thread checkpoint are part of Codex's durable record.
/// Only accept complete, nonnegative token accounting, never turn a malformed
/// record into a zero-cost success that suppresses the valid legacy fallback.
struct CodexUsageRecord {
    id: String,
    usage: TokenUsage,
    total: CodexCumulative,
}

impl CodexUsageRecord {
    fn parse(payload: &Value) -> Option<Self> {
        let id = payload.get("response_id")?.as_str()?.trim();
        if id.is_empty() {
            return None;
        }
        let usage = CodexCumulative::checked(payload.get("usage")?)?;
        let total = CodexCumulative::checked(payload.get("thread_token_usage")?)?;
        total.delta_from(usage)?;
        Some(Self {
            id: id.to_string(),
            usage: usage.usage(),
            total,
        })
    }
}

/// A resumed thread can write the same `token_count` event into a second file.
/// The upstream response id names one response exactly, so it is the key when
/// present. Without it, a fingerprint of the model, every token counter and the
/// exact millisecond timestamp stands in: a replay is a verbatim copy of all
/// four, and two distinct turns do not collide on an exact timestamp with
/// identical token counts. `None` — no id and no timestamp — cannot be
/// deduplicated, so the turn is kept (under-counting is the wrong direction).
fn codex_dedup_key(
    response_id: Option<&str>,
    model: &str,
    usage: &TokenUsage,
    timestamp_ms: Option<i64>,
) -> Option<String> {
    if let Some(id) = response_id.map(str::trim).filter(|id| !id.is_empty()) {
        return Some(format!("codex:id:{id}"));
    }
    let timestamp = timestamp_ms?;
    Some(format!(
        "codex:fp:{model}:{}:{}:{}:{}:{timestamp}",
        usage.input_tokens, usage.output_tokens, usage.cache_read_tokens, usage.cache_write_tokens
    ))
}

/// True when a rollout opens with its parent thread's history replayed.
///
/// Codex writes a fresh file for every subagent spawn and every fork, and some of
/// them begin by dumping the parent's transcript verbatim at the fork instant;
/// only the events after this thread's first `turn_context` are its own work.
/// Counting the prefix charges the parent's spend twice, and because it precedes
/// the `turn_context` that names the model it all lands under `unknown` — on a
/// real corpus that was 413M phantom tokens (6.5% of all Codex tokens) from 8 of
/// 1100 files, every one of whose replayed `token_count` events was found
/// verbatim in the parent's rollout. No unforked file had any usage before its
/// first `turn_context`, so this cannot drop a real turn from one.
fn replays_parent_history(session_meta_line: &str) -> bool {
    // Substring first: the marker keys are absent from most first lines, and a
    // `session_meta` payload is large enough that parsing it is not free.
    if !session_meta_line.contains("forked_from_id")
        && !session_meta_line.contains("parent_thread_id")
    {
        return false;
    }
    let Ok(entry) = serde_json::from_str::<Value>(session_meta_line) else {
        return false;
    };
    if entry.get("type").and_then(Value::as_str) != Some("session_meta") {
        return false;
    }
    let payload = entry.get("payload").unwrap_or(&Value::Null);
    ["forked_from_id", "parent_thread_id"].iter().any(|key| {
        payload
            .get(*key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    })
}

/// Cumulative token counts as Codex reports them, before cache adjustment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct CodexCumulative {
    input_tokens: i64,
    cached_input_tokens: i64,
    cache_write_input_tokens: i64,
    output_tokens: i64,
}

impl CodexCumulative {
    fn checked(value: &Value) -> Option<Self> {
        let value = value.as_object()?;
        let count = |key: &str, required: bool| -> Option<i64> {
            match value.get(key) {
                None if !required => Some(0),
                Some(number) => number.as_i64().filter(|n| *n >= 0),
                _ => None,
            }
        };
        Some(Self {
            input_tokens: count("input_tokens", true)?,
            output_tokens: count("output_tokens", true)?,
            cached_input_tokens: count("cached_input_tokens", false)?,
            cache_write_input_tokens: count("cache_write_input_tokens", false)?,
        })
    }

    fn from_value(total: &Value) -> Self {
        Self {
            input_tokens: json_i64(total.get("input_tokens")),
            cached_input_tokens: json_i64(total.get("cached_input_tokens")),
            cache_write_input_tokens: json_i64(total.get("cache_write_input_tokens")),
            // `reasoning_output_tokens` is already part of `output_tokens`;
            // adding it would double-count reasoning.
            output_tokens: json_i64(total.get("output_tokens")),
        }
    }

    /// This event's own usage, treating the cumulative value as the whole turn.
    fn usage(self) -> TokenUsage {
        // Codex reports `input_tokens` inclusive of `cached_input_tokens`, so
        // the cached portion is subtracted to avoid billing it at the full
        // input rate.
        TokenUsage {
            input_tokens: (self.input_tokens - self.cached_input_tokens).max(0),
            output_tokens: self.output_tokens,
            cache_write_tokens: self.cache_write_input_tokens,
            cache_read_tokens: self.cached_input_tokens,
        }
    }

    /// Usage attributable to this turn alone, or `None` when any field went
    /// backwards (the session counter reset).
    fn delta_from(self, previous: Self) -> Option<TokenUsage> {
        let input = self.input_tokens - previous.input_tokens;
        let cached = self.cached_input_tokens - previous.cached_input_tokens;
        let cache_write = self.cache_write_input_tokens - previous.cache_write_input_tokens;
        let output = self.output_tokens - previous.output_tokens;
        if input < 0 || cached < 0 || cache_write < 0 || output < 0 {
            return None;
        }
        Some(TokenUsage {
            input_tokens: (input - cached).max(0),
            output_tokens: output,
            cache_write_tokens: cache_write,
            cache_read_tokens: cached,
        })
    }
}

/// The upstream Responses uuid carried by an assistant `response_item`.
///
/// Two places carry it, and a rollout needs at least one of them to join to a
/// proxy row:
///
/// * The item id, when Codex writes it with a known prefix. `rs_` (reasoning)
///   and `fc_` (function_call) only ever appear in assistant output. `fco_` is
///   the client's own function_call_output, and a `msg_` on a user or developer
///   turn is a client-side conversation id — neither joins to a proxy row, so
///   both are rejected.
/// * `encrypted_content` on a reasoning item, which the Responses API uses to
///   hand back the upstream item handle for a reasoning blob. Codex records it
///   verbatim, optionally with a `-<n>` index suffix when one response carried
///   several reasoning items.
///
/// The second form is the load-bearing one for current Codex builds: they emit
/// reasoning items whose `id` is a locally generated v4 uuid with no prefix at
/// all, and those match nothing — 0 of 430 such ids on a real corpus. The
/// prefixed ids still join (727 of 800), but every turn of a session that only
/// produced unprefixed ones dropped out of the merge and read as unproxied
/// spend, so both forms are needed.
fn codex_assistant_response_id(payload: &Value) -> Option<String> {
    let item_type = payload.get("type").and_then(Value::as_str)?;
    let prefixed = match item_type {
        "reasoning" => payload
            .get("id")
            .and_then(Value::as_str)?
            .strip_prefix("rs_"),
        "function_call" => payload
            .get("id")
            .and_then(Value::as_str)?
            .strip_prefix("fc_")
            .map(strip_trailing_index),
        "message" if payload.get("role").and_then(Value::as_str) == Some("assistant") => payload
            .get("id")
            .and_then(Value::as_str)?
            .strip_prefix("msg_"),
        _ => None,
    };
    // Legacy fallback only: some bridges encode response ids this way, but
    // native Responses item ids identify a different object. A durable
    // token_usage_record always supersedes this guess in parse_codex_file.
    if let Some(id) = prefixed.filter(|id| !id.trim().is_empty()) {
        return Some(id.to_string());
    }
    // Only a reasoning item carries `encrypted_content`, and only there is it
    // the upstream handle rather than an opaque blob this code cannot read.
    if item_type != "reasoning" {
        return None;
    }
    encrypted_content_response_id(payload.get("encrypted_content").and_then(Value::as_str)?)
}

/// Characters in a hyphenated uuid: `8-4-4-4-12`.
const UUID_LEN: usize = 36;

/// The uuid prefix of an `encrypted_content` value.
///
/// Anything that is not a leading dash-free uuid is rejected, which excludes
/// every other producer of this field: the proxy's own
/// `ai-switch-anthropic:…` marker and the base64 blobs a Responses-style
/// provider returns when the item was not routed through this app at all.
fn encrypted_content_response_id(encrypted: &str) -> Option<String> {
    let trimmed = encrypted.trim();
    // `get` rather than indexing: a value shorter than a uuid, or one holding a
    // multi-byte character inside the first 36 bytes, is not an id.
    let candidate = trimmed.get(..UUID_LEN)?;
    let shape_ok = candidate
        .as_bytes()
        .iter()
        .enumerate()
        .all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            // Uppercase is excluded because no producer writes it, so accepting
            // it would only ever match nothing.
            _ => byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase(),
        });
    // Whatever follows the uuid must be the optional `-<n>` index, so a longer
    // base64 blob that merely begins with uuid-shaped characters is not read as
    // one.
    let rest = &trimmed[UUID_LEN..];
    let tail_ok = rest.is_empty()
        || rest
            .strip_prefix('-')
            .is_some_and(|index| !index.is_empty() && index.bytes().all(|b| b.is_ascii_digit()));
    (shape_ok && tail_ok).then(|| candidate.to_string())
}

/// Drop the trailing `_<n>` a function-call id carries (`fc_<uuid>_0`) — but
/// only when that segment really is an index.
///
/// Upstream ids embed underscores of their own (`fc_toolu_bdrk_01MY…`,
/// `fc_call_9wU3…`), so cutting at the last underscore unconditionally collapses
/// every id from such a provider onto one key. That key then matches the wrong
/// proxy row, or none, and the request gets counted on both sides.
fn strip_trailing_index(id: &str) -> &str {
    match id.rsplit_once('_') {
        Some((head, tail))
            if !head.is_empty() && !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) =>
        {
            head
        }
        _ => id,
    }
}

fn json_i64(value: Option<&Value>) -> i64 {
    value
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_f64().map(|number| number as i64))
                .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
        })
        .unwrap_or(0)
        .max(0)
}

/// Epoch milliseconds for a transcript line. Claude uses RFC 3339 `timestamp`;
/// Codex uses the same field on the envelope.
fn entry_timestamp_ms(entry: &Value) -> Option<i64> {
    let raw = entry
        .get("timestamp")
        .or_else(|| entry.get("created_at"))
        .or_else(|| entry.get("createdAt"))?;

    if let Some(number) = raw.as_i64() {
        // Heuristic: values this small are seconds, not milliseconds.
        return Some(if number < 100_000_000_000 {
            number * 1_000
        } else {
            number
        });
    }
    let text = raw.as_str()?;
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_jsonl(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let mut file = File::create(&path).expect("create fixture");
        for line in lines {
            writeln!(file, "{line}").expect("write fixture");
        }
        path
    }

    fn claude_line(msg_id: &str, model: &str, input: i64, output: i64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"2026-08-19T14:04:50.011Z","message":{{"id":"{msg_id}","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}}}}"#
        )
    }

    /// Aggregate a set of files the same way [`scan_session_usage`] does, without
    /// touching the real home directory.
    fn aggregate(files: &[(&Path, Provider)], window: TimeWindow) -> SessionUsageStats {
        let mut accumulator = Accumulator::default();
        let mut seen = HashSet::new();
        for (path, provider) in files {
            let parsed = match provider {
                Provider::Claude => parse_claude_file(path),
                Provider::Codex => parse_codex_file(path),
            };
            accumulator.absorb(&parsed, window, &mut seen);
        }
        accumulator.finish()
    }

    fn aggregate_claude(path: &Path) -> SessionUsageStats {
        aggregate(&[(path, Provider::Claude)], TimeWindow::default())
    }

    fn aggregate_codex(path: &Path) -> SessionUsageStats {
        aggregate(&[(path, Provider::Codex)], TimeWindow::default())
    }

    /// Build a Codex `token_count` event with the given cumulative totals.
    fn codex_token_count(ts: &str, input: i64, cached: i64, output: i64) -> String {
        format!(
            r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"cached_input_tokens":{cached},"output_tokens":{output}}}}}}}}}"#
        )
    }

    #[test]
    fn codex_cumulative_totals_are_split_into_per_turn_entries() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
                &codex_token_count("2026-08-19T03:43:00.000Z", 300, 0, 30),
                &codex_token_count("2026-08-19T03:44:00.000Z", 1000, 200, 50),
            ],
        );

        let stats = aggregate_codex(&path);

        // Three turns, not one file-level row and not a triple-counted sum.
        assert_eq!(stats.totals.request_count, 3);
        // The per-turn deltas must add back up to the final cumulative value:
        // 1000 input of which 200 cached -> 800 uncached, 200 cache reads, 50 out.
        assert_eq!(stats.totals.input_tokens, 800);
        assert_eq!(stats.totals.cache_read_tokens, 200);
        assert_eq!(stats.totals.output_tokens, 50);
    }

    #[test]
    fn codex_repeated_identical_totals_are_not_counted_twice() {
        // A real rollout emits the same cumulative value 2-3 times in a row.
        // Each repeat would otherwise become a zero-token request, inflating the
        // request count without changing the tokens.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
                &codex_token_count("2026-08-19T03:42:01.000Z", 100, 0, 10),
                &codex_token_count("2026-08-19T03:42:02.000Z", 100, 0, 10),
                &codex_token_count("2026-08-19T03:43:00.000Z", 300, 0, 30),
            ],
        );

        let stats = aggregate_codex(&path);

        assert_eq!(stats.totals.request_count, 2);
        assert_eq!(stats.totals.input_tokens, 300);
        assert_eq!(stats.totals.output_tokens, 30);
    }

    #[test]
    fn codex_negative_delta_restarts_the_running_total() {
        // A fork or resume resets the cumulative counter mid-file. Diffing
        // across that boundary would yield negative tokens; the event is
        // instead treated as a fresh start.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 1000, 0, 100),
                &codex_token_count("2026-08-19T03:43:00.000Z", 50, 0, 5),
                &codex_token_count("2026-08-19T03:44:00.000Z", 120, 0, 12),
            ],
        );

        let stats = aggregate_codex(&path);

        assert_eq!(stats.totals.request_count, 3);
        // 1000 (first) + 50 (restart) + 70 (delta) = 1120.
        assert_eq!(stats.totals.input_tokens, 1120);
        // 100 (first) + 5 (restart) + 7 (delta) = 112.
        assert_eq!(stats.totals.output_tokens, 112);
    }

    #[test]
    fn codex_per_turn_deltas_sum_back_to_the_final_cumulative_total() {
        // The invariant that guards the 350x lesson recorded at the top of this
        // file: whatever the split produces must add back up to the last
        // cumulative value the session reported. If a future change reverts to
        // summing the cumulative values, this fails immediately.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 17063, 0, 500),
                &codex_token_count("2026-08-19T03:42:01.000Z", 17063, 0, 500),
                &codex_token_count("2026-08-19T03:43:00.000Z", 39956, 9600, 1200),
                &codex_token_count("2026-08-19T03:44:00.000Z", 76853, 30000, 2400),
            ],
        );

        let parsed = parse_codex_file(&path);
        let summed_input: i64 = parsed.entries.iter().map(|e| e.usage.input_tokens).sum();
        let summed_cache_read: i64 = parsed
            .entries
            .iter()
            .map(|e| e.usage.cache_read_tokens)
            .sum();
        let summed_output: i64 = parsed.entries.iter().map(|e| e.usage.output_tokens).sum();

        // Final cumulative: 76853 input of which 30000 cached -> 46853 uncached.
        assert_eq!(summed_input, 46_853);
        assert_eq!(summed_cache_read, 30_000);
        assert_eq!(summed_output, 2_400);
    }

    #[test]
    fn codex_turn_response_id_comes_from_assistant_items_only() {
        // `rs_` (reasoning) and `fc_` (function_call) ids embed the upstream
        // Responses uuid and only appear in assistant output. `fco_` is the
        // client's own function_call_output and `msg_` on a user/developer turn
        // is a client-side conversation id — neither can join to a proxy row.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                r#"{"timestamp":"2026-08-19T03:41:51.000Z","type":"response_item","payload":{"type":"message","role":"user","id":"msg_01a0601e-a66f-7c42-aabe-6488c2cf7b61"}}"#,
                r#"{"timestamp":"2026-08-19T03:41:52.000Z","type":"response_item","payload":{"type":"reasoning","id":"rs_5d76e101-2615-4e87-8455-72061b36392c"}}"#,
                r#"{"timestamp":"2026-08-19T03:41:53.000Z","type":"response_item","payload":{"type":"function_call_output","id":"fco_01a0601e-fbbc-7e40-be4a-7d80109de16b"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
            ],
        );

        let parsed = parse_codex_file(&path);

        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(
            parsed.entries[0].response_id.as_deref(),
            Some("5d76e101-2615-4e87-8455-72061b36392c")
        );
    }

    #[test]
    fn codex_turn_response_id_falls_back_to_the_encrypted_content_handle() {
        // Current Codex builds write reasoning items whose `id` is a locally
        // generated v4 with no prefix, so nothing joins on the id alone. The
        // upstream handle is in `encrypted_content` instead, with a `-<n>` index
        // when one response carried several reasoning items. A real rollout of
        // this shape contributed 929 such handles, of which 436 matched a proxy
        // row — every one of those turns used to read as unproxied spend.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-10-02T19:51:50.476Z","type":"turn_context","payload":{"model":"deepseek-v4-flash"}}"#,
                r#"{"timestamp":"2026-10-02T19:51:50.766Z","type":"response_item","payload":{"type":"reasoning","id":"e34d9c8c-2549-42f2-b07f-ddb454ed7a6a","encrypted_content":"c96a18b7-aaa4-4a74-b482-b2caddb0faab-0"}}"#,
                &codex_token_count("2026-10-02T19:52:00.000Z", 100, 0, 10),
            ],
        );

        let parsed = parse_codex_file(&path);

        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(
            parsed.entries[0].response_id.as_deref(),
            Some("c96a18b7-aaa4-4a74-b482-b2caddb0faab"),
            "the `-0` index must be dropped so the key matches the proxy row"
        );
    }

    #[test]
    fn codex_encrypted_content_is_read_only_when_it_leads_with_a_uuid() {
        // Every other producer of this field must stay unreadable, or a turn
        // joins a proxy row it has nothing to do with.
        assert_eq!(
            encrypted_content_response_id("c96a18b7-aaa4-4a74-b482-b2caddb0faab-0"),
            Some("c96a18b7-aaa4-4a74-b482-b2caddb0faab".to_string())
        );
        assert_eq!(
            encrypted_content_response_id("c96a18b7-aaa4-4a74-b482-b2caddb0faab"),
            Some("c96a18b7-aaa4-4a74-b482-b2caddb0faab".to_string())
        );
        // Leading or trailing whitespace is a transcript artefact, not a
        // different id.
        assert_eq!(
            encrypted_content_response_id("  c96a18b7-aaa4-4a74-b482-b2caddb0faab-12\n"),
            Some("c96a18b7-aaa4-4a74-b482-b2caddb0faab".to_string())
        );
        // This app's own marker on a proxied Anthropic turn.
        assert_eq!(
            encrypted_content_response_id("ai-switch-anthropic:abc"),
            None
        );
        // A base64 blob that merely starts with uuid-shaped characters.
        assert_eq!(
            encrypted_content_response_id("c96a18b7-aaa4-4a74-b482-b2caddb0faabZ"),
            None
        );
        assert_eq!(encrypted_content_response_id("wbm1:SW50ZXJlc3Q"), None);
        assert_eq!(encrypted_content_response_id(""), None);
        assert_eq!(encrypted_content_response_id("not-a-uuid"), None);
        // Uppercase hex is not what any producer writes, and accepting it would
        // only ever match nothing.
        assert_eq!(
            encrypted_content_response_id("C96A18B7-AAA4-4A74-B482-B2CADDB0FAAB"),
            None
        );
        // Too short to be a uuid.
        assert_eq!(encrypted_content_response_id("c96a18b7-aaa4"), None);
    }

    #[test]
    fn codex_encrypted_content_is_ignored_on_a_non_reasoning_item() {
        // Only reasoning carries the upstream handle. Anywhere else the same
        // field is an opaque blob, so a turn must not claim an id from it.
        let payload = serde_json::json!({
            "type": "message",
            "role": "assistant",
            "id": "5b8c9d0e-1f2a-4c3b-8d7e-6a5b4c3d2e1f",
            "encrypted_content": "c96a18b7-aaa4-4a74-b482-b2caddb0faab-0",
        });

        assert_eq!(codex_assistant_response_id(&payload), None);
    }

    #[test]
    fn a_prefixed_item_id_wins_over_the_encrypted_content_handle() {
        // The item id is minted by the upstream itself, so it is the stronger
        // key: two reasoning items in one response share an `encrypted_content`
        // uuid but carry distinct `rs_` ids.
        let payload = serde_json::json!({
            "type": "reasoning",
            "id": "rs_5d76e101-2615-4e87-8455-72061b36392c",
            "encrypted_content": "c96a18b7-aaa4-4a74-b482-b2caddb0faab-0",
        });

        assert_eq!(
            codex_assistant_response_id(&payload).as_deref(),
            Some("5d76e101-2615-4e87-8455-72061b36392c")
        );
    }

    #[test]
    fn function_call_ids_only_lose_a_numeric_tail() {
        // The trailing `_0` on `fc_<uuid>_0` is an index and has to go. The
        // underscores inside a provider's own id must not: cutting at the last
        // one turned every `fc_toolu_bdrk_*` id into the key `toolu_bdrk`, so
        // unrelated turns matched each other's proxy rows.
        assert_eq!(strip_trailing_index("9wU3abc_0"), "9wU3abc");
        assert_eq!(
            strip_trailing_index("toolu_bdrk_01MYabc"),
            "toolu_bdrk_01MYabc"
        );
        assert_eq!(strip_trailing_index("call_9wU3abc"), "call_9wU3abc");
        // Nothing sensible is left if the whole id is an index.
        assert_eq!(strip_trailing_index("_0"), "_0");
        assert_eq!(strip_trailing_index("plain"), "plain");
    }

    #[test]
    fn codex_turn_response_id_keeps_a_function_call_uuid_intact() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                r#"{"timestamp":"2026-08-19T03:41:52.000Z","type":"response_item","payload":{"type":"function_call","id":"fc_toolu_bdrk_01MYabcdef_0"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
            ],
        );

        let parsed = parse_codex_file(&path);

        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(
            parsed.entries[0].response_id.as_deref(),
            Some("toolu_bdrk_01MYabcdef")
        );
    }

    #[test]
    fn claude_rows_are_deduplicated_by_message_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        // The same message id appears three times, as resume/compaction produces.
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[
                &claude_line("msg_1", "claude-opus-5", 1_000_000, 0),
                &claude_line("msg_1", "claude-opus-5", 1_000_000, 0),
                &claude_line("msg_2", "claude-opus-5", 0, 1_000_000),
            ],
        );

        let stats = aggregate_claude(&path);

        assert_eq!(
            stats.totals.request_count, 2,
            "duplicate id must be dropped"
        );
        assert_eq!(stats.totals.input_tokens, 1_000_000);
        assert_eq!(stats.totals.output_tokens, 1_000_000);
        // 1M input at $5 + 1M output at $25.
        assert_eq!(stats.totals.cost_micros, 30_000_000);
    }

    #[test]
    fn claude_dedup_spans_multiple_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[&claude_line("msg_shared", "claude-opus-5", 500, 0)],
        );
        let second = write_jsonl(
            dir.path(),
            "b.jsonl",
            &[&claude_line("msg_shared", "claude-opus-5", 500, 0)],
        );

        let stats = aggregate(
            &[(&first, Provider::Claude), (&second, Provider::Claude)],
            TimeWindow::default(),
        );

        assert_eq!(stats.totals.request_count, 1);
    }

    /// A resumed Codex thread can replay an earlier turn's `token_count` into a
    /// second file. With no cross-file id these turns used to be counted twice;
    /// the response id (or an exact fingerprint) now deduplicates them.
    #[test]
    fn codex_turns_are_deduplicated_across_files_by_response_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                r#"{"timestamp":"2026-08-19T03:41:52.000Z","type":"response_item","payload":{"type":"reasoning","id":"rs_shared-uuid"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
            ],
        );
        let second = write_jsonl(
            dir.path(),
            "b.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                r#"{"timestamp":"2026-08-19T03:41:52.000Z","type":"response_item","payload":{"type":"reasoning","id":"rs_shared-uuid"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
            ],
        );

        let stats = aggregate(
            &[(&first, Provider::Codex), (&second, Provider::Codex)],
            TimeWindow::default(),
        );

        assert_eq!(
            stats.totals.request_count, 1,
            "the same response id in two files must be counted once"
        );
        assert_eq!(stats.totals.input_tokens, 100);
    }

    /// Without a response id, an exact fingerprint (model + tokens + millisecond
    /// timestamp) still collapses a verbatim replay across files.
    #[test]
    fn codex_turns_without_id_deduplicate_on_an_exact_fingerprint() {
        let dir = tempfile::tempdir().expect("tempdir");
        let make = |name: &str| {
            write_jsonl(
                dir.path(),
                name,
                &[
                    r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                    &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
                ],
            )
        };
        let first = make("a.jsonl");
        let second = make("b.jsonl");

        let stats = aggregate(
            &[(&first, Provider::Codex), (&second, Provider::Codex)],
            TimeWindow::default(),
        );

        assert_eq!(
            stats.totals.request_count, 1,
            "a verbatim replay with no id must dedup on its fingerprint"
        );
    }

    /// Two genuinely distinct turns that happen to share a model must not be
    /// folded together: different timestamps keep their fingerprints apart.
    #[test]
    fn codex_distinct_turns_are_not_merged_by_fingerprint() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
                &codex_token_count("2026-08-19T03:43:00.000Z", 300, 0, 30),
            ],
        );

        let stats = aggregate_codex(&path);

        assert_eq!(
            stats.totals.request_count, 2,
            "distinct-timestamp turns must both count"
        );
    }

    #[test]
    fn claude_skips_synthetic_messages() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[
                &claude_line("msg_1", "<synthetic>", 999, 999),
                &claude_line("msg_2", "claude-opus-5", 10, 10),
            ],
        );

        let stats = aggregate_claude(&path);

        assert_eq!(stats.totals.request_count, 1);
        assert_eq!(stats.totals.input_tokens, 10);
    }

    #[test]
    fn claude_counts_vendor_prefixed_models() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[&claude_line(
                "msg_1",
                "anthropic/claude-opus-5-aws",
                1_000_000,
                0,
            )],
        );

        let stats = aggregate_claude(&path);

        assert_eq!(stats.totals.cost_micros, 5_000_000);
        assert_eq!(stats.totals.unpriced_request_count, 0);
    }

    #[test]
    fn codex_turns_never_sum_the_cumulative_totals() {
        // The original form of this test pinned "one row per file". Turns are
        // now split out per event, but the property it guarded still holds: the
        // tokens must equal the final cumulative value, never the sum of every
        // cumulative snapshot (which overstated one real file by 350x).
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
                &codex_token_count("2026-08-19T03:43:00.000Z", 300, 0, 30),
                &codex_token_count("2026-08-19T03:44:00.000Z", 1000, 200, 50),
            ],
        );

        let stats = aggregate_codex(&path);

        // Summing the snapshots would give 1400 input; the correct answer is
        // the final cumulative value, 1000, minus the 200 cached portion.
        assert_eq!(stats.totals.input_tokens, 800);
        assert_eq!(stats.totals.cache_read_tokens, 200);
        assert_eq!(stats.totals.output_tokens, 50);
        assert_eq!(stats.by_model[0].model, "gpt-5.6-sol");
    }

    /// A subagent spawn or fork replays the parent's transcript at the head of
    /// the new file. Counting it charged the parent's spend twice, and since the
    /// replay precedes the file's only `turn_context` it landed under `unknown` —
    /// 413M tokens on the author's corpus.
    #[test]
    fn codex_forked_rollout_skips_the_replayed_parent_prefix() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.400Z","type":"session_meta","payload":{"id":"019fd099","forked_from_id":"019fcbb9","parent_thread_id":"019fcbb9"}}"#,
                // The parent's history, dumped at the fork instant.
                r#"{"timestamp":"2026-08-19T03:41:50.410Z","type":"response_item","payload":{"type":"reasoning","id":"rs_parent-turn"}}"#,
                &codex_token_count("2026-08-19T03:41:50.410Z", 1_000, 200, 100),
                &codex_token_count("2026-08-19T03:41:50.411Z", 1_600, 400, 160),
                // This thread's own work starts here.
                r#"{"timestamp":"2026-08-19T03:41:50.500Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 1_900, 500, 200),
            ],
        );

        let parsed = parse_codex_file(&path);

        // One turn, and its tokens are the delta from the inherited running
        // total (300 input of which 100 cached, 40 output) — not the 1900 the
        // cumulative figure would have charged.
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].model, "gpt-5.6-sol");
        assert_eq!(parsed.entries[0].usage.input_tokens, 200);
        assert_eq!(parsed.entries[0].usage.cache_read_tokens, 100);
        assert_eq!(parsed.entries[0].usage.output_tokens, 40);
        // The parent's trailing response id stays with the parent's entry.
        assert_eq!(parsed.entries[0].response_id, None);
    }

    #[test]
    fn codex_unforked_rollout_counts_usage_before_its_turn_context() {
        // The skip above keys off the fork marker, not off `turn_context`
        // ordering: a plain session that reports usage first is still real spend.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.400Z","type":"session_meta","payload":{"id":"019fd099"}}"#,
                &codex_token_count("2026-08-19T03:42:00.000Z", 100, 0, 10),
                r#"{"timestamp":"2026-08-19T03:42:30.000Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
                &codex_token_count("2026-08-19T03:43:00.000Z", 300, 0, 30),
            ],
        );

        let stats = aggregate_codex(&path);

        assert_eq!(stats.totals.request_count, 2);
        assert_eq!(stats.totals.input_tokens, 300);
        assert_eq!(stats.totals.output_tokens, 30);
    }

    #[test]
    fn codex_rollout_without_model_is_reported_as_unpriced() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "rollout.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:42:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10}}}}"#,
            ],
        );

        let stats = aggregate_codex(&path);

        // The tokens are still counted; only the cost is unknown.
        assert_eq!(stats.totals.input_tokens, 100);
        assert_eq!(stats.totals.cost_micros, 0);
        assert_eq!(stats.totals.unpriced_request_count, 1);
        assert!(!stats.by_model[0].priced);
    }

    #[test]
    fn time_window_filters_by_timestamp() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[
                &format!(
                    r#"{{"timestamp":"2026-08-01T00:00:00.000Z","message":{{"id":"old","model":"claude-opus-5","usage":{{"input_tokens":5,"output_tokens":0}}}}}}"#
                ),
                &format!(
                    r#"{{"timestamp":"2026-08-20T00:00:00.000Z","message":{{"id":"new","model":"claude-opus-5","usage":{{"input_tokens":7,"output_tokens":0}}}}}}"#
                ),
            ],
        );

        let cutoff = chrono::DateTime::parse_from_rfc3339("2026-08-10T00:00:00Z")
            .unwrap()
            .timestamp_millis();

        let stats = aggregate(
            &[(&path, Provider::Claude)],
            TimeWindow {
                start_ms: Some(cutoff),
                end_ms: None,
            },
        );

        assert_eq!(stats.totals.request_count, 1);
        assert_eq!(stats.totals.input_tokens, 7);
    }

    #[test]
    fn collected_entries_carry_the_response_id_and_respect_dedup() {
        // Mirrors what collect_session_entries does, without touching the real
        // home directory: the same message id in two files yields one entry,
        // and the response id survives for merging.
        let dir = tempfile::tempdir().expect("tempdir");
        let first = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[&claude_line("msg_shared", "claude-opus-5", 500, 0)],
        );
        let second = write_jsonl(
            dir.path(),
            "b.jsonl",
            &[&claude_line("msg_shared", "claude-opus-5", 500, 0)],
        );

        let mut seen = HashSet::new();
        let mut collected = Vec::new();
        for path in [&first, &second] {
            for entry in parse_claude_file(path).entries {
                if let Some(key) = &entry.dedup_key {
                    if !seen.insert(key.clone()) {
                        continue;
                    }
                }
                collected.push(entry);
            }
        }

        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].response_id.as_deref(), Some("msg_shared"));
    }

    #[test]
    fn malformed_lines_do_not_abort_the_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[
                "not json at all",
                r#"{"message":{"id":"no_usage","model":"claude-opus-5"}}"#,
                &claude_line("msg_ok", "claude-opus-5", 42, 0),
                "{\"truncated\": ",
            ],
        );

        let stats = aggregate_claude(&path);

        assert_eq!(stats.totals.request_count, 1);
        assert_eq!(stats.totals.input_tokens, 42);
    }

    #[test]
    fn provider_and_model_rollups_are_separated() {
        let dir = tempfile::tempdir().expect("tempdir");
        let claude = write_jsonl(
            dir.path(),
            "c.jsonl",
            &[
                &claude_line("m1", "claude-opus-5", 1_000_000, 0),
                &claude_line("m2", "claude-haiku-4-5", 1_000_000, 0),
            ],
        );
        let codex = write_jsonl(
            dir.path(),
            "x.jsonl",
            &[
                r#"{"timestamp":"2026-08-19T03:41:50.476Z","payload":{"model":"gpt-5.6-sol"}}"#,
                r#"{"timestamp":"2026-08-19T03:42:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"output_tokens":0}}}}"#,
            ],
        );

        let stats = aggregate(
            &[(&claude, Provider::Claude), (&codex, Provider::Codex)],
            TimeWindow::default(),
        );

        assert_eq!(stats.by_model.len(), 3);
        assert_eq!(stats.by_provider.len(), 2);
        // Opus at $5/MTok is the most expensive row and must sort first.
        assert_eq!(stats.by_model[0].model, "claude-opus-5");
        let claude_total = stats
            .by_provider
            .iter()
            .find(|row| row.provider == "claude")
            .expect("claude rollup");
        assert_eq!(claude_total.totals.request_count, 2);
        assert_eq!(claude_total.totals.cost_micros, 6_000_000); // $5 + $1
    }

    #[test]
    fn empty_window_yields_no_usage() {
        // A window in the far future matches nothing, so the aggregate must be
        // empty regardless of what the corpus contains. Uses fixtures rather
        // than `scan_session_usage` so the test never reads the real home
        // directory (which would make it machine-dependent and slow).
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[&claude_line("msg_1", "claude-opus-5", 100, 0)],
        );

        let stats = aggregate(
            &[(&path, Provider::Claude)],
            TimeWindow {
                start_ms: Some(i64::MAX - 1),
                end_ms: Some(i64::MAX),
            },
        );

        assert_eq!(stats.totals, SessionUsageTotals::default());
        assert!(!stats.truncated);
    }

    #[test]
    fn cached_parse_is_reused_and_invalidated_on_change() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_jsonl(
            dir.path(),
            "a.jsonl",
            &[&claude_line("msg_1", "claude-opus-5", 100, 0)],
        );

        let first = parsed_file(&path, Provider::Claude);
        let second = parsed_file(&path, Provider::Claude);
        assert!(
            Arc::ptr_eq(&first, &second),
            "unchanged file should hit the cache"
        );
        assert_eq!(first.entries.len(), 1);

        // Appending changes both size and mtime, so the cache must re-parse.
        // Sleep past filesystem mtime granularity: a same-millisecond append
        // would otherwise be indistinguishable if the size also matched.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("reopen fixture");
        writeln!(file, "{}", claude_line("msg_2", "claude-opus-5", 200, 0))
            .expect("append fixture");
        drop(file);

        let third = parsed_file(&path, Provider::Claude);
        assert!(
            !Arc::ptr_eq(&first, &third),
            "changed file must invalidate the cache"
        );
        assert_eq!(third.entries.len(), 2);
    }
}

/// Manual validation against the real session corpus on this machine.
///
/// Ignored by default: it reads the user's actual `~/.claude` and `~/.codex`
/// directories, so results vary per machine and a cold run touches gigabytes.
/// Run with `cargo test --lib real_corpus -- --ignored --nocapture` to check the
/// counting rules against known-good figures and to see cold/warm timings.
#[cfg(test)]
mod real_corpus {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore]
    fn report_real_usage_and_cache_speedup() {
        let cold_start = Instant::now();
        let cold = scan_session_usage(TimeWindow::default());
        let cold_elapsed = cold_start.elapsed();

        let warm_start = Instant::now();
        let warm = scan_session_usage(TimeWindow::default());
        let warm_elapsed = warm_start.elapsed();

        println!("files scanned      : {}", cold.scanned_file_count);
        println!("truncated          : {}", cold.truncated);
        println!("requests           : {}", cold.totals.request_count);
        println!("input tokens       : {}", cold.totals.input_tokens);
        println!("output tokens      : {}", cold.totals.output_tokens);
        println!("cache write tokens : {}", cold.totals.cache_write_tokens);
        println!("cache read tokens  : {}", cold.totals.cache_read_tokens);
        println!(
            "estimated cost     : ${:.2}",
            cold.totals.cost_micros as f64 / 1_000_000.0
        );
        println!(
            "unpriced requests  : {}",
            cold.totals.unpriced_request_count
        );
        println!("cold scan          : {:.2}s", cold_elapsed.as_secs_f64());
        println!("warm scan          : {:.2}s", warm_elapsed.as_secs_f64());
        for row in cold.by_provider.iter() {
            println!(
                "  provider {:<8} requests={:<6} cost=${:.2}",
                row.provider,
                row.totals.request_count,
                row.totals.cost_micros as f64 / 1_000_000.0
            );
        }
        for row in cold.by_model.iter().take(8) {
            println!(
                "  model {:<38} priced={:<5} requests={:<6} cost=${:.2}",
                row.model,
                row.priced,
                row.totals.request_count,
                row.totals.cost_micros as f64 / 1_000_000.0
            );
        }

        // The corpus is live and append-only — an agent may write to its own
        // transcript while this runs — so the warm scan can legitimately see
        // more. It must never see less.
        assert!(
            warm.totals.request_count >= cold.totals.request_count,
            "warm scan lost requests: {} -> {}",
            cold.totals.request_count,
            warm.totals.request_count
        );
        assert!(
            warm.totals.cost_micros >= cold.totals.cost_micros,
            "warm scan lost cost"
        );
    }
}

#[cfg(test)]
#[path = "session_usage_service/codex_record_tests.rs"]
mod codex_record_tests;
