use super::*;
use tokio::io::{AsyncRead, AsyncReadExt};

const OUTPUT_LIMIT: usize = 128 * 1024;

pub(super) struct SystemExecutor;

fn discover() -> Option<std::path::PathBuf> {
    if let Ok(path) = which::which("tailscale") {
        return Some(path);
    }
    let mut paths: Vec<std::path::PathBuf> = vec![
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale".into(),
        "/opt/homebrew/bin/tailscale".into(),
        "/usr/local/bin/tailscale".into(),
        "/usr/bin/tailscale".into(),
        "/usr/sbin/tailscale".into(),
    ];
    for key in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(key) {
            paths.push(std::path::PathBuf::from(root).join("Tailscale/tailscale.exe"));
        }
    }
    paths.into_iter().find(|path| path.is_file())
}

/// Spawn recipe for CLI children: no console window on Windows, and English
/// diagnostics so the stderr classification below can match fixed phrases.
fn tokio_command(program: std::path::PathBuf) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    command
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[async_trait::async_trait]
impl Executor for SystemExecutor {
    fn installed(&self) -> bool {
        discover().is_some()
    }

    async fn run(
        &self,
        args: Vec<String>,
        cancel: CancellationToken,
        auth: AuthCallback,
        timeout: Duration,
    ) -> Result<String, Failure> {
        let program = discover().ok_or(Failure("notInstalled"))?;
        if cancel.is_cancelled() {
            return Err(Failure("cancelled"));
        }
        let mut child = tokio_command(program)
            .args(args)
            .spawn()
            .map_err(|err| {
                Failure(if err.kind() == std::io::ErrorKind::PermissionDenied {
                    "permissionDenied"
                } else {
                    "unavailable"
                })
            })?;
        let stdout = child.stdout.take().ok_or(Failure("failed"))?;
        let stderr = child.stderr.take().ok_or(Failure("failed"))?;
        let result = {
            let reads = async {
                tokio::try_join!(
                    capture(stdout, auth.clone()),
                    capture(stderr, auth),
                    async { child.wait().await.map_err(|_| Failure("failed")) }
                )
            };
            tokio::select! {
                biased;
                _ = cancel.cancelled() => Err(Failure("cancelled")),
                result = tokio::time::timeout(timeout, reads) => result.unwrap_or(Err(Failure("timeout"))),
            }
        };
        let (stdout, stderr, exit) = match result {
            Ok(output) => output,
            Err(error) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(error);
            }
        };
        if !exit.success() {
            // Inspect only for classification; raw output can contain auth URLs and secrets.
            let text = String::from_utf8_lossy(&stderr).to_ascii_lowercase();
            return Err(Failure(
                if text.contains("permission denied")
                    || text.contains("access denied")
                    || text.contains("must be run as root")
                {
                    "permissionDenied"
                } else if text.contains("failed to connect")
                    || text.contains("tailscaled") && text.contains("not running")
                {
                    "unavailable"
                } else {
                    "failed"
                },
            ));
        }
        String::from_utf8(stdout).map_err(|_| Failure("invalidResponse"))
    }
}

async fn capture<R: AsyncRead + Unpin>(
    mut stream: R,
    auth: AuthCallback,
) -> Result<Vec<u8>, Failure> {
    let mut output = Vec::new();
    let mut buffer = [0u8; 4096];
    let mut scanned = 0;
    let mut previous = None;
    loop {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|_| Failure("failed"))?;
        if count == 0 {
            if let Some(url) = authorization_url(&String::from_utf8_lossy(&output[scanned..])) {
                if previous.as_ref() != Some(&url) {
                    auth(url);
                }
            }
            return Ok(output);
        }
        if output.len() + count > OUTPUT_LIMIT {
            return Err(Failure("invalidResponse"));
        }
        output.extend_from_slice(&buffer[..count]);
        // Only scan complete tokens: a URL can straddle multiple pipe reads.
        if let Some(end) = output[scanned..].iter().rposition(u8::is_ascii_whitespace) {
            let end = scanned + end + 1;
            if let Some(url) = authorization_url(&String::from_utf8_lossy(&output[scanned..end])) {
                if previous.as_ref() != Some(&url) {
                    auth(url.clone());
                    previous = Some(url);
                }
            }
            scanned = end;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn captures_split_authorization_without_waiting_for_process_exit() {
        let (mut writer, reader) = tokio::io::duplex(1024);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(capture(
            reader,
            Arc::new(move |url| {
                let _ = tx.send(url);
            }),
        ));
        writer
            .write_all(b"To authorize: https://login.tailscale.")
            .await
            .unwrap();
        tokio::task::yield_now().await;
        assert!(rx.try_recv().is_err());
        writer.write_all(b"com/f/example\n").await.unwrap();
        let url = tokio::time::timeout(Duration::from_millis(200), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(url, "https://login.tailscale.com/f/example");
        writer.shutdown().await.unwrap();
        assert_eq!(
            String::from_utf8(task.await.unwrap().unwrap()).unwrap(),
            "To authorize: https://login.tailscale.com/f/example\n"
        );
    }

    #[tokio::test]
    async fn bounds_output_before_reading_an_unbounded_child() {
        let input = vec![b'x'; OUTPUT_LIMIT + 1];
        assert_eq!(
            capture(input.as_slice(), Arc::new(|_| {})).await,
            Err(Failure("invalidResponse"))
        );
    }
}
