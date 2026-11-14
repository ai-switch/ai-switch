//! Channel-aware update check. Downloads and installation continue to use the
//! updater plugin's resources; only endpoint selection happens here.

use tauri::{Manager, State, Url, Webview, Wry};
use tauri_plugin_updater::UpdaterExt;

use crate::app_state::AppState;
use crate::error::{ApiError, AppError};
use crate::services::settings_service::SettingsService;

/// Stable releases: the same endpoint `tauri.conf.json` configures.
const STABLE_ENDPOINT: &str =
    "https://github.com/ai-switch/ai-switch/releases/latest/download/latest.json";
/// Beta channel: a manifest the release pipeline writes on every prerelease tag,
/// kept on a dedicated branch so it has a stable URL. GitHub's
/// `/releases/latest` never returns a prerelease, which is exactly why the beta
/// channel needs its own copy. The repository is public, so this raw URL needs
/// no authentication.
const BETA_ENDPOINT: &str = "https://raw.githubusercontent.com/ai-switch/ai-switch/beta/beta.json";

/// Mirrors `tauri_plugin_updater::commands::Metadata`, which is `pub(crate)` and
/// therefore not reusable. Field names are camelCase to match what the JS
/// `Update` class reads.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

async fn check_channels<T, C, F, V>(
    beta: bool,
    mut check: C,
    version: V,
) -> Result<Option<T>, String>
where
    C: FnMut(&'static str) -> F,
    F: std::future::Future<Output = Result<Option<T>, String>>,
    V: Fn(&T) -> &str,
{
    if !beta {
        return check(STABLE_ENDPOINT).await;
    }
    // Endpoints in one UpdaterBuilder are failover only: a valid but stale RC
    // would hide a newer stable release. Check both and compare their versions.
    let (stable, beta) = tokio::join!(check(STABLE_ENDPOINT), check(BETA_ENDPOINT));
    match (stable, beta) {
        (Ok(Some(stable)), Ok(Some(beta))) => {
            let stable_version =
                semver::Version::parse(version(&stable)).map_err(|error| error.to_string())?;
            let beta_version =
                semver::Version::parse(version(&beta)).map_err(|error| error.to_string())?;
            Ok(Some(if beta_version > stable_version {
                beta
            } else {
                stable
            }))
        }
        (Ok(Some(update)), _) | (_, Ok(Some(update))) => Ok(Some(update)),
        (Ok(None), Ok(None)) => Ok(None),
        // Don't call it "up to date" when an endpoint could not be checked.
        (Err(error), _) | (_, Err(error)) => Err(error),
    }
}

async fn check_endpoint(
    webview: &Webview<Wry>,
    endpoint: &'static str,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let url = Url::parse(endpoint).map_err(|error| error.to_string())?;
    webview
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|error| error.to_string())?
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_update(
    webview: Webview<Wry>,
    state: State<'_, AppState>,
) -> Result<Option<UpdateMetadata>, ApiError> {
    let settings = SettingsService::load(&state.paths).await?;
    let Some(update) = check_channels(
        settings.beta_updates_enabled,
        |endpoint| check_endpoint(&webview, endpoint),
        |update| update.version.as_str(),
    )
    .await
    .map_err(|error| AppError::Validation {
        code: "update.check",
        message: "Could not check for updates".to_string(),
        details: Some(error),
        recoverable: true,
    })?
    else {
        return Ok(None);
    };

    let date = match update.date {
        Some(date) => Some(
            date.format(&time::format_description::well_known::Rfc3339)
                .map_err(|error| AppError::Validation {
                    code: "update.date",
                    message: "Could not format the release date".to_string(),
                    details: Some(error.to_string()),
                    recoverable: true,
                })?,
        ),
        None => None,
    };

    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        // Registered in the webview's table so the JS `Update` class can keep
        // driving download/install through `plugin:updater|*`.
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn beta_channel_chooses_the_newest_installable_release() {
        for (stable, beta, expected) in [
            (Some("0.18.2"), Some("0.19.0-rc.1"), Some("0.19.0-rc.1")),
            (Some("0.19.0"), Some("0.19.0-rc.1"), Some("0.19.0")),
            (Some("0.19.1"), Some("0.19.0-rc.2"), Some("0.19.1")),
            (Some("0.18.2"), Some("0.19.0-rc.10"), Some("0.19.0-rc.10")),
            (None, Some("0.19.0-rc.2"), Some("0.19.0-rc.2")),
            (None, None, None),
        ] {
            let selected = check_channels(
                true,
                |endpoint| {
                    std::future::ready(Ok(if endpoint == STABLE_ENDPOINT {
                        stable
                    } else {
                        beta
                    }))
                },
                |version: &&str| *version,
            )
            .await
            .unwrap();
            assert_eq!(selected, expected);
        }
    }

    #[tokio::test]
    async fn stable_channel_never_requests_the_beta_manifest() {
        let selected = check_channels(
            false,
            |endpoint| {
                assert_eq!(endpoint, STABLE_ENDPOINT);
                std::future::ready(Ok(Some("0.19.0")))
            },
            |version: &&str| *version,
        )
        .await
        .unwrap();
        assert_eq!(selected, Some("0.19.0"));
    }

    #[tokio::test]
    async fn a_missing_beta_manifest_does_not_hide_stable_updates() {
        let selected = check_channels(
            true,
            |endpoint| {
                std::future::ready(if endpoint == BETA_ENDPOINT {
                    Err("404: beta channel has not been published".to_string())
                } else {
                    Ok(Some("0.19.0"))
                })
            },
            |version: &&str| *version,
        )
        .await
        .unwrap();
        assert_eq!(selected, Some("0.19.0"));
    }

    #[tokio::test]
    async fn a_stable_endpoint_failure_does_not_hide_beta_updates() {
        let selected = check_channels(
            true,
            |endpoint| {
                std::future::ready(if endpoint == STABLE_ENDPOINT {
                    Err("stable endpoint unavailable".to_string())
                } else {
                    Ok(Some("0.19.0-rc.3"))
                })
            },
            |version: &&str| *version,
        )
        .await
        .unwrap();
        assert_eq!(selected, Some("0.19.0-rc.3"));
    }

    #[tokio::test]
    async fn failed_checks_are_not_reported_as_up_to_date() {
        let result = check_channels::<&str, _, _, _>(
            true,
            |_| std::future::ready(Err("network unavailable".to_string())),
            |version: &&str| *version,
        )
        .await;
        assert!(result.unwrap_err().contains("network unavailable"));
    }

    #[tokio::test]
    async fn matching_versions_prefer_the_stable_payload() {
        let selected = check_channels(
            true,
            |endpoint| std::future::ready(Ok(Some(("0.19.0", endpoint)))),
            |candidate: &(&str, &str)| candidate.0,
        )
        .await
        .unwrap();
        assert_eq!(selected, Some(("0.19.0", STABLE_ENDPOINT)));
    }

    #[tokio::test]
    async fn semver_orders_numeric_prerelease_identifiers() {
        let selected = check_channels(
            true,
            |endpoint| {
                std::future::ready(Ok(Some(if endpoint == STABLE_ENDPOINT {
                    "0.19.0-rc.2"
                } else {
                    "0.19.0-rc.10"
                })))
            },
            |version: &&str| *version,
        )
        .await
        .unwrap();
        assert_eq!(selected, Some("0.19.0-rc.10"));
    }
}
