//! Tailscale Funnel management for the running Web service.
//!
//! Ported from lingyun/codeg-plus: the app drives the system-installed
//! `tailscale` CLI (nothing is bundled or downloaded), publishes the local Web
//! service with `tailscale funnel --bg --https=443`, and verifies every
//! mutation by re-reading `funnel status --json` instead of trusting exit
//! codes. Only the mapping recorded in this app's own preference is ever
//! cleaned up; foreign 443 configuration is reported, never touched.

use crate::app_state::AppState;
use crate::database::repositories::app_metadata_repository::AppMetadataRepository;
use crate::error::AppError;
use crate::services::web_service::WebService;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

mod cli;

const METADATA_KEY: &str = "web_service_tailscale_funnel";
type AuthCallback = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Failure(&'static str);

#[async_trait::async_trait]
trait Executor: Send + Sync {
    fn installed(&self) -> bool;
    async fn run(
        &self,
        args: Vec<String>,
        cancel: CancellationToken,
        auth: AuthCallback,
        timeout: Duration,
    ) -> Result<String, Failure>;
}

use cli::SystemExecutor;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunnelStatus {
    pub state: String,
    pub installed: bool,
    pub enabled: bool,
    pub desired_enabled: bool,
    pub owned: bool,
    pub url: Option<String>,
    pub auth_url: Option<String>,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prerequisite: Option<FunnelPrerequisite>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FunnelPrerequisite {
    Install,
    StartDaemon,
    Connect,
    Login,
    ApproveDevice,
    ConfigureDns,
    StartWebService,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preference {
    desired_enabled: bool,
    owned: Option<OwnedMapping>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OwnedMapping {
    hostname: String,
    port: u16,
}

#[derive(Default)]
struct Runtime {
    loaded: bool,
    preference: Preference,
    error: Option<String>,
    auth_url: Option<String>,
    generation: u64,
    operation: Option<Operation>,
}

struct Operation {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

pub struct FunnelManager {
    executor: Arc<dyn Executor>,
    runtime: Mutex<Runtime>,
}

impl Default for FunnelManager {
    fn default() -> Self {
        Self {
            executor: Arc::new(SystemExecutor),
            runtime: Mutex::new(Runtime::default()),
        }
    }
}

impl FunnelManager {
    #[cfg(test)]
    pub(crate) fn with_executor(executor: Arc<dyn Executor>) -> Self {
        Self {
            executor,
            runtime: Mutex::new(Runtime::default()),
        }
    }
}

fn command_error(code: &'static str) -> AppError {
    AppError::Validation {
        code: "tailscale_funnel.external",
        message: code.to_string(),
        details: None,
        recoverable: true,
    }
}

fn manager(state: &AppState) -> &Arc<FunnelManager> {
    &state.tailscale_funnel
}

async fn live_port(state: &AppState) -> Option<u16> {
    let status = state.web_service.inner.lock().await.status.clone()?;
    if !status.running {
        return None;
    }
    status.port.filter(|port| *port != 0)
}

impl FunnelManager {
    async fn initialize(&self, pool: &SqlitePool) -> Result<(), AppError> {
        if self.runtime.lock().unwrap().loaded {
            return Ok(());
        }
        let preference = AppMetadataRepository::get_value(pool, METADATA_KEY)
            .await?
            .map(|text| {
                serde_json::from_str::<Preference>(&text)
                    .map_err(|_| command_error("invalidResponse"))
            })
            .transpose()?
            .unwrap_or_default();
        let mut runtime = self.runtime.lock().unwrap();
        runtime.preference = preference;
        runtime.loaded = true;
        Ok(())
    }

    async fn save(&self, pool: &SqlitePool, preference: Preference) -> Result<(), AppError> {
        let text = serde_json::to_string(&preference).map_err(|_| command_error("failed"))?;
        AppMetadataRepository::upsert_value(pool, METADATA_KEY, &text).await?;
        self.runtime.lock().unwrap().preference = preference;
        Ok(())
    }

    fn preference(&self) -> Preference {
        self.runtime.lock().unwrap().preference.clone()
    }

    fn active(&self) -> bool {
        self.runtime
            .lock()
            .unwrap()
            .operation
            .as_ref()
            .is_some_and(|op| !op.task.is_finished())
    }

    fn set_error(&self, error: Option<&str>) {
        self.runtime.lock().unwrap().error = error.map(str::to_string);
    }

    fn base_status(&self, state: &str) -> FunnelStatus {
        let runtime = self.runtime.lock().unwrap();
        FunnelStatus {
            state: state.into(),
            installed: self.executor.installed(),
            enabled: false,
            desired_enabled: runtime.preference.desired_enabled,
            owned: runtime.preference.owned.is_some(),
            url: None,
            auth_url: runtime.auth_url.clone(),
            error: runtime.error.clone(),
            prerequisite: match state {
                "notInstalled" => Some(FunnelPrerequisite::Install),
                "unavailable" => Some(FunnelPrerequisite::StartDaemon),
                _ => None,
            },
        }
    }

    fn node_prerequisite(&self, backend: &str, hostname: Option<&str>) -> Option<FunnelStatus> {
        let (state, prerequisite, error) = match backend {
            "Running" if hostname.is_some() => return None,
            "Running" => (
                "error",
                FunnelPrerequisite::ConfigureDns,
                Some("dnsNotReady"),
            ),
            "NeedsMachineAuth" => (
                "needsLogin",
                FunnelPrerequisite::ApproveDevice,
                Some("deviceApproval"),
            ),
            "NeedsLogin" | "NoState" => ("needsLogin", FunnelPrerequisite::Login, None),
            "Stopped" => ("stopped", FunnelPrerequisite::Connect, None),
            _ => ("unavailable", FunnelPrerequisite::StartDaemon, None),
        };
        let mut status = self.base_status(state);
        status.prerequisite = Some(prerequisite);
        if let Some(error) = error {
            status.error = Some(error.into());
        }
        Some(status)
    }

    async fn json(&self, args: &[&str]) -> Result<Value, Failure> {
        let text = self
            .executor
            .run(
                args.iter().map(|v| (*v).to_string()).collect(),
                CancellationToken::new(),
                Arc::new(|_| {}),
                Duration::from_secs(8),
            )
            .await?;
        let value: Value = serde_json::from_str(&text).map_err(|_| Failure("invalidResponse"))?;
        if !value.is_object() {
            return Err(Failure("invalidResponse"));
        }
        Ok(value)
    }

    async fn node(&self) -> Result<(String, Option<String>), Failure> {
        let node = self.json(&["status", "--json"]).await?;
        let backend = node["BackendState"]
            .as_str()
            .ok_or(Failure("invalidResponse"))?
            .to_string();
        let hostname = node["Self"]["DNSName"]
            .as_str()
            .map(|name| name.trim_end_matches('.').to_ascii_lowercase())
            .filter(|name| valid_hostname(name));
        Ok((backend, hostname))
    }

    async fn refresh(&self, state: &AppState) -> FunnelStatus {
        let mut status = self.base_status("ready");
        if !status.installed {
            status.state = "notInstalled".into();
            status.prerequisite = Some(FunnelPrerequisite::Install);
            return status;
        }
        if self.active() {
            status.state = if status.auth_url.is_some() {
                "authorizing"
            } else {
                "starting"
            }
            .into();
            return status;
        }
        let (backend, hostname) = match self.node().await {
            Ok(value) => value,
            Err(Failure(code)) => {
                status.state = "unavailable".into();
                status.prerequisite = Some(FunnelPrerequisite::StartDaemon);
                status.error = Some(code.into());
                return status;
            }
        };
        if let Some(prerequisite) = self.node_prerequisite(&backend, hostname.as_deref()) {
            return prerequisite;
        }
        let hostname = hostname.expect("running node prerequisite validated hostname");
        let config = match self.json(&["funnel", "status", "--json"]).await {
            Ok(value) => value,
            Err(Failure(code)) => {
                status.state = "error".into();
                status.error = Some(code.into());
                return status;
            }
        };
        // The service may have stopped during a CLI query; never publish stale addresses.
        let Some(port) = live_port(state).await else {
            status.state = "stopped".into();
            status.prerequisite = Some(FunnelPrerequisite::StartWebService);
            return status;
        };
        match inspect_mapping(&config, &hostname, port) {
            Mapping::Public => {
                status.state = "enabled".into();
                status.enabled = true;
                status.url = Some(format!("https://{hostname}"));
                status.owned = self
                    .preference()
                    .owned
                    .is_some_and(|own| own.hostname == hostname && own.port == port);
            }
            Mapping::Conflict => {
                status.state = "conflict".into();
            }
            Mapping::Empty if status.error.is_some() => {
                status.state = "error".into();
            }
            Mapping::Empty => {}
        }
        status
    }

    async fn cancel_task(&self) {
        let operation = {
            let mut runtime = self.runtime.lock().unwrap();
            runtime.generation += 1;
            runtime.auth_url = None;
            runtime.operation.take()
        };
        if let Some(operation) = operation {
            operation.cancel.cancel();
            // The executor owns its child until kill + wait has completed.
            let _ = operation.task.await;
        }
    }

    async fn cleanup(&self, pool: &SqlitePool) -> Result<(), Failure> {
        let mut preference = self.preference();
        let Some(owned) = preference.owned.clone() else {
            return Ok(());
        };
        if !valid_hostname(&owned.hostname) || owned.port == 0 {
            return Err(Failure("conflict"));
        }
        let config = self.json(&["funnel", "status", "--json"]).await?;
        match inspect_mapping(&config, &owned.hostname, owned.port) {
            Mapping::Conflict => return Err(Failure("conflict")),
            Mapping::Empty => {}
            Mapping::Public => {
                self.executor
                    .run(
                        vec!["serve".into(), "--https=443".into(), "off".into()],
                        CancellationToken::new(),
                        Arc::new(|_| {}),
                        Duration::from_secs(8),
                    )
                    .await?;
                let after = self.json(&["funnel", "status", "--json"]).await?;
                if occupies_https_port(&after) {
                    return Err(Failure("cleanupFailed"));
                }
            }
        }
        preference.owned = None;
        self.save(pool, preference)
            .await
            .map_err(|_| Failure("cleanupFailed"))
    }

    fn spawn_operation(
        self: &Arc<Self>,
        state: Arc<AppState>,
        args: Vec<String>,
        timeout: Duration,
        publishing: bool,
        interactive: bool,
        capture_auth: bool,
    ) {
        let cancel = CancellationToken::new();
        let worker_cancel = cancel.clone();
        let mut runtime = self.runtime.lock().unwrap();
        runtime.generation += 1;
        let generation = runtime.generation;
        runtime.error = None;
        runtime.auth_url = None;
        let manager = self.clone();
        let auth_manager = self.clone();
        let auth_cancel = cancel.clone();
        let auth: AuthCallback = if capture_auth {
            Arc::new(move |text| {
                if let Some(url) = authorization_url(&text) {
                    let mut runtime = auth_manager.runtime.lock().unwrap();
                    if runtime.generation == generation {
                        runtime.auth_url = Some(url);
                        // Nobody is present to click a background restore's
                        // login link, so stop waiting as soon as one appears.
                        if !interactive {
                            auth_cancel.cancel();
                        }
                    }
                }
            })
        } else {
            // An invalid auth key makes `up` fall back to interactive login;
            // that must read as a failed key (non-zero exit), not as a login
            // page this app should open.
            Arc::new(|_| {})
        };
        let task = tokio::spawn(async move {
            let mut result = manager
                .executor
                .run(args, worker_cancel.clone(), auth, timeout)
                .await;
            if result.is_ok() && publishing {
                result = async {
                    let (backend, hostname) = manager.node().await?;
                    let config = manager.json(&["funnel", "status", "--json"]).await?;
                    let port = live_port(&state).await.ok_or(Failure("stopped"))?;
                    if backend != "Running"
                        || hostname.as_deref().is_none_or(|host| {
                            inspect_mapping(&config, host, port) != Mapping::Public
                        })
                    {
                        return Err(Failure("failed"));
                    }
                    Ok(String::new())
                }
                .await;
            }
            let mut runtime = manager.runtime.lock().unwrap();
            if runtime.generation == generation {
                runtime.error = result.err().map(|Failure(code)| code.to_string());
                if runtime.error.is_none() {
                    runtime.auth_url = None;
                }
            }
        });
        runtime.operation = Some(Operation { cancel, task });
    }
}

fn valid_hostname(hostname: &str) -> bool {
    hostname.ends_with(".ts.net")
        && hostname.len() <= 253
        && hostname.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-')
        })
}

/// Whether the persisted preference still asks for the funnel. Only meaningful
/// once `initialize` has loaded the preference.
pub fn desired_enabled(state: &AppState) -> bool {
    state
        .tailscale_funnel
        .runtime
        .lock()
        .unwrap()
        .preference
        .desired_enabled
}

pub async fn status_locked(state: &AppState) -> Result<FunnelStatus, AppError> {
    let funnel = manager(state);
    funnel.initialize(&state.pool).await?;
    let status = funnel.refresh(state).await;
    WebService::apply_funnel_gate_locked(state, &status).await;
    Ok(status)
}

/// The Web service must already hold the lifecycle lock; funnel cores below
/// take it themselves.
pub async fn status_core(state: &AppState) -> Result<FunnelStatus, AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    status_locked(state).await
}

pub async fn login_core(state: Arc<AppState>) -> Result<FunnelStatus, AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    let status = login_inner(&state).await?;
    WebService::apply_funnel_gate_locked(&state, &status).await;
    Ok(status)
}

async fn login_inner(state: &Arc<AppState>) -> Result<FunnelStatus, AppError> {
    let funnel = manager(state);
    funnel.initialize(&state.pool).await?;
    if funnel.active() {
        return Ok(funnel.refresh(&state).await);
    }
    if !funnel.executor.installed() {
        return Ok(funnel.base_status("notInstalled"));
    }
    match funnel.node().await {
        Ok((backend, _)) if backend == "Running" => return Ok(funnel.refresh(&state).await),
        Ok((backend, hostname)) if backend == "NeedsMachineAuth" => {
            return Ok(funnel
                .node_prerequisite(&backend, hostname.as_deref())
                .expect("machine approval has a prerequisite"));
        }
        Err(Failure(code)) => {
            funnel.set_error(Some(code));
            return Ok(funnel.base_status("unavailable"));
        }
        _ => {}
    }
    funnel.spawn_operation(
        state.clone(),
        vec!["up".into(), "--timeout=120s".into()],
        Duration::from_secs(120),
        false,
        true,
        true,
    );
    Ok(funnel.base_status("starting"))
}

/// Login with a Tailscale auth key — the headless/unattended path. The key is
/// passed to `up --authkey` once and is never persisted; the node connection
/// itself lives in the system tailscaled's state.
pub async fn login_with_auth_key_core(
    state: Arc<AppState>,
    auth_key: String,
) -> Result<FunnelStatus, AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    let status = login_with_auth_key_inner(&state, auth_key).await?;
    WebService::apply_funnel_gate_locked(&state, &status).await;
    Ok(status)
}

