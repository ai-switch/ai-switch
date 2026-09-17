//! Per-client home resolution for Electron desktop clients whose data root
//! does not always match this app's `BaseDirs::home_dir()`.
//!
//! Both bundled CLIs resolve their data root through an `os-homedir`-style
//! ponyfill that prefers `process.env.HOME` over the platform API:
//!
//! ```text
//! function homedir() { return process.env.HOME || os.homedir(); }
//! ```
//!
//! `os.homedir()` on Windows reads the profile directory
//! (`HKCU\...\ProfileList`), which ignores `HOME`. That split is exactly what
//! `directories::BaseDirs` — which returns the Windows profile path — misses:
//! when other software (observed with Cadence SPB 16.6, which exports a global
//! `HOME` pointing at `%APPDATA%\SPB_16.6`) redirects `HOME`, the client lands
//! in `SPB_16.6\.zcode\v2` while this app keeps writing `~\.zcode\v2` — two
//! different files, and the second write silently stops reaching the client.
//!
//! The `*_base` helpers re-derive the client's effective root the way the
//! client itself does. Two rules keep them safe:
//!
//! - The environment override only applies when the caller passed the real
//!   profile dir. Production callers do; test fixtures pass a temp home and
//!   get it back untouched, so adapter tests stay hermetic on any machine —
//!   including ones with a redirected `HOME`.
//! - No install-shaped directory is ever scanned. The client's own resolution
//!   chain is deterministic; a scan would guess, and guessing writes config
//!   into directories the client does not read.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Case-insensitive comparison with trailing separators trimmed: Windows paths
/// differ in case and often in trailing slashes, and a `HOME` that merely
/// re-spells the profile dir must not be treated as a redirect.
pub(crate) fn same_path(left: &Path, right: &Path) -> bool {
    let normalize = |path: &Path| {
        let lossy = path.to_string_lossy();
        lossy.trim_end_matches(['/', '\\']).to_ascii_lowercase()
    };
    normalize(left) == normalize(right)
}

/// The Windows profile dir: `directories::BaseDirs` home, falling back to
/// `USERPROFILE` where `BaseDirs` cannot construct (tests, services).
fn profile_home() -> Option<PathBuf> {
    if let Some(path) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
        return Some(path);
    }
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|value| !value.as_os_str().is_empty())
}

/// The homedir ponyfill's result for a caller already known to be resolving
/// the real profile dir: `HOME` wins only when it is set, non-empty, and
/// spelling something other than the profile dir.
fn ponyfill_base(
    env_home: Option<&OsStr>,
    profile: Option<&Path>,
    home: &Path,
) -> PathBuf {
    let Some(profile) = profile else {
        return home.to_path_buf();
    };
    if !same_path(home, profile) {
        // Fixture home: tests resolve against their own tree, never the
        // machine's redirected environment.
        return home.to_path_buf();
    }
    match env_home {
        Some(value) if !value.is_empty() => {
            let env_home = PathBuf::from(value);
            if same_path(&env_home, profile) {
                profile.to_path_buf()
            } else {
                env_home
            }
        }
        _ => profile.to_path_buf(),
    }
}

/// Base dir a WorkBuddy-family client (desktop app or bundled CLI) resolves
/// for `home`, through the homedir ponyfill.
pub(crate) fn ponyfill_base_for(home: &Path) -> PathBuf {
    ponyfill_base(std::env::var_os("HOME").as_deref(), profile_home().as_deref(), home)
}

/// ZCode's own chain: `ZCODE_DATA_BASE_DIR` → homedir ponyfill (`HOME` first,
/// then the profile dir). The runtime override is process-internal and
/// unreachable from here.
fn zcode_base(
    env_base_dir: Option<&OsStr>,
    env_home: Option<&OsStr>,
    profile: Option<&Path>,
    home: &Path,
) -> PathBuf {
    let Some(profile) = profile else {
        return home.to_path_buf();
    };
    if !same_path(home, profile) {
        return home.to_path_buf();
    }
    if let Some(value) = env_base_dir {
        let lossy = value.to_string_lossy();
        let trimmed = lossy.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    ponyfill_base(env_home, Some(profile), home)
}

/// Base dir ZCode resolves for `home`, following its documented chain.
pub(crate) fn zcode_base_for(home: &Path) -> PathBuf {
    zcode_base(
        std::env::var_os("ZCODE_DATA_BASE_DIR").as_deref(),
        std::env::var_os("HOME").as_deref(),
        profile_home().as_deref(),
        home,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE: &str = "C:\\Users\\Admin";
    const SPB: &str = "C:\\Users\\Admin\\AppData\\Roaming\\SPB_16.6";

    #[test]
    fn same_path_ignores_case_and_trailing_separators() {
        assert!(same_path(
            Path::new("C:\\Users\\Admin\\"),
            Path::new("c:\\users\\admin")
        ));
        assert!(same_path(Path::new("/home/u"), Path::new("/home/u/")));
        assert!(!same_path(Path::new(SPB), Path::new(PROFILE)));
    }

    #[test]
    fn fixture_homes_pass_through_untouched() {
        let fixture = Path::new("/nonexistent-adapter-fixture-home");
        assert_eq!(ponyfill_base(None, Some(Path::new(PROFILE)), fixture), fixture);
        assert_eq!(
            zcode_base(None, Some(OsStr::new(SPB)), Some(Path::new(PROFILE)), fixture),
            fixture
        );
    }

    #[test]
    fn an_unchanged_home_resolves_to_the_profile_dir() {
        for env_home in [None, Some(OsStr::new(""))] {
            assert_eq!(
                ponyfill_base(env_home, Some(Path::new(PROFILE)), Path::new(PROFILE)),
                Path::new(PROFILE)
            );
        }
        // A HOME that merely re-spells the profile dir is not a redirect.
        assert_eq!(
            ponyfill_base(
                Some(OsStr::new("c:\\users\\admin\\")),
                Some(Path::new(PROFILE)),
                Path::new(PROFILE)
            ),
            Path::new(PROFILE)
        );
    }

    #[test]
    fn a_redirected_home_moves_both_clients_the_way_their_own_loader_does() {
        let env_home = Some(OsStr::new(SPB));
        assert_eq!(
            ponyfill_base(env_home, Some(Path::new(PROFILE)), Path::new(PROFILE)),
            Path::new(SPB)
        );
        assert_eq!(
            zcode_base(None, env_home, Some(Path::new(PROFILE)), Path::new(PROFILE)),
            Path::new(SPB)
        );
    }

    #[test]
    fn zcode_env_base_dir_precedes_the_home_ponyfill() {
        assert_eq!(
            zcode_base(
                Some(OsStr::new("D:\\zcode-data")),
                Some(OsStr::new(SPB)),
                Some(Path::new(PROFILE)),
                Path::new(PROFILE)
            ),
            Path::new("D:\\zcode-data")
        );
        // An empty or whitespace value is ignored and resolution falls through.
        assert_eq!(
            zcode_base(
                Some(OsStr::new("  ")),
                None,
                Some(Path::new(PROFILE)),
                Path::new(PROFILE)
            ),
            Path::new(PROFILE)
        );
    }

    #[test]
    fn a_missing_profile_dir_leaves_the_caller_home_in_charge() {
        let home = Path::new("/only/home");
        assert_eq!(ponyfill_base(Some(OsStr::new(SPB)), None, home), home);
        assert_eq!(
            zcode_base(Some(OsStr::new(SPB)), None, None, home),
            home
        );
    }
}
