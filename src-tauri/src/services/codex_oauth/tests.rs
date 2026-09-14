use super::*;
use crate::database::{create_memory_pool, run_migrations};
use crate::error::AppError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use process::{LoginInfo, LoginProcess};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::Notify;

#[derive(Default)]
struct Controls {
    complete: Notify,
    cleaned: AtomicBool,
    cancelled: AtomicBool,
    failed: AtomicBool,
    cleanup_failed: AtomicBool,
    hold_cleanup: AtomicBool,
    cleanup_started: AtomicBool,
    release_cleanup: Notify,
}
struct FakeProcess(Arc<Controls>);
#[async_trait::async_trait]
impl LoginProcess for FakeProcess {
    async fn start_login(&mut self, _method: CodexOAuthMethod) -> Result<LoginInfo, AppError> {
        Ok(LoginInfo {
            login_id: "fixture-login".to_string(),
            authorization_url: "https://auth.openai.com/oauth/authorize".to_string(),
            user_code: None,
            client_id: Some("fixture-client".to_string()),
        })
    }
    async fn wait_for_login(&mut self) -> Result<(), AppError> {
        self.0.complete.notified().await;
        if self.0.failed.load(Ordering::SeqCst) {
            Err(oauth_error(
                "codex_oauth.login_failed",
                "Authorization failed",
            ))
        } else {
            Ok(())
        }
    }
    async fn read_auth_json(&self) -> Result<String, AppError> {
        let token = format!(
            "e30.{}.fixture",
            URL_SAFE_NO_PAD
                .encode(json!({"email":"oauth@example.test","aud":"fixture-client"}).to_string())
        );
        Ok(json!({"auth_mode":"chatgpt", "tokens": {"id_token":token,"access_token":"fixture-access-secret","refresh_token":"fixture-refresh-secret","account_id":"fixture-account"}}).to_string())
    }
    async fn cleanup(self: Box<Self>, cancel_login: bool) -> Result<(), AppError> {
        self.0.cleanup_started.store(true, Ordering::SeqCst);
        if self.0.hold_cleanup.load(Ordering::SeqCst) {
            self.0.release_cleanup.notified().await;
        }
        self.0.cancelled.store(cancel_login, Ordering::SeqCst);
        self.0.cleaned.store(true, Ordering::SeqCst);
        if self.0.cleanup_failed.load(Ordering::SeqCst) {
            return Err(oauth_error(
                "codex_oauth.cleanup_failed",
                "Could not clean up temporary credentials",
            ));
        }
        Ok(())
    }
}
fn input(name: &str) -> StartCodexOAuthInput {
    StartCodexOAuthInput {
        method: CodexOAuthMethod::Browser,
        batch_name: name.to_string(),
    }
}
async fn pool() -> sqlx::SqlitePool {
    let pool = create_memory_pool().await.unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}
