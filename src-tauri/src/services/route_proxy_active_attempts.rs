use crate::web::event_bridge::EventEmitter;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub const ACTIVE_ATTEMPT_EVENT: &str = "route-proxy-active-attempt";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveProxyAttempt {
    pub request_id: String,
    pub attempt_id: String,
    pub platform: String,
    pub client_key: String,
    pub credential_id: String,
    pub credential_name: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActiveAttemptAction {
    Started,
    Finished,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveProxyAttemptEvent {
    pub epoch: String,
    pub sequence: u64,
    pub action: ActiveAttemptAction,
    pub attempt: ActiveProxyAttempt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveProxyAttemptSnapshot {
    pub epoch: String,
    pub sequence: u64,
    pub active: Vec<ActiveProxyAttempt>,
}

#[derive(Clone)]
pub struct RouteProxyActiveAttemptRegistry {
    inner: Arc<Mutex<RegistryState>>,
}

struct RegistryState {
    epoch: String,
    sequence: u64,
    active: HashMap<String, ActiveProxyAttempt>,
    emitter: Option<EventEmitter>,
    internal_traces: std::collections::HashSet<String>,
    generation: u64,
    cancellation: tokio::sync::watch::Sender<u64>,
}

impl Default for RouteProxyActiveAttemptRegistry {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryState {
                epoch: Uuid::new_v4().to_string(),
                sequence: 0,
                active: HashMap::new(),
                emitter: None,
                internal_traces: Default::default(),
                generation: 0,
                cancellation: tokio::sync::watch::channel(0).0,
            })),
        }
    }
}

impl RouteProxyActiveAttemptRegistry {
    pub fn set_emitter(&self, emitter: EventEmitter) {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).emitter = Some(emitter);
    }

    pub fn generation(&self) -> u64 {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).generation
    }

    pub async fn cancelled(&self, generation: u64) {
        let mut receiver = self.inner.lock().unwrap_or_else(|e| e.into_inner()).cancellation.subscribe();
        loop {
            if *receiver.borrow_and_update() != generation {
                return;
            }
            if receiver.changed().await.is_err() {
                return;
            }
        }
    }

    pub fn begin(
        &self,
        request_id: &str,
        platform: &str,
        client_key: Option<&str>,
        credential_id: &str,
        credential_name: &str,
    ) -> ActiveProxyAttemptGuard {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        self.insert(&mut state, request_id, platform, client_key, credential_id, credential_name)
    }

    pub fn begin_in_generation(
        &self,
        generation: u64,
        request_id: &str,
        platform: &str,
        client_key: Option<&str>,
        credential_id: &str,
        credential_name: &str,
    ) -> Option<ActiveProxyAttemptGuard> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.generation != generation {
            return None;
        }
        Some(self.insert(&mut state, request_id, platform, client_key, credential_id, credential_name))
    }

    fn insert(
        &self,
        state: &mut RegistryState,
        request_id: &str,
        platform: &str,
        client_key: Option<&str>,
        credential_id: &str,
        credential_name: &str,
    ) -> ActiveProxyAttemptGuard {
        let attempt = ActiveProxyAttempt {
            request_id: request_id.to_string(),
            attempt_id: Uuid::new_v4().to_string(),
            platform: platform.to_string(),
            client_key: client_key.unwrap_or("unknown").to_string(),
            credential_id: credential_id.to_string(),
            credential_name: credential_name.to_string(),
            started_at: Utc::now().to_rfc3339(),
        };
        let id = attempt.attempt_id.clone();
        state.active.insert(id.clone(), attempt.clone());
        emit(state, ActiveAttemptAction::Started, attempt);
        ActiveProxyAttemptGuard { registry: self.clone(), id }
    }

    pub fn snapshot(&self) -> ActiveProxyAttemptSnapshot {
        let state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut active: Vec<_> = state.active.values().cloned().collect();
        active.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.attempt_id.cmp(&b.attempt_id)));
        ActiveProxyAttemptSnapshot { epoch: state.epoch.clone(), sequence: state.sequence, active }
    }

    pub fn mark_internal_trace(&self, trace: &str) -> InternalTraceGuard {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).internal_traces.insert(trace.to_string());
        InternalTraceGuard { registry: self.clone(), trace: trace.to_string() }
    }

    pub fn is_internal_trace(&self, trace: &str) -> bool {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).internal_traces.contains(trace)
    }

    pub fn clear(&self) {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        state.generation += 1;
        state.cancellation.send_replace(state.generation);
        let attempts: Vec<_> = state.active.drain().map(|(_, attempt)| attempt).collect();
        for attempt in attempts {
            emit(&mut state, ActiveAttemptAction::Finished, attempt);
        }
    }

    fn finish(&self, id: &str) {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(attempt) = state.active.remove(id) {
            emit(&mut state, ActiveAttemptAction::Finished, attempt);
        }
    }
}

// Update and enqueue under the same lock: snapshots and event sequence numbers
// describe one boundary even when several upstreams finish concurrently.
fn emit(state: &mut RegistryState, action: ActiveAttemptAction, attempt: ActiveProxyAttempt) {
    state.sequence += 1;
    if let Some(emitter) = &state.emitter {
        emitter.emit(ACTIVE_ATTEMPT_EVENT, &ActiveProxyAttemptEvent {
            epoch: state.epoch.clone(), sequence: state.sequence, action, attempt,
        });
    }
}

pub struct InternalTraceGuard {
    registry: RouteProxyActiveAttemptRegistry,
    trace: String,
}

impl Drop for InternalTraceGuard {
    fn drop(&mut self) {
        self.registry.inner.lock().unwrap_or_else(|e| e.into_inner()).internal_traces.remove(&self.trace);
    }
}

