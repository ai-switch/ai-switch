use crate::error::AppError;
use chrono::Utc;
use sha2::{Digest, Sha384};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions,
    SqliteSynchronous,
};
use sqlx::{Connection, SqlitePool};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

pub mod repositories;

#[cfg(test)]
mod test_support;

/// Compiled-in migrations. Kept as one static so the embedded SQL is stored
/// once and the checksum repair below compares against exactly the set that
/// [`run_migrations`] applies.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Tables that only ever hold what the user created or accumulated. Seeded
/// tables such as `target_apps` are deliberately absent: they are filled on
/// every fresh start and would make an empty database look occupied.
const USER_DATA_TABLES: &[&str] = &[
    "route_credentials",
    "client_direct_modes",
    "route_pool_groups",
    "route_pool_members",
    "providers",
    "official_accounts",
    "route_proxy_keys",
    "mcp_servers",
    "batches",
    "prompt_assets",
    "sessions",
    "usage_events",
    "config_snapshots",
    "saas_users",
    "saas_api_keys",
    "saas_wallet_ledger",
    "saas_recharge_orders",
    "saas_redemption_codes",
    "saas_group_settings",
    "saas_settings",
];

pub async fn create_pool(database_file: &Path) -> Result<SqlitePool, AppError> {
    if let Some(parent) = database_file.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let url = format!("sqlite://{}", database_file.display());
    let options = SqliteConnectOptions::from_str(&url)
        .map_err(|err| AppError::Database {
            code: "database.connect_options",
            message: "Could not create SQLite connection options".to_string(),
            details: Some(err.to_string()),
            recoverable: false,
        })?
        .create_if_missing(true)
        .foreign_keys(true)
        // WAL keeps committed transactions recoverable after a power loss:
        // writes land in the `-wal` sidecar first and only merge into the main
        // file at checkpoint, so a crash can never leave a half-written page in
        // the main database (issue #17). `synchronous=NORMAL` is the pairing
        // SQLite documents as corruption-safe under WAL, and the busy timeout
        // keeps the connection pool from erroring out on write contention.
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|err| AppError::Database {
            code: "database.connect",
            message: "Could not connect to SQLite database".to_string(),
            details: Some(err.to_string()),
            recoverable: false,
        })
}

#[cfg(test)]
pub async fn create_memory_pool() -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .map_err(|err| AppError::Database {
            code: "database.connect_options",
            message: "Could not create in-memory SQLite options".to_string(),
            details: Some(err.to_string()),
            recoverable: false,
        })?
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|err| AppError::Database {
            code: "database.connect",
            message: "Could not connect to in-memory SQLite database".to_string(),
            details: Some(err.to_string()),
            recoverable: false,
        })
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    MIGRATOR.run(pool).await.map_err(|err| {
        let details = err.to_string();
        let recoverable = is_migration_conflict_message(&details);
        AppError::Database {
            code: "database.migration",
            message: "Could not apply SQLite migrations".to_string(),
            details: Some(details),
            recoverable,
        }
    })?;
    repositories::route_pool_repository::RoutePoolRepository::migrate_legacy_pool_views(pool)
        .await?;
    Ok(())
}

/// Open the app database and apply migrations.
///
/// Migration checksums are a SHA-384 over the raw bytes of each `.sql` file, so
/// anything that rewrites those bytes without changing a single statement — a
/// CRLF-to-LF normalization, a reformat, a stray trailing newline — makes sqlx
/// report `VersionMismatch` for migrations that already ran. Left alone that
/// aborts startup; quarantining is what the app used to do, and it looks to the
/// user exactly like every account was deleted.
///
/// So before quarantining anything, try to repair: if a stored checksum differs
/// from the shipped file only by line endings, the applied SQL was byte-for-byte
/// equivalent and the ledger entry is simply stale. Rewrite it and carry on with
/// the user's data intact. Quarantine remains as the last resort for genuine
/// content changes, and only when the database has no user data to lose.
pub async fn open_migrated_pool(
    database_file: &Path,
    backups_dir: &Path,
) -> Result<SqlitePool, AppError> {
    let pool = create_pool(database_file).await?;

    // Catch page-level corruption from a non-normal shutdown (issue #17) before
    // migrations touch anything. Running migrations against a corrupt file fails
    // opaquely at best and scatters damage at worst, so recover first.
    if let Err(corruption) = check_integrity(&pool).await {
        pool.close().await;
        return recover_from_corruption(database_file, backups_dir, corruption).await;
    }

    match run_migrations(&pool).await {
        Ok(()) => restore_quarantined_database(pool, database_file, backups_dir).await,
        Err(err) if is_recoverable_migration_conflict(&err) => {
            let repaired = repair_line_ending_checksums(&pool).await?;
            if repaired > 0 {
                if let Ok(()) = run_migrations(&pool).await {
                    return restore_quarantined_database(pool, database_file, backups_dir).await;
                }
            }

            // Still mismatched: a migration's SQL really did change. Refuse to
            // throw away a populated database — a hard startup error the user
            // can report is recoverable, a silently emptied account list is not.
            if has_user_data(&pool).await? {
                return Err(preserve_instead_of_quarantine(database_file, &err));
            }

            pool.close().await;
            quarantine_database_files(database_file, backups_dir).await?;
            let pool = create_pool(database_file).await?;
            run_migrations(&pool).await?;
            restore_quarantined_database(pool, database_file, backups_dir).await
        }
        Err(err) => Err(err),
    }
}