async fn begin(
    runtime: &CodexOAuthRuntime,
    pool: &sqlx::SqlitePool,
    controls: Arc<Controls>,
    lifetime: Duration,
) -> CodexOAuthStatus {
    runtime
        .start_with_factory(
            pool.clone(),
            input("OAuth batch"),
            || Ok(Box::new(FakeProcess(controls))),
            lifetime,
        )
        .await
        .unwrap()
}
async fn terminal(runtime: &CodexOAuthRuntime, id: &str) -> CodexOAuthStatus {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let status = runtime.status(id).await.unwrap();
            if status.status.is_terminal() {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn validates_batch_before_starting_any_process() {
    let runtime = CodexOAuthRuntime::default();
    let count = AtomicUsize::new(0);
    let error = runtime
        .start_with_factory(
            pool().await,
            input("  "),
            || {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(Box::new(FakeProcess(Arc::default())))
            },
            Duration::from_secs(60),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "validation.batch_name_required");
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn permits_only_one_session_and_cancel_waits_for_cleanup_without_importing() {
    let runtime = CodexOAuthRuntime::default();
    let pool = pool().await;
    let controls = Arc::new(Controls::default());
    let started = begin(&runtime, &pool, controls.clone(), Duration::from_secs(60)).await;
    let error = runtime
        .start_with_factory(
            pool.clone(),
            input("second"),
            || panic!("must reject before spawn"),
            Duration::from_secs(60),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "codex_oauth.busy");
    let cancelled = runtime.cancel(&started.session_id).await.unwrap();
    assert_eq!(cancelled.status, CodexOAuthPhase::Cancelled);
    assert!(controls.cleaned.load(Ordering::SeqCst));
    assert!(controls.cancelled.load(Ordering::SeqCst));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM batches")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        runtime.cancel(&started.session_id).await.unwrap().status,
        CodexOAuthPhase::Cancelled
    );
}

#[tokio::test]
async fn expires_without_polling_and_cleans_up_process() {
    let runtime = CodexOAuthRuntime::default();
    let controls = Arc::new(Controls::default());
    let started = begin(
        &runtime,
        &pool().await,
        controls.clone(),
        Duration::from_millis(20),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(80)).await;
    let status = runtime.status(&started.session_id).await.unwrap();
    assert_eq!(status.status, CodexOAuthPhase::Expired);
    assert!(controls.cleaned.load(Ordering::SeqCst));
    assert!(status.authorization_url.is_none());
}

#[tokio::test]
async fn imports_once_and_repeated_poll_or_late_cancel_cannot_duplicate_or_expose_tokens() {
    let runtime = CodexOAuthRuntime::default();
    let pool = pool().await;
    let controls = Arc::new(Controls::default());
    let started = begin(&runtime, &pool, controls.clone(), Duration::from_secs(60)).await;
    controls.complete.notify_one();
    let status = terminal(&runtime, &started.session_id).await;
    assert_eq!(status.status, CodexOAuthPhase::Succeeded);
    assert!(controls.cleaned.load(Ordering::SeqCst));
    assert!(!controls.cancelled.load(Ordering::SeqCst));
    assert_eq!(
        status.account.as_ref().unwrap().email.as_deref(),
        Some("oauth@example.test")
    );
    assert!(!serde_json::to_string(&status).unwrap().contains("secret"));
    let cancelled = runtime.cancel(&started.session_id).await.unwrap();
    assert_eq!(cancelled.status, CodexOAuthPhase::Succeeded);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM route_credentials")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn failed_login_and_application_shutdown_both_release_the_session() {
    let runtime = CodexOAuthRuntime::default();
    let pool = pool().await;
    let controls = Arc::new(Controls::default());
    controls.failed.store(true, Ordering::SeqCst);
    let started = begin(&runtime, &pool, controls.clone(), Duration::from_secs(60)).await;
    controls.complete.notify_one();
    assert_eq!(
        terminal(&runtime, &started.session_id).await.status,
        CodexOAuthPhase::Failed
    );
    assert!(controls.cleaned.load(Ordering::SeqCst));
    let next = Arc::new(Controls::default());
    let started = begin(&runtime, &pool, next.clone(), Duration::from_secs(60)).await;
    runtime.shutdown().await;
    assert_eq!(
        runtime.status(&started.session_id).await.unwrap().status,
        CodexOAuthPhase::Cancelled
    );
    assert!(next.cleaned.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cleanup_failure_is_visible_and_never_commits_an_account_or_empty_batch() {
    let runtime = CodexOAuthRuntime::default();
    let pool = pool().await;
    let controls = Arc::new(Controls::default());
    controls.cleanup_failed.store(true, Ordering::SeqCst);
    let started = begin(&runtime, &pool, controls.clone(), Duration::from_secs(60)).await;
    controls.complete.notify_one();
    let status = terminal(&runtime, &started.session_id).await;
    assert_eq!(status.status, CodexOAuthPhase::Failed);
    assert_eq!(status.error.unwrap().code, "codex_oauth.cleanup_failed");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM batches")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn cancellation_during_cleanup_prevents_the_not_yet_started_transaction() {
    let runtime = CodexOAuthRuntime::default();
    let pool = pool().await;
    let controls = Arc::new(Controls::default());
    controls.hold_cleanup.store(true, Ordering::SeqCst);
    let started = begin(&runtime, &pool, controls.clone(), Duration::from_secs(60)).await;
    controls.complete.notify_one();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !controls.cleanup_started.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let release = controls.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(20)).await;
        release.release_cleanup.notify_one();
    });
    let status = runtime.cancel(&started.session_id).await.unwrap();
    assert_eq!(status.status, CodexOAuthPhase::Cancelled);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM route_credentials")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}