pub struct ActiveProxyAttemptGuard {
    registry: RouteProxyActiveAttemptRegistry,
    id: String,
}

impl Drop for ActiveProxyAttemptGuard {
    fn drop(&mut self) {
        self.registry.finish(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web::event_bridge::{EventEmitter, WebEventBroadcaster};
    use std::sync::Arc;

    /// 把广播订阅里积压的事件按序取出（测试专用；与插件版 drain 等价的读取端）。
    fn drain_events(
        receiver: &mut tokio::sync::broadcast::Receiver<crate::web::event_bridge::WebEvent>,
    ) -> Vec<serde_json::Value> {
        let mut events = Vec::new();
        while let Ok(event) = receiver.try_recv() {
            events.push(serde_json::to_value(&event).unwrap());
        }
        events
    }


    #[test]
    fn snapshots_and_events_follow_guard_lifetime() {
        let registry = RouteProxyActiveAttemptRegistry::default();
        let events = Arc::new(WebEventBroadcaster::new());
        let mut receiver = events.subscribe();
        registry.set_emitter(EventEmitter::Web(events.clone()));
        let first = registry.begin("request-1", "codex", Some("zcode"), "account-a", "Account A");
        let snapshot = registry.snapshot();
        assert_eq!(snapshot.sequence, 1);
        assert_eq!(snapshot.active.len(), 1);
        assert_eq!(snapshot.active[0].client_key, "zcode");
        assert_eq!(snapshot.active[0].credential_id, "account-a");
        assert_eq!(snapshot.active[0].request_id, "request-1");
        let started = drain_events(&mut receiver);
        assert_eq!(started[0]["channel"], "route-proxy-active-attempt");
        assert_eq!(started[0]["payload"]["action"], "started");
        assert_eq!(started[0]["payload"]["epoch"], snapshot.epoch);
        drop(first);
        assert!(registry.snapshot().active.is_empty());
        assert_eq!(registry.snapshot().sequence, 2);
        let finished = drain_events(&mut receiver);
        assert_eq!(finished[0]["payload"]["action"], "finished");
        assert_eq!(finished[0]["payload"]["attempt"]["attempt_id"], snapshot.active[0].attempt_id);
    }

    #[test]
    fn concurrent_calls_have_distinct_ids_and_unknown_origin_is_explicit() {
        let registry = RouteProxyActiveAttemptRegistry::default();
        let a = registry.begin("request-1", "codex", None, "account-a", "Account A");
        let b = registry.begin("request-1", "claude", Some("claude_code"), "account-b", "Account B");
        let snapshot = registry.snapshot();
        assert_eq!(snapshot.active.len(), 2);
        assert_ne!(snapshot.active[0].attempt_id, snapshot.active[1].attempt_id);
        assert!(snapshot.active.iter().any(|attempt| attempt.client_key == "unknown"));
        drop(a);
        assert_eq!(registry.snapshot().active[0].credential_id, "account-b");
        drop(b);
        assert!(registry.snapshot().active.is_empty());
    }

    #[test]
    fn model_test_trace_exclusion_only_lives_as_long_as_its_guard() {
        let registry = RouteProxyActiveAttemptRegistry::default();
        assert!(!registry.is_internal_trace("test-trace"));
        let guard = registry.mark_internal_trace("test-trace");
        assert!(registry.clone().is_internal_trace("test-trace"));
        assert!(!registry.is_internal_trace("foreign-trace"));
        drop(guard);
        assert!(!registry.is_internal_trace("test-trace"));
    }

    #[test]
    fn separate_runtimes_have_distinct_epochs() {
        let first = RouteProxyActiveAttemptRegistry::default();
        let second = RouteProxyActiveAttemptRegistry::default();
        assert_ne!(first.snapshot().epoch, second.snapshot().epoch);
        assert_eq!(first.snapshot().epoch, first.clone().snapshot().epoch);
    }

    #[test]
    fn stopped_generation_cannot_register_retry_or_continuation_attempts() {
        let registry = RouteProxyActiveAttemptRegistry::default();
        let old_generation = registry.generation();
        let old_attempt = registry.begin_in_generation(old_generation, "old-request", "codex", Some("zcode"), "account-a", "Account A").unwrap();
        registry.clear();
        assert!(registry.begin_in_generation(old_generation, "old-request", "codex", Some("zcode"), "account-b", "Account B").is_none());
        let new_generation = registry.generation();
        assert_ne!(old_generation, new_generation);
        let fresh = registry.begin_in_generation(new_generation, "fresh-request", "codex", Some("codex"), "account-b", "Account B").unwrap();
        drop(old_attempt);
        let snapshot = registry.snapshot();
        assert_eq!(snapshot.active.len(), 1);
        assert_eq!(snapshot.active[0].request_id, "fresh-request");
        drop(fresh);
    }

    #[tokio::test]
    async fn stopping_notifies_pending_old_generation_requests() {
        let registry = RouteProxyActiveAttemptRegistry::default();
        let generation = registry.generation();
        let cloned = registry.clone();
        let waiting = tokio::spawn(async move { cloned.cancelled(generation).await; });
        registry.clear();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiting).await.unwrap().unwrap();
    }

    #[test]
    fn stopping_clears_active_attempts_and_late_guard_drops_are_noops() {
        let registry = RouteProxyActiveAttemptRegistry::default();
        let first = registry.begin("request-1", "codex", Some("zcode"), "account-a", "Account A");
        let second = registry.begin("request-2", "codex", Some("codex"), "account-a", "Account A");
        registry.clear();
        assert!(registry.snapshot().active.is_empty());
        let sequence = registry.snapshot().sequence;
        drop(first);
        drop(second);
        assert_eq!(registry.snapshot().sequence, sequence);
    }
}
