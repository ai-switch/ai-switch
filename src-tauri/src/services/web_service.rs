use crate::app_state::AppState;
use crate::error::AppError;
use crate::paths::{is_desktop_dev_runtime, AppPaths};
use crate::server::{
    advertised_web_host, format_web_base_url, is_loopback_host, normalize_tls_paths,
};
use crate::services::mobile_pairing::{
    MobilePairingPayload, MobilePairingRedeemResponse, MobilePairingStore, MobileTokenRegistry,
};
use crate::services::remote_probe::{probe_access_url, should_probe_access_url};
use crate::services::route_proxy_https_service::RouteProxyHttpsService;
use crate::services::route_proxy_service::RouteProxyService;
use crate::web::router::build_router_with_sensitive_command_gate;
use crate::web::static_assets::resolve_static_dir;
use crate::web::tailscale_funnel::{self, FunnelStatus};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::time::SystemTime;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use url::Url;
use uuid::Uuid;

const MOBILE_TOKEN_REGISTRY_FILE: &str = "mobile-tokens.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebServiceConfig {
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
    #[serde(rename = "routeAccessEnabled", alias = "autoStart", default)]
    pub route_access_enabled: bool,
    /// One-time upgrade marker: legacy Web-only ports are reset to the shared
    /// service port, while later user changes are preserved.
    #[serde(default)]
    pub shared_port_migrated: bool,
    #[serde(default)]
    pub tls_enabled: bool,
    #[serde(default)]
    pub tls_cert_path: Option<String>,
    #[serde(default)]
    pub tls_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebServerStatus {
    pub running: bool,
    pub host: String,
    pub port: Option<u16>,
    pub base_url: Option<String>,
}

#[derive(Clone, Default)]
pub struct WebServiceRuntimeState {
    pub(crate) inner: Arc<Mutex<WebServiceRuntimeInner>>,
    pub(crate) config_reconciliation_lock: Arc<Mutex<()>>,
    mobile_pairing: MobilePairingStore,
}

#[derive(Default)]
pub(crate) struct WebServiceRuntimeInner {
    pub(crate) status: Option<WebServerStatus>,
    shutdown: Option<oneshot::Sender<()>>,
    join_handle: Option<JoinHandle<()>>,
    sensitive_command_gate: Option<Arc<AtomicBool>>,
}

pub struct WebService;

impl WebService {
    pub fn mobile_token_registry(runtime: &WebServiceRuntimeState) -> MobileTokenRegistry {
        runtime.mobile_pairing.mobile_token_registry()
    }

    #[cfg(test)]
    pub(crate) fn mobile_pairing_store_for_test(
        runtime: &WebServiceRuntimeState,
    ) -> MobilePairingStore {
        runtime.mobile_pairing.clone()
    }

    pub async fn create_mobile_pairing(
        state: &AppState,
        force: bool,
    ) -> Result<MobilePairingPayload, AppError> {
        let _guard = state.web_service.config_reconciliation_lock.lock().await;
        let config = Self::load_config(&state.paths).await?;
        let web_status = Self::status(&state.web_service, &config).await;
        if !web_status.running {
            return Err(AppError::Validation {
                code: "mobile_pairing.web_service_not_running",
                message: "Start the Web Service before creating a mobile pairing code".to_string(),
                details: None,
                recoverable: true,
            });
        }
        let funnel = tailscale_funnel::status_locked(state).await?;
        if funnel.state != "enabled" || funnel.url.is_none() {
            return Err(AppError::Validation {
                code: "mobile_pairing.remote_access_not_ready",
                message: "Public access over Tailscale Funnel is not enabled".to_string(),
                details: funnel.error.clone(),
                recoverable: true,
            });
        }
        let access_url = funnel.url.expect("enabled funnel carries its public URL");
        // A blocked Funnel ingress still resolves and accepts TCP, so the phone
        // only learns it is unusable after scanning. Probe the same path first.
        if should_probe_access_url(true, force) {
            if let Err(reason) = probe_access_url(&access_url).await {
                return Err(AppError::Validation {
                    code: "mobile_pairing.remote_url_unreachable",
                    message: format!("{access_url} is not reachable from this computer"),
                    details: Some(reason),
                    recoverable: true,
                });
            }
        }
        state
            .web_service
            .mobile_pairing
            .create(
                Some(access_url),
                None,
                SystemTime::now(),
                Duration::from_secs(5 * 60),
            )
            .await
            .map_err(|message| AppError::Validation {
                code: "mobile_pairing.create_failed",
                message,
                details: None,
                recoverable: true,
            })
    }

