use super::*;
use crate::app_state::{CloseToTrayRuntime, AppState};
use crate::database::{create_memory_pool, run_migrations};
use crate::services::config_write_service::ConfigWriteRuntimeState;
use crate::services::deeplink_protocol_service::DeepLinkProtocolRuntime;
use crate::services::route_proxy_service::RouteProxyRuntimeState;
use crate::services::web_service::{WebService, WebServiceRuntimeState};
use crate::terminal_manager::TerminalManager;
use crate::web::event_bridge::WebEventBroadcaster;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Notify;

const DNS: &str = "workstation.example.ts.net";

fn public_config(port: u16) -> Value {
    json!({"TCP":{"443":{"HTTPS":true}}, "Web":{format!("{DNS}:443"):{"Handlers":{"/":{"Proxy":format!("http://127.0.0.1:{port}")}}}}, "AllowFunnel":{format!("{DNS}:443"):true}})
}

#[derive(Default)]
struct FakeCli {
    data: Mutex<FakeData>,
    wait: AtomicBool,
    entered: Notify,
    release: Notify,
}

struct FakeData {
    installed: bool,
    backend: String,
    hostname: String,
    config: Value,
    apply: bool,
    fail: Option<Failure>,
    calls: Vec<Vec<String>>,
}

impl Default for FakeData {
    fn default() -> Self {
        Self {
            installed: true,
            backend: "Running".into(),
            hostname: format!("{DNS}."),
            config: json!({}),
            apply: true,
            fail: None,
            calls: vec![],
        }
    }
}

#[async_trait::async_trait]
impl Executor for FakeCli {
    fn installed(&self) -> bool {
        self.data.lock().unwrap().installed
    }

    async fn run(
        &self,
        args: Vec<String>,
        cancel: CancellationToken,
        auth: AuthCallback,
        _timeout: Duration,
    ) -> Result<String, Failure> {
        self.data.lock().unwrap().calls.push(args.clone());
        if args == ["status", "--json"] {
            let data = self.data.lock().unwrap();
            return Ok(
                json!({"BackendState":data.backend, "Self":{"DNSName":data.hostname}}).to_string(),
            );
        }
        if args == ["funnel", "status", "--json"] {
            return Ok(self.data.lock().unwrap().config.to_string());
        }
        if args.first().is_some_and(|arg| arg == "serve") {
            assert_eq!(
                args,
                ["serve", "--https=443", "off"],
                "cleanup must not bypass confirmation for newly added handlers"
            );
            let mut data = self.data.lock().unwrap();
            if let Some(failure) = data.fail {
                return Err(failure);
            }
            for key in ["TCP", "Web", "AllowFunnel"] {
                if let Some(map) = data.config[key].as_object_mut() {
                    map.retain(|key, _| {
                        if key == "443" {
                            false
                        } else {
                            !key.ends_with(":443")
                        }
                    });
                }
            }
            return Ok(String::new());
        }
        let is_up = args.first().is_some_and(|arg| arg == "up");
        if !is_up {
            assert_eq!(&args[..4], &["funnel", "--bg", "--https=443", "--yes"]);
            let port = args[4]
                .strip_prefix("http://127.0.0.1:")
                .unwrap()
                .parse()
                .unwrap();
            let mut data = self.data.lock().unwrap();
            if data.apply {
                data.config = public_config(port);
            }
        }
        if self.wait.load(Ordering::SeqCst) {
            auth("https://login.tailscale.com/f/test-authorization".into());
            self.entered.notify_one();
            tokio::select! {
                _ = cancel.cancelled() => return Err(Failure("cancelled")),
                _ = self.release.notified() => {}
            }
        }
        if let Some(failure) = self.data.lock().unwrap().fail {
            return Err(failure);
        }
        if is_up {
            self.data.lock().unwrap().backend = "Running".into();
        }
        Ok(String::new())
    }
}

