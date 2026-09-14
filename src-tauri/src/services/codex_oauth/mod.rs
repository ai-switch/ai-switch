mod credential;
mod process;

use crate::error::{ApiError, AppError};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Mutex};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexOAuthMethod {
    Browser,
    DeviceCode,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ImportedCodexAccount {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
}

fn oauth_error(code: &'static str, message: &str) -> crate::error::AppError {
    crate::error::AppError::Validation {
        code,
        message: message.to_string(),
        details: None,
        recoverable: true,
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartCodexOAuthInput {
    pub method: CodexOAuthMethod,
    pub batch_name: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexOAuthPhase {
    Starting,
    Waiting,
    Importing,
    Succeeded,
    Cancelled,
    Failed,
    Expired,
}

impl CodexOAuthPhase {
    fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Cancelled | Self::Failed | Self::Expired
        )
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexOAuthStatus {
    pub session_id: String,
    pub method: CodexOAuthMethod,
    pub status: CodexOAuthPhase,
    pub authorization_url: Option<String>,
    pub user_code: Option<String>,
    pub expires_at: String,
    pub account: Option<ImportedCodexAccount>,
    pub error: Option<crate::error::ApiError>,
}

struct LoginSession {
    cancel: watch::Sender<bool>,
    status: watch::Receiver<CodexOAuthStatus>,
}

#[derive(Default)]
struct RuntimeState {
    session: Option<LoginSession>,
    shutting_down: bool,
}

#[derive(Clone, Default)]
pub struct CodexOAuthRuntime {
    state: Arc<Mutex<RuntimeState>>,
}

impl CodexOAuthRuntime {
    pub async fn start(
        &self,
        pool: SqlitePool,
        input: StartCodexOAuthInput,
    ) -> Result<CodexOAuthStatus, AppError> {
        self.start_with_factory(
            pool,
            input,
            || {
                let executable = process::resolve_codex()?;
                Ok(Box::new(process::CodexProcess::spawn(&executable)?))
            },
            Duration::from_secs(10 * 60),
        )
        .await
    }

    async fn start_with_factory<F>(
        &self,
        pool: SqlitePool,
        input: StartCodexOAuthInput,
        factory: F,
        lifetime: Duration,
    ) -> Result<CodexOAuthStatus, AppError>
    where
        F: FnOnce() -> Result<Box<dyn process::LoginProcess>, AppError>,
    {
        if input.batch_name.trim().is_empty() {
            return Err(oauth_error(
                "validation.batch_name_required",
                "Batch name is required",
            ));
        }
        let mut state = self.state.lock().await;
        if state.shutting_down {
            return Err(oauth_error(
                "codex_oauth.shutting_down",
                "AI Switch is shutting down",
            ));
        }
        if state
            .session
            .as_ref()
            .is_some_and(|session| !session.status.borrow().status.is_terminal())
        {
            return Err(oauth_error("codex_oauth.busy", "A Codex login is already in progress. Finish or cancel it before starting another."));
        }
        let process = factory()?;
        let snapshot = CodexOAuthStatus {
            session_id: uuid::Uuid::new_v4().to_string(),
            method: input.method,
            status: CodexOAuthPhase::Starting,
            authorization_url: None,
            user_code: None,
            expires_at: (Utc::now() + chrono::Duration::from_std(lifetime).unwrap_or_default())
                .to_rfc3339(),
            account: None,
            error: None,
        };
        let (status_tx, status_rx) = watch::channel(snapshot.clone());
        let (cancel_tx, cancel_rx) = watch::channel(false);
        state.session = Some(LoginSession {
            cancel: cancel_tx,
            status: status_rx,
        });
        tokio::spawn(run_login(
            process, pool, input, status_tx, cancel_rx, lifetime,
        ));
        Ok(snapshot)
    }

    pub async fn status(&self, session_id: &str) -> Result<CodexOAuthStatus, AppError> {
        let state = self.state.lock().await;
        let session = state
            .session
            .as_ref()
            .filter(|session| session.status.borrow().session_id == session_id)
            .ok_or_else(|| {
                oauth_error(
                    "codex_oauth.session_not_found",
                    "Codex login session no longer exists. Start a new login.",
                )
            })?;
        let snapshot = session.status.borrow().clone();
        Ok(snapshot)
    }

    pub async fn cancel(&self, session_id: &str) -> Result<CodexOAuthStatus, AppError> {
        let mut status = {
            let state = self.state.lock().await;
            let session = state
                .session
                .as_ref()
                .filter(|session| session.status.borrow().session_id == session_id)
                .ok_or_else(|| {
                    oauth_error(
                        "codex_oauth.session_not_found",
                        "Codex login session no longer exists",
                    )
                })?;
            let _ = session.cancel.send(true);
            session.status.clone()
        };
        loop {
            let snapshot = status.borrow().clone();
            if snapshot.status.is_terminal() {
                return Ok(snapshot);
            }
            status.changed().await.map_err(|_| {
                oauth_error(
                    "codex_oauth.process_exited",
                    "Codex login stopped unexpectedly",
                )
            })?;
        }
    }

    pub async fn shutdown(&self) {
        let session_id = {
            let mut state = self.state.lock().await;
            state.shutting_down = true;
            state
                .session
                .as_ref()
                .map(|session| session.status.borrow().session_id.clone())
        };
        if let Some(id) = session_id {
            let _ = self.cancel(&id).await;
        }
    }
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    loop {
        if *cancel.borrow() {
            return;
        }
        if cancel.changed().await.is_err() {
            return;
        }
    }
}

async fn run_login(
    mut process: Box<dyn process::LoginProcess>,
    pool: SqlitePool,
    input: StartCodexOAuthInput,
    status: watch::Sender<CodexOAuthStatus>,
    mut cancel: watch::Receiver<bool>,
    lifetime: Duration,
) {
    let authenticate = async {
        let info = process.start_login(input.method).await?;
        status.send_modify(|snapshot| {
            snapshot.status = CodexOAuthPhase::Waiting;
            snapshot.authorization_url = Some(info.authorization_url);
            snapshot.user_code = info.user_code;
        });
        process.wait_for_login().await?;
        let auth = process.read_auth_json().await?;
        credential::parse_auth_json(&auth, info.client_id.as_deref())
    };
    let (mut phase, mut error, credential) = tokio::select! {
        biased;
        _ = cancelled(&mut cancel) => (CodexOAuthPhase::Cancelled, None, None),
        _ = tokio::time::sleep(lifetime) => (CodexOAuthPhase::Expired, Some(oauth_error("codex_oauth.expired", "Codex login expired. Start a new login.")), None),
        result = authenticate => match result {
            Ok(credential) => (CodexOAuthPhase::Importing, None, Some(credential)),
            Err(error) => (CodexOAuthPhase::Failed, Some(error), None),
        },
    };
    // Stop the CLI and remove temporary secrets before the irreversible DB step.
    // A cleanup failure is therefore actionable without duplicating an account on retry.
    let cleanup = process.cleanup(credential.is_none()).await;
    let mut account = None;
    if let Err(cleanup_error) = cleanup {
        phase = CodexOAuthPhase::Failed;
        error = Some(cleanup_error);
    } else if let Some(credential) = credential {
        // No await between the last cancellation check and entering Importing.
        // Once the transaction starts, cancellation waits and returns its outcome.
        if *cancel.borrow() {
            phase = CodexOAuthPhase::Cancelled;
        } else {
            status.send_modify(|snapshot| {
                snapshot.status = CodexOAuthPhase::Importing;
                snapshot.authorization_url = None;
                snapshot.user_code = None;
            });
            match credential::import_account(&pool, &input.batch_name, credential).await {
                Ok(imported) => {
                    account = Some(imported);
                    phase = CodexOAuthPhase::Succeeded;
                }
                Err(import_error) => {
                    error = Some(import_error);
                    phase = CodexOAuthPhase::Failed;
                }
            }
        }
    }
    status.send_modify(|snapshot| {
        snapshot.status = phase;
        snapshot.authorization_url = None;
        snapshot.user_code = None;
        snapshot.account = account;
        snapshot.error = error.map(ApiError::from);
    });
}

#[cfg(test)]
mod tests;