    pub async fn redeem_mobile_pairing(
        state: &AppState,
        code: String,
    ) -> Result<MobilePairingRedeemResponse, AppError> {
        let _guard = state.web_service.config_reconciliation_lock.lock().await;
        let now = SystemTime::now();
        let response = state
            .web_service
            .mobile_pairing
            .redeem(&code, now)
            .await
            .map_err(|message| AppError::Validation {
                code: "mobile_pairing.invalid_code",
                message,
                details: None,
                recoverable: true,
            })?;
        // The response already contains the usable token. A persistence error
        // must not discard it after consuming the one-time pairing code; the
        // in-memory registry remains authoritative for the current process.
        if let Err(error) = state
            .web_service
            .mobile_pairing
            .persist_tokens(&mobile_token_registry_path(&state.paths), now)
            .await
        {
            eprintln!("failed to persist mobile token registry: {error}");
        }
        Ok(response)
    }

    pub async fn load_config(paths: &AppPaths) -> Result<WebServiceConfig, AppError> {
        paths.ensure().await?;
        if !paths.web_service_file.exists() {
            let config = WebServiceConfig::default();
            return Self::save_config(paths, &config).await;
        }

        let contents = tokio::fs::read_to_string(&paths.web_service_file).await?;
        let config: WebServiceConfig = serde_json::from_str(&contents)?;
        let legacy_port = !config.shared_port_migrated;
        let mut normalized = Self::normalize_config(config.clone());
        if legacy_port {
            normalized.port = default_service_port(is_desktop_dev_runtime());
        }
        if normalized != config {
            Self::save_config(paths, &normalized).await?;
        }
        Ok(normalized)
    }

    pub async fn save_config(
        paths: &AppPaths,
        config: &WebServiceConfig,
    ) -> Result<WebServiceConfig, AppError> {
        paths.ensure().await?;
        let normalized = Self::normalize_config(config.clone());
        validate_enabled_tls_paths(&normalized)?;
        let contents = serde_json::to_string_pretty(&normalized)?;
        tokio::fs::write(&paths.web_service_file, contents).await?;
        Ok(normalized)
    }

    pub async fn save_config_and_reconcile(
        state: &AppState,
        config: &WebServiceConfig,
    ) -> Result<WebServiceConfig, AppError> {
        let _guard = state.web_service.config_reconciliation_lock.lock().await;
        Self::set_sensitive_command_policy(&state.web_service, false).await;
        let saved = Self::save_config(&state.paths, config).await?;
        Self::reconcile_sensitive_command_policy_locked(state, &saved).await;
        Ok(saved)
    }

    pub async fn status(
        runtime: &WebServiceRuntimeState,
        config: &WebServiceConfig,
    ) -> WebServerStatus {
        runtime
            .inner
            .lock()
            .await
            .status
            .clone()
            .unwrap_or(WebServerStatus {
                running: false,
                host: config.host.clone(),
                port: None,
                base_url: None,
            })
    }