async fn login_with_auth_key_inner(
    state: &Arc<AppState>,
    auth_key: String,
) -> Result<FunnelStatus, AppError> {
    let funnel = manager(state);
    funnel.initialize(&state.pool).await?;
    if funnel.active() {
        return Ok(funnel.refresh(state).await);
    }
    if !funnel.executor.installed() {
        return Ok(funnel.base_status("notInstalled"));
    }
    match funnel.node().await {
        Ok((backend, _)) if backend == "Running" => return Ok(funnel.refresh(&state).await),
        Ok((backend, hostname)) if backend == "NeedsMachineAuth" => {
            return Ok(funnel
                .node_prerequisite(&backend, hostname.as_deref())
                .expect("machine approval has a prerequisite"));
        }
        Err(Failure(code)) => {
            funnel.set_error(Some(code));
            return Ok(funnel.base_status("unavailable"));
        }
        _ => {}
    }
    funnel.spawn_operation(
        state.clone(),
        vec![
            "up".into(),
            // The key rides the process argv, which is visible to other local
            // processes — the same trade-off Tailscale's own CI recipes make.
            format!("--authkey={auth_key}"),
            "--timeout=60s".into(),
        ],
        Duration::from_secs(60),
        false,
        false,
        false,
    );
    Ok(funnel.base_status("starting"))
}

