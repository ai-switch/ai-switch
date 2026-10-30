use crate::error::AppError;
use std::collections::HashSet;

pub(crate) const DEFAULT_CODEX_BASELINE_MODELS: &[&str] = &[
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
];

pub(crate) fn default_models(platform: &str) -> Vec<String> {
    if platform.trim().eq_ignore_ascii_case("codex") {
        return DEFAULT_CODEX_BASELINE_MODELS
            .iter()
            .map(|model| (*model).to_string())
            .collect();
    }
    Vec::new()
}

/// Trim model ids, drop blank rows, and reject case-insensitive duplicates.
/// An empty result is intentional: callers use it to mean "restore defaults".
/// Interpret a stored JSON value, falling back to defaults for missing,
/// malformed, empty, or duplicate data. Duplicate rows are treated as corrupt
/// because a duplicate would make the advertised model list ambiguous.
pub(crate) fn resolve_stored_models(platform: &str, raw: Option<&str>) -> Vec<String> {
    let fallback = default_models(platform);
    let Some(raw) = raw else {
        return fallback;
    };
    let Ok(parsed) = serde_json::from_str::<Vec<String>>(raw) else {
        return fallback;
    };
    match normalize_models(&parsed) {
        Ok(models) if !models.is_empty() => models,
        _ => fallback,
    }
}

pub(crate) fn normalize_models(models: &[String]) -> Result<Vec<String>, AppError> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for model in models {
        let model = model.trim();
        if model.is_empty() {
            continue;
        }
        let key = model.to_ascii_lowercase();
        if !seen.insert(key) {
            return Err(AppError::Validation {
                code: "validation.route_pool_baseline_models_duplicate",
                message: "Baseline model ids must be unique".to_string(),
                details: Some(model.to_string()),
                recoverable: true,
            });
        }
        normalized.push(model.to_string());
    }
    Ok(normalized)
}
