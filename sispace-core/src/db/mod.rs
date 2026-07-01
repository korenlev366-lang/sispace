//! SQLite schema and migrations for SISpace task state.

pub mod tasks;
pub mod messages;
pub mod search;
pub mod swarm;
pub mod terminals;
pub mod presets;
pub mod cost;

use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;

pub const SCHEMA_VERSION: i32 = 5;

pub fn open(db_path: &Path) -> SqlResult<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> SqlResult<()> {
    let version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (1)", [])?;
    }

    if version < 2 {
        conn.execute_batch(include_str!("migrations/002_swarm_meta.sql"))?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (2)", [])?;
    }

    if version < 3 {
        conn.execute_batch(include_str!("migrations/003_subagent_model.sql"))?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (3)", [])?;
    }

    if version < 4 {
        conn.execute_batch(include_str!("migrations/004_workspace_presets.sql"))?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (4)", [])?;
    }

    if version < 5 {
        conn.execute_batch(include_str!("migrations/005_swarm_worktree.sql"))?;
        conn.execute("INSERT INTO schema_migrations (version) VALUES (5)", [])?;
    }

    Ok(())
}

pub fn db_path() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("sispace")
        .join("tasks.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_creates_tasks_table() {
        let path = std::env::temp_dir().join(format!("sispace-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = open(&path).expect("open test db");
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .expect("count tasks table");
        assert_eq!(count, 1);
        let _ = std::fs::remove_file(path);
    }
}
