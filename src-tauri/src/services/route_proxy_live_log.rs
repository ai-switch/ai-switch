//! Live request log for the route proxy.
//!
//! Captures the four stages of every proxied request (inbound client request,
//! transformed upstream request, raw upstream response, final client response)
//! so the UI can tail them live for troubleshooting — especially protocol
//! conversions where the four stages differ.
//!
//! The bounded ring buffer in memory is the authoritative copy: it is what the
//! UI reads and what the diagnostics export packs up.
//! [`RouteProxyLiveLog::persist_to`] adds a durable mirror of it under
//! `AppPaths::logs_dir`, because the entry a user needs to send is usually the
//! one recorded *before* the restart they did while trying to fix it.
//!
//! Live updates are pushed through the shared [`EventEmitter`] (Tauri `emit` on
//! the desktop, WebSocket broadcast on the headless server) only while at least
//! one viewer is subscribed.

use crate::services::brotli_codec;
use crate::web::event_bridge::EventEmitter;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

pub const ROUTE_PROXY_LIVE_LOG_EVENT: &str = "route-proxy-live-log";

/// Newest N entries kept in memory (per whole proxy, not per platform).
///
/// Sized for a support workflow rather than for a live view: a user who hits a
/// problem is expected to export this and send it, so the window has to span
/// enough turns to contain the one that misbehaved.
///
/// The cost is real and worth stating plainly. A single entry carries four stage
/// previews at up to 64 KB each, so measured against real traffic (~149 KB per
/// entry) this is roughly **150 MB of resident memory** — the app's largest
/// in-memory structure by a wide margin — and the on-disk mirror holds the same
/// window. The mirror is what makes the size defensible: rotated segments are
/// brotli-compressed (see [`LIVE_LOG_SEGMENT_MAX_BYTES`]), so ~3 MB of disk
/// carries what would otherwise be ~193 MB, and the export of a full window
/// lands near 1.5 MB. Lower this if the memory trade stops being worth it;
/// nothing else depends on the exact number.
pub(crate) const LIVE_LOG_CAPACITY: usize = 1000;
/// Max bytes retained per stage before truncation.
pub(crate) const LIVE_LOG_STAGE_LIMIT: usize = 64 * 1024;

/// How many raw bytes of a streaming response [`StreamObserver`] keeps before
/// the preview is handed to the live log.
///
/// Deliberately several times [`LIVE_LOG_STAGE_LIMIT`], and that ratio is the
/// whole point. A Responses gateway echoes the entire request back inside its
/// opening `response.created` event; measured against a real gateway that one
/// event ran to ~63 KB — `instructions` at 55.5 KB plus `tools` at 7.8 KB,
/// against a 64 KB stage budget. Boilerplate that size has to be *stripped*
/// before the preview is cut, which means the observer has to hold enough raw
/// bytes for both halves of the job: the echo that gets removed and the real
/// events behind it that must survive the cut. Capped at the stage limit
/// instead, the redaction would find nothing left to free and nothing left to
/// show — the reasoning deltas it exists to reveal sit just past the echo, in
/// bytes the observer had already discarded.
///
/// [`StreamObserver`]: crate::services::route_proxy_stream::StreamObserver
pub(crate) const LIVE_LOG_RAW_PREVIEW_LIMIT: usize = 4 * LIVE_LOG_STAGE_LIMIT;

/// File the live log is appended to, inside `AppPaths::logs_dir`.
pub const LIVE_LOG_FILE_NAME: &str = "route-proxy-live-log.jsonl";
/// A rotated segment is `route-proxy-live-log.000007.jsonl.br`.
///
/// The suffix is what tells a finished segment from the file still being
/// appended to: both share the prefix, but only a rotated one is compressed.
const LIVE_LOG_SEGMENT_PREFIX: &str = "route-proxy-live-log.";
const LIVE_LOG_SEGMENT_SUFFIX: &str = ".jsonl.br";

/// Bytes at which the current file is rotated into a compressed segment.
const LIVE_LOG_SEGMENT_MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Compressed segments kept beside the current file.
///
/// Sized to the *worst* entry rather than the average, because the window still
/// has to cover [`LIVE_LOG_CAPACITY`] entries when every one of them is large:
/// the biggest entry measured was 193 KB, so a full window can reach ~193 MB,
/// and six 32 MB segments plus a partial current file clears that. Compressing
/// segments keeps such a window near 3 MB of disk instead of 193 MB.
const LIVE_LOG_MAX_SEGMENTS: usize = 6;