/// Run `PRAGMA quick_check` and fail unless the database reports `ok`.
///
/// `quick_check` is `integrity_check` minus the slower index verification, so it
/// still catches the page-level damage a crash leaves behind — second references
/// to a page, rowids out of order, orphaned pages (issue #17) — in a fraction of
/// the time a full scan would take.
async fn check_integrity(pool: &SqlitePool) -> Result<(), AppError> {
    let rows: Vec<String> = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_all(pool)
        .await
        .map_err(|err| AppError::Database {
            code: "database.integrity_check_failed",
            message: "Could not run PRAGMA quick_check".to_string(),
            details: Some(err.to_string()),
            recoverable: false,
        })?;
    // A clean database yields exactly one row, "ok". Anything else — a second
    // row, or a message like "database disk image is malformed" — is corruption.
    if rows.len() == 1 && rows[0].eq_ignore_ascii_case("ok") {
        Ok(())
    } else {
        Err(AppError::Database {
            code: "database.corrupt",
            message: "SQLite reports the local database is corrupt.".to_string(),
            details: Some(rows.join("\n")),
            recoverable: false,
        })
    }
}

/// Recover from a corrupt database by salvaging whatever rows survive into a
/// fresh file, then parking the original under `backups/` and promoting the
/// salvage.
///
/// Page-level corruption from a crash is usually confined to the table being
/// written at the moment of power loss (issue #17: `usage_events`). The account
/// and credential tables earlier in the file are typically still readable, so a
/// row-by-row copy into a clean database recovers them — exactly what the issue
/// reporter did by hand.
async fn recover_from_corruption(
    database_file: &Path,
    backups_dir: &Path,
    corruption: AppError,
) -> Result<SqlitePool, AppError> {
    let staged = append_suffix(database_file, ".salvage-candidate");
    let _ = remove_database_files(&staged).await;

    match salvage_database(database_file, &staged).await {
        Ok(report) if report.created > 0 => {
            // Bring the salvage up to the current schema before promoting it, so
            // a salvage that recovered an older schema still opens cleanly.
            let staged_pool = create_pool(&staged).await?;
            let migration_outcome = run_migrations(&staged_pool).await;
            staged_pool.close().await;
            if migration_outcome.is_err() {
                let _ = remove_database_files(&staged).await;
                return Err(preserve_corrupt_original(database_file, &corruption));
            }

            park_corrupt_database(database_file, backups_dir, &report).await?;
            rename_database_files(&staged, database_file).await?;

            let pool = create_pool(database_file).await?;
            restore_quarantined_database(pool, database_file, backups_dir).await
        }
        _ => {
            // Salvage recovered nothing usable. Keep the corrupt original in
            // place so the user can recover manually — the bytes are intact.
            let _ = remove_database_files(&staged).await;
            Err(preserve_corrupt_original(database_file, &corruption))
        }
    }
}

/// Copy every readable table from `source` into a fresh database at `staged`.
///
/// Attaches the corrupt source via `ATTACH DATABASE` and recreates schema +
/// data table by table. A table whose pages are corrupt makes its
/// `INSERT ... SELECT` fail; that table is skipped and recorded in the report,
/// but the rest of the copy proceeds.
#[derive(Debug)]
struct SalvageReport {
    created: usize,
    copied: usize,
    skipped_schema: Vec<String>,
    skipped_data: Vec<String>,
}

async fn salvage_database(source: &Path, staged: &Path) -> Result<SalvageReport, AppError> {
    let target = SqliteConnectOptions::from_str(&format!("sqlite://{}", staged.display()))
        .map_err(|err| salvage_error("build staged connection options", err))?
        .create_if_missing(true)
        .foreign_keys(false)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10));
    // A single connection, not a pool: ATTACH is per-connection, and a pool would
    // re-establish (or reset) it on every checkout.
    let mut conn = SqliteConnection::connect_with(&target)
        .await
        .map_err(|err| salvage_error("open the staged database", err))?;

    let attach = format!(
        "ATTACH DATABASE {} AS src",
        quote_sqlite_literal(&source.display().to_string())
    );
    if let Err(err) = sqlx::query(&attach).execute(&mut conn).await {
        let _ = conn.close().await;
        return Err(salvage_error("attach the corrupt database for reading", err));
    }

    let outcome = async {
        // Recreate schema objects in the staged database, in creation order, so
        // foreign-key references resolve even though FK enforcement is off.
        let objects: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT type, name, sql FROM src.sqlite_master \
             WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' \
             ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid",
        )
        .fetch_all(&mut conn)
        .await?;

        let mut created = 0usize;
        let mut skipped_schema = Vec::new();
        for (_kind, name, sql) in &objects {
            match sqlx::query(sql).execute(&mut conn).await {
                Ok(_) => created += 1,
                Err(_) => skipped_schema.push(name.clone()),
            }
        }

        // Preserve the migration ledger so run_migrations is a no-op on the
        // salvage (or applies only genuinely pending migrations). A missing
        // ledger is non-fatal: the migrations use CREATE TABLE IF NOT EXISTS.
        let _: Result<_, sqlx::Error> = sqlx::query(
            "INSERT INTO main._sqlx_migrations SELECT * FROM src._sqlx_migrations",
        )
        .execute(&mut conn)
        .await;

        // Copy rows table by table. A page-level read failure on one table must
        // not abort the rest — the accounts live in earlier tables and are what
        // the user actually needs to recover.
        let tables: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM main.sqlite_master \
             WHERE type='table' AND name NOT LIKE 'sqlite_%' \
             AND name <> '_sqlx_migrations'",
        )
        .fetch_all(&mut conn)
        .await?;

        let mut copied = 0usize;
        let mut skipped_data = Vec::new();
        for (name,) in &tables {
            let stmt = format!("INSERT INTO main.\"{name}\" SELECT * FROM src.\"{name}\"");
            match sqlx::query(&stmt).execute(&mut conn).await {
                Ok(_) => copied += 1,
                Err(_) => skipped_data.push(name.clone()),
            }
        }

        Ok::<SalvageReport, sqlx::Error>(SalvageReport {
            created,
            copied,
            skipped_schema,
            skipped_data,
        })
    }
    .await;

    let _ = sqlx::query("DETACH DATABASE src").execute(&mut conn).await;
    let _ = conn.close().await;

    outcome.map_err(|err| salvage_error("salvage data from the corrupt database", err))
}