    // Box the future because the shared router contains commands that can start
    // this service; this breaks the recursive handler Send/type dependency.
    pub fn start(
        state: Arc<AppState>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<WebServerStatus, AppError>> + Send>,
    > {
        Box::pin(async move {
            let _guard = state.web_service.config_reconciliation_lock.lock().await;
            Self::set_sensitive_command_policy(&state.web_service, false).await;
            let config = Self::load_config(&state.paths).await?;
            RouteProxyService::set_route_access_enabled(
                &state.route_proxy,
                config.route_access_enabled,
            )
            .await;
            let status = Self::start_server_locked(Arc::clone(&state), config.clone()).await?;
            // Re-publish the funnel if the persisted preference still asks for
            // it; the task waits for this lock, so ordering stays serialized.
            tailscale_funnel::restore(Arc::clone(&state));
            Self::reconcile_sensitive_command_policy_locked(&state, &config).await;
            Ok(status)
        })
    }

    async fn start_server_locked(
        state: Arc<AppState>,
        config: WebServiceConfig,
    ) -> Result<WebServerStatus, AppError> {
        let config = Self::normalize_config(config);
        let tls_paths = validate_start_config(&config)?;
        if let Some(status) = state.web_service.inner.lock().await.status.clone() {
            if status.running {
                return Ok(status);
            }
        }

        let token = config.token.clone().unwrap_or_default();
        if let Err(error) = state
            .web_service
            .mobile_pairing
            .load_tokens(&mobile_token_registry_path(&state.paths), SystemTime::now())
            .await
        {
            // A corrupt registry must not prevent the primary-token web
            // service from starting; ignoring it fails closed for mobile
            // tokens while preserving local recovery.
            eprintln!("failed to load mobile token registry: {error}");
        }
        let static_dir = resolve_static_dir();
        let sensitive_command_gate = Arc::new(AtomicBool::new(false));
        let router = build_router_with_sensitive_command_gate(
            Arc::clone(&state),
            token,
            static_dir,
            Arc::clone(&sensitive_command_gate),
        );
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let (host, port, scheme, join_handle) = if let Some((certificate_path, private_key_path)) =
            tls_paths
        {
            let rustls_config = load_rustls_config(&certificate_path, &private_key_path).await?;
            let addr = resolve_bind_address(&config.host, config.port).await?;
            let listener =
                RouteProxyService::bind_shared_web_listener(&state.route_proxy, addr).await?;
            let addr = listener
                .local_addr()
                .map_err(|error| AppError::Filesystem {
                    code: "web_service.addr",
                    message: "Could not read web service address".to_string(),
                    details: Some(error.to_string()),
                    recoverable: true,
                })?;
            let listener = listener.into_std().map_err(|error| AppError::Filesystem {
                code: "web_service.bind",
                message: "Could not start web service".to_string(),
                details: Some(error.to_string()),
                recoverable: true,
            })?;
            let host = advertised_web_host(addr);
            let port = addr.port();
            let handle = axum_server::Handle::new();
            let join_handle = tokio::spawn(async move {
                let server = axum_server::from_tcp_rustls(listener, rustls_config)
                    .handle(handle.clone())
                    .serve(router.into_make_service_with_connect_info::<SocketAddr>());
                tokio::pin!(server);
                tokio::select! {
                    result = &mut server => {
                        if let Err(error) = result {
                            eprintln!("web service HTTPS server error: {error}");
                        }
                    }
                    _ = shutdown_rx => {
                        handle.graceful_shutdown(Some(Duration::from_secs(5)));
                        if let Err(error) = server.await {
                            eprintln!("web service HTTPS shutdown error: {error}");
                        }
                    }
                }
            });
            (host, port, "https", join_handle)
        } else {
            let addr = resolve_bind_address(&config.host, config.port).await?;
            let listener =
                RouteProxyService::bind_shared_web_listener(&state.route_proxy, addr).await?;
            let addr = listener
                .local_addr()
                .map_err(|error| AppError::Filesystem {
                    code: "web_service.addr",
                    message: "Could not read web service address".to_string(),
                    details: Some(error.to_string()),
                    recoverable: true,
                })?;
            let host = advertised_web_host(addr);
            let port = addr.port();
            let join_handle = tokio::spawn(async move {
                let server = axum::serve(listener, router).with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                });
                if let Err(error) = server.await {
                    eprintln!("web service server error: {error}");
                }
            });
            (host, port, "http", join_handle)
        };
        let base_url = format_web_base_url(scheme, &host, port);
        RouteProxyService::mark_shared_listener(
            &state.route_proxy,
            config.host.clone(),
            port,
            base_url.clone(),
        )
        .await;

        let status = WebServerStatus {
            running: true,
            host,
            port: Some(port),
            base_url: Some(base_url),
        };
        {
            let mut inner = state.web_service.inner.lock().await;
            if let Some(existing) = &inner.status {
                if existing.running {
                    let _ = shutdown_tx.send(());
                    return Ok(existing.clone());
                }
            }
            inner.status = Some(status.clone());
            inner.shutdown = Some(shutdown_tx);
            inner.join_handle = Some(join_handle);
            inner.sensitive_command_gate = Some(sensitive_command_gate);
        }

