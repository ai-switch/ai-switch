use std::sync::Arc;

use tauri::State;

use crate::app_state::AppState;
use crate::error::ApiError;
use crate::services::route_proxy_service::{RouteProxyService, RouteProxyStatus};
use crate::services::web_service::{WebServerStatus, WebService, WebServiceConfig};
use crate::web::tailscale_funnel::FunnelStatus;

#[tauri::command]
pub async fn get_web_service_config(
    state: State<'_, AppState>,
) -> Result<WebServiceConfig, ApiError> {
    WebService::load_config(&state.paths)
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn save_web_service_config(
    state: State<'_, AppState>,
    config: WebServiceConfig,
) -> Result<WebServiceConfig, ApiError> {
    let saved = WebService::save_config_and_reconcile(&state, &config)
        .await
        .map_err(ApiError::from)?;

    Ok(saved)
}

#[tauri::command]
pub async fn get_web_server_status(
    state: State<'_, AppState>,
) -> Result<WebServerStatus, ApiError> {
    let config = WebService::load_config(&state.paths)
        .await
        .map_err(ApiError::from)?;
    Ok(WebService::status(&state.web_service, &config).await)
}

#[tauri::command]
pub async fn start_web_server(state: State<'_, AppState>) -> Result<WebServerStatus, ApiError> {
    let app_state = Arc::new(state.inner().clone());
    WebService::start(app_state).await.map_err(ApiError::from)
}

#[tauri::command]
pub async fn stop_web_server(state: State<'_, AppState>) -> Result<WebServerStatus, ApiError> {
    WebService::stop(state.inner()).await.map_err(ApiError::from)
}

#[tauri::command]
pub async fn set_route_access(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<RouteProxyStatus, ApiError> {
    WebService::set_route_access(state.inner(), enabled).await?;
    Ok(RouteProxyService::status(&state.route_proxy).await)
}

#[tauri::command]
pub async fn get_tailscale_funnel_status(
    state: State<'_, AppState>,
) -> Result<FunnelStatus, ApiError> {
    WebService::get_tailscale_funnel_status(state.inner())
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn create_mobile_pairing(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<crate::services::mobile_pairing::MobilePairingPayload, ApiError> {
    WebService::create_mobile_pairing(state.inner(), force.unwrap_or(false))
        .await
        .map_err(ApiError::from)
}

// The authorization URL surfaces through polled `FunnelStatus.authUrl`; the
// frontend opens it (deduped, once per flow), so no Rust-side opener here.
#[tauri::command]
pub async fn start_tailscale_login(state: State<'_, AppState>) -> Result<FunnelStatus, ApiError> {
    WebService::start_tailscale_login(Arc::new(state.inner().clone()))
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn start_tailscale_with_auth_key(
    state: State<'_, AppState>,
    auth_key: String,
) -> Result<FunnelStatus, ApiError> {
    WebService::start_tailscale_with_auth_key(Arc::new(state.inner().clone()), auth_key)
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn enable_tailscale_funnel(
    state: State<'_, AppState>,
) -> Result<FunnelStatus, ApiError> {
    WebService::enable_tailscale_funnel(Arc::new(state.inner().clone()))
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn disable_tailscale_funnel(
    state: State<'_, AppState>,
) -> Result<FunnelStatus, ApiError> {
    WebService::disable_tailscale_funnel(state.inner())
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn cancel_tailscale_funnel_operation(
    state: State<'_, AppState>,
) -> Result<FunnelStatus, ApiError> {
    WebService::cancel_tailscale_funnel_operation(state.inner())
        .await
        .map_err(ApiError::from)
}