async fn enable_locked(state: &Arc<AppState>, interactive: bool) -> Result<FunnelStatus, AppError> {
    let status = enable_locked_inner(state, interactive).await?;
    WebService::apply_funnel_gate_locked(state, &status).await;
    Ok(status)
}

async fn enable_locked_inner(
    state: &Arc<AppState>,
    interactive: bool,
) -> Result<FunnelStatus, AppError> {
    let funnel = manager(state);
    if funnel.active() {
        return Ok(funnel.refresh(state).await);
    }
    let Some(port) = live_port(state).await else {
        let mut status = funnel.base_status("stopped");
        status.error = Some("stopped".into());
        status.prerequisite = Some(FunnelPrerequisite::StartWebService);
        return Ok(status);
    };
    // Funnel proxies to 127.0.0.1:<port>, so a bind it cannot reach is a
    // configuration the CLI would silently mis-publish.
    let config = WebService::load_config(&state.paths).await?;
    if !matches!(config.host.as_str(), "0.0.0.0" | "127.0.0.1") {
        funnel.set_error(Some("unsupportedBind"));
        return Ok(funnel.base_status("error"));
    }
    if !funnel.executor.installed() {
        return Ok(funnel.base_status("notInstalled"));
    }
    let hostname = match funnel.node().await {
        Ok((backend, Some(hostname))) if backend == "Running" => hostname,
        Ok((backend, hostname)) => {
            return Ok(funnel
                .node_prerequisite(&backend, hostname.as_deref())
                .expect("non-ready node has a prerequisite"));
        }
        Err(Failure(code)) => {
            funnel.set_error(Some(code));
            return Ok(funnel.base_status("unavailable"));
        }
    };
    let funnel_config = match funnel.json(&["funnel", "status", "--json"]).await {
        Ok(config) => config,
        Err(Failure(code)) => {
            funnel.set_error(Some(code));
            return Ok(funnel.base_status("error"));
        }
    };
    let mut preference = funnel.preference();
    if let Some(owned) = &preference.owned {
        if owned.hostname == hostname
            && owned.port == port
            && inspect_mapping(&funnel_config, &hostname, port) == Mapping::Public
        {
            preference.desired_enabled = true;
            funnel.save(&state.pool, preference).await?;
            funnel.set_error(None);
            return Ok(funnel.refresh(state).await);
        }
        if let Err(Failure(code)) = funnel.cleanup(&state.pool).await {
            funnel.set_error(Some(code));
            return Ok(funnel.base_status("conflict"));
        }
    } else if inspect_mapping(&funnel_config, &hostname, port) != Mapping::Empty {
        funnel.set_error(Some("conflict"));
        return Ok(funnel.base_status("conflict"));
    }
    funnel
        .save(
            &state.pool,
            Preference {
                desired_enabled: true,
                owned: Some(OwnedMapping { hostname, port }),
            },
        )
        .await?;
    funnel.spawn_operation(
        state.clone(),
        vec![
            "funnel".into(),
            "--bg".into(),
            "--https=443".into(),
            "--yes".into(),
            format!("http://127.0.0.1:{port}"),
        ],
        Duration::from_secs(if interactive { 120 } else { 15 }),
        true,
        interactive,
        true,
    );
    Ok(funnel.base_status("starting"))
}

