//! Codex / Claude 直连与路由互切。按客户端加锁，模式状态只在全部写入成功后提交。
mod storage;
use crate::config_writer::{hash_bytes, ConfigWriter, FileState};
use crate::database::repositories::route_credential_repository::RouteCredentialRepository;
use crate::error::AppError;
use crate::models::config_snapshot::ConfigWriteOutcome;
use crate::models::direct_mode::DirectModeStatus;
use crate::paths::AppPaths;
use crate::services::config_write_service::{
    ConfigWriteCoordinator, ConfigWriteRequest, ConfigWriteRuntimeState,
};
use crate::services::direct_mode_auth::{self, failure};
use crate::services::route_proxy_service::SelectedCredential;
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use storage::{apply_changes, Change, Location};
use tokio::sync::Mutex;
use uuid::Uuid;

// 同时保护切换和代理读取原生登录，防止文件已切到 B、数据库仍指向 A 的短暂窗口。
static SWITCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn switch_lock() -> &'static Mutex<()> {
    SWITCH_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Clone, FromRow)]
struct Record {
    client_key: String,
    credential_id: String,
    platform: String,
    credential_kind: String,
    config_path: String,
    auth_location: String,
    config_fingerprint: String,
    config_backup_path: Option<String>,
    auth_backup_path: Option<String>,
    updated_at: String,
}

fn client_for(platform: &str) -> Result<&'static str, AppError> {
    match platform {
        "codex" => Ok("codex"),
        "claude" => Ok("claude_code"),
        _ => Err(failure(
            "direct_mode.unsupported",
            "直连模式仅支持 Codex 和 Claude。",
        )),
    }
}
fn config_path(home: &Path, client: &str) -> PathBuf {
    home.join(if client == "codex" {
        ".codex/config.toml"
    } else {
        ".claude/settings.json"
    })
}
fn state_error() -> AppError {
    failure(
        "direct_mode.state_failed",
        "无法保存或读取直连状态，未确认切换成功。",
    )
}
async fn record(pool: &SqlitePool, client: &str) -> Result<Option<Record>, AppError> {
    sqlx::query_as("SELECT * FROM client_direct_modes WHERE client_key = ?")
        .bind(client)
        .fetch_optional(pool)
        .await
        .map_err(|_| state_error())
}
fn location(r: &Record) -> Result<Location, AppError> {
    serde_json::from_str(&r.auth_location).map_err(|_| state_error())
}

struct CredentialSync {
    id: String,
    secret: String,
    config: String,
    before_secret: String,
    before_config: String,
}

