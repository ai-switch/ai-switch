//! 认证位置及可恢复的变更单元。Keychain 通过原生 API 访问，不启动带密钥参数的进程。
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "storage", rename_all = "snake_case")]
pub(super) enum Location {
    File { path: PathBuf },
    Keychain { service: String, account: String },
}

impl Location {
    pub(super) fn file(path: PathBuf) -> Self {
        Self::File { path }
    }

    pub(super) fn auth(home: &Path, client: &str) -> Result<Self, AppError> {
        if client == "codex" {
            return Ok(Self::file(home.join(".codex/auth.json")));
        }
        #[cfg(all(target_os = "macos", not(test)))]
        {
            use sha2::{Digest, Sha256};
            let mut service = "Claude Code-credentials".to_string();
            if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
                let dir = home.join(".claude");
                service.push('-');
                service.push_str(
                    &format!("{:x}", Sha256::digest(dir.to_string_lossy().as_bytes()))[..8],
                );
            }
            let account = std::env::var("USER")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| {
                    failure(
                        "direct_mode.auth_store_unavailable",
                        "无法确定当前 macOS Keychain 用户，未修改配置。",
                    )
                })?;
            return Ok(Self::Keychain { service, account });
        }
        #[cfg(any(not(target_os = "macos"), test))]
        Ok(Self::file(home.join(".claude/.credentials.json")))
    }

    pub(super) async fn read(&self) -> Result<FileState, AppError> {
        match self {
            Self::File { path } => ConfigWriter::inspect(path).await,
            Self::Keychain { .. } => {
                let bytes = self.keychain_get().await?;
                Ok(FileState {
                    existed: bytes.is_some(),
                    hash: bytes.as_deref().map(hash_bytes),
                    bytes,
                    permissions: None,
                })
            }
        }
    }

    pub(super) async fn write(
        &self,
        replacement: Option<&[u8]>,
        before: &FileState,
    ) -> Result<(), AppError> {
        match self {
            Self::File { path } => match replacement {
                Some(bytes) => {
                    let private = before.clone();
                    #[cfg(unix)]
                    let private = {
                        use std::os::unix::fs::PermissionsExt;
                        FileState {
                            permissions: Some(std::fs::Permissions::from_mode(0o600)),
                            ..private
                        }
                    };
                    ConfigWriter::write_atomic_if_unchanged(path, bytes, &private).await?;
                    Ok(())
                }
                None if before.existed => {
                    ConfigWriter::remove_if_hash_matches(
                        path,
                        before.hash.as_deref().expect("file hash"),
                    )
                    .await
                }
                None => {
                    if self.read().await?.existed {
                        return Err(conflict());
                    }
                    Ok(())
                }
            },
            Self::Keychain { .. } => {
                if self.read().await?.hash != before.hash {
                    return Err(conflict());
                }
                self.keychain_set(replacement.map(Vec::from)).await
            }
        }
    }

    async fn keychain_get(&self) -> Result<Option<Vec<u8>>, AppError> {
        #[cfg(target_os = "macos")]
        {
            let Self::Keychain { service, account } = self.clone() else {
                unreachable!()
            };
            return tokio::task::spawn_blocking(move || {
                let entry = keyring::Entry::new(&service, &account).map_err(|_| store_error())?;
                match entry.get_password() {
                    Ok(value) => Ok(Some(value.into_bytes())),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(_) => Err(store_error()),
                }
            })
            .await
            .map_err(|_| store_error())?;
        }
        #[cfg(not(target_os = "macos"))]
        Err(store_error())
    }

    async fn keychain_set(&self, bytes: Option<Vec<u8>>) -> Result<(), AppError> {
        #[cfg(target_os = "macos")]
        {
            let Self::Keychain { service, account } = self.clone() else {
                unreachable!()
            };
            return tokio::task::spawn_blocking(move || {
                let entry = keyring::Entry::new(&service, &account).map_err(|_| store_error())?;
                match bytes {
                    Some(b) => entry
                        .set_password(std::str::from_utf8(&b).map_err(|_| store_error())?)
                        .map_err(|_| store_error()),
                    None => match entry.delete_credential() {
                        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                        Err(_) => Err(store_error()),
                    },
                }
            })
            .await
            .map_err(|_| store_error())?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = bytes;
            Err(store_error())
        }
    }
}

fn store_error() -> AppError {
    failure(
        "direct_mode.auth_store_unavailable",
        "无法安全访问原生认证存储，请解锁 Keychain 或检查文件权限后重试。",
    )
}
fn conflict() -> AppError {
    failure(
        "direct_mode.concurrent_change",
        "配置或认证在切换期间被其他程序修改，未覆盖新内容。请退出客户端后重试。",
    )
}

pub(super) struct Change {
    pub location: Location,
    pub before: FileState,
    pub after: Option<Vec<u8>>,
}

impl Change {
    fn expected_after(&self) -> FileState {
        FileState {
            existed: self.after.is_some(),
            hash: self.after.as_deref().map(hash_bytes),
            bytes: self.after.clone(),
            permissions: self.before.permissions.clone(),
        }
    }
}

/// 所有文件成功后才持久化模式。失败按逆序恢复，并拒绝覆盖切换期间的外部修改。
pub(super) async fn apply_changes<F>(changes: &[Change], persist: F) -> Result<(), AppError>
where
    F: std::future::Future<Output = Result<(), AppError>>,
{
    let mut committed = Vec::new();
    let mut error = None;
    for (i, change) in changes.iter().enumerate() {
        if let Err(e) = change
            .location
            .write(change.after.as_deref(), &change.before)
            .await
        {
            // 原子替换可能已成功，但落盘后的验证失败；仍将可识别的本次写入恢复。
            if change
                .location
                .read()
                .await
                .is_ok_and(|s| s.hash == change.expected_after().hash)
            {
                committed.push(i);
            }
            error = Some(e);
            break;
        }
        committed.push(i);
    }
    if error.is_none() {
        error = persist.await.err();
    }
    let Some(e) = error else { return Ok(()) };
    let mut rollback_failed = false;
    for i in committed.into_iter().rev() {
        let change = &changes[i];
        if change
            .location
            .write(change.before.bytes.as_deref(), &change.expected_after())
            .await
            .is_err()
        {
            rollback_failed = true;
        }
    }
    if rollback_failed {
        Err(failure("direct_mode.rollback_conflict","切换失败，部分配置因外部修改或认证存储不可用而未能恢复。已保留受限权限备份；请退出客户端后检查配置。"))
    } else {
        Err(e)
    }
}