pub async fn enable_core(state: Arc<AppState>) -> Result<FunnelStatus, AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    manager(&state).initialize(&state.pool).await?;
    enable_locked(&state, true).await
}

pub async fn disable_core(state: &AppState) -> Result<FunnelStatus, AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    let funnel = manager(state);
    funnel.initialize(&state.pool).await?;
    funnel.cancel_task().await;
    let mut preference = funnel.preference();
    let was_owned = preference.owned.is_some();
    preference.desired_enabled = false;
    funnel.save(&state.pool, preference).await?;
    funnel.set_error(None);
    if let Err(Failure(code)) = funnel.cleanup(&state.pool).await {
        funnel.set_error(Some(code));
    }
    let mut status = funnel.refresh(state).await;
    if status.enabled && !was_owned {
        status.error = Some("notOwned".into());
    }
    WebService::apply_funnel_gate_locked(state, &status).await;
    Ok(status)
}

pub async fn cancel_core(state: &AppState) -> Result<FunnelStatus, AppError> {
    disable_core(state).await
}

/// Launch-time reconcile: remove a mapping a crashed run left behind even when
/// the Web service is not about to start.
pub async fn initialize(state: &AppState) -> Result<(), AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    let funnel = manager(state);
    funnel.initialize(&state.pool).await?;
    if live_port(state).await.is_none() {
        if let Err(Failure(code)) = funnel.cleanup(&state.pool).await {
            funnel.set_error(Some("cleanupFailed"));
            return Err(command_error(code));
        }
    }
    Ok(())
}