/// Serialized entries buffered for the writer before
/// [`RouteProxyLiveLog::record`] gives up on the file.
///
/// `record` runs on the request path, so it must never wait for a ~150 KB write.
/// A full queue drops the line instead: the ring is authoritative and the file
/// is its mirror, so a drop costs a gap in the file, never a stalled request.
const LIVE_LOG_WRITE_QUEUE: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteProxyLiveLogEntry {
    pub id: String,
    pub trace_id: Option<String>,
    pub platform: String,
    pub credential_id: String,
    pub credential_name: String,
    pub attempt: usize,
    pub path: String,
    pub target_url: Option<String>,
    /// Headers actually sent upstream, one `name: value` per line, sorted.
    ///
    /// Credential-bearing values are masked. The identity headers the proxy
    /// injects to look like an official CLI stay visible — they are what a
    /// fingerprinting gateway accepts or rejects on, so this is the field that
    /// makes an `unauthorized client detected` diagnosable. Defaulted so older
    /// payloads stay compatible.
    #[serde(default)]
    pub upstream_headers: Option<String>,
    pub requested_model: Option<String>,
    pub upstream_model: Option<String>,
    pub status: Option<u16>,
    pub success: bool,
    pub error_message: Option<String>,
    pub duration_ms: i64,
    /// Protocol bridge kind applied (e.g. codex responses->chat); None when the
    /// request was forwarded without conversion.
    pub bridge: Option<String>,
    pub client_request: Option<String>,
    pub upstream_request: Option<String>,
    pub upstream_response: Option<String>,
    pub final_response: Option<String>,
    /// How many frames of the upstream stream carried reasoning text, when the
    /// proxy watched that stream from start to finish.
    ///
    /// `None` means nobody counted — a buffered reply, or an entry recorded
    /// before this field existed — and must not be read as zero. `Some(0)` is
    /// the interesting one: the upstream was watched and never reasoned, which
    /// is a fact about the upstream rather than about this log. It is recorded
    /// as a count instead of being inferred from `upstream_response` because
    /// that string is capped, redacted and cut, so the deltas can be missing
    /// from it while still having happened.
    #[serde(default)]
    pub upstream_reasoning_deltas: Option<usize>,
    /// Non-error diagnostics surfaced for troubleshooting, e.g. a bridged
    /// upstream that completed a turn without emitting any tool call. Defaulted
    /// so older payloads/consumers stay compatible.
    #[serde(default)]
    pub notes: Vec<String>,
    pub truncated: bool,
    /// Which of the four stages hit [`LIVE_LOG_STAGE_LIMIT`], as field names
    /// (`client_request`, `upstream_request`, `upstream_response`,
    /// `final_response`).
    ///
    /// [`Self::truncated`] is the OR of all four, which is not enough to reason
    /// about any single stage: a 60 KB prompt makes the two *request* stages
    /// truncate on nearly every turn, while the stage a caller actually cares
    /// about — the upstream response — may be complete. Worse, the reverse
    /// happens with Responses upstreams, whose opening `response.created` event
    /// echoes the whole input and blows the limit on its own, so the response
    /// stage truncates while the requests do not. Consumers that draw
    /// conclusions from "this stage has no X" must consult this list, not
    /// `truncated`. Defaulted so older payloads stay compatible.
    ///
    /// Absence from this list means nothing was dropped to fit the budget — not
    /// that the stage is a verbatim copy. The caller may still have summarised
    /// boilerplate fields (see `redact_verbose_request_fields`) before the
    /// preview was taken.
    #[serde(default)]
    pub truncated_stages: Vec<String>,
    pub created_at: String,
}

/// How much of a truncated body's tail to keep alongside its head.
///
/// Request bodies put the bulk first and the interesting scalars last: a
/// Responses request serializes `input` before `max_output_tokens`, `stream` and
/// `reasoning`, and a Codex request puts `tools` and `include` after it as well.
/// A head-only cut therefore hides exactly the fields that explain why an
/// upstream behaved the way it did — whether reasoning was even asked for, which
/// model was named, whether the call was meant to stream.
const LIVE_LOG_STAGE_TAIL: usize = 16 * 1024;

/// Marker inserted where the omitted middle of a truncated body was.
pub(crate) const LIVE_LOG_ELISION_MARKER: &str = "ai-switch-live-log: omitted";

/// Truncate a captured body to the per-stage limit and lossily decode to text.
/// Returns `(text, truncated)`. `None` inputs pass through as `(None, false)`.
///
/// Truncation keeps the head *and* the tail: the head carries the conversation,
/// the tail carries the trailing scalar fields, and only the middle is dropped.
pub fn stage_preview(body: Option<&[u8]>) -> (Option<String>, bool) {
    let Some(body) = body else {
        return (None, false);
    };
    if body.is_empty() {
        return (None, false);
    }
    if body.len() <= LIVE_LOG_STAGE_LIMIT {
        return (Some(String::from_utf8_lossy(body).to_string()), false);
    }
    let head_end = LIVE_LOG_STAGE_LIMIT - LIVE_LOG_STAGE_TAIL;
    let tail_start = body.len() - LIVE_LOG_STAGE_TAIL;
    let omitted = tail_start - head_end;
    let mut preview = String::with_capacity(LIVE_LOG_STAGE_LIMIT + 128);
    preview.push_str(&String::from_utf8_lossy(&body[..head_end]));
    preview.push_str(&format!(
        "\n...[{LIVE_LOG_ELISION_MARKER} {omitted} bytes]...\n"
    ));
    preview.push_str(&String::from_utf8_lossy(&body[tail_start..]));
    (Some(preview), true)
}

/// Names of the stages that truncated, in the order the four stage flags are
/// passed. Pair with [`RouteProxyLiveLogEntry::truncated_stages`].
pub fn truncated_stage_names(
    client_request: bool,
    upstream_request: bool,
    upstream_response: bool,
    final_response: bool,
) -> Vec<String> {
    [
        ("client_request", client_request),
        ("upstream_request", upstream_request),
        ("upstream_response", upstream_response),
        ("final_response", final_response),
    ]
    .into_iter()
    .filter(|(_, truncated)| *truncated)
    .map(|(name, _)| name.to_string())
    .collect()
}

