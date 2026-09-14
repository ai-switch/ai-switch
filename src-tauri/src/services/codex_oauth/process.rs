use super::{oauth_error, CodexOAuthMethod};
use crate::error::AppError;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tempfile::TempDir;
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use url::Url;

const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LoginInfo {
    pub login_id: String,
    pub authorization_url: String,
    pub user_code: Option<String>,
    pub client_id: Option<String>,
}

fn protocol_error() -> AppError {
    oauth_error(
        "codex_oauth.unsupported_cli",
        "Codex CLI does not support the expected login protocol. Update Codex CLI and try again.",
    )
}

fn value_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn parse_login_result(method: CodexOAuthMethod, value: Value) -> Result<LoginInfo, AppError> {
    let (kind, url_key) = match method {
        CodexOAuthMethod::Browser => ("chatgpt", "authUrl"),
        CodexOAuthMethod::DeviceCode => ("chatgptDeviceCode", "verificationUrl"),
    };
    if value.get("type").and_then(Value::as_str) != Some(kind) {
        return Err(protocol_error());
    }
    let login_id = value_text(&value, "loginId")
        .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        .ok_or_else(protocol_error)?;
    let authorization_url = value_text(&value, url_key).ok_or_else(protocol_error)?;
    let unsafe_url = || {
        oauth_error(
            "codex_oauth.unsafe_url",
            "Codex returned an unexpected authorization address. Login was stopped.",
        )
    };
    let url = Url::parse(&authorization_url).map_err(|_| unsafe_url())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || !matches!(
            url.host_str(),
            Some("auth.openai.com" | "auth0.openai.com" | "chatgpt.com")
        )
    {
        return Err(unsafe_url());
    }
    let user_code = match method {
        CodexOAuthMethod::Browser => None,
        CodexOAuthMethod::DeviceCode => Some(
            value_text(&value, "userCode")
                .filter(|code| {
                    code.len() <= 64
                        && code
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"- ".contains(&c))
                })
                .ok_or_else(protocol_error)?,
        ),
    };
    let client_id = url
        .query_pairs()
        .find_map(|(key, value)| (key == "client_id").then(|| value.into_owned()));
    Ok(LoginInfo {
        login_id,
        authorization_url,
        user_code,
        client_id,
    })
}

fn verify_file_storage(value: &Value) -> Result<(), AppError> {
    let config = &value["config"];
    if config["cli_auth_credentials_store"] != "file" || config["forced_login_method"] != "chatgpt"
    {
        return Err(oauth_error("codex_oauth.storage_policy", "Codex policy prevents isolated file-based ChatGPT login. Contact your administrator or import JSON instead."));
    }
    Ok(())
}