/// Spawned after a successful Web service bind: re-publish the funnel if the
/// persisted preference still asks for it. Non-interactive — bails as soon as
/// login would be required, because nobody is watching.
pub fn restore(state: Arc<AppState>) {
    tokio::spawn(async move {
        let _guard = state.web_service.config_reconciliation_lock.lock().await;
        let funnel = manager(&state);
        if funnel.initialize(&state.pool).await.is_err() {
            funnel.set_error(Some("failed"));
            return;
        }
        if live_port(&state).await.is_none() || !funnel.preference().desired_enabled {
            if let Err(Failure(code)) = funnel.cleanup(&state.pool).await {
                funnel.set_error(Some(code));
            }
            return;
        }
        if enable_locked(&state, false).await.is_err() {
            funnel.set_error(Some("failed"));
        }
    });
}

/// Web-service shutdown: cancel any in-flight operation and undo the owned
/// mapping while keeping `desiredEnabled`. Caller must hold the Web service's
/// lifecycle lock; a failure here must abort the stop so the UI can reconcile.
pub async fn shutdown_locked(state: &AppState) -> Result<(), AppError> {
    let funnel = manager(state);
    funnel.initialize(&state.pool).await?;
    funnel.cancel_task().await;
    match funnel.cleanup(&state.pool).await {
        Ok(()) => {
            funnel.set_error(None);
            Ok(())
        }
        Err(_) => {
            funnel.set_error(Some("cleanupFailed"));
            Err(command_error("cleanupFailed"))
        }
    }
}