#[derive(Default)]
struct LiveLogState {
    /// Entries are behind an `Arc` so that reading the ring is a refcount bump
    /// rather than a deep copy of up to ~150 KB per entry. Two readers depend on
    /// that: `record` (which keeps a handle for the sink and the emitter) and
    /// `snapshot` (which the diagnostics export calls on the whole window —
    /// measured at ~70 ms as a deep copy, and it holds this very mutex, the one
    /// the request path takes).
    buffer: VecDeque<Arc<RouteProxyLiveLogEntry>>,
    subscribers: usize,
    emitter: Option<EventEmitter>,
    /// Present once [`RouteProxyLiveLog::persist_to`] has attached a file.
    sink: Option<mpsc::Sender<String>>,
}

#[derive(Clone, Default)]
pub struct RouteProxyLiveLog {
    inner: Arc<Mutex<LiveLogState>>,
}

impl RouteProxyLiveLog {
    pub fn set_emitter(&self, emitter: EventEmitter) {
        let mut state = self.inner.lock().expect("route proxy live log lock");
        state.emitter = Some(emitter);
    }

    /// Push an entry into the ring buffer, and emit it live when someone is
    /// watching. Recording always happens so a freshly opened viewer sees
    /// recent history; emission is gated to avoid pushing to idle webviews.
    pub fn record(&self, entry: RouteProxyLiveLogEntry) {
        // Boxed once, then handed around by reference count: the ring, the file
        // sink and the emitter all want the same entry, and copying it three
        // times per proxied request was pure waste.
        let entry = Arc::new(entry);
        let (emitter, sink) = {
            let mut state = self.inner.lock().expect("route proxy live log lock");
            if state.buffer.len() >= LIVE_LOG_CAPACITY {
                state.buffer.pop_front();
            }
            state.buffer.push_back(Arc::clone(&entry));
            let emitter = if state.subscribers > 0 {
                state.emitter.clone()
            } else {
                None
            };
            (emitter, state.sink.clone())
        };
        if let Some(sink) = sink {
            // Serialized outside the lock, and handed over with `try_send`: an
            // entry is ~150 KB of JSON, and formatting it while holding the ring
            // would put every concurrent request behind this one. Two requests
            // that finish together can therefore reach the file in either order
            // — the ring keeps the order the UI reads, and the file only has to
            // contain the entries.
            if let Ok(line) = serde_json::to_string(&entry) {
                let _ = sink.try_send(line);
            }
        }
        if let Some(emitter) = emitter {
            emitter.emit(ROUTE_PROXY_LIVE_LOG_EVENT, &entry);
        }
    }

    /// Mirror every recorded entry into `dir`, and restore the newest entries
    /// already there.
    ///
    /// Returns the writer for the caller to spawn rather than spawning it here:
    /// this layer does not get to pick a runtime, because the desktop app
    /// attaches from a Tauri setup hook (no Tokio context in scope) while the
    /// standalone server is already inside one. `None` when a writer is already
    /// attached, so calling twice cannot leave two tasks appending to one file.
    pub fn persist_to(&self, dir: PathBuf) -> Option<LiveLogFileWriter> {
        let mut state = self.inner.lock().expect("route proxy live log lock");
        if state.sink.is_some() {
            return None;
        }
        let (sink, receiver) = mpsc::channel(LIVE_LOG_WRITE_QUEUE);
        state.sink = Some(sink);
        Some(LiveLogFileWriter {
            dir,
            receiver,
            ring: Arc::clone(&self.inner),
        })
    }

    /// Detach the file so the writer task drains its queue and returns.
    ///
    /// Dropping the sender is what ends `run`: the writer is otherwise waiting
    /// on a channel that the ring keeps alive for the life of the process.
    pub fn stop_persisting(&self) {
        let mut state = self.inner.lock().expect("route proxy live log lock");
        state.sink = None;
    }

    /// Register a viewer and return the current history for its platform
    /// (oldest first).
    ///
    /// Handles rather than copies: both callers serialize the result straight to
    /// JSON, so owning the entries here only bought a deep copy of the window.
    pub fn subscribe(&self, platform: &str) -> Vec<Arc<RouteProxyLiveLogEntry>> {
        let mut state = self.inner.lock().expect("route proxy live log lock");
        state.subscribers += 1;
        state
            .buffer
            .iter()
            .filter(|entry| entry.platform == platform)
            .cloned()
            .collect()
    }

    pub fn unsubscribe(&self) {
        let mut state = self.inner.lock().expect("route proxy live log lock");
        state.subscribers = state.subscribers.saturating_sub(1);
    }

    /// Every entry in the ring, oldest first, regardless of platform.
    ///
    /// Unlike [`Self::subscribe`] this neither filters nor registers a viewer:
    /// the diagnostics export wants the whole buffer, and it must not make the
    /// proxy start emitting to a webview that is not listening.
    ///
    /// Cheap now that the ring holds handles, which matters because this is
    /// called on the whole window while holding the same mutex `record` takes
    /// from the request path.
    pub fn snapshot(&self) -> Vec<Arc<RouteProxyLiveLogEntry>> {
        let state = self.inner.lock().expect("route proxy live log lock");
        state.buffer.iter().cloned().collect()
    }
}

/// Appends the live log to disk, and restores it when the app starts.
///
/// Split out of [`RouteProxyLiveLog`] so the file work happens on a spawned task
/// rather than on the request path, and so the restore — which can be a hundred
/// megabytes of brotli and JSON — does not sit in front of the first window.
pub struct LiveLogFileWriter {
    dir: PathBuf,
    receiver: mpsc::Receiver<String>,
    ring: Arc<Mutex<LiveLogState>>,
}