/// Full AppState with the funnel manager wired to `cli`. The returned TempDir
/// must be kept alive by the caller for as long as the state lives. Restarts
/// must reuse `pool`: the funnel preference lives in the database, and a fresh
/// in-memory database looks like a factory reset.
async fn fixture_pool(
    cli: Arc<FakeCli>,
    port: u16,
    pool: sqlx::SqlitePool,
) -> (tempfile::TempDir, Arc<AppState>) {
    let temp = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState {
        paths: crate::paths::AppPaths::from_data_dir(temp.path().join("app-data")),
        pool,
        config_writes: ConfigWriteRuntimeState::default(),
        deeplink_protocols: DeepLinkProtocolRuntime::default(),
        close_to_tray: CloseToTrayRuntime::default(),
        route_proxy: RouteProxyRuntimeState::default(),
        saas: crate::saas::SaasRuntime::default(),
        web_service: WebServiceRuntimeState::default(),
        tailscale_funnel: Arc::new(FunnelManager::with_executor(cli)),
        terminals: TerminalManager::default(),
        terminal_hub: Arc::new(crate::web::terminal_hub::TerminalHub::default()),
        event_broadcaster: Arc::new(WebEventBroadcaster::default()),
    });
    if port != 0 {
        WebService::mark_standalone_listener(
            &state,
            "127.0.0.1",
            port,
            format!("http://127.0.0.1:{port}"),
        )
        .await;
    }
    (temp, state)
}

async fn fixture(cli: Arc<FakeCli>, port: u16) -> (tempfile::TempDir, Arc<AppState>) {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    fixture_pool(cli, port, pool).await
}

async fn finished(state: &AppState) -> FunnelStatus {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let status = status_core(state).await.unwrap();
            if !matches!(status.state.as_str(), "starting" | "authorizing") {
                return status;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("operation did not settle")
}

#[tokio::test]
async fn setup_reports_distinct_prerequisites_and_can_connect_a_stopped_node() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    for (backend, prerequisite) in [
        ("NeedsLogin", "login"),
        ("NeedsMachineAuth", "approveDevice"),
        ("Stopped", "connect"),
    ] {
        cli.data.lock().unwrap().backend = backend.into();
        let status = serde_json::to_value(status_core(&state).await.unwrap()).unwrap();
        assert_eq!(status["prerequisite"], prerequisite);
    }
    login_core(state.clone()).await.unwrap();
    assert_eq!(finished(&state).await.state, "ready");
    assert!(cli
        .data
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|args| args == &["up", "--timeout=120s"]));
    WebService::stop(&state).await.unwrap();
    let status = serde_json::to_value(status_core(&state).await.unwrap()).unwrap();
    assert_eq!(status["prerequisite"], "startWebService");
    cli.data.lock().unwrap().installed = false;
    let status = serde_json::to_value(status_core(&state).await.unwrap()).unwrap();
    assert_eq!(status["prerequisite"], "install");
}

#[tokio::test]
async fn running_without_dns_does_not_request_login() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    cli.data.lock().unwrap().hostname.clear();
    for status in [
        status_core(&state).await.unwrap(),
        enable_core(state.clone()).await.unwrap(),
    ] {
        let wire = serde_json::to_value(status).unwrap();
        assert_eq!(wire["state"], "error");
        assert_eq!(wire["prerequisite"], "configureDns");
        assert_eq!(wire["error"], "dnsNotReady");
    }
    assert!(!cli
        .data
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|args| args.contains(&"up".into()) || args.contains(&"--bg".into())));
}

#[tokio::test]
async fn device_approval_does_not_repeat_login() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    cli.data.lock().unwrap().backend = "NeedsMachineAuth".into();
    let login = login_core(state.clone()).await.unwrap();
    assert_eq!(
        serde_json::to_value(login).unwrap()["prerequisite"],
        "approveDevice"
    );
    let enable = enable_core(state.clone()).await.unwrap();
    assert_eq!(
        serde_json::to_value(enable).unwrap()["prerequisite"],
        "approveDevice"
    );
    assert!(!cli
        .data
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|args| args.contains(&"up".into()) || args.contains(&"--bg".into())));
}