        Ok(status)
    }

    pub async fn stop(state: &AppState) -> Result<WebServerStatus, AppError> {
        let _guard = state.web_service.config_reconciliation_lock.lock().await;
        Self::set_sensitive_command_policy(&state.web_service, false).await;
        // Undo the funnel mapping while the proxy target is still alive; a
        // failure aborts the stop so the UI can reconcile instead of leaving a
        // public URL pointed at a dead port.
        tailscale_funnel::shutdown_locked(state).await?;
        let config = Self::load_config(&state.paths).await.unwrap_or_default();
        RouteProxyService::set_route_access_enabled(
            &state.route_proxy,
            config.route_access_enabled,
        )
        .await;
        let (shutdown, join_handle, owned_listener) = {
            let mut inner = state.web_service.inner.lock().await;
            let owned_listener = inner.status.take().is_some_and(|status| status.running);
            inner.sensitive_command_gate = None;
            (
                inner.shutdown.take(),
                inner.join_handle.take(),
                owned_listener,
            )
        };
        if let Some(shutdown) = shutdown {
            let _ = shutdown.send(());
        }
        if let Some(mut handle) = join_handle {
            if tokio::time::timeout(Duration::from_secs(5), &mut handle)
                .await
                .is_err()
            {
                handle.abort();
                let _ = handle.await;
            }
        }
        if owned_listener {
            RouteProxyService::clear_shared_listener(&state.route_proxy).await;
            if let Err(error) = RouteProxyHttpsService::clear_auto_start(&state.paths).await {
                eprintln!("Could not clear legacy pool auto-start: {error}");
            }
        }

        Ok(WebServerStatus {
            running: false,
            host: config.host,
            port: None,
            base_url: None,
        })
    }

    pub async fn set_route_access(
        state: &AppState,
        enabled: bool,
    ) -> Result<WebServerStatus, AppError> {
        let mut config = Self::load_config(&state.paths).await?;
        config.route_access_enabled = enabled;
        Self::save_config(&state.paths, &config).await?;
        RouteProxyService::set_route_access_enabled(&state.route_proxy, enabled).await;

        if enabled {
            Self::start(Arc::new(state.clone())).await
        } else {
            Ok(Self::status(&state.web_service, &config).await)
        }
    }

    pub async fn mark_standalone_listener(
        state: &AppState,
        host: impl Into<String>,
        port: u16,
        base_url: impl Into<String>,
    ) {
        let mut inner = state.web_service.inner.lock().await;
        inner.status = Some(WebServerStatus {
            running: true,
            host: host.into(),
            port: Some(port),
            base_url: Some(base_url.into()),
        });
    }

    pub async fn get_tailscale_funnel_status(state: &AppState) -> Result<FunnelStatus, AppError> {
        tailscale_funnel::status_core(state).await
    }

    pub async fn start_tailscale_login(state: Arc<AppState>) -> Result<FunnelStatus, AppError> {
        tailscale_funnel::login_core(state).await
    }

    pub async fn start_tailscale_with_auth_key(
        state: Arc<AppState>,
        auth_key: String,
    ) -> Result<FunnelStatus, AppError> {
        tailscale_funnel::login_with_auth_key_core(state, auth_key).await
    }

    pub async fn enable_tailscale_funnel(state: Arc<AppState>) -> Result<FunnelStatus, AppError> {
        tailscale_funnel::enable_core(state).await
    }

    pub async fn disable_tailscale_funnel(state: &AppState) -> Result<FunnelStatus, AppError> {
        tailscale_funnel::disable_core(state).await
    }

    pub async fn cancel_tailscale_funnel_operation(
        state: &AppState,
    ) -> Result<FunnelStatus, AppError> {
        tailscale_funnel::cancel_core(state).await
    }

    /// Re-apply the sensitive-command gate from a funnel status observation.
    /// The funnel module calls this whenever a status lands; callers already
    /// hold the Web service lifecycle lock, so this must not take it.
    pub(crate) async fn apply_funnel_gate_locked(state: &AppState, funnel: &FunnelStatus) {
        let config = Self::load_config(&state.paths).await.unwrap_or_default();
        let status = Self::status(&state.web_service, &config).await;
        let enabled = sensitive_commands_enabled_for_runtime(&config, &status, Some(funnel));
        Self::set_sensitive_command_policy(&state.web_service, enabled).await;
    }

    async fn reconcile_sensitive_command_policy_locked(
        state: &AppState,
        config: &WebServiceConfig,
    ) {
        Self::set_sensitive_command_policy(&state.web_service, false).await;
        let status = Self::status(&state.web_service, config).await;
        if !status.running {
            return;
        }

        // Funnel operations re-apply the gate whenever a status observation
        // lands. Until one does, only a funnel the user never asked for leaves
        // the plain-HTTP gate open.
        if !tailscale_funnel::desired_enabled(state) {
            let enabled = sensitive_commands_enabled_for_runtime(config, &status, None);
            Self::set_sensitive_command_policy(&state.web_service, enabled).await;
        }
    }

    async fn set_sensitive_command_policy(runtime: &WebServiceRuntimeState, enabled: bool) {
        let gate = runtime.inner.lock().await.sensitive_command_gate.clone();
        if let Some(gate) = gate {
            gate.store(enabled, Ordering::Release);
        }
    }

    fn normalize_config(config: WebServiceConfig) -> WebServiceConfig {
        let defaults = WebServiceConfig::default();
        let host = config.host.trim();
        let token = config
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or(defaults.token);
        let tls_cert_path = normalize_optional_path(config.tls_cert_path);
        let tls_key_path = normalize_optional_path(config.tls_key_path);

        WebServiceConfig {
            host: if host.is_empty() {
                defaults.host
            } else {
                host.to_string()
            },
            port: if config.port == 0 {
                defaults.port
            } else {
                config.port
            },
            token,
            route_access_enabled: config.route_access_enabled,
            shared_port_migrated: true,
            tls_enabled: config.tls_enabled,
            tls_cert_path,
            tls_key_path,
        }
    }
}