impl LiveLogFileWriter {
    /// Restore the ring, then append until the sink is dropped.
    pub async fn run(mut self) {
        let mut segment = match LiveLogSegment::open(&self.dir).await {
            Ok(segment) => segment,
            Err(error) => {
                eprintln!(
                    "route proxy live log: cannot write {}: {error}",
                    self.dir.join(LIVE_LOG_FILE_NAME).display()
                );
                // Keep draining rather than returning: a full queue would make
                // every later `record` pay for a `try_send` that cannot succeed.
                while self.receiver.recv().await.is_some() {}
                return;
            }
        };
        let restored = {
            let dir = self.dir.clone();
            // On the blocking pool: this can be tens of megabytes of brotli and
            // JSON, and it must not hold a runtime worker while it runs.
            tokio::task::spawn_blocking(move || read_newest_entries(&dir, LIVE_LOG_CAPACITY))
                .await
                .unwrap_or_default()
        };
        if !restored.is_empty() {
            let mut state = self.ring.lock().expect("route proxy live log lock");
            seed_ring(&mut state, restored);
        }
        while let Some(line) = self.receiver.recv().await {
            if let Err(error) = segment.append(&line).await {
                eprintln!("route proxy live log: append failed: {error}");
            }
        }
    }
}

/// Insert restored entries ahead of everything recorded since startup.
///
/// They are all older, so when the ring already filled while the restore ran it
/// is the *restored* entries that have to give — dropping from the back would
/// throw away the live ones instead.
fn seed_ring(state: &mut LiveLogState, restored: Vec<RouteProxyLiveLogEntry>) {
    let room = LIVE_LOG_CAPACITY.saturating_sub(state.buffer.len());
    let drop_oldest = restored.len().saturating_sub(room);
    // Newest first, pushed to the front, ends up oldest-first ahead of the live
    // entries — the order `subscribe` and the UI both expect.
    for entry in restored.into_iter().skip(drop_oldest).rev() {
        state.buffer.push_front(Arc::new(entry));
    }
}

/// The file currently being appended to, plus its rotation bookkeeping.
struct LiveLogSegment {
    dir: PathBuf,
    /// `None` only while rotating: the handle has to be closed before the file
    /// can be removed, and Windows refuses to delete an open one.
    file: Option<tokio::fs::File>,
    bytes: u64,
    next_seq: u64,
    max_bytes: u64,
}

impl LiveLogSegment {
    async fn open(dir: &Path) -> std::io::Result<Self> {
        Self::open_with_limit(dir, LIVE_LOG_SEGMENT_MAX_BYTES).await
    }

    /// `max_bytes` is a parameter so a test can rotate on every line instead of
    /// writing 32 MB to see the rotation path at all.
    async fn open_with_limit(dir: &Path, max_bytes: u64) -> std::io::Result<Self> {
        tokio::fs::create_dir_all(dir).await?;
        let path = dir.join(LIVE_LOG_FILE_NAME);
        let bytes = tokio::fs::metadata(&path)
            .await
            .map_or(0, |meta| meta.len());
        let next_seq = list_segments(dir).await?.last().map_or(1, |seq| seq + 1);
        Ok(Self {
            dir: dir.to_path_buf(),
            file: Some(open_append(&path).await?),
            bytes,
            next_seq,
            max_bytes,
        })
    }

    /// The open handle, reopening it if a failed rotation closed it.
    ///
    /// Reopening rather than panicking is what keeps one bad rotation from
    /// ending persistence for the rest of the session: the writer task owns the
    /// only copy of the state, so a panic there closes the channel and every
    /// later `record` drops its line with nothing to report it.
    async fn file(&mut self) -> std::io::Result<&mut tokio::fs::File> {
        if self.file.is_none() {
            self.file = Some(open_append(&self.dir.join(LIVE_LOG_FILE_NAME)).await?);
        }
        Ok(self.file.as_mut().expect("just opened"))
    }

    async fn append(&mut self, line: &str) -> std::io::Result<()> {
        // One entry per line is what makes the file parseable line by line, and
        // `serde_json` guarantees it: a newline inside a string is escaped.
        let mut framed = Vec::with_capacity(line.len() + 1);
        framed.extend_from_slice(line.as_bytes());
        framed.push(b'\n');
        self.file().await?.write_all(&framed).await?;
        self.bytes += framed.len() as u64;
        if self.bytes >= self.max_bytes {
            self.rotate().await?;
        }
        Ok(())
    }

    /// Compress the current file into a segment and start a new one.
    ///
    /// A failure leaves the segment usable rather than half-rotated. Resetting
    /// the byte count matters as much as reopening the file: without it, a disk
    /// that stays full would re-compress 32 MB on *every* subsequent line.
    async fn rotate(&mut self) -> std::io::Result<()> {
        let outcome = self.rotate_inner().await;
        if outcome.is_err() {
            self.bytes = 0;
            self.file = None;
        }
        outcome
    }

    async fn rotate_inner(&mut self) -> std::io::Result<()> {
        let current = self.dir.join(LIVE_LOG_FILE_NAME);
        if let Some(mut file) = self.file.take() {
            file.flush().await?;
            drop(file);
        }
        let raw = tokio::fs::read(&current).await?;
        let compressed = tokio::task::spawn_blocking(move || brotli_codec::compress(&raw))
            .await
            .map_err(std::io::Error::other)??;
        // Written under a temporary name and renamed into place: a process that
        // dies mid-write then leaves a `.tmp` (ignored by the scan, because it
        // does not match the segment suffix) instead of a segment that looks
        // finished and decompresses to nothing. The sequence number is never
        // reused, so the rename cannot hit an existing file.
        let target = self.dir.join(segment_file_name(self.next_seq));
        let staging = self
            .dir
            .join(format!("{}.tmp", segment_file_name(self.next_seq)));
        tokio::fs::write(&staging, compressed).await?;
        tokio::fs::rename(&staging, &target).await?;
        tokio::fs::remove_file(&current).await?;
        self.next_seq += 1;
        self.bytes = 0;
        self.file = Some(open_append(&current).await?);
        self.prune().await;
        Ok(())
    }