#[tokio::test]
async fn reports_backend_and_missing_installation_without_exposing_private_serve() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    for (backend, expected) in [
        ("NeedsLogin", "needsLogin"),
        ("Stopped", "stopped"),
        ("Running", "ready"),
    ] {
        cli.data.lock().unwrap().backend = backend.into();
        assert_eq!(status_core(&state).await.unwrap().state, expected);
    }
    cli.data.lock().unwrap().installed = false;
    assert_eq!(status_core(&state).await.unwrap().state, "notInstalled");
    cli.data.lock().unwrap().installed = true;
    cli.data.lock().unwrap().config = public_config(3080);
    cli.data.lock().unwrap().config["AllowFunnel"] = json!({});
    let status = status_core(&state).await.unwrap();
    assert!(!status.enabled);
    assert_eq!(status.state, "conflict");
}

#[tokio::test]
async fn never_adopts_or_removes_unowned_matching_mapping() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    cli.data.lock().unwrap().config = public_config(3080);
    let initial = status_core(&state).await.unwrap();
    assert!(initial.enabled && !initial.owned);
    enable_core(state.clone()).await.unwrap();
    let status = finished(&state).await;
    assert_eq!(status.error.as_deref(), Some("conflict"));
    let status = disable_core(&state).await.unwrap();
    assert_eq!(status.error.as_deref(), Some("notOwned"));
    assert_eq!(cli.data.lock().unwrap().config, public_config(3080));
    assert!(!cli
        .data
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|args| args.contains(&"--bg".into()) || args.contains(&"off".into())));
}

#[tokio::test]
async fn streams_authorization_and_cancels_with_cleanup_and_persistence() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    cli.wait.store(true, Ordering::SeqCst);
    assert_eq!(enable_core(state.clone()).await.unwrap().state, "starting");
    tokio::time::timeout(Duration::from_secs(3), cli.entered.notified())
        .await
        .unwrap();
    let status = status_core(&state).await.unwrap();
    assert_eq!(status.state, "authorizing");
    assert_eq!(
        status.auth_url.as_deref(),
        Some("https://login.tailscale.com/f/test-authorization")
    );
    let saved: Value = serde_json::from_str(
        &AppMetadataRepository::get_value(&state.pool, METADATA_KEY)
            .await
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(saved["desiredEnabled"], true);
    assert_eq!(saved["owned"]["port"], 3080);
    let status = cancel_core(&state).await.unwrap();
    assert!(!status.enabled && !status.owned && !status.desired_enabled);
    assert!(status.auth_url.is_none());
    assert_eq!(
        inspect_mapping(&cli.data.lock().unwrap().config, DNS, 3080),
        Mapping::Empty
    );
}

#[tokio::test]
async fn auth_key_login_ignores_streamed_authorization() {
    // An invalid key makes `up` fall back to interactive login; the streamed
    // login link must not surface (and must not auto-cancel into a confusing
    // error) — only the non-zero exit of a rejected key matters.
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    cli.data.lock().unwrap().backend = "NeedsLogin".into();
    cli.wait.store(true, Ordering::SeqCst);
    assert_eq!(
        login_with_auth_key_core(state.clone(), "secret-key".into())
            .await
            .unwrap()
            .state,
        "starting"
    );
    tokio::time::timeout(Duration::from_secs(3), cli.entered.notified())
        .await
        .unwrap();
    let status = status_core(&state).await.unwrap();
    assert_eq!(status.state, "starting");
    assert!(status.auth_url.is_none());
    let status = cancel_core(&state).await.unwrap();
    // cancel_task bumps the generation, so the executor's "cancelled" outcome
    // is deliberately swallowed; what matters is the observable state.
    assert!(status.error.is_none());
    assert!(
        !cli
            .data
            .lock()
            .unwrap()
            .calls
            .iter()
            .any(|args| args.contains(&"--bg".into())),
        "auth-key login must not publish anything"
    );
}

#[tokio::test]
async fn successful_exit_without_configuration_stays_failed() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    cli.data.lock().unwrap().apply = false;
    enable_core(state.clone()).await.unwrap();
    let status = finished(&state).await;
    assert!(!status.enabled);
    assert_eq!(status.error.as_deref(), Some("failed"));
    assert!(status.desired_enabled);
    assert_eq!(status_core(&state).await.unwrap().state, "error");
}