pub async fn shutdown(state: &AppState) -> Result<(), AppError> {
    let _guard = state.web_service.config_reconciliation_lock.lock().await;
    shutdown_locked(state).await
}

#[cfg(test)]
#[path = "tailscale_funnel/tests.rs"]
mod manager_tests;

#[derive(Debug, PartialEq, Eq)]
enum Mapping {
    Empty,
    Public,
    Conflict,
}

fn occupies_https_port(config: &Value) -> bool {
    config.get("TCP").and_then(|v| v.get("443")).is_some()
        || ["Web", "AllowFunnel"].iter().any(|key| {
            config
                .get(key)
                .and_then(Value::as_object)
                .is_some_and(|map| map.keys().any(|host| host.ends_with(":443")))
        })
}

fn inspect_mapping(config: &Value, hostname: &str, port: u16) -> Mapping {
    if config
        .get("Foreground")
        .and_then(Value::as_object)
        .is_some_and(|map| map.values().any(occupies_https_port))
    {
        return Mapping::Conflict;
    }
    if !occupies_https_port(config) {
        return Mapping::Empty;
    }
    let host = format!("{hostname}:443");
    let target = format!("http://127.0.0.1:{port}");
    let tcp = &config["TCP"]["443"];
    let handlers = config["Web"][&host]["Handlers"].as_object();
    let own_host_only = ["Web", "AllowFunnel"].iter().all(|key| {
        config[*key]
            .as_object()
            .is_none_or(|map| map.keys().all(|key| !key.ends_with(":443") || key == &host))
    });
    if own_host_only
        && tcp["HTTPS"] == true
        && tcp.get("TCPForward").is_none_or(|v| v == "")
        && config["AllowFunnel"][&host] == true
        && handlers.is_some_and(|map| {
            map.len() == 1
                && map.get("/").is_some_and(|handler| {
                    handler["Proxy"]
                        .as_str()
                        .is_some_and(|proxy| proxy.trim_end_matches('/') == target)
                        && ["Path", "Text", "Redirect"]
                            .iter()
                            .all(|key| handler.get(*key).is_none_or(|v| v == ""))
                })
        })
    {
        Mapping::Public
    } else {
        Mapping::Conflict
    }
}