/// Move a corrupt database and its sidecars into `backups/` under a `.corrupt-`
/// marker, and leave a note explaining what happened and what was salvaged.
///
/// The marker differs from `.migration-conflict-` so these copies are never
/// picked up by [`restore_quarantined_database`] — a corrupt file is not a
/// restore candidate.
async fn park_corrupt_database(
    database_file: &Path,
    backups_dir: &Path,
    report: &SalvageReport,
) -> Result<(), AppError> {
    tokio::fs::create_dir_all(backups_dir).await?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let base_name = database_file
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("ai-switch.db");

    for path in database_sidecar_paths(database_file) {
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(base_name);
        let backup_name = format!("{file_name}.corrupt-{stamp}");
        rename_with_retry(&path, &backups_dir.join(backup_name))
            .await
            .map_err(|err| AppError::Filesystem {
                code: "filesystem.corrupt_quarantine",
                message: "Could not park the corrupt database file".to_string(),
                details: Some(format!("{} -> backups/: {err}", path.display())),
                recoverable: false,
            })?;
    }

    let note_path = backups_dir.join(format!("{base_name}.corrupt-{stamp}.txt"));
    let skipped_schema = if report.skipped_schema.is_empty() {
        "none".to_string()
    } else {
        report.skipped_schema.join(", ")
    };
    let skipped_data = if report.skipped_data.is_empty() {
        "none".to_string()
    } else {
        report.skipped_data.join(", ")
    };
    let note = format!(
        "AI Switch detected page-level corruption in this database after an\n\
         unclean shutdown and recovered what it could into a fresh database.\n\
         \n\
         Original database: {base}\n\
         Timestamp: {stamp}\n\
         Schema objects recreated: {created}\n\
         Tables whose data copied cleanly: {copied}\n\
         Tables whose data could not be read (skipped): {skipped_data}\n\
         Schema objects that could not be recreated (skipped): {skipped_schema}\n\
         \n\
         The original bytes are preserved in this backups/ directory in case\n\
         you want to attempt a manual recovery.\n",
        base = database_file.display(),
        stamp = stamp,
        created = report.created,
        copied = report.copied,
        skipped_data = skipped_data,
        skipped_schema = skipped_schema,
    );
    tokio::fs::write(&note_path, note).await?;
    Ok(())
}

/// Surface a fatal error while leaving the corrupt original on disk untouched,
/// so the user can recover from it manually (the bytes are intact).
fn preserve_corrupt_original(database_file: &Path, corruption: &AppError) -> AppError {
    let details = match corruption {
        AppError::Database { details, .. } => details.clone().unwrap_or_default(),
        _ => corruption.to_string(),
    };
    AppError::Database {
        code: "database.corrupt",
        message: "The AI Switch database is corrupt and could not be repaired automatically. \
                  The original file was left in place so you can recover from it manually."
            .to_string(),
        details: Some(format!("{}: {details}", database_file.display())),
        recoverable: false,
    }
}

/// Quote a string as a SQLite single-quoted literal (doubling internal quotes).
fn quote_sqlite_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn salvage_error(action: &str, err: sqlx::Error) -> AppError {
    AppError::Database {
        code: "database.salvage",
        message: format!("Could not {action}"),
        details: Some(err.to_string()),
        recoverable: false,
    }
}

/// Rewrite `_sqlx_migrations` checksums that match a shipped migration once its
/// line endings are normalized. Returns how many rows were corrected.
async fn repair_line_ending_checksums(pool: &SqlitePool) -> Result<usize, AppError> {
    let applied: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations")
            .fetch_all(pool)
            .await
            .map_err(|err| migration_repair_error("read the applied migration ledger", err))?;
    let applied: HashMap<i64, Vec<u8>> = applied.into_iter().collect();

    let mut repaired = 0usize;
    for migration in MIGRATOR.iter() {
        let Some(stored) = applied.get(&migration.version) else {
            continue;
        };
        if stored.as_slice() == migration.checksum.as_ref() {
            continue;
        }
        if !line_ending_variants_match(&migration.sql, stored) {
            continue;
        }

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(migration.checksum.as_ref())
            .bind(migration.version)
            .execute(pool)
            .await
            .map_err(|err| migration_repair_error("rewrite a stale migration checksum", err))?;
        repaired += 1;
    }

    Ok(repaired)
}

/// True when `stored` is the SHA-384 of this migration's SQL under some line
/// ending convention, i.e. the two differ only in CR bytes.
fn line_ending_variants_match(sql: &str, stored: &[u8]) -> bool {
    let lf = sql.replace("\r\n", "\n");
    let crlf = lf.replace('\n', "\r\n");
    [lf, crlf]
        .iter()
        .any(|variant| Sha384::digest(variant.as_bytes()).as_slice() == stored)
}

async fn has_user_data(pool: &SqlitePool) -> Result<bool, AppError> {
    for table in USER_DATA_TABLES {
        // EXISTS stops at the first row, so this stays cheap even next to a
        // usage_events table with a million rows.
        let query = if *table == "route_pool_groups" {
            "SELECT EXISTS(SELECT 1 FROM route_pool_groups WHERE is_internal<>0 OR deleted_at IS NOT NULL OR name<>CASE id WHEN platform||'-default' THEN '默认组' WHEN platform||'-out' THEN '未入池' WHEN platform||'-archived' THEN '已归档' ELSE '' END OR is_active<>CASE WHEN id=platform||'-default' THEN 1 ELSE 0 END)".to_string()
        } else if *table == "saas_settings" {
            "SELECT EXISTS(SELECT 1 FROM saas_settings WHERE key<>'instance_id')".to_string()
        } else {
            format!("SELECT EXISTS(SELECT 1 FROM \"{table}\")")
        };
        let present = sqlx::query_scalar::<_, bool>(&query).fetch_one(pool).await;
        match present {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            // A table missing from an older schema genuinely holds no rows. Any
            // other failure must not be read as "nothing here to lose": both
            // callers take `false` as permission to replace this database, so a
            // transient query error would cost the user their accounts.
            Err(err) if is_missing_table(&err) => {}
            Err(err) => {
                return Err(migration_repair_error(
                    &format!("check whether \"{table}\" holds user data"),
                    err,
                ))
            }
        }
    }
    Ok(false)
}

