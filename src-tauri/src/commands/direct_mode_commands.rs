use crate::app_state::AppState;
use crate::error::ApiError;
use crate::models::direct_mode::DirectModeStatus;
use crate::services::direct_mode_service::DirectModeService;
use tauri::State;

#[tauri::command]
pub async fn get_client_direct_modes(
    state: State<'_, AppState>,
) -> Result<Vec<DirectModeStatus>, ApiError> {
    DirectModeService::statuses(&state.pool)
        .await
        .map_err(ApiError::from)
}

#[tauri::command]
pub async fn enable_client_direct_mode(
    state: State<'_, AppState>,
    credential_id: String,
) -> Result<DirectModeStatus, ApiError> {
    DirectModeService::enable(
        &state.paths,
        &state.pool,
        &state.config_writes,
        &credential_id,
    )
    .await
    .map_err(ApiError::from)
}