#[tokio::test]
async fn login_does_not_change_a_running_profile() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    login_core(state.clone()).await.unwrap();
    assert_eq!(finished(&state).await.state, "ready");
    assert!(!cli
        .data
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|args| args.first().is_some_and(|arg| arg == "up")));
    cli.data.lock().unwrap().backend = "NeedsLogin".into();
    login_core(state.clone()).await.unwrap();
    assert_eq!(finished(&state).await.state, "ready");
    assert!(cli
        .data
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|args| args == &["up", "--timeout=120s"]));
}

#[tokio::test]
async fn shutdown_keeps_preference_and_restore_cleans_old_port() {
    let cli = Arc::new(FakeCli::default());
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let (_temp, state) = fixture_pool(cli.clone(), 3080, pool.clone()).await;
    enable_core(state.clone()).await.unwrap();
    assert!(finished(&state).await.enabled);
    // Restart on a new port, against the SAME database: restore re-publishes.
    let (restarted_temp, restarted) = fixture_pool(cli.clone(), 3090, pool).await;
    std::mem::forget(restarted_temp);
    restore(restarted.clone());
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let status = status_core(&restarted).await.unwrap();
            if status.enabled
                && status.owned
                && cli.data.lock().unwrap().config["Web"][format!("{DNS}:443")]["Handlers"]["/"]
                    ["Proxy"]
                    == "http://127.0.0.1:3090"
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let guard = restarted
        .web_service
        .config_reconciliation_lock
        .lock()
        .await;
    shutdown_locked(&restarted).await.unwrap();
    drop(guard);
    let status = status_core(&restarted).await.unwrap();
    assert!(!status.enabled && !status.owned && status.desired_enabled);
}

#[tokio::test]
async fn refuses_cleanup_after_external_edit_and_preserves_other_ports() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 3080).await;
    enable_core(state.clone()).await.unwrap();
    assert!(finished(&state).await.enabled);
    cli.data.lock().unwrap().config["Web"][format!("{DNS}:443")]["Handlers"]["/foreign"] =
        json!({"Text":"external"});
    let before = cli.data.lock().unwrap().config.clone();
    assert_eq!(
        disable_core(&state).await.unwrap().error.as_deref(),
        Some("conflict")
    );
    assert_eq!(cli.data.lock().unwrap().config, before);
    cli.data.lock().unwrap().config = public_config(3080);
    cli.data.lock().unwrap().config["TCP"]["8443"] = json!({"HTTPS":true});
    assert!(!disable_core(&state).await.unwrap().enabled);
    assert_eq!(
        cli.data.lock().unwrap().config["TCP"]["8443"]["HTTPS"],
        true
    );
}

#[tokio::test]
async fn startup_reconciles_owned_mapping_without_starting_web_service() {
    let cli = Arc::new(FakeCli::default());
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    let (_temp, state) = fixture_pool(cli.clone(), 3080, pool.clone()).await;
    enable_core(state.clone()).await.unwrap();
    assert!(finished(&state).await.enabled);
    let (restarted_temp, restarted) = fixture_pool(cli.clone(), 0, pool).await;
    std::mem::forget(restarted_temp);
    initialize(&restarted).await.unwrap();
    assert_eq!(
        inspect_mapping(&cli.data.lock().unwrap().config, DNS, 3080),
        Mapping::Empty
    );
    let status = status_core(&restarted).await.unwrap();
    assert!(!status.enabled && !status.owned && status.desired_enabled);
}

#[tokio::test]
async fn rejects_missing_service_or_unsafe_bind_before_starting_cli() {
    let cli = Arc::new(FakeCli::default());
    let (_temp, state) = fixture(cli.clone(), 0).await;
    assert_eq!(
        enable_core(state.clone()).await.unwrap().error.as_deref(),
        Some("stopped")
    );
    let mut config = WebService::load_config(&state.paths).await.unwrap();
    config.host = "192.0.2.10".into();
    WebService::save_config(&state.paths, &config).await.unwrap();
    WebService::mark_standalone_listener(&state, "192.0.2.10", 3080, "http://192.0.2.10:3080")
        .await;
    assert_eq!(
        enable_core(state.clone()).await.unwrap().error.as_deref(),
        Some("unsupportedBind")
    );
    assert!(cli.data.lock().unwrap().calls.is_empty());
}