/// True when SQLite rejected the statement because the table is not part of this
/// schema — the expected answer for a database written by an older version.
fn is_missing_table(err: &sqlx::Error) -> bool {
    err.to_string().contains("no such table")
}

/// Bring back a database that an earlier version quarantined.
///
/// 0.7.3 quarantined and replaced databases whose migration checksums differed
/// only by line endings, so upgraded installs started on an empty account list
/// while the real data sat in `backups/` untouched. Once the checksum repair
/// above can reconcile such a file, restoring it is the other half of the fix.
///
/// Deliberately conservative: this only runs when the live database holds no
/// user data at all, so a restore can never overwrite something the user
/// created after the quarantine. In that case there is nothing to weigh up —
/// an empty database is exactly what the bug produced.
async fn restore_quarantined_database(
    pool: SqlitePool,
    database_file: &Path,
    backups_dir: &Path,
) -> Result<SqlitePool, AppError> {
    if has_user_data(&pool).await? {
        return Ok(pool);
    }
    let Some(stamp) = newest_quarantined_stamp(database_file, backups_dir).await else {
        return Ok(pool);
    };
    let quarantined = quarantined_paths(database_file, backups_dir, &stamp);

    // Migrate a scratch copy first: a quarantine file that cannot be brought up
    // to the current schema must not replace the working database. The `-wal`
    // sidecar travels with it — a quarantine taken after an unclean shutdown
    // keeps its newest transactions there, and opening the bare `.db` would
    // drop them without a word.
    let staged = append_suffix(database_file, ".restore-candidate");
    let _ = remove_database_files(&staged).await;
    for (source, target) in quarantined.iter().zip(database_sidecar_paths(&staged)) {
        if tokio::fs::try_exists(source).await.unwrap_or(false) {
            tokio::fs::copy(source, &target).await?;
        }
    }
    let restored = match prepare_restored_copy(&staged).await {
        Ok(true) => true,
        Ok(false) | Err(_) => false,
    };
    if !restored {
        let _ = remove_database_files(&staged).await;
        return Ok(pool);
    }

    pool.close().await;
    // Park what is being replaced instead of deleting it. The live database is
    // empty by the check above, but that is a verdict this code reached on its
    // own: if it is ever wrong, the bytes still have to exist somewhere.
    park_replaced_database(database_file, backups_dir).await?;
    rename_database_files(&staged, database_file).await?;
    // Keep the bytes, but take the file out of the candidate set so a later
    // start cannot restore it a second time over newer data.
    if let Some(base) = quarantined.first() {
        let _ = rename_with_retry(base, &append_suffix(base, ".restored")).await;
    }

    create_pool(database_file).await
}

/// Migrate a staged copy of a quarantined database. `Ok(false)` means the copy
/// is not usable as a replacement and should be discarded.
async fn prepare_restored_copy(staged: &Path) -> Result<bool, AppError> {
    let pool = create_pool(staged).await?;
    let outcome = async {
        if run_migrations(&pool).await.is_err() {
            repair_line_ending_checksums(&pool).await?;
            run_migrations(&pool).await?;
        }
        has_user_data(&pool).await
    }
    .await;
    pool.close().await;
    outcome
}

/// Timestamp of the newest `*.migration-conflict-*` copy of this database,
/// ignoring the `-wal` and `-shm` sidecars and anything already restored.
async fn newest_quarantined_stamp(database_file: &Path, backups_dir: &Path) -> Option<String> {
    let base_name = database_file.file_name()?.to_str()?;
    let prefix = format!("{base_name}.migration-conflict-");

    let mut entries = tokio::fs::read_dir(backups_dir).await.ok()?;
    let mut newest: Option<String> = None;
    while let Some(entry) = entries.next_entry().await.ok()? {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // The trailing timestamp sorts lexicographically, so the plain string
        // comparison below picks the most recent quarantine.
        let Some(stamp) = name.strip_prefix(&prefix) else {
            continue;
        };
        if !stamp.chars().all(|c| c.is_ascii_digit() || c == '-') {
            continue;
        }
        if newest
            .as_ref()
            .is_none_or(|newest_stamp| stamp > newest_stamp.as_str())
        {
            newest = Some(stamp.to_string());
        }
    }

    newest
}

/// The names [`quarantine_database_files`] produced for one timestamp. Each
/// sidecar keeps its own suffix ahead of the marker, so `ai-switch.db-wal` was
/// parked as `ai-switch.db-wal.migration-conflict-<stamp>`.
fn quarantined_paths(database_file: &Path, backups_dir: &Path, stamp: &str) -> Vec<PathBuf> {
    database_sidecar_paths(database_file)
        .into_iter()
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?;
            Some(backups_dir.join(format!("{name}.migration-conflict-{stamp}")))
        })
        .collect()
}

/// Move the database that is about to be replaced into `backups_dir`, sidecars
/// included. The `replaced` marker deliberately differs from the quarantine
/// marker so these copies can never be picked up as a restore candidate.
async fn park_replaced_database(database_file: &Path, backups_dir: &Path) -> Result<(), AppError> {
    tokio::fs::create_dir_all(backups_dir).await?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    for path in database_sidecar_paths(database_file) {
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        rename_with_retry(&path, &backups_dir.join(format!("{name}.replaced-{stamp}"))).await?;
    }
    Ok(())
}

