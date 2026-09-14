use crate::app_state::AppState;
use crate::error::ApiError;
use crate::services::codex_oauth::{CodexOAuthRuntime, CodexOAuthStatus, StartCodexOAuthInput};
use tauri::State;

#[tauri::command]
pub async fn start_codex_oauth(
    state: State<'_, AppState>,
    oauth: State<'_, CodexOAuthRuntime>,
    input: StartCodexOAuthInput,
) -> Result<CodexOAuthStatus, ApiError> {
    oauth
        .start(state.pool.clone(), input)
        .await
        .map_err(ApiError::from)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_codex_oauth_status(
    oauth: State<'_, CodexOAuthRuntime>,
    session_id: String,
) -> Result<CodexOAuthStatus, ApiError> {
    oauth.status(&session_id).await.map_err(ApiError::from)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cancel_codex_oauth(
    oauth: State<'_, CodexOAuthRuntime>,
    session_id: String,
) -> Result<CodexOAuthStatus, ApiError> {
    oauth.cancel(&session_id).await.map_err(ApiError::from)
}