#[cfg(windows)]
fn native_in_package(package: &Path) -> Option<PathBuf> {
    let target = if cfg!(target_arch = "aarch64") {
        "aarch64-pc-windows-msvc"
    } else {
        "x86_64-pc-windows-msvc"
    };
    let platform = if cfg!(target_arch = "aarch64") {
        "codex-win32-arm64"
    } else {
        "codex-win32-x64"
    };
    // Canonicalizing the package also resolves pnpm's package-directory symlink.
    let package = package
        .canonicalize()
        .unwrap_or_else(|_| package.to_path_buf());
    let roots = [
        package.join("vendor"),
        package
            .join("node_modules/@openai")
            .join(platform)
            .join("vendor"),
        package.parent()?.join(platform).join("vendor"),
    ];
    for root in roots {
        for layout in ["bin/codex.exe", "codex/codex.exe"] {
            let candidate = root.join(target).join(layout);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_native_codex(dirs: &[PathBuf]) -> Option<PathBuf> {
    for dir in dirs.iter().filter(|dir| dir.is_absolute()) {
        #[cfg(windows)]
        {
            let direct = dir.join("codex.exe");
            if direct.is_file() {
                return Some(direct);
            }
            if let Some(native) = native_in_package(&dir.join("node_modules/@openai/codex")) {
                return Some(native);
            }
            // pnpm keeps global packages below a versioned global store, while
            // its command shims live directly in PNPM_HOME (the PATH entry).
            if dir.join("codex.cmd").is_file() || dir.join("codex.ps1").is_file() {
                if let Ok(entries) = std::fs::read_dir(dir.join("global")) {
                    let mut roots: Vec<_> = entries
                        .filter_map(Result::ok)
                        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                        .map(|entry| entry.path())
                        .collect();
                    roots.sort();
                    for root in roots.into_iter().rev() {
                        if let Some(native) =
                            native_in_package(&root.join("node_modules/@openai/codex"))
                        {
                            return Some(native);
                        }
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let direct = dir.join("codex");
            if direct
                .metadata()
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            {
                return Some(direct);
            }
        }
    }
    None
}

pub(super) fn resolve_codex() -> Result<PathBuf, AppError> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    // GUI applications on macOS do not always inherit the login shell's PATH.
    #[cfg(not(windows))]
    {
        dirs.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
        if let Some(home) = directories::BaseDirs::new() {
            dirs.push(home.home_dir().join(".local/bin"));
            dirs.push(home.home_dir().join(".npm-global/bin"));
        }
    }
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    find_native_codex(&dirs).ok_or_else(|| oauth_error("codex_oauth.cli_not_found", "Codex CLI was not found. Install or update the official Codex CLI and restart AI Switch."))
}

fn isolated_command(executable: &Path, home: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .current_dir(home)
        .env("CODEX_HOME", home)
        .args([
            "-c",
            "cli_auth_credentials_store=\"file\"",
            "-c",
            "forced_login_method=\"chatgpt\"",
            "-c",
            "features.plugins=false",
            "-c",
            "features.remote_plugin=false",
            "-c",
            "features.apps=false",
            "app-server",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for key in [
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "OPENAI_ACCESS_TOKEN",
        "CODEX_ACCESS_TOKEN",
        "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    ] {
        command.env_remove(key);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    #[cfg(unix)]
    command.process_group(0);
    command
}

struct Rpc<R, W> {
    reader: R,
    writer: W,
    completions: VecDeque<Value>,
}

impl<R: AsyncBufRead + Unpin, W: AsyncWrite + Unpin> Rpc<R, W> {
    fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer,
            completions: VecDeque::new(),
        }
    }

    async fn send(&mut self, message: Value) -> Result<(), AppError> {
        let mut bytes = message.to_string().into_bytes();
        bytes.push(b'\n');
        self.writer
            .write_all(&bytes)
            .await
            .map_err(|_| protocol_error())?;
        self.writer.flush().await.map_err(|_| protocol_error())
    }

    async fn read(&mut self) -> Result<Value, AppError> {
        let mut bytes = Vec::new();
        loop {
            let available = self.reader.fill_buf().await.map_err(|_| protocol_error())?;
            if available.is_empty() {
                return Err(oauth_error("codex_oauth.process_exited", "Codex CLI exited before completing login. Check its installation and try again."));
            }
            let length = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|pos| pos + 1)
                .unwrap_or(available.len());
            if bytes.len() + length > MAX_MESSAGE_BYTES {
                return Err(protocol_error());
            }
            bytes.extend_from_slice(&available[..length]);
            self.reader.consume(length);
            if bytes.last() == Some(&b'\n') {
                break;
            }
        }
        serde_json::from_slice(&bytes).map_err(|_| protocol_error())
    }

    fn remember_completion(&mut self, message: &Value) -> Result<(), AppError> {
        if message.get("method").and_then(Value::as_str) == Some("account/login/completed") {
            if self.completions.len() >= 16 {
                return Err(protocol_error());
            }
            self.completions.push_back(message["params"].clone());
        }
        Ok(())
    }

    async fn request(&mut self, id: u64, method: &str, params: Value) -> Result<Value, AppError> {
        self.send(json!({"id":id, "method":method, "params":params}))
            .await?;
        loop {
            let message = self.read().await?;
            if message.get("id").and_then(Value::as_u64) == Some(id)
                && message.get("method").is_none()
            {
                if message.get("error").is_some() {
                    return Err(protocol_error());
                }
                return message.get("result").cloned().ok_or_else(protocol_error);
            }
            self.remember_completion(&message)?;
        }
    }

    async fn wait_for_login(&mut self, login_id: &str) -> Result<(), AppError> {
        loop {
            while let Some(params) = self.completions.pop_front() {
                if params.get("loginId").and_then(Value::as_str) == Some(login_id) {
                    return if params.get("success").and_then(Value::as_bool) == Some(true) {
                        Ok(())
                    } else {
                        Err(oauth_error("codex_oauth.login_failed", "Codex authorization failed or was cancelled. Retry browser login, or enable device-code login in your account settings."))
                    };
                }
            }
            let message = self.read().await?;
            self.remember_completion(&message)?;
        }
    }
}

pub(super) struct CodexProcess {
    child: Child,
    rpc: Rpc<BufReader<ChildStdout>, ChildStdin>,
    home: Option<TempDir>,
    login_id: Option<String>,
}

impl CodexProcess {
    pub(super) fn spawn(executable: &Path) -> Result<Self, AppError> {
        let home = tempfile::Builder::new()
            .prefix("ai-switch-codex-oauth-")
            .tempdir()
            .map_err(|_| {
                oauth_error(
                    "codex_oauth.temp_dir",
                    "Could not create an isolated Codex login directory",
                )
            })?;
        let mut child = isolated_command(executable, home.path())
            .spawn()
            .map_err(|_| {
                oauth_error(
                    "codex_oauth.start_failed",
                    "Could not start Codex CLI. Update the official Codex CLI and try again.",
                )
            })?;
        let reader = BufReader::new(child.stdout.take().ok_or_else(protocol_error)?);
        let writer = child.stdin.take().ok_or_else(protocol_error)?;
        Ok(Self {
            child,
            rpc: Rpc::new(reader, writer),
            home: Some(home),
            login_id: None,
        })
    }

    pub(super) async fn start_login(
        &mut self,
        method: CodexOAuthMethod,
    ) -> Result<LoginInfo, AppError> {
        tokio::time::timeout(START_TIMEOUT, async {
            self.rpc.request(1, "initialize", json!({
                "clientInfo":{"name":"ai_switch", "title":"AI Switch", "version":env!("CARGO_PKG_VERSION")},
                "capabilities":{"experimentalApi":false}
            })).await?;
            self.rpc.send(json!({"method":"initialized", "params":{}})).await?;
            let config = self.rpc.request(2, "config/read", json!({"includeLayers":false})).await?;
            verify_file_storage(&config)?;
            let kind = match method { CodexOAuthMethod::Browser => "chatgpt", CodexOAuthMethod::DeviceCode => "chatgptDeviceCode" };
            let result = self.rpc.request(3, "account/login/start", json!({"type":kind})).await?;
            let info = parse_login_result(method, result)?;
            self.login_id = Some(info.login_id.clone());
            Ok(info)
        }).await.map_err(|_| oauth_error("codex_oauth.start_timeout", "Codex login startup timed out. Check your network and Codex CLI installation."))?
    }

    pub(super) async fn wait_for_login(&mut self) -> Result<(), AppError> {
        let id = self.login_id.clone().ok_or_else(protocol_error)?;
        self.rpc.wait_for_login(&id).await
    }

    pub(super) async fn read_auth_json(&self) -> Result<String, AppError> {
        let path = self
            .home
            .as_ref()
            .ok_or_else(protocol_error)?
            .path()
            .join("auth.json");
        let invalid = || {
            oauth_error("codex_oauth.invalid_credentials", "Codex did not write valid isolated login credentials. Check its credential-storage policy.")
        };
        let metadata = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(|_| invalid())?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_MESSAGE_BYTES as u64
        {
            return Err(invalid());
        }
        let file = tokio::fs::File::open(path).await.map_err(|_| invalid())?;
        let mut text = String::new();
        file.take(MAX_MESSAGE_BYTES as u64 + 1)
            .read_to_string(&mut text)
            .await
            .map_err(|_| invalid())?;
        if text.len() > MAX_MESSAGE_BYTES {
            return Err(invalid());
        }
        Ok(text)
    }

    pub(super) async fn cleanup(mut self, cancel_login: bool) -> Result<(), AppError> {
        if cancel_login {
            if let Some(id) = self.login_id.as_ref() {
                let _ = tokio::time::timeout(
                    Duration::from_millis(500),
                    self.rpc.send(json!({
                        "id":4, "method":"account/login/cancel", "params":{"loginId":id}
                    })),
                )
                .await;
            }
        }
        // Give the app-server a chance to release its databases and callback port.
        // ChildStdin::shutdown alone does not close the OS pipe on Windows.
        // Drop both redirected pipes so EOF lets app-server exit gracefully.
        drop(self.rpc);
        if tokio::time::timeout(Duration::from_secs(2), self.child.wait())
            .await
            .is_err()
        {
            #[cfg(unix)]
            if let Some(pid) = self.child.id() {
                // Includes a Node wrapper when Codex is installed via npm on Unix.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
            }
            let _ = self.child.kill().await;
            let _ = self.child.wait().await;
        }
        let home = self.home.take().ok_or_else(protocol_error)?;
        drop(self.child);
        let path = home.path().to_path_buf();
        // Windows/antivirus may briefly retain the process cwd even after wait().
        let mut removed = false;
        for attempt in 0..20 {
            match tokio::fs::remove_dir_all(&path).await {
                Ok(()) => {
                    removed = true;
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    removed = true;
                    break;
                }
                Err(_) if attempt < 19 => tokio::time::sleep(Duration::from_millis(100)).await,
                Err(_) => break,
            }
        }
        if !removed {
            // Best effort to remove just the sensitive file before reporting cleanup failure.
            let _ = tokio::fs::remove_file(path.join("auth.json")).await;
        }
        drop(home);
        if removed {
            Ok(())
        } else {
            Err(oauth_error("codex_oauth.cleanup_failed", "Could not fully clean up the temporary Codex login directory. Restart AI Switch before trying again."))
        }
    }
}

#[async_trait::async_trait]
pub(super) trait LoginProcess: Send {
    async fn start_login(&mut self, method: CodexOAuthMethod) -> Result<LoginInfo, AppError>;
    async fn wait_for_login(&mut self) -> Result<(), AppError>;
    async fn read_auth_json(&self) -> Result<String, AppError>;
    async fn cleanup(self: Box<Self>, cancel_login: bool) -> Result<(), AppError>;
}

#[async_trait::async_trait]
impl LoginProcess for CodexProcess {
    async fn start_login(&mut self, method: CodexOAuthMethod) -> Result<LoginInfo, AppError> {
        CodexProcess::start_login(self, method).await
    }
    async fn wait_for_login(&mut self) -> Result<(), AppError> {
        CodexProcess::wait_for_login(self).await
    }
    async fn read_auth_json(&self) -> Result<String, AppError> {
        CodexProcess::read_auth_json(self).await
    }
    async fn cleanup(self: Box<Self>, cancel_login: bool) -> Result<(), AppError> {
        CodexProcess::cleanup(*self, cancel_login).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    const LOGIN_ID: &str = "e8a9f5c7-bcce-40f4-a3fc-232ff950cf7e";

    #[test]
    fn parses_browser_and_device_authorization_without_fixed_client_ids() {
        let browser = parse_login_result(CodexOAuthMethod::Browser, json!({
            "type": "chatgpt", "loginId": LOGIN_ID,
            "authUrl": "https://auth.openai.com/oauth/authorize?client_id=observed-client&state=fixture"
        })).unwrap();
        assert_eq!(browser.client_id.as_deref(), Some("observed-client"));
        assert!(browser.user_code.is_none());
        let device = parse_login_result(
            CodexOAuthMethod::DeviceCode,
            json!({
                "type": "chatgptDeviceCode", "loginId": LOGIN_ID,
                "verificationUrl": "https://auth.openai.com/codex/device", "userCode": "ABCD-1234"
            }),
        )
        .unwrap();
        assert_eq!(device.user_code.as_deref(), Some("ABCD-1234"));
    }

    #[test]
    fn rejects_untrusted_authorization_urls_and_wrong_login_modes() {
        for url in [
            "javascript:alert(1)",
            "http://auth.openai.com/",
            "https://auth.openai.com.evil.test/",
            "https://user:secret@auth.openai.com/",
            "https://auth.openai.com:8443/",
        ] {
            let error = parse_login_result(
                CodexOAuthMethod::Browser,
                json!({"type": "chatgpt", "loginId": LOGIN_ID, "authUrl": url}),
            )
            .unwrap_err();
            assert_eq!(error.code(), "codex_oauth.unsafe_url");
            assert!(error.details().is_none());
        }
        assert!(parse_login_result(CodexOAuthMethod::Browser, json!({"type": "apiKey"})).is_err());
        assert!(parse_login_result(CodexOAuthMethod::DeviceCode, json!({"type":"chatgptDeviceCode", "loginId": LOGIN_ID, "verificationUrl":"https://auth.openai.com/codex/device"})).is_err());
    }

    #[test]
    fn refuses_to_login_if_managed_policy_prevents_isolated_file_storage() {
        assert!(verify_file_storage(&json!({"config": {"cli_auth_credentials_store": "file", "forced_login_method": "chatgpt"}})).is_ok());
        for storage in ["keyring", "auto", "ephemeral"] {
            assert_eq!(
                verify_file_storage(&json!({"config": {"cli_auth_credentials_store": storage}}))
                    .unwrap_err()
                    .code(),
                "codex_oauth.storage_policy"
            );
        }
    }

    #[test]
    fn isolated_command_never_uses_user_home_or_shell_and_removes_inherited_keys() {
        let temp = tempfile::tempdir().unwrap();
        let exe = temp.path().join("codex.exe");
        let command = isolated_command(&exe, temp.path());
        let command = command.as_std();
        assert_eq!(command.get_program(), exe.as_os_str());
        assert_eq!(command.get_current_dir(), Some(temp.path()));
        let env: Vec<_> = command.get_envs().collect();
        assert!(env
            .iter()
            .any(|(key, value)| *key == "CODEX_HOME" && *value == Some(temp.path().as_os_str())));
        assert!(env
            .iter()
            .any(|(key, value)| *key == "OPENAI_API_KEY" && value.is_none()));
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"cli_auth_credentials_store=\"file\"".to_string()));
        assert!(args.contains(&"forced_login_method=\"chatgpt\"".to_string()));
        for disabled in [
            "features.plugins=false",
            "features.remote_plugin=false",
            "features.apps=false",
        ] {
            assert!(
                args.contains(&disabled.to_string()),
                "login must not initialize unrelated plugin catalogs"
            );
        }
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[cfg(windows)]
    #[test]
    fn resolves_npm_native_binary_instead_of_the_cmd_or_extensionless_shim() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("codex"), "#!/bin/sh").unwrap();
        std::fs::write(temp.path().join("codex.cmd"), "@echo off").unwrap();
        let target = if cfg!(target_arch = "aarch64") {
            "aarch64-pc-windows-msvc"
        } else {
            "x86_64-pc-windows-msvc"
        };
        let platform = if cfg!(target_arch = "aarch64") {
            "codex-win32-arm64"
        } else {
            "codex-win32-x64"
        };
        let native = temp
            .path()
            .join("node_modules/@openai/codex/node_modules/@openai")
            .join(platform)
            .join("vendor")
            .join(target)
            .join("bin/codex.exe");
        std::fs::create_dir_all(native.parent().unwrap()).unwrap();
        std::fs::write(&native, "MZfixture").unwrap();
        assert_eq!(
            find_native_codex(&[temp.path().to_path_buf()]),
            Some(native.canonicalize().unwrap())
        );
    }

    #[cfg(windows)]
    #[test]
    fn resolves_pnpm_global_install_from_its_path_shim_directory() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("codex.cmd"), "@echo off").unwrap();
        let target = if cfg!(target_arch = "aarch64") {
            "aarch64-pc-windows-msvc"
        } else {
            "x86_64-pc-windows-msvc"
        };
        let package = temp.path().join("global/5/node_modules/@openai/codex");
        let native = package.join("vendor").join(target).join("codex/codex.exe");
        std::fs::create_dir_all(native.parent().unwrap()).unwrap();
        std::fs::write(&native, "MZfixture").unwrap();
        assert_eq!(
            find_native_codex(&[temp.path().to_path_buf()]),
            Some(native.canonicalize().unwrap())
        );
    }

    #[tokio::test]
    async fn buffers_early_login_completion_and_ignores_other_login_ids() {
        let (client, mut server) = tokio::io::duplex(16384);
        let (read, write) = tokio::io::split(client);
        let mut rpc = Rpc::new(BufReader::new(read), write);
        for message in [
            json!({"method":"account/login/completed", "params":{"loginId":"other", "success":false, "error":"secret-marker"}}),
            json!({"method":"account/login/completed", "params":{"loginId":LOGIN_ID, "success":true}}),
            json!({"id":3, "result":{"type":"chatgpt", "loginId":LOGIN_ID}}),
        ] {
            server
                .write_all(format!("{message}\n").as_bytes())
                .await
                .unwrap();
        }
        let value = rpc
            .request(3, "account/login/start", json!({"type":"chatgpt"}))
            .await
            .unwrap();
        assert_eq!(value["loginId"], LOGIN_ID);
        rpc.wait_for_login(LOGIN_ID).await.unwrap();
        let mut sent = String::new();
        BufReader::new(server).read_line(&mut sent).await.unwrap();
        let sent: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(sent["method"], "account/login/start");
    }

    #[tokio::test]
    async fn protocol_errors_and_login_failures_do_not_echo_secrets() {
        for message in [
            json!({"id":1,"error":{"code":-32602,"message":"secret-marker"}}),
            json!({"method":"account/login/completed","params":{"loginId":LOGIN_ID,"success":false,"error":"secret-marker"}}),
        ] {
            let (client, mut server) = tokio::io::duplex(4096);
            let (read, write) = tokio::io::split(client);
            let mut rpc = Rpc::new(BufReader::new(read), write);
            server
                .write_all(format!("{message}\n").as_bytes())
                .await
                .unwrap();
            let error = if message.get("id").is_some() {
                rpc.request(1, "initialize", json!({})).await.unwrap_err()
            } else {
                rpc.wait_for_login(LOGIN_ID).await.unwrap_err()
            };
            assert!(!format!("{error:?}").contains("secret-marker"));
            assert!(error.details().is_none());
        }
    }
    #[tokio::test]
    #[ignore = "Requires an installed official Codex CLI and a free localhost callback port"]
    async fn official_cli_browser_login_start_and_cancel_smoke() {
        let executable = resolve_codex().expect("official CLI installed");
        let mut process = CodexProcess::spawn(&executable).expect("isolated process");
        let home = process.home.as_ref().unwrap().path().to_path_buf();
        let started = process.start_login(CodexOAuthMethod::Browser).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        let cleanup = process.cleanup(true).await;
        cleanup.expect("process and credentials cleaned");
        let info = started.expect("official browser login protocol");
        assert!(info.authorization_url.starts_with("https://"));
        assert!(info.client_id.is_some());
        assert!(!home.exists(), "temporary Codex home must be removed");
    }
}