    /// Drop the oldest segments once the window holds more than it needs.
    async fn prune(&self) {
        let Ok(sequences) = list_segments(&self.dir).await else {
            return;
        };
        let excess = sequences.len().saturating_sub(LIVE_LOG_MAX_SEGMENTS);
        for seq in &sequences[..excess] {
            let _ = tokio::fs::remove_file(self.dir.join(segment_file_name(*seq))).await;
        }
    }
}

/// Read the newest `limit` entries from `dir`, oldest first.
///
/// Walks the files newest-first and stops as soon as it has enough, so a full
/// window usually costs one decompression rather than six. Unreadable or
/// unparseable files are skipped rather than failing the restore: a log that
/// half-exists is still worth showing.
fn read_newest_entries(dir: &Path, limit: usize) -> Vec<RouteProxyLiveLogEntry> {
    let Ok(sequences) = list_segments_blocking(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = sequences
        .iter()
        .map(|seq| dir.join(segment_file_name(*seq)))
        .collect();
    paths.push(dir.join(LIVE_LOG_FILE_NAME));

    let mut newest_first = Vec::new();
    for path in paths.iter().rev() {
        let mut entries = read_entries(path);
        entries.reverse();
        newest_first.extend(entries);
        if newest_first.len() >= limit {
            break;
        }
    }
    newest_first.truncate(limit);
    newest_first.reverse();
    newest_first
}

fn read_entries(path: &Path) -> Vec<RouteProxyLiveLogEntry> {
    let Ok(raw) = std::fs::read(path) else {
        return Vec::new();
    };
    let raw = if path.extension().is_some_and(|extension| extension == "br") {
        match brotli_codec::decompress(&raw) {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!(
                    "route proxy live log: cannot read {}: {error}",
                    path.display()
                );
                return Vec::new();
            }
        }
    } else {
        raw
    };
    String::from_utf8_lossy(&raw)
        .lines()
        .filter_map(|line| serde_json::from_str::<RouteProxyLiveLogEntry>(line).ok())
        .collect()
}

async fn list_segments(dir: &Path) -> std::io::Result<Vec<u64>> {
    let mut reader = match tokio::fs::read_dir(dir).await {
        Ok(reader) => reader,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut sequences = Vec::new();
    while let Some(entry) = reader.next_entry().await? {
        if let Some(seq) = entry.file_name().to_str().and_then(parse_segment_name) {
            sequences.push(seq);
        }
    }
    sequences.sort_unstable();
    Ok(sequences)
}

fn list_segments_blocking(dir: &Path) -> std::io::Result<Vec<u64>> {
    let mut sequences = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        if let Some(seq) = entry?.file_name().to_str().and_then(parse_segment_name) {
            sequences.push(seq);
        }
    }
    sequences.sort_unstable();
    Ok(sequences)
}

/// `route-proxy-live-log.000007.jsonl.br` → `Some(7)`.
///
/// The current file shares the prefix but not the suffix, so the one still being
/// appended to can never be mistaken for a finished segment.
fn parse_segment_name(name: &str) -> Option<u64> {
    name.strip_prefix(LIVE_LOG_SEGMENT_PREFIX)?
        .strip_suffix(LIVE_LOG_SEGMENT_SUFFIX)?
        .parse()
        .ok()
}

fn segment_file_name(seq: u64) -> String {
    format!("{LIVE_LOG_SEGMENT_PREFIX}{seq:06}{LIVE_LOG_SEGMENT_SUFFIX}")
}