impl Default for WebServiceConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: default_service_port(is_desktop_dev_runtime()),
            token: Some(Uuid::new_v4().to_string()),
            route_access_enabled: false,
            shared_port_migrated: false,
            tls_enabled: false,
            tls_cert_path: None,
            tls_key_path: None,
        }
    }
}

fn default_service_port(is_dev: bool) -> u16 {
    if is_dev {
        10086
    } else {
        crate::server::standalone_default_port()
    }
}

fn normalize_optional_path(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn mobile_token_registry_path(paths: &AppPaths) -> PathBuf {
    paths.data_dir.join(MOBILE_TOKEN_REGISTRY_FILE)
}

fn validate_enabled_tls_paths(
    config: &WebServiceConfig,
) -> Result<Option<(PathBuf, PathBuf)>, AppError> {
    if !config.tls_enabled {
        return Ok(None);
    }
    normalize_tls_paths(
        config.tls_cert_path.as_deref(),
        config.tls_key_path.as_deref(),
    )?
    .ok_or_else(|| AppError::Validation {
        code: "web.tls_paths_incomplete",
        message: "Both TLS certificate and private-key paths are required".to_string(),
        details: None,
        recoverable: true,
    })
    .map(Some)
}

fn validate_start_config(
    config: &WebServiceConfig,
) -> Result<Option<(PathBuf, PathBuf)>, AppError> {
    let tls_paths = validate_enabled_tls_paths(config)?;
    // The default config generates a UUID token, so this only bites a
    // hand-blanked web-service.json — where the alternative is a server that
    // answers 401 to everything without saying why.
    crate::server::resolve_server_token(config.token.clone())?;
    Ok(tls_paths)
}

fn sensitive_commands_enabled_for_runtime(
    config: &WebServiceConfig,
    status: &WebServerStatus,
    funnel_status: Option<&FunnelStatus>,
) -> bool {
    if !status.running {
        return false;
    }
    if !is_loopback_host(&config.host) {
        return true;
    }

    let Some(base_url) = status
        .base_url
        .as_deref()
        .and_then(|value| Url::parse(value).ok())
    else {
        return false;
    };
    if base_url.scheme() == "https" {
        return true;
    }
    if base_url.scheme() != "http" || !is_loopback_host(&status.host) {
        return false;
    }

    match funnel_status {
        // The funnel was never asked for: plain local HTTP stays fully usable,
        // matching the old "secure network disabled" behavior.
        None => true,
        // A live funnel mapping is HTTPS by definition (TLS ends at Tailscale's
        // edge), so enabling it opens the gate. While connecting, errored or
        // conflicted, stay closed — the trusted transport is not there yet.
        Some(funnel) => funnel.enabled,
    }
}

async fn resolve_bind_address(host: &str, port: u16) -> Result<SocketAddr, AppError> {
    tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| AppError::Validation {
            code: "web_service.addr",
            message: "Could not resolve web service address".to_string(),
            details: Some(error.to_string()),
            recoverable: true,
        })?
        .next()
        .ok_or_else(|| AppError::Validation {
            code: "web_service.addr",
            message: "Could not resolve web service address".to_string(),
            details: None,
            recoverable: true,
        })
}

async fn load_rustls_config(
    certificate_path: &std::path::Path,
    private_key_path: &std::path::Path,
) -> Result<axum_server::tls_rustls::RustlsConfig, AppError> {
    axum_server::tls_rustls::RustlsConfig::from_pem_file(certificate_path, private_key_path)
        .await
        .map_err(|error| AppError::Validation {
            code: "web.tls_material_invalid",
            message: "Could not load Web TLS certificate".to_string(),
            details: Some(error.to_string()),
            recoverable: true,
        })
}

#[cfg(test)]
mod tests {
    use super::{
        load_rustls_config, sensitive_commands_enabled_for_runtime, validate_start_config,
        WebServerStatus, WebService, WebServiceConfig, WebServiceRuntimeState,
    };
    use crate::app_state::AppState;
    use crate::database::{create_memory_pool, run_migrations};
    use crate::services::config_write_service::ConfigWriteRuntimeState;
    use crate::services::deeplink_protocol_service::DeepLinkProtocolRuntime;
    use crate::services::mobile_pairing::MobilePairingStore;
    use crate::services::route_proxy_service::RouteProxyRuntimeState;
    use crate::terminal_manager::TerminalManager;
    use crate::web::event_bridge::WebEventBroadcaster;
    use crate::web::tailscale_funnel::FunnelStatus;
    use async_trait::async_trait;
    use rcgen::{generate_simple_self_signed, CertifiedKey};
    use std::sync::atomic::AtomicUsize;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::Duration;
    use std::time::SystemTime;
    use tempfile::tempdir;
    use tokio::sync::Notify;