pub struct DirectModeService;
impl DirectModeService {
    pub(crate) async fn authentication_guard() -> tokio::sync::MutexGuard<'static, ()> {
        switch_lock().lock().await
    }
    /// 只允许宿主本机调用；不接收前端提供的地址、路径或密钥。
    pub async fn enable(
        paths: &AppPaths,
        pool: &SqlitePool,
        runtime: &ConfigWriteRuntimeState,
        id: &str,
    ) -> Result<DirectModeStatus, AppError> {
        let home = directories::BaseDirs::new()
            .ok_or_else(state_error)?
            .home_dir()
            .to_path_buf();
        let credential = RouteCredentialRepository::get(pool, id).await?;
        ensure_environment(&credential.platform, &home)?;
        Self::enable_for_home(paths, pool, runtime, &home, id).await
    }

    pub(crate) async fn enable_for_home(
        paths: &AppPaths,
        pool: &SqlitePool,
        runtime: &ConfigWriteRuntimeState,
        home: &Path,
        id: &str,
    ) -> Result<DirectModeStatus, AppError> {
        let _switch = switch_lock().lock().await;
        let credential = RouteCredentialRepository::get(pool, id).await?;
        if credential.archived_at.is_some() {
            return Err(failure(
                "direct_mode.archived",
                "请先恢复已归档账号，再启用直连模式。",
            ));
        }
        let client = client_for(&credential.platform)?;
        let path = config_path(home, client);
        let lock = runtime.lock_for_path(&path).await?;
        let _guard = lock.lock().await;
        let config_location = Location::file(path.clone());
        let auth_location = Location::auth(home, client)?;
        let existing = config_location.read().await?;
        let existing_auth = auth_location.read().await?;
        let old = record(pool, client).await?;
        if old
            .as_ref()
            .is_some_and(|r| Path::new(&r.config_path) != path)
        {
            return Err(state_error());
        }
        let sync = sync_before_switch(pool, old.as_ref()).await?;
        // 如果重启用的是同一官方账号，使用客户端已刷新的 token，不能写回过期副本。
        let (secret, config) = sync
            .as_ref()
            .filter(|saved| saved.id == id)
            .map(|saved| (saved.secret.as_str(), saved.config.as_str()))
            .unwrap_or((&credential.secret_payload_json, &credential.config_json));
        let rendered = direct_mode_auth::render(
            &credential.platform,
            &credential.kind,
            secret,
            config,
            existing.bytes.as_deref(),
            existing_auth.bytes.as_deref(),
        )?;
        let mut auth: Value = serde_json::from_slice(&rendered.auth).map_err(|_| state_error())?;
        if credential.platform == "claude" && credential.kind == "official" {
            // Claude 的原生刷新会保留根对象其他项；完整替换认证会丢失该绑定。
            auth["aiSwitchDirectCredentialId"] = json!(id);
        } else if credential.platform == "claude" {
            auth.as_object_mut()
                .expect("object")
                .remove("aiSwitchDirectCredentialId");
        }
        let operation = Uuid::new_v4().to_string();
        let backup_dir = paths.backups_dir.join("direct-mode").join(&operation);
        let config_backup = backup(&backup_dir, "config.previous", &existing).await?;
        let auth_backup = backup(&backup_dir, "auth.previous", &existing_auth).await?;
        let row = Record {
            client_key: client.into(),
            credential_id: id.into(),
            platform: credential.platform.clone(),
            credential_kind: credential.kind.clone(),
            config_path: path.to_string_lossy().into_owned(),
            auth_location: serde_json::to_string(&auth_location).map_err(|_| state_error())?,
            config_fingerprint: direct_mode_auth::fingerprint(
                &credential.platform,
                &rendered.config,
            )?,
            config_backup_path: old
                .as_ref()
                .map(|r| r.config_backup_path.clone())
                .unwrap_or(config_backup),
            auth_backup_path: old
                .as_ref()
                .map(|r| r.auth_backup_path.clone())
                .unwrap_or(auth_backup),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        let changes = vec![
            Change {
                location: auth_location,
                before: existing_auth,
                after: Some(serde_json::to_vec_pretty(&auth).expect("value")),
            },
            Change {
                location: config_location,
                before: existing,
                after: Some(rendered.config),
            },
        ];
        apply_changes(&changes, persist(pool, Some(&row), client, sync.as_ref())).await?;
        Ok(public_status(&row, "active"))
    }

    pub async fn statuses(pool: &SqlitePool) -> Result<Vec<DirectModeStatus>, AppError> {
        let _switch = switch_lock().lock().await;
        let rows: Vec<Record> =
            sqlx::query_as("SELECT * FROM client_direct_modes ORDER BY client_key")
                .fetch_all(pool)
                .await
                .map_err(|_| state_error())?;
        let mut results = Vec::new();
        for row in rows {
            let current = ConfigWriter::inspect(Path::new(&row.config_path)).await;
            let status = match current {
                Ok(s)
                    if s.bytes.as_ref().is_some_and(|b| {
                        direct_mode_auth::fingerprint(&row.platform, b)
                            .is_ok_and(|h| h == row.config_fingerprint)
                    }) =>
                {
                    if row.credential_kind == "official" {
                        match RouteCredentialRepository::get(pool, &row.credential_id).await {
                            Ok(c)
                                if native_credentials(
                                    &row,
                                    &c.secret_payload_json,
                                    &c.config_json,
                                )
                                .await
                                .is_ok() =>
                            {
                                "active"
                            }
                            _ => "changed",
                        }
                    } else if location(&row)?.read().await.is_ok_and(|s| {
                        s.bytes.as_ref().is_some_and(|b| {
                            serde_json::from_slice::<Value>(b).is_ok_and(|v| v.is_object())
                        })
                    }) {
                        "active"
                    } else {
                        "changed"
                    }
                }
                Ok(_) => "changed",
                Err(_) => "unavailable",
            };
            results.push(public_status(&row, status));
        }
        Ok(results)
    }

    pub(crate) async fn has_direct(pool: &SqlitePool, client: &str) -> Result<bool, AppError> {
        Ok(record(pool, client).await?.is_some())
    }

    /// 调用方只传入本次选中的客户端。后台端点变更使用 preserve_direct=true。
    pub(crate) async fn write_route(
        paths: &AppPaths,
        pool: &SqlitePool,
        runtime: &ConfigWriteRuntimeState,
        request: ConfigWriteRequest,
        preserve_direct: bool,
    ) -> Result<Vec<ConfigWriteOutcome>, AppError> {
        let _switch = switch_lock().lock().await;
        let client = request.adapter.client_key();
        let Some(old) = record(pool, client).await? else {
            return ConfigWriteCoordinator::write_group(paths, pool, runtime, vec![request]).await;
        };
        let path = request
            .adapter
            .resolve_path_with_context(&request.home, &request.path_context);
        if preserve_direct {
            return Ok(vec![outcome(
                &old,
                &Uuid::new_v4().to_string(),
                "skipped",
                Some("direct_mode.preserved"),
                None,
                None,
            )]);
        }
        if path != Path::new(&old.config_path) {
            return Err(state_error());
        }
        let lock = runtime.lock_for_path(&path).await?;
        let _guard = lock.lock().await;
        let config_location = Location::file(path.clone());
        let auth_location = location(&old)?;
        let current = config_location.read().await?;
        let current_auth = auth_location.read().await?;
        let sync = sync_before_switch(pool, Some(&old)).await?;
        let original_config = read_backup(old.config_backup_path.as_deref()).await?;
        let original_auth = read_backup(old.auth_backup_path.as_deref()).await?;
        let cleaned = clean_for_route(
            &old.platform,
            current.bytes.as_deref(),
            original_config.as_deref(),
        )?;
        let rendered = request
            .adapter
            .render(&path, Some(&cleaned), &request.input)?;
        let restored_auth = restore_auth(
            &old.platform,
            current_auth.bytes.as_deref(),
            original_auth.as_deref(),
        )?;
        let operation = Uuid::new_v4().to_string();
        let backup_dir = paths.backups_dir.join("direct-mode").join(&operation);
        backup(&backup_dir, "config.previous", &current).await?;
        backup(&backup_dir, "auth.previous", &current_auth).await?;
        let before_hash = current.hash.clone();
        let after_hash = Some(hash_bytes(&rendered));
        let changes = vec![
            Change {
                location: auth_location,
                before: current_auth,
                after: restored_auth,
            },
            Change {
                location: config_location,
                before: current,
                after: Some(rendered),
            },
        ];
        apply_changes(&changes, persist(pool, None, client, sync.as_ref())).await?;
        Ok(vec![outcome(
            &old,
            &operation,
            "succeeded",
            None,
            before_hash,
            after_hash,
        )])
    }

    /// 原生客户端负责刷新；代理只读取当前认证，不再并发兑换同一个 refresh token。
    pub(crate) async fn official_for_proxy(
        pool: &SqlitePool,
        credential: &SelectedCredential,
    ) -> Result<Option<SelectedCredential>, String> {
        // 调用者持有 authentication_guard，覆盖整个代理刷新过程而非只保护文件读取。
        let client = match client_for(&credential.platform) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        let row = record(pool, client)
            .await
            .map_err(|_| "无法读取直连认证状态".to_string())?;
        let Some(row) =
            row.filter(|r| r.credential_id == credential.id && r.credential_kind == "official")
        else {
            return Ok(None);
        };
        let current = ConfigWriter::inspect(Path::new(&row.config_path))
            .await
            .map_err(|_| "无法读取直连配置".to_string())?;
        if current.bytes.as_ref().is_none_or(|b| {
            !direct_mode_auth::fingerprint(&row.platform, b)
                .is_ok_and(|h| h == row.config_fingerprint)
        }) {
            return Err("直连配置已被修改，请重新启用直连或切回算力池。".to_string());
        }
        let (secret,config)=native_credentials(&row,&credential.secret_payload_json,&credential.config_json).await
            .map_err(|_|"官方账号处于直连模式，但原生登录已变化或不可读取，请在原生客户端重新登录并重新导入该账号。".to_string())?;
        Ok(Some(SelectedCredential {
            secret_payload_json: secret,
            config_json: config,
            ..credential.clone()
        }))
    }
}