async fn open_append(path: &Path) -> std::io::Result<tokio::fs::File> {
    tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web::event_bridge::WebEventBroadcaster;

    fn entry(platform: &str, id: &str) -> RouteProxyLiveLogEntry {
        RouteProxyLiveLogEntry {
            id: id.to_string(),
            trace_id: None,
            platform: platform.to_string(),
            credential_id: "cred".to_string(),
            credential_name: "Cred".to_string(),
            attempt: 0,
            path: "/v1/messages".to_string(),
            target_url: None,
            upstream_headers: None,
            requested_model: None,
            upstream_model: None,
            status: Some(200),
            success: true,
            error_message: None,
            duration_ms: 1,
            bridge: None,
            client_request: Some("in".to_string()),
            upstream_request: Some("up".to_string()),
            upstream_response: Some("raw".to_string()),
            final_response: Some("final".to_string()),
            upstream_reasoning_deltas: None,
            notes: Vec::new(),
            truncated: false,
            truncated_stages: Vec::new(),
            created_at: "now".to_string(),
        }
    }

    #[test]
    fn truncated_stage_names_lists_only_the_stages_that_hit_the_limit() {
        assert!(truncated_stage_names(false, false, false, false).is_empty());
        assert_eq!(
            truncated_stage_names(true, false, false, false),
            vec!["client_request"]
        );
        // The case that motivated the field: a Responses upstream truncates its
        // response stage while both request stages stay complete.
        assert_eq!(
            truncated_stage_names(false, false, true, false),
            vec!["upstream_response"]
        );
        assert_eq!(
            truncated_stage_names(true, true, true, true),
            vec![
                "client_request",
                "upstream_request",
                "upstream_response",
                "final_response"
            ]
        );
    }

    #[test]
    fn truncated_stages_survive_a_serde_round_trip_and_default_when_absent() {
        let mut with_stages = entry("codex", "a");
        with_stages.truncated_stages = vec!["upstream_response".to_string()];
        let json = serde_json::to_string(&with_stages).expect("serialize");
        let back: RouteProxyLiveLogEntry = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, with_stages);

        // Payloads written before the field existed must still deserialize.
        let mut legacy = serde_json::to_value(entry("codex", "b")).expect("to_value");
        legacy
            .as_object_mut()
            .expect("object")
            .remove("truncated_stages");
        let back: RouteProxyLiveLogEntry = serde_json::from_value(legacy).expect("legacy payload");
        assert!(back.truncated_stages.is_empty());
    }

    /// The distinction the field exists for: `None` means nobody counted,
    /// `Some(0)` means the upstream was watched and never reasoned. Collapsing
    /// them at the wire level would turn "we did not look" into "there was
    /// nothing" — the exact confusion this field was added to end.
    #[test]
    fn reasoning_count_round_trips_and_absent_means_unknown_not_zero() {
        let mut counted = entry("codex", "a");
        counted.upstream_reasoning_deltas = Some(0);
        let json = serde_json::to_string(&counted).expect("serialize");
        let back: RouteProxyLiveLogEntry = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.upstream_reasoning_deltas, Some(0));

        let mut legacy = serde_json::to_value(entry("codex", "b")).expect("to_value");
        legacy
            .as_object_mut()
            .expect("object")
            .remove("upstream_reasoning_deltas");
        let back: RouteProxyLiveLogEntry = serde_json::from_value(legacy).expect("legacy payload");
        assert_eq!(
            back.upstream_reasoning_deltas, None,
            "缺字段是「没人数过」，不能读成 0"
        );
    }

    /// 快照必须是**句柄**而不是副本。
    ///
    /// 它要读满窗（~146 MB）而 `record` 就在同一把锁上、且在请求路径上：
    /// 深拷贝一次满窗实测 70–80ms，用户点一次「导出排错数据」就让当时所有在飞的
    /// 请求一起等。改成 `Arc` 后是 1000 次引用计数自增。
    ///
    /// 这条测试锁的是那个设计决定：`snapshot` 的返回类型一旦变回持有值的容器，
    /// 这里就编译不过，改的人必须是有意删掉它，而不是顺手改回去。
    #[test]
    fn snapshot_hands_back_handles_rather_than_copies() {
        let log = RouteProxyLiveLog::default();
        log.record(entry("codex", "e1"));

        let first = log.snapshot();
        let second = log.snapshot();
        assert_eq!(first.len(), 1);
        assert!(
            Arc::ptr_eq(&first[0], &second[0]),
            "两次快照指向同一个条目才算拿的是句柄"
        );

        // 满窗也要快：这条断言的是**不会退化成深拷贝**，所以给它一个宽松到
        // 不会因机器抖动而误报的上限。实测 64.6µs，深拷贝满窗是 70ms 量级。
        let body = "y".repeat(70 * 1024);
        for index in 0..LIVE_LOG_CAPACITY {
            let mut item = entry("codex", &format!("e{index}"));
            item.client_request = Some(body.clone());
            item.final_response = Some(body.clone());
            log.record(item);
        }
        let start = std::time::Instant::now();
        let full = log.snapshot();
        let elapsed = start.elapsed();
        assert_eq!(full.len(), LIVE_LOG_CAPACITY);
        assert!(
            elapsed < std::time::Duration::from_millis(20),
            "满窗快照不该是深拷贝，耗时 {elapsed:?}"
        );
    }

    #[test]
    fn ring_buffer_drops_oldest_beyond_capacity() {
        let log = RouteProxyLiveLog::default();
        for index in 0..(LIVE_LOG_CAPACITY + 5) {
            log.record(entry("codex", &format!("e{index}")));
        }
        let snapshot = log.subscribe("codex");
        assert_eq!(snapshot.len(), LIVE_LOG_CAPACITY);
        assert_eq!(snapshot.first().map(|e| e.id.as_str()), Some("e5"));
        assert_eq!(
            snapshot.last().map(|e| e.id.as_str()),
            Some(format!("e{}", LIVE_LOG_CAPACITY + 4)).as_deref()
        );
    }

    #[test]
    fn snapshot_filters_by_platform() {
        let log = RouteProxyLiveLog::default();
        log.record(entry("codex", "a"));
        log.record(entry("claude", "b"));
        let codex = log.subscribe("codex");
        assert_eq!(codex.len(), 1);
        assert_eq!(codex[0].id, "a");
    }

    #[test]
    fn emits_only_when_subscribed() {
        let broadcaster = Arc::new(WebEventBroadcaster::new());
        let mut receiver = broadcaster.subscribe();
        let log = RouteProxyLiveLog::default();
        log.set_emitter(EventEmitter::Web(broadcaster));

        // No subscriber yet: recorded but not emitted.
        log.record(entry("codex", "silent"));
        assert!(receiver.try_recv().is_err());

        // Subscribing returns history and enables live emission.
        let history = log.subscribe("codex");
        assert_eq!(history.len(), 1);
        log.record(entry("codex", "live"));
        let event = receiver.try_recv().expect("live event");
        assert_eq!(event.channel, ROUTE_PROXY_LIVE_LOG_EVENT);
        assert_eq!(event.payload["id"], "live");

        // After the last viewer leaves, emission stops again.
        log.unsubscribe();
        log.record(entry("codex", "silent-again"));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn stage_preview_truncates_and_flags() {
        let big = vec![b'x'; LIVE_LOG_STAGE_LIMIT + 10];
        let (text, truncated) = stage_preview(Some(&big));
        let text = text.expect("preview");
        assert!(truncated);
        // 头部 + 省略标记 + 尾部；只有中间被丢掉，所以总长略超单阶段上限。
        assert!(text.starts_with("xxx"));
        assert!(text.contains(LIVE_LOG_ELISION_MARKER));
        assert!(text.len() > LIVE_LOG_STAGE_LIMIT);
        assert!(text.len() < LIVE_LOG_STAGE_LIMIT + 128);
        assert_eq!(stage_preview(Some(b"")), (None, false));
        assert_eq!(stage_preview(None), (None, false));
    }

    #[test]
    fn stage_preview_keeps_the_tail_so_trailing_scalars_stay_visible() {
        // 复刻真实请求的形态：对话在前、解释性标量在后。
        let mut body = b"{\"input\":[".to_vec();
        body.extend(vec![b'x'; LIVE_LOG_STAGE_LIMIT * 2]);
        body.extend_from_slice(
            b"],\"model\":\"m\",\"stream\":true,\"reasoning\":{\"effort\":\"high\"}}",
        );

        let (text, truncated) = stage_preview(Some(&body));
        let text = text.expect("preview");
        assert!(truncated);
        assert!(text.contains(LIVE_LOG_ELISION_MARKER));
        assert!(
            text.contains("\"reasoning\":{\"effort\":\"high\"}"),
            "尾部的 reasoning 配置必须留在预览里"
        );
        assert!(text.contains("\"stream\":true"));
        // 头部仍然保留，说明只有中间被丢弃。
        assert!(text.starts_with("{\"input\":["));

        // 未超限的报文一个字节都不动。
        let small = b"{\"input\":\"hi\"}";
        let (text, truncated) = stage_preview(Some(small.as_slice()));
        assert!(!truncated);
        assert_eq!(text.as_deref().map(str::as_bytes), Some(small.as_slice()));
    }

    fn jsonl(ids: &[&str]) -> String {
        ids.iter()
            .map(|id| serde_json::to_string(&entry("codex", id)).expect("json"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Works for both shapes the tests hold entries in: the ring hands back
    /// `Arc<RouteProxyLiveLogEntry>`, while `read_newest_entries` reads owned
    /// entries off disk.
    fn ids_of<E: std::borrow::Borrow<RouteProxyLiveLogEntry>>(entries: Vec<E>) -> Vec<String> {
        entries
            .into_iter()
            .map(|entry| entry.borrow().id.clone())
            .collect()
    }

    /// 落盘的意义：用户重启一次之后，出事那一轮还在。
    #[tokio::test]
    async fn persist_to_mirrors_records_to_disk_in_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let log = RouteProxyLiveLog::default();
        let handle = tokio::spawn(
            log.persist_to(dir.path().to_path_buf())
                .expect("writer")
                .run(),
        );

        for index in 0..5 {
            log.record(entry("codex", &format!("e{index}")));
        }
        // 摘掉 sink 才能让 writer 排空队列后退出，测试才有确定的完成点。
        log.stop_persisting();
        handle.await.expect("writer task");

        let text = std::fs::read_to_string(dir.path().join(LIVE_LOG_FILE_NAME)).expect("read");
        let ids: Vec<String> = text
            .lines()
            .map(|line| {
                serde_json::from_str::<RouteProxyLiveLogEntry>(line)
                    .expect("entry")
                    .id
            })
            .collect();
        assert_eq!(ids, vec!["e0", "e1", "e2", "e3", "e4"]);
    }

    /// 恢复出来的条目比启动后记录的更旧，必须排在前面——而且不能因为恢复得晚
    /// 就把启动后记录的那条挤掉。
    #[tokio::test]
    async fn a_restarted_log_restores_history_ahead_of_new_records() {
        let dir = tempfile::tempdir().expect("tempdir");
        {
            let log = RouteProxyLiveLog::default();
            let handle = tokio::spawn(
                log.persist_to(dir.path().to_path_buf())
                    .expect("writer")
                    .run(),
            );
            for index in 0..3 {
                log.record(entry("codex", &format!("old{index}")));
            }
            log.stop_persisting();
            handle.await.expect("writer");
        }

        let log = RouteProxyLiveLog::default();
        let handle = tokio::spawn(
            log.persist_to(dir.path().to_path_buf())
                .expect("writer")
                .run(),
        );
        log.record(entry("codex", "new"));
        log.stop_persisting();
        handle.await.expect("writer");

        assert_eq!(
            ids_of(log.subscribe("codex")),
            ["old0", "old1", "old2", "new"]
        );
    }

    #[test]
    fn seed_ring_keeps_live_entries_when_the_ring_is_already_full() {
        let log = RouteProxyLiveLog::default();
        for index in 0..LIVE_LOG_CAPACITY {
            log.record(entry("codex", &format!("live{index}")));
        }
        let restored: Vec<_> = (0..5)
            .map(|index| entry("codex", &format!("old{index}")))
            .collect();
        seed_ring(&mut log.inner.lock().expect("lock"), restored);

        let ids = ids_of(log.subscribe("codex"));
        assert_eq!(ids.len(), LIVE_LOG_CAPACITY);
        assert_eq!(
            ids[0], "live0",
            "没有空位时该丢的是恢复出来的旧条目，不是启动后记录的"
        );
    }

    #[test]
    fn seed_ring_keeps_the_newest_restored_entries_when_room_is_short() {
        let log = RouteProxyLiveLog::default();
        for index in 0..(LIVE_LOG_CAPACITY - 2) {
            log.record(entry("codex", &format!("live{index}")));
        }
        let restored: Vec<_> = (0..5)
            .map(|index| entry("codex", &format!("old{index}")))
            .collect();
        seed_ring(&mut log.inner.lock().expect("lock"), restored);

        let ids = ids_of(log.subscribe("codex"));
        assert_eq!(ids.len(), LIVE_LOG_CAPACITY);
        assert_eq!(&ids[..2], &["old3", "old4"], "只留得下两条时留下较新的两条");
        assert_eq!(ids[2], "live0");
    }

    #[test]
    fn read_newest_entries_walks_segments_then_the_current_file_and_truncates() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let segment = jsonl(&["s0", "s1", "s2"]);
        std::fs::write(
            root.join(segment_file_name(1)),
            brotli_codec::compress(segment.as_bytes()).expect("compress"),
        )
        .expect("write segment");
        std::fs::write(root.join(LIVE_LOG_FILE_NAME), jsonl(&["c0", "c1"])).expect("write current");

        let newest = |limit| ids_of(read_newest_entries(root, limit));
        assert_eq!(newest(10), ["s0", "s1", "s2", "c0", "c1"]);
        assert_eq!(newest(4), ["s1", "s2", "c0", "c1"]);
        assert_eq!(newest(2), ["c0", "c1"], "够数就不再往前读，旧段不必解压");
    }

    /// 一次失败的轮转不能把写盘结束掉：句柄被关掉、字节数被重置之后，下一次追加
    /// 必须重新打开并**继续追加**，而不是从头覆盖。
    #[tokio::test]
    async fn a_segment_reopens_its_file_after_a_failed_rotation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let mut segment = LiveLogSegment::open_with_limit(root, 4096)
            .await
            .expect("open");
        segment.append(&jsonl(&["a"])).await.expect("append");

        // 模拟 rotate 失败后留下的状态。
        segment.file = None;
        segment.bytes = 0;

        segment
            .append(&jsonl(&["b"]))
            .await
            .expect("append reopens");
        let text = std::fs::read_to_string(root.join(LIVE_LOG_FILE_NAME)).expect("read");
        let ids: Vec<String> = text
            .lines()
            .map(|line| {
                serde_json::from_str::<RouteProxyLiveLogEntry>(line)
                    .expect("entry")
                    .id
            })
            .collect();
        assert_eq!(ids, vec!["a", "b"], "重开是追加，不是覆盖");
    }

    #[test]
    fn only_compressed_rotations_parse_as_segments() {
        assert_eq!(
            parse_segment_name("route-proxy-live-log.000007.jsonl.br"),
            Some(7)
        );
        assert_eq!(
            parse_segment_name(LIVE_LOG_FILE_NAME),
            None,
            "正在追加的文件不是已完成的段"
        );
        assert_eq!(
            parse_segment_name("route-proxy-live-log.abc.jsonl.br"),
            None
        );
        assert_eq!(parse_segment_name("other.jsonl.br"), None);
        assert_eq!(
            parse_segment_name("route-proxy-live-log.000007.jsonl.br.tmp"),
            None,
            "写了一半的段不能被当成已完成的段"
        );
    }

    #[tokio::test]
    async fn rotation_compresses_the_segment_and_prunes_to_the_window() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        // 上限设成 1 字节：每一行都触发一次轮转，否则这个测试要写 32MB。
        let mut segment = LiveLogSegment::open_with_limit(root, 1)
            .await
            .expect("open");
        for index in 0..(LIVE_LOG_MAX_SEGMENTS + 4) {
            let line = serde_json::to_string(&entry("codex", &format!("e{index}"))).expect("json");
            segment.append(&line).await.expect("append");
        }
        drop(segment);

        let sequences = list_segments_blocking(root).expect("list");
        assert_eq!(sequences.len(), LIVE_LOG_MAX_SEGMENTS, "超出的旧段要被删掉");
        let newest = *sequences.last().expect("a segment");
        assert_eq!(newest, (LIVE_LOG_MAX_SEGMENTS + 4) as u64);

        // 段是压缩过的，解出来仍是原样的 JSONL。
        let raw = std::fs::read(root.join(segment_file_name(newest))).expect("read segment");
        let text =
            String::from_utf8(brotli_codec::decompress(&raw).expect("decompress")).expect("utf8");
        let last: RouteProxyLiveLogEntry = serde_json::from_str(text.trim()).expect("parse");
        assert_eq!(last.id, format!("e{}", LIVE_LOG_MAX_SEGMENTS + 3));

        // 当前文件被重新建出来，且是空的。
        assert_eq!(
            std::fs::metadata(root.join(LIVE_LOG_FILE_NAME))
                .expect("current file")
                .len(),
            0
        );
        assert_eq!(
            ids_of(read_newest_entries(root, 100)),
            ["e4", "e5", "e6", "e7", "e8", "e9"],
            "窗口里的六条都在，且顺序是从旧到新"
        );
    }
}