    #[tokio::test]
    async fn mobile_pairing_codes_are_hashed_expiring_and_single_use() {
        let store = MobilePairingStore::default();
        let payload = store
            .create(
                Some("https://public.example".to_string()),
                None,
                SystemTime::UNIX_EPOCH + Duration::from_secs(1_000),
                Duration::from_secs(60),
            )
            .await
            .unwrap();
        assert_eq!(payload.version, 1);
        assert!(!payload.pairing_code.is_empty());
        assert!(
            store
                .debug_contains_plaintext_code(&payload.pairing_code)
                .await
                == false
        );

        let redeemed = store
            .redeem(
                &payload.pairing_code,
                SystemTime::UNIX_EPOCH + Duration::from_secs(1_001),
            )
            .await
            .unwrap();
        assert!(redeemed.token.starts_with("ms_"));
        assert!(store
            .redeem(
                &payload.pairing_code,
                SystemTime::UNIX_EPOCH + Duration::from_secs(1_002)
            )
            .await
            .is_err());
        assert!(
            store
                .is_mobile_token_valid(
                    &redeemed.token,
                    SystemTime::UNIX_EPOCH + Duration::from_secs(1_002)
                )
                .await
        );
    }

    #[tokio::test]
    async fn mobile_pairing_rejects_expired_codes() {
        let store = MobilePairingStore::default();
        let payload = store
            .create(
                None,
                Some("https://private.example".to_string()),
                SystemTime::UNIX_EPOCH + Duration::from_secs(2_000),
                Duration::from_secs(1),
            )
            .await
            .unwrap();
        assert!(store
            .redeem(
                &payload.pairing_code,
                SystemTime::UNIX_EPOCH + Duration::from_secs(2_001)
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn redeemed_mobile_tokens_are_persisted_for_a_new_runtime() {
        let (_temp, state) = concurrency_test_state().await;
        let store = WebService::mobile_pairing_store_for_test(&state.web_service);
        let payload = store
            .create(
                Some("https://public.example".to_string()),
                None,
                SystemTime::now(),
                Duration::from_secs(300),
            )
            .await
            .unwrap();
        let redeemed = WebService::redeem_mobile_pairing(state.as_ref(), payload.pairing_code)
            .await
            .unwrap();

        let restored = MobilePairingStore::default();
        restored
            .load_tokens(
                &state.paths.data_dir.join("mobile-tokens.json"),
                SystemTime::now(),
            )
            .await
            .unwrap();
        assert!(
            restored
                .is_mobile_token_valid(&redeemed.token, SystemTime::now())
                .await
        );
    }

    async fn concurrency_test_state() -> (tempfile::TempDir, Arc<AppState>) {
        let temp = tempdir().unwrap();
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        let state = Arc::new(AppState {
            paths: crate::paths::AppPaths::from_data_dir(temp.path().join("app-data")),
            pool,
            config_writes: ConfigWriteRuntimeState::default(),
            deeplink_protocols: DeepLinkProtocolRuntime::default(),
            close_to_tray: crate::app_state::CloseToTrayRuntime::default(),
            route_proxy: RouteProxyRuntimeState::default(),
            saas: crate::saas::SaasRuntime::default(),
            web_service: WebServiceRuntimeState::default(),
            tailscale_funnel: Arc::new(crate::web::tailscale_funnel::FunnelManager::default()),
            terminals: TerminalManager::default(),
            terminal_hub: Arc::new(crate::web::terminal_hub::TerminalHub::default()),
            event_broadcaster: Arc::new(WebEventBroadcaster::default()),
        });
        (temp, state)
    }

    async fn seed_running_web_service(
        state: &AppState,
        config: &WebServiceConfig,
        gate: Arc<std::sync::atomic::AtomicBool>,
    ) {
        let mut runtime = state.web_service.inner.lock().await;
        runtime.status = Some(WebServerStatus {
            running: true,
            host: config.host.clone(),
            port: Some(config.port),
            base_url: Some(format!("http://{}:{}", config.host, config.port)),
        });
        runtime.sensitive_command_gate = Some(gate);
    }

    #[test]
    fn config_defaults_and_legacy_files_drop_the_removed_secure_network_keys() {
        let config = WebServiceConfig::default();
        assert!(!config.route_access_enabled);
        // An old web-service.json still carries tailscaleEnabled/…; serde must
        // ignore the removed keys instead of rejecting the whole file.
        let legacy: WebServiceConfig = serde_json::from_str(
            r#"{"host":"127.0.0.1","port":3090,"token":"t","routeAccessEnabled":false,
                "sharedPortMigrated":true,"tailscaleEnabled":true,
                "tailscaleExposureMode":"public","tailscaleAuthKeyPresent":true}"#,
        )
        .unwrap();
        assert_eq!(legacy.host, "127.0.0.1");
        assert_eq!(legacy.port, 3090);
    }
    #[test]
    fn advanced_tls_configuration_is_normalized_and_preserved() {
        let config = super::WebService::normalize_config(WebServiceConfig {
            tls_enabled: true,
            tls_cert_path: Some(" cert.pem ".to_string()),
            tls_key_path: Some(" key.pem ".to_string()),
            ..WebServiceConfig::default()
        });

        assert!(config.tls_enabled);
        assert_eq!(config.tls_cert_path.as_deref(), Some("cert.pem"));
        assert_eq!(config.tls_key_path.as_deref(), Some("key.pem"));
        validate_start_config(&config).unwrap();
    }

    #[test]
    fn enabled_tls_rejects_a_one_path_configuration() {
        let config = WebServiceConfig {
            host: "0.0.0.0".to_string(),
            tls_enabled: true,
            tls_cert_path: Some("cert.pem".to_string()),
            tls_key_path: None,
            ..WebServiceConfig::default()
        };

        let error = validate_start_config(&config).unwrap_err();
        assert!(matches!(
            error,
            crate::error::AppError::Validation {
                code: "web.tls_paths_incomplete",
                ..
            }
        ));
    }

    #[test]
    fn desktop_all_interface_http_starts_with_sensitive_commands_enabled() {
        let config = WebServiceConfig {
            host: "0.0.0.0".to_string(),
            tls_enabled: false,
            ..WebServiceConfig::default()
        };
        let web_status = WebServerStatus {
            running: true,
            host: "127.0.0.1".to_string(),
            port: Some(3090),
            base_url: Some("http://127.0.0.1:3090".to_string()),
        };

        validate_start_config(&config).unwrap();
        assert!(sensitive_commands_enabled_for_runtime(
            &config,
            &web_status,
            None,
        ));
    }

    fn funnel_status(state: &str, enabled: bool, desired: bool) -> FunnelStatus {
        FunnelStatus {
            state: state.to_string(),
            installed: true,
            enabled,
            desired_enabled: desired,
            owned: enabled,
            url: enabled.then(|| "https://machine.example.ts.net".to_string()),
            auth_url: None,
            error: None,
            prerequisite: None,
        }
    }

    fn loopback_http_status() -> WebServerStatus {
        WebServerStatus {
            running: true,
            host: "127.0.0.1".to_string(),
            port: Some(3090),
            base_url: Some("http://127.0.0.1:3090".to_string()),
        }
    }

    #[test]
    fn funnel_enabled_opens_the_local_http_gate_and_pending_states_keep_it_closed() {
        let config = WebServiceConfig {
            host: "127.0.0.1".to_string(),
            tls_enabled: false,
            ..WebServiceConfig::default()
        };
        let web_status = loopback_http_status();

        assert!(!sensitive_commands_enabled_for_runtime(
            &config,
            &web_status,
            Some(&funnel_status("starting", false, true)),
        ));
        assert!(!sensitive_commands_enabled_for_runtime(
            &config,
            &web_status,
            Some(&funnel_status("error", false, true)),
        ));
        assert!(!sensitive_commands_enabled_for_runtime(
            &config,
            &web_status,
            Some(&funnel_status("conflict", false, false)),
        ));
        assert!(sensitive_commands_enabled_for_runtime(
            &config,
            &web_status,
            Some(&funnel_status("enabled", true, true)),
        ));
    }

    #[test]
    fn local_http_gate_stays_open_while_funnel_is_not_requested() {
        let config = WebServiceConfig {
            host: "127.0.0.1".to_string(),
            tls_enabled: false,
            ..WebServiceConfig::default()
        };

        assert!(sensitive_commands_enabled_for_runtime(
            &config,
            &loopback_http_status(),
            None,
        ));
    }

    #[tokio::test]
    async fn config_reconciliation_lock_serializes_updates() {
        let runtime = WebServiceRuntimeState::default();
        let first_guard = runtime.config_reconciliation_lock.lock().await;
        let second_runtime = runtime.clone();
        let acquired = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let second_acquired = Arc::clone(&acquired);
        let second = tokio::spawn(async move {
            let _guard = second_runtime.config_reconciliation_lock.lock().await;
            second_acquired.store(true, Ordering::Release);
        });

        tokio::task::yield_now().await;
        assert!(!acquired.load(Ordering::Acquire));
        drop(first_guard);
        second.await.unwrap();
        assert!(acquired.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn configured_rustls_material_starts_an_https_listener() {
        let temp = tempdir().unwrap();
        let CertifiedKey { cert, key_pair } =
            generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let certificate_path = temp.path().join("certificate.pem");
        let private_key_path = temp.path().join("private-key.pem");
        tokio::fs::write(&certificate_path, cert.pem())
            .await
            .unwrap();
        tokio::fs::write(&private_key_path, key_pair.serialize_pem())
            .await
            .unwrap();
        load_rustls_config(&certificate_path, &private_key_path)
            .await
            .unwrap();

        let reservation = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reservation.local_addr().unwrap().port();
        drop(reservation);
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        let state = Arc::new(AppState {
            paths: crate::paths::AppPaths::from_data_dir(temp.path().join("app-data")),
            pool,
            config_writes: ConfigWriteRuntimeState::default(),
            deeplink_protocols: DeepLinkProtocolRuntime::default(),
            close_to_tray: crate::app_state::CloseToTrayRuntime::default(),
            route_proxy: RouteProxyRuntimeState::default(),
            saas: crate::saas::SaasRuntime::default(),
            web_service: WebServiceRuntimeState::default(),
            tailscale_funnel: Default::default(),
            terminals: TerminalManager::default(),
            terminal_hub: Arc::new(crate::web::terminal_hub::TerminalHub::default()),
            event_broadcaster: Arc::new(WebEventBroadcaster::default()),
        });
        let config = WebServiceConfig {
            host: "127.0.0.1".to_string(),
            port,
            tls_enabled: true,
            tls_cert_path: Some(certificate_path.display().to_string()),
            tls_key_path: Some(private_key_path.display().to_string()),
            ..WebServiceConfig::default()
        };
        WebService::save_config(&state.paths, &config)
            .await
            .unwrap();

        let status = WebService::start(Arc::clone(&state)).await.unwrap();
        assert_eq!(
            status.base_url.as_deref(),
            Some(format!("https://127.0.0.1:{port}").as_str())
        );
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();
        let mut response = None;
        for _ in 0..50 {
            match client
                .get(format!("https://127.0.0.1:{port}/health"))
                .send()
                .await
            {
                Ok(value) => {
                    response = Some(value);
                    break;
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        }
        assert_eq!(response.unwrap().status(), reqwest::StatusCode::OK);
        WebService::stop(&state).await;
    }

    #[tokio::test]
    async fn occupied_tls_port_fails_without_reporting_running() {
        let temp = tempdir().unwrap();
        let CertifiedKey { cert, key_pair } =
            generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let certificate_path = temp.path().join("certificate.pem");
        let private_key_path = temp.path().join("private-key.pem");
        tokio::fs::write(&certificate_path, cert.pem())
            .await
            .unwrap();
        tokio::fs::write(&private_key_path, key_pair.serialize_pem())
            .await
            .unwrap();

        let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = occupied.local_addr().unwrap().port();
        let pool = create_memory_pool().await.unwrap();
        run_migrations(&pool).await.unwrap();
        let state = Arc::new(AppState {
            paths: crate::paths::AppPaths::from_data_dir(temp.path().join("app-data")),
            pool,
            config_writes: ConfigWriteRuntimeState::default(),
            deeplink_protocols: DeepLinkProtocolRuntime::default(),
            close_to_tray: crate::app_state::CloseToTrayRuntime::default(),
            route_proxy: RouteProxyRuntimeState::default(),
            saas: crate::saas::SaasRuntime::default(),
            web_service: WebServiceRuntimeState::default(),
            tailscale_funnel: Default::default(),
            terminals: TerminalManager::default(),
            terminal_hub: Arc::new(crate::web::terminal_hub::TerminalHub::default()),
            event_broadcaster: Arc::new(WebEventBroadcaster::default()),
        });
        let config = WebServiceConfig {
            host: "127.0.0.1".to_string(),
            port,
            tls_enabled: true,
            tls_cert_path: Some(certificate_path.display().to_string()),
            tls_key_path: Some(private_key_path.display().to_string()),
            ..WebServiceConfig::default()
        };
        WebService::save_config(&state.paths, &config)
            .await
            .unwrap();

        let error = WebService::start(Arc::clone(&state)).await.unwrap_err();
        assert!(matches!(
            error,
            crate::error::AppError::Filesystem {
                code: "web_service.bind",
                ..
            }
        ));
        let status = WebService::status(&state.web_service, &config).await;
        assert!(!status.running);
        assert!(status.port.is_none());
        assert!(status.base_url.is_none());
    }
}

#[cfg(test)]
mod route_access_tests;
#[cfg(test)]
mod shared_listener_tests;
