//! Saving the diagnostics bundle the live-log dialog offers.
//!
//! Desktop-only: it writes through a native save dialog, which the headless
//! server has no equivalent for. The frontend refuses to call it in web mode via
//! `desktopOnlyCommands`, the same way `save_route_credential_export` is gated.

use crate::app_state::AppState;
use crate::config_writer::ConfigWriter;
use crate::error::{ApiError, AppError};
use crate::services::route_proxy_diagnostics_service::{self, DIAGNOSTICS_FILE_EXTENSION};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveRouteProxyDiagnosticsResult {
    pub cancelled: bool,
    pub file_name: Option<String>,
    /// Entries packed, so the UI can say what was written rather than just that
    /// something was.
    pub entries: usize,
    /// Compressed size on disk.
    pub byte_size: usize,
}

#[tauri::command]
pub async fn save_route_proxy_diagnostics_export(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SaveRouteProxyDiagnosticsResult, ApiError> {
    // The dialog comes first: assembling the bundle compresses up to ~146 MB,
    // and there is no reason to spend that on an export the user then cancels.
    let selected = app
        .dialog()
        .file()
        .set_file_name(route_proxy_diagnostics_service::suggested_file_name())
        .add_filter("AI Switch diagnostics", &[DIAGNOSTICS_FILE_EXTENSION])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(cancelled_result());
    };
    let selected = selected.into_path().map_err(|error| {
        ApiError::from(AppError::Validation {
            code: "diagnostics.export_path_invalid",
            message: "The selected export path is invalid".to_string(),
            details: Some(error.to_string()),
            recoverable: true,
        })
    })?;
    let path = with_extension(selected);

    let bundle = route_proxy_diagnostics_service::build(
        &state.pool,
        &state.paths,
        &state.route_proxy.live_log(),
    )
    .await
    .map_err(ApiError::from)?;

    // Bytes, not text: the bundle is a brotli stream, and the text overload
    // would reject it before it reached the disk.
    let expected = ConfigWriter::inspect(&path).await.map_err(ApiError::from)?;
    ConfigWriter::write_atomic_if_unchanged(&path, &bundle.bytes, &expected)
        .await
        .map_err(ApiError::from)?;

    Ok(SaveRouteProxyDiagnosticsResult {
        cancelled: false,
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned),
        entries: bundle.entries,
        byte_size: bundle.bytes.len(),
    })
}

/// Add the extension when the user typed a bare name.
///
/// `set_file_name` pre-fills the full name, so this only fires when it was
/// edited away — and a `.jsonl.br` file the user cannot tell apart from a `.txt`
/// is worse than one more suffix than they asked for.
fn with_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        return path;
    }
    let mut name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("ai-switch-diagnostics")
        .to_string();
    name.push_str(".jsonl.");
    name.push_str(DIAGNOSTICS_FILE_EXTENSION);
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(name),
        _ => Path::new(&name).to_path_buf(),
    }
}

fn cancelled_result() -> SaveRouteProxyDiagnosticsResult {
    SaveRouteProxyDiagnosticsResult {
        cancelled: true,
        file_name: None,
        entries: 0,
        byte_size: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_without_an_extension_gets_the_bundle_suffix() {
        assert_eq!(
            with_extension(PathBuf::from("/tmp/report")),
            PathBuf::from("/tmp/report.jsonl.br")
        );
        assert_eq!(
            with_extension(PathBuf::from("report")),
            PathBuf::from("report.jsonl.br")
        );
    }

    #[test]
    fn an_extension_the_user_chose_is_left_alone() {
        assert_eq!(
            with_extension(PathBuf::from("/tmp/report.jsonl.br")),
            PathBuf::from("/tmp/report.jsonl.br")
        );
        assert_eq!(
            with_extension(PathBuf::from("/tmp/report.zip")),
            PathBuf::from("/tmp/report.zip"),
            "用户明确选了别的后缀就照办，不偷偷改回 br"
        );
    }
}