/// Move a database and its sidecars, keeping each sidecar attached to the new
/// base name. Missing files are skipped.
async fn rename_database_files(from: &Path, to: &Path) -> Result<(), AppError> {
    for (source, target) in database_sidecar_paths(from)
        .into_iter()
        .zip(database_sidecar_paths(to))
    {
        if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
            continue;
        }
        rename_with_retry(&source, &target).await?;
    }
    Ok(())
}

/// Rename a database file that was closed moments ago, waiting out a handle the
/// OS has not released yet.
///
/// `SqlitePool::close` resolves before every underlying file handle is
/// necessarily gone, and Windows fails a rename against a still-open handle
/// with a sharing violation where Unix would simply succeed. The wait is short
/// and bounded: the handle is already on its way out.
pub(crate) async fn rename_with_retry(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    const ATTEMPTS: usize = 20;
    let mut attempt = 0usize;
    loop {
        attempt += 1;
        match tokio::fs::rename(from, to).await {
            Ok(()) => return Ok(()),
            Err(err) if attempt < ATTEMPTS && is_sharing_violation(&err) => {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            Err(err) => return Err(err.into()),
        }
    }
}

/// True when the operation failed only because someone still holds the file
/// open. Windows reports `ERROR_SHARING_VIOLATION` (32) and
/// `ERROR_LOCK_VIOLATION` (33), neither of which has a stable `ErrorKind`.
fn is_sharing_violation(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::PermissionDenied
        || matches!(err.raw_os_error(), Some(32) | Some(33))
}

async fn remove_database_files(database_file: &Path) -> Result<(), AppError> {
    for path in database_sidecar_paths(database_file) {
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(())
}

fn migration_repair_error(action: &str, err: sqlx::Error) -> AppError {
    AppError::Database {
        code: "database.migration_repair",
        message: format!("Could not {action}"),
        details: Some(err.to_string()),
        recoverable: false,
    }
}

fn preserve_instead_of_quarantine(database_file: &Path, err: &AppError) -> AppError {
    let details = match err {
        AppError::Database { details, .. } => details.clone().unwrap_or_default(),
        _ => String::new(),
    };
    AppError::Database {
        code: "database.migration_conflict_preserved",
        message: "SQLite migrations no longer match this database, which still holds your data. \
                  It was left untouched instead of being replaced."
            .to_string(),
        details: Some(format!("{}: {details}", database_file.display())),
        recoverable: false,
    }
}

fn is_recoverable_migration_conflict(err: &AppError) -> bool {
    match err {
        AppError::Database {
            code,
            details,
            recoverable,
            ..
        } if *code == "database.migration" => {
            *recoverable
                || details
                    .as_deref()
                    .is_some_and(is_migration_conflict_message)
        }
        _ => false,
    }
}

fn is_migration_conflict_message(details: &str) -> bool {
    let lower = details.to_ascii_lowercase();
    lower.contains("was previously applied but has been modified")
        || lower.contains("versionmismatch")
        || lower.contains("migration version") && lower.contains("mismatch")
        || lower.contains("checksum") && lower.contains("migration")
}

async fn quarantine_database_files(
    database_file: &Path,
    backups_dir: &Path,
) -> Result<(), AppError> {
    tokio::fs::create_dir_all(backups_dir).await?;

    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let base_name = database_file
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("ai-switch.db");

    for path in database_sidecar_paths(database_file) {
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(base_name);
        let backup_name = format!("{file_name}.migration-conflict-{stamp}");
        let backup_path = backups_dir.join(backup_name);
        rename_with_retry(&path, &backup_path)
            .await
            .map_err(|err| AppError::Filesystem {
                code: "filesystem.migration_quarantine",
                message: "Could not quarantine the conflicting database file".to_string(),
                details: Some(format!(
                    "{} -> {}: {err}",
                    path.display(),
                    backup_path.display()
                )),
                recoverable: false,
            })?;
    }

    let note_path = backups_dir.join(format!("{base_name}.migration-conflict-{stamp}.txt"));
    let note = format!(
        "AI Switch quarantined a local database because SQLite migrations no longer matched.\n\
         Original database: {}\n\
         Timestamp: {}\n\
         Action: moved conflicting db files into backups and created a fresh database on next open.\n",
        database_file.display(),
        stamp
    );
    tokio::fs::write(&note_path, note).await?;
    Ok(())
}

fn database_sidecar_paths(database_file: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::with_capacity(3);
    paths.push(database_file.to_path_buf());
    paths.push(append_suffix(database_file, "-wal"));
    paths.push(append_suffix(database_file, "-shm"));
    paths
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(test)]
mod migration_checksum_manifest_tests {
    use super::MIGRATOR;
    use std::collections::BTreeMap;

    /// Pinned SHA-384 of every migration that has already shipped.
    const MANIFEST: &str = include_str!("migration_checksums.txt");

    fn manifest_entries() -> BTreeMap<String, String> {
        MANIFEST
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| {
                let (name, checksum) = line
                    .split_once(' ')
                    .unwrap_or_else(|| panic!("malformed manifest line: {line}"));
                (name.to_string(), checksum.to_ascii_lowercase())
            })
            .collect()
    }

    fn compiled_entries() -> BTreeMap<String, String> {
        MIGRATOR
            .iter()
            .map(|migration| {
                let name = format!(
                    "{}_{}{}",
                    migration.version,
                    migration.description.replace(' ', "_"),
                    migration.migration_type.suffix()
                );
                let checksum = migration
                    .checksum
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                (name, checksum)
            })
            .collect()
    }

    /// The 0.7.3 data-loss bug started as a whitespace-only reformat of two
    /// migrations. sqlx hashes migration files byte for byte, so that alone was
    /// enough to make every existing install fail its checksum check. This test
    /// is the tripwire: touching a migration that has shipped fails here, and
    /// the fix is always a new migration rather than an edit.
    #[test]
    fn shipped_migrations_keep_their_original_checksums() {
        let manifest = manifest_entries();
        let compiled = compiled_entries();

        let mut changed = Vec::new();
        for (name, expected) in &manifest {
            match compiled.get(name) {
                Some(actual) if actual == expected => {}
                Some(_) => changed.push(format!(
                    "{name}: contents changed (line endings count) — revert it and add a new migration"
                )),
                None => changed.push(format!("{name}: removed or renamed")),
            }
        }
        assert!(
            changed.is_empty(),
            "shipped migrations were modified:\n{}",
            changed.join("\n")
        );

        let unpinned: Vec<&String> = compiled
            .keys()
            .filter(|name| !manifest.contains_key(*name))
            .collect();
        assert!(
            unpinned.is_empty(),
            "new migrations are missing from migration_checksums.txt: {unpinned:?}"
        );
    }

    /// Every migration must be LF-only. A CRLF file hashes differently, which is
    /// exactly how 0.7.3 broke, and the difference is invisible in review.
    #[test]
    fn migrations_contain_no_carriage_returns() {
        let offenders: Vec<String> = MIGRATOR
            .iter()
            .filter(|migration| migration.sql.contains('\r'))
            .map(|migration| migration.version.to_string())
            .collect();
        assert!(
            offenders.is_empty(),
            "migrations must use LF line endings: {offenders:?}"
        );
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::{append_suffix, open_migrated_pool, rename_with_retry, run_migrations, MIGRATOR};
    use sha2::{Digest, Sha384};
    use sqlx::{Row, SqlitePool};
    use std::path::Path;
    use tempfile::tempdir;

    /// Rewrite the stored checksum for `version` to the SHA-384 of the same
    /// migration with CRLF line endings, reproducing what a checkout on a
    /// Windows machine (or the reverse normalization in 0.7.3) leaves behind.
    async fn store_crlf_checksum(pool: &SqlitePool, version: i64) {
        let migration = MIGRATOR
            .iter()
            .find(|migration| migration.version == version)
            .expect("migration exists");
        let crlf = migration.sql.replace("\r\n", "\n").replace('\n', "\r\n");
        let checksum = Sha384::digest(crlf.as_bytes()).to_vec();

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(checksum)
            .bind(version)
            .execute(pool)
            .await
            .expect("store crlf checksum");
    }

    async fn insert_account(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO route_credentials (id, platform, kind, display_name, created_at, updated_at)
             VALUES (?, 'claude', 'api', 'kept account', '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z')",
        )
        .bind(id)
        .execute(pool)
        .await
        .expect("insert account");
    }

    async fn account_count(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM route_credentials")
            .fetch_one(pool)
            .await
            .expect("account count")
    }

    /// Fold the WAL back into the main database before a test parks the file.
    ///
    /// A 0.7.3 quarantine predates WAL, so the artifact it parked was a single
    /// self-contained `.db`. SQLite does not reliably checkpoint the WAL by the
    /// time `SqlitePool::close` resolves — on Windows the `rename_with_retry`
    /// below happens to wait for the file handle, but on macOS the rename
    /// succeeds immediately and would park a database whose newest rows are
    /// still in the `-wal`. Checkpointing first makes the test platform-neutral.
    async fn checkpoint_wal(pool: &SqlitePool) {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(pool)
            .await
            .expect("checkpoint WAL before parking");
    }

    async fn quarantine_file_count(backups_dir: &Path) -> usize {
        // A missing directory is the strongest form of "nothing was
        // quarantined": only quarantine_database_files creates it.
        let Ok(mut entries) = tokio::fs::read_dir(backups_dir).await else {
            return 0;
        };
        let mut count = 0usize;
        while let Some(entry) = entries.next_entry().await.expect("backup entry") {
            if entry
                .file_name()
                .to_string_lossy()
                .contains("migration-conflict-")
            {
                count += 1;
            }
        }
        count
    }

    // The 0.7.3 regression: normalizing the migrations from CRLF to LF changed
    // every checksum, so an upgraded install hit VersionMismatch and had its
    // database quarantined — the account list came up empty.
    #[tokio::test]
    async fn line_ending_only_checksum_change_keeps_accounts_and_skips_quarantine() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("initial open");
        insert_account(&pool, "account-kept").await;
        for version in [202607130001, 202607220001, 202608200001] {
            store_crlf_checksum(&pool, version).await;
        }
        pool.close().await;

        let reopened = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("reopen after line ending normalization");

        assert_eq!(account_count(&reopened).await, 1);
        assert_eq!(quarantine_file_count(&backups_dir).await, 0);
        run_migrations(&reopened)
            .await
            .expect("migrations clean on the next start");
    }

    // Recovering the installs 0.7.3 already broke: the accounts are sitting in
    // backups/ next to an empty live database, and a start on the fixed build
    // has to pull them back.
    #[tokio::test]
    async fn quarantined_database_is_restored_over_an_empty_one() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");
        tokio::fs::create_dir_all(&backups_dir)
            .await
            .expect("backups dir");

        // Stand in for the 0.7.3 quarantine: a fully migrated database holding
        // the user's accounts, parked under backups/.
        let orphan = dir.path().join("orphan.db");
        let orphan_pool = open_migrated_pool(&orphan, &backups_dir)
            .await
            .expect("orphan open");
        insert_account(&orphan_pool, "account-quarantined").await;
        checkpoint_wal(&orphan_pool).await;
        orphan_pool.close().await;
        let quarantined = backups_dir.join("ai-switch.db.migration-conflict-20260901-193257");
        rename_with_retry(&orphan, &quarantined)
            .await
            .expect("park the quarantined database");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("open with an empty live database");

        assert_eq!(account_count(&pool).await, 1);
        let restored_id: String = sqlx::query_scalar("SELECT id FROM route_credentials")
            .fetch_one(&pool)
            .await
            .expect("restored account id");
        assert_eq!(restored_id, "account-quarantined");
        run_migrations(&pool)
            .await
            .expect("restored database is fully migrated");

        // The quarantine file is renamed, not deleted, and no longer qualifies
        // as a restore candidate.
        assert!(!quarantined.exists());
        assert!(append_suffix(&quarantined, ".restored").exists());

        // The database that was replaced is parked too. It was empty, but that
        // was this code's own verdict, so the bytes still have to be somewhere.
        let mut parked = Vec::new();
        let mut entries = tokio::fs::read_dir(&backups_dir).await.expect("backups");
        while let Some(entry) = entries.next_entry().await.expect("backup entry") {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains(".replaced-") {
                parked.push(name);
            }
        }
        assert!(
            parked.iter().any(|name| name.starts_with("ai-switch.db.")),
            "the replaced database should be parked, got {parked:?}"
        );
    }

    // Restoring must never overwrite accounts the user added after the
    // quarantine — at that point the empty-list symptom is already behind them.
    #[tokio::test]
    async fn quarantined_database_is_left_alone_when_the_live_one_has_accounts() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");
        tokio::fs::create_dir_all(&backups_dir)
            .await
            .expect("backups dir");

        let orphan = dir.path().join("orphan.db");
        let orphan_pool = open_migrated_pool(&orphan, &backups_dir)
            .await
            .expect("orphan open");
        insert_account(&orphan_pool, "account-quarantined").await;
        checkpoint_wal(&orphan_pool).await;
        orphan_pool.close().await;

        let seeded = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("first open");
        insert_account(&seeded, "account-added-after").await;
        seeded.close().await;

        // Only now does the quarantine file appear, so the restore decision is
        // made against a live database that already holds an account.
        let quarantined = backups_dir.join("ai-switch.db.migration-conflict-20260901-193257");
        rename_with_retry(&orphan, &quarantined)
            .await
            .expect("park the quarantined database");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("reopen");

        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM route_credentials")
            .fetch_all(&pool)
            .await
            .expect("account ids");
        assert_eq!(ids, vec!["account-added-after".to_string()]);
        assert!(quarantined.exists());
    }

    // A real content change to an applied migration is not repairable. Losing
    // the user's accounts to it is worse than refusing to start, so the
    // populated database must survive even though the app cannot open it.
    #[tokio::test]
    async fn unrepairable_checksum_change_preserves_a_populated_database() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("initial open");
        insert_account(&pool, "account-kept").await;
        sqlx::query("UPDATE _sqlx_migrations SET checksum = x'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE version = 202607130004")
            .execute(&pool)
            .await
            .expect("corrupt checksum");
        pool.close().await;

        let error = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect_err("must refuse to replace a populated database");
        assert!(
            matches!(
                error,
                crate::error::AppError::Database {
                    code: "database.migration_conflict_preserved",
                    ..
                }
            ),
            "unexpected error: {error:?}"
        );

        assert_eq!(quarantine_file_count(&backups_dir).await, 0);
        let survivor = super::create_pool(&database_file).await.expect("reopen");
        assert_eq!(account_count(&survivor).await, 1);
    }

    #[tokio::test]
    async fn open_migrated_pool_recovers_from_modified_migration_checksum() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");
        tokio::fs::create_dir_all(&backups_dir)
            .await
            .expect("backups dir");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("initial open");
        sqlx::query("UPDATE _sqlx_migrations SET checksum = x'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE version = 202607130004")
            .execute(&pool)
            .await
            .expect("corrupt checksum");
        pool.close().await;

        let recovered = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("recovered open");
        run_migrations(&recovered)
            .await
            .expect("migrations still apply after recovery");

        let row = sqlx::query(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'route_pool_members'",
        )
        .fetch_one(&recovered)
        .await
        .expect("table lookup");
        let count: i64 = row.get("count");
        assert_eq!(count, 1);

        let mut entries = tokio::fs::read_dir(&backups_dir)
            .await
            .expect("read backups");
        let mut backup_count = 0usize;
        while let Some(entry) = entries.next_entry().await.expect("backup entry") {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.contains("migration-conflict-") {
                backup_count += 1;
            }
        }
        assert!(
            backup_count >= 1,
            "expected quarantined database backup files"
        );
    }
    #[tokio::test]
    async fn seeded_dynamic_groups_do_not_make_a_fresh_database_look_occupied() {
        let pool = super::create_memory_pool().await.unwrap();
        super::run_migrations(&pool).await.unwrap();
        assert!(!super::has_user_data(&pool).await.unwrap());
        sqlx::query("UPDATE route_pool_groups SET is_internal=1 WHERE id='codex-default'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(super::has_user_data(&pool).await.unwrap());
    }

    // --- corruption recovery (issue #17) ---

    async fn journal_mode(pool: &SqlitePool) -> String {
        sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(pool)
            .await
            .expect("journal_mode")
    }

    async fn synchronous_setting(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("PRAGMA synchronous")
            .fetch_one(pool)
            .await
            .expect("synchronous")
    }

    async fn insert_usage_event(pool: &SqlitePool, id: &str, payload_bytes: usize) {
        let metadata = format!("{{\"preview\":\"{}\"}}", "x".repeat(payload_bytes));
        sqlx::query(
            "INSERT INTO usage_events (id, source_label, metric_type, amount, unit, metadata_json, created_at)
             VALUES (?, 'manual', 'request', 1, 'count', ?, '2026-10-02T00:00:00Z')",
        )
        .bind(id)
        .bind(metadata)
        .execute(pool)
        .await
        .expect("insert usage event");
    }

    // Overwrite one interior B-tree page with 0xFF. A checkpointed database is a
    // single self-contained file, so an invalid page type byte reliably makes
    // PRAGMA quick_check report a malformed image, while the earlier pages —
    // where the accounts live — stay readable. That mirrors issue #17, where the
    // crash corrupted usage_events but left the account tables intact.
    async fn corrupt_an_interior_page(database_file: &Path) {
        let mut bytes = tokio::fs::read(database_file).await.expect("read db");
        assert!(
            bytes.len() > 8192,
            "test database too small to corrupt meaningfully"
        );
        let page_size = 4096usize;
        // Corrupt a page three-quarters into the file: past the schema page and
        // the small account tables, squarely inside the usage_events data.
        let start = ((bytes.len() * 3 / 4) / page_size) * page_size;
        let start = start.max(page_size);
        let end = (start + page_size).min(bytes.len());
        for b in &mut bytes[start..end] {
            *b = 0xFF;
        }
        tokio::fs::write(database_file, &bytes)
            .await
            .expect("write corrupt db");
    }

    async fn corrupt_backup_count(backups_dir: &Path) -> usize {
        let Ok(mut entries) = tokio::fs::read_dir(backups_dir).await else {
            return 0;
        };
        let mut count = 0usize;
        while let Some(entry) = entries.next_entry().await.expect("backup entry") {
            if entry.file_name().to_string_lossy().contains(".corrupt-") {
                count += 1;
            }
        }
        count
    }

    #[tokio::test]
    async fn create_pool_enables_wal_with_normal_synchronous() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("open");

        // WAL mode is a persistent property of the database file; once set it is
        // reported on every connection.
        let mode = journal_mode(&pool).await;
        assert_eq!(mode.to_ascii_lowercase(), "wal");
        // synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA.
        assert_eq!(
            synchronous_setting(&pool).await,
            1,
            "WAL should pair with NORMAL"
        );
    }

    #[tokio::test]
    async fn quick_check_reports_ok_on_a_healthy_database() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");

        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("open");
        insert_account(&pool, "account-healthy").await;

        let result: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await
            .expect("quick_check");
        assert_eq!(result, "ok");
    }

    #[tokio::test]
    async fn salvage_database_copies_schema_data_and_migration_ledger() {
        let dir = tempdir().expect("tempdir");
        let source = dir.path().join("source.db");
        let staged = dir.path().join("staged.db");
        let backups_dir = dir.path().join("backups");

        let pool = open_migrated_pool(&source, &backups_dir)
            .await
            .expect("source open");
        insert_account(&pool, "account-salvaged").await;
        insert_usage_event(&pool, "event-1", 32).await;
        // Checkpoint so the main file holds every committed row before close.
        checkpoint_wal(&pool).await;
        pool.close().await;

        let report = super::salvage_database(&source, &staged)
            .await
            .expect("salvage");
        assert!(report.created > 0, "should recreate schema objects: {report:?}");
        assert!(report.copied > 0, "should copy tables: {report:?}");

        let salvaged = super::create_pool(&staged).await.expect("open staged");
        assert_eq!(account_count(&salvaged).await, 1);
        let events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usage_events")
            .fetch_one(&salvaged)
            .await
            .expect("usage count");
        assert_eq!(events, 1);
        // The migration ledger travelled with the salvage, so re-running
        // migrations is a no-op rather than a re-application.
        super::run_migrations(&salvaged)
            .await
            .expect("migrations are a no-op on the salvage");
    }

    #[tokio::test]
    async fn corrupt_database_is_salvaged_and_original_is_parked() {
        let dir = tempdir().expect("tempdir");
        let database_file = dir.path().join("ai-switch.db");
        let backups_dir = dir.path().join("backups");

        // One account (early pages) plus a batch of usage_events (later pages) so
        // the file spans enough pages to corrupt the events without touching the
        // account.
        let pool = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("initial open");
        insert_account(&pool, "account-to-keep").await;
        for i in 0..200 {
            insert_usage_event(&pool, &format!("event-{i}"), 512).await;
        }
        checkpoint_wal(&pool).await;
        pool.close().await;
        // Drop the WAL sidecars so quick_check reads only the corrupt main file.
        let _ = tokio::fs::remove_file(&append_suffix(&database_file, "-wal")).await;
        let _ = tokio::fs::remove_file(&append_suffix(&database_file, "-shm")).await;

        corrupt_an_interior_page(&database_file).await;

        // Sanity-check that the corruption is actually detectable; if it isn't,
        // the test below would pass for the wrong reason.
        let probe = super::create_pool(&database_file)
            .await
            .expect("corrupt db still opens");
        let probe_result = sqlx::query_scalar::<_, String>("PRAGMA quick_check")
            .fetch_all(&probe)
            .await;
        probe.close().await;
        // 表的数量改变后，同一损坏页可能让 SQLite 直接返回 SQLITE_CORRUPT，
        // 而不是返回含损坏描述的行；二者都证明损坏被检测到。其他错误仍失败。
        match probe_result {
            Ok(rows) => assert!(
                !rows.iter().any(|r| r.eq_ignore_ascii_case("ok")) || rows.len() != 1,
                "corruption should be detectable by quick_check, got {rows:?}"
            ),
            Err(sqlx::Error::Database(error)) => assert_eq!(error.code().as_deref(), Some("11")),
            Err(error) => panic!("unexpected quick_check failure: {error}"),
        }

        let recovered = open_migrated_pool(&database_file, &backups_dir)
            .await
            .expect("recovery should produce a usable database");

        assert_eq!(
            account_count(&recovered).await,
            1,
            "the account on the uncorrupted early pages should survive salvage"
        );
        assert!(
            corrupt_backup_count(&backups_dir).await >= 1,
            "the corrupt original should be parked under backups/"
        );
    }
}