fn public_status(r: &Record, status: &str) -> DirectModeStatus {
    DirectModeStatus {
        client_key: r.client_key.clone(),
        credential_id: r.credential_id.clone(),
        platform: r.platform.clone(),
        credential_kind: r.credential_kind.clone(),
        status: status.into(),
        updated_at: r.updated_at.clone(),
        restart_required: true,
    }
}
fn outcome(
    r: &Record,
    operation: &str,
    status: &str,
    code: Option<&str>,
    before: Option<String>,
    after: Option<String>,
) -> ConfigWriteOutcome {
    ConfigWriteOutcome {
        operation_id: operation.into(),
        snapshot_id: None,
        target_app_id: None,
        target_key: r.client_key.clone(),
        platform: r.platform.clone(),
        path: r.config_path.clone(),
        status: status.into(),
        before_hash: before,
        after_hash: after,
        error_code: code.map(str::to_owned),
    }
}

async fn backup(dir: &Path, name: &str, state: &FileState) -> Result<Option<String>, AppError> {
    match &state.bytes {
        Some(bytes) => {
            let path = dir.join(name);
            ConfigWriter::write_private_backup(&path, bytes).await?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}
async fn read_backup(path: Option<&str>) -> Result<Option<Vec<u8>>, AppError> {
    match path {
        Some(p) => ConfigWriter::inspect(Path::new(p))
            .await?
            .bytes
            .map(Some)
            .ok_or_else(|| {
                failure(
                    "direct_mode.backup_missing",
                    "直连前的认证备份缺失，未覆盖当前认证。",
                )
            }),
        None => Ok(None),
    }
}

async fn persist(
    pool: &SqlitePool,
    row: Option<&Record>,
    client: &str,
    sync: Option<&CredentialSync>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await.map_err(|_| state_error())?;
    if let Some(saved) = sync {
        let updated=sqlx::query("UPDATE route_credentials SET secret_payload_json=?,config_json=? WHERE id=? AND secret_payload_json=? AND config_json=?")
            .bind(&saved.secret).bind(&saved.config).bind(&saved.id).bind(&saved.before_secret).bind(&saved.before_config)
            .execute(&mut *tx).await.map_err(|_|state_error())?;
        if updated.rows_affected() != 1 {
            return Err(failure(
                "direct_mode.concurrent_change",
                "账号在切换期间被编辑，未覆盖新的账号内容。",
            ));
        }
    }
    if let Some(r) = row {
        sqlx::query("INSERT INTO client_direct_modes(client_key,credential_id,platform,credential_kind,config_path,auth_location,config_fingerprint,config_backup_path,auth_backup_path,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_key) DO UPDATE SET credential_id=excluded.credential_id,platform=excluded.platform,credential_kind=excluded.credential_kind,config_path=excluded.config_path,auth_location=excluded.auth_location,config_fingerprint=excluded.config_fingerprint,config_backup_path=excluded.config_backup_path,auth_backup_path=excluded.auth_backup_path,updated_at=excluded.updated_at")
            .bind(&r.client_key).bind(&r.credential_id).bind(&r.platform).bind(&r.credential_kind).bind(&r.config_path).bind(&r.auth_location).bind(&r.config_fingerprint).bind(&r.config_backup_path).bind(&r.auth_backup_path).bind(&r.updated_at)
            .execute(&mut *tx).await.map_err(|_|state_error())?;
    } else {
        sqlx::query("DELETE FROM client_direct_modes WHERE client_key=?")
            .bind(client)
            .execute(&mut *tx)
            .await
            .map_err(|_| state_error())?;
    }
    tx.commit().await.map_err(|_| state_error())
}

async fn sync_before_switch(
    pool: &SqlitePool,
    old: Option<&Record>,
) -> Result<Option<CredentialSync>, AppError> {
    let Some(old) = old.filter(|r| r.credential_kind == "official") else {
        return Ok(None);
    };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM route_credentials WHERE id=?)")
            .bind(&old.credential_id)
            .fetch_one(pool)
            .await
            .map_err(|_| state_error())?;
    // 用户删除账号不应阻止恢复原配置，但不再向已删除账号写回 token。
    if !exists {
        return Ok(None);
    }
    let credential = RouteCredentialRepository::get(pool, &old.credential_id).await?;
    let (secret, config) = match native_credentials(
        old,
        &credential.secret_payload_json,
        &credential.config_json,
    )
    .await
    {
        Ok(tokens) => tokens,
        // 显式切换仍可继续，但绝不能把另一个原生登录的 token 写回旧账号。
        Err(AppError::Validation {
            code: "direct_mode.auth_changed",
            ..
        }) => return Ok(None),
        Err(error) => return Err(error),
    };
    Ok(Some(CredentialSync {
        id: old.credential_id.clone(),
        secret,
        config,
        before_secret: credential.secret_payload_json,
        before_config: credential.config_json,
    }))
}

fn auth_changed() -> AppError {
    failure(
        "direct_mode.auth_changed",
        "原生登录已退出或变更；不会将其认证写回原账号。",
    )
}

async fn native_credentials(
    row: &Record,
    secret: &str,
    config: &str,
) -> Result<(String, String), AppError> {
    let mut secret: Value = serde_json::from_str(secret).map_err(|_| state_error())?;
    let mut config: Value = serde_json::from_str(config).map_err(|_| state_error())?;
    if !secret.is_object() || !config.is_object() {
        return Err(state_error());
    }
    let auth = location(row)?
        .read()
        .await?
        .bytes
        .ok_or_else(auth_changed)?;
    let auth: Value = serde_json::from_slice(&auth).map_err(|_| state_error())?;
    let native = if row.platform == "codex" {
        if auth["auth_mode"]
            .as_str()
            .is_some_and(|mode| mode != "chatgpt")
            || auth["OPENAI_API_KEY"]
                .as_str()
                .is_some_and(|key| !key.is_empty())
        {
            return Err(auth_changed());
        }
        if auth["tokens"]["account_id"].as_str() != secret["account_id"].as_str()
            || secret["account_id"].as_str().is_none()
        {
            return Err(auth_changed());
        }
        &auth["tokens"]
    } else {
        if auth["aiSwitchDirectCredentialId"].as_str() != Some(row.credential_id.as_str()) {
            return Err(auth_changed());
        }
        &auth["claudeAiOauth"]
    };
    for (snake, camel) in [
        ("access_token", "accessToken"),
        ("refresh_token", "refreshToken"),
        ("id_token", "idToken"),
    ] {
        let key = if row.platform == "codex" {
            snake
        } else {
            camel
        };
        if let Some(value) = native
            .get(key)
            .filter(|v| v.as_str().is_some_and(|s| !s.is_empty()))
        {
            secret[snake] = value.clone();
        } else if snake != "id_token" || row.platform == "codex" {
            return Err(auth_changed());
        }
    }
    if row.platform == "claude" {
        if let Some(expiry) = native.get("expiresAt").and_then(Value::as_i64) {
            config["expired"] = json!(expiry / 1000);
        }
        config["scopes"] = native["scopes"].clone();
    } else if let Some(token) = native["access_token"].as_str() {
        use base64::Engine;
        if let Some(payload) = token
            .split('.')
            .nth(1)
            .and_then(|s| {
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(s)
                    .ok()
            })
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        {
            if let Some(exp) = payload.get("exp") {
                config["expired"] = exp.clone();
            }
        }
    }
    Ok((secret.to_string(), config.to_string()))
}

fn clean_for_route(
    platform: &str,
    current: Option<&[u8]>,
    original: Option<&[u8]>,
) -> Result<Vec<u8>, AppError> {
    if platform == "claude" {
        return Ok(
            serde_json::to_vec_pretty(&direct_mode_auth::clean_claude_settings(current)?)
                .expect("value"),
        );
    }
    let parse = |b: Option<&[u8]>| -> Result<toml_edit::Document, AppError> {
        std::str::from_utf8(b.unwrap_or_default())
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| {
                failure(
                    "direct_mode.invalid_config",
                    "Codex 配置无法解析，未覆盖原文件。",
                )
            })
    };
    let mut doc = parse(current)?;
    let original = parse(original)?;
    if let Some(providers) = doc
        .get_mut("model_providers")
        .and_then(toml_edit::Item::as_table_mut)
    {
        providers.remove("ai-switch-direct");
    }
    if let Some(store) = original.get("cli_auth_credentials_store") {
        doc["cli_auth_credentials_store"] = store.clone();
    } else {
        doc.remove("cli_auth_credentials_store");
    }
    Ok(doc.to_string().into_bytes())
}