fn authorization_url(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|word| {
        let candidate = word.trim_matches(|c: char| matches!(c, '\"' | '\'' | ',' | '(' | ')'));
        let url = url::Url::parse(candidate).ok()?;
        (url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && matches!(
                url.host_str(),
                Some("login.tailscale.com" | "tailscale.com")
            )
            && (url.path().starts_with("/a/")
                || url.path().starts_with("/f/")
                || url.path().starts_with("/admin/")
                || url.path().starts_with("/s/")))
        .then(|| url.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn public_config() -> serde_json::Value {
        json!({
            "TCP": {"443": {"HTTPS": true}},
            "Web": {"workstation.example.ts.net:443": {"Handlers": {
                "/": {"Proxy": "http://127.0.0.1:3080"}
            }}},
            "AllowFunnel": {"workstation.example.ts.net:443": true}
        })
    }

    #[test]
    fn recognizes_only_public_mapping_to_current_service() {
        let config = public_config();
        assert_eq!(
            inspect_mapping(&config, "workstation.example.ts.net", 3080),
            Mapping::Public
        );
        assert_eq!(
            inspect_mapping(&config, "workstation.example.ts.net", 3090),
            Mapping::Conflict
        );
        let mut private = config.clone();
        private["AllowFunnel"] = json!({});
        assert_eq!(
            inspect_mapping(&private, "workstation.example.ts.net", 3080),
            Mapping::Conflict
        );
        assert_eq!(
            inspect_mapping(&json!({}), "workstation.example.ts.net", 3080),
            Mapping::Empty
        );
    }

    #[test]
    fn refuses_mixed_handlers_and_foreground_configuration() {
        let mut config = public_config();
        config["Web"]["workstation.example.ts.net:443"]["Handlers"]["/other"] =
            json!({"Proxy":"http://127.0.0.1:9000"});
        assert_eq!(
            inspect_mapping(&config, "workstation.example.ts.net", 3080),
            Mapping::Conflict
        );
        assert_eq!(
            inspect_mapping(
                &json!({"Foreground":{"session":public_config()}}),
                "workstation.example.ts.net",
                3080
            ),
            Mapping::Conflict
        );
    }

    #[test]
    fn ignores_other_ports_without_removing_them() {
        let config = json!({"TCP":{"8443":{"HTTPS":true}},"Web":{"workstation.example.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9000"}}}}});
        assert_eq!(
            inspect_mapping(&config, "workstation.example.ts.net", 3080),
            Mapping::Empty
        );
    }

    #[test]
    fn accepts_only_tailscale_https_authorization_links() {
        assert_eq!(
            authorization_url("To authenticate: https://login.tailscale.com/a/example\n"),
            Some("https://login.tailscale.com/a/example".to_string())
        );
        for bad in [
            "http://login.tailscale.com/a/example",
            "https://login.tailscale.com.evil.test/a/x",
            "https://evil.test/?next=https://login.tailscale.com/a/x",
            "https://user@login.tailscale.com/a/x",
        ] {
            assert_eq!(authorization_url(bad), None);
        }
    }
}