fn restore_auth(
    platform: &str,
    current: Option<&[u8]>,
    original: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, AppError> {
    let parse = |bytes: Option<&[u8]>| -> Result<Value, AppError> {
        let v =
            serde_json::from_slice::<Value>(bytes.unwrap_or(b"{}")).map_err(|_| state_error())?;
        if !v.is_object() {
            return Err(state_error());
        }
        Ok(v)
    };
    let original_existed = original.is_some();
    let mut auth = parse(current)?;
    let original = parse(original)?;
    let fields: &[&str] = if platform == "codex" {
        &["auth_mode", "OPENAI_API_KEY", "tokens", "last_refresh"]
    } else {
        &["claudeAiOauth", "aiSwitchDirectCredentialId"]
    };
    for key in fields {
        if let Some(value) = original.get(*key) {
            auth[*key] = value.clone();
        } else {
            auth.as_object_mut().expect("object").remove(*key);
        }
    }
    if !original_existed && auth.as_object().expect("object").is_empty() {
        Ok(None)
    } else {
        Ok(Some(serde_json::to_vec_pretty(&auth).expect("value")))
    }
}

fn ensure_environment(platform: &str, home: &Path) -> Result<(), AppError> {
    let client = client_for(platform)?;
    let (home_key, expected) = if client == "codex" {
        ("CODEX_HOME", home.join(".codex"))
    } else {
        ("CLAUDE_CONFIG_DIR", home.join(".claude"))
    };
    if std::env::var_os(home_key)
        .filter(|v| !v.is_empty())
        .is_some_and(|v| PathBuf::from(v) != expected)
    {
        return Err(failure("direct_mode.environment_conflict",&format!("检测到自定义 {home_key}。为避免写错客户端目录，本次未修改；请先使用默认客户端目录。")));
    }
    let keys: &[&str] = if platform == "codex" {
        &["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"]
    } else {
        direct_mode_auth::CLAUDE_AUTH_ENV
    };
    for key in keys {
        if std::env::var_os(key).is_some_and(|v| !v.is_empty()) {
            return Err(failure("direct_mode.environment_conflict",&format!("环境变量 {key} 可能覆盖客户端直连配置，请先移除该覆盖后重试；未修改系统环境变量。")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
