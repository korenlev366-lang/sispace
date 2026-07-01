use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalRecord {
    pub id: i64,
    pub task_id: Option<String>,
    pub pid: i32,
    pub cmd: String,
    pub cwd: String,
    pub status: String,
    pub started_at: String,
    pub stopped_at: Option<String>,
}

pub fn insert_terminal(
    conn: &Connection,
    task_id: Option<&str>,
    pid: i32,
    cmd: &str,
    cwd: &str,
) -> SqlResult<TerminalRecord> {
    conn.execute(
        "INSERT INTO terminals (task_id, pid, cmd, cwd, status) VALUES (?1, ?2, ?3, ?4, 'running')",
        params![task_id, pid, cmd, cwd],
    )?;
    let id = conn.last_insert_rowid();
    get_terminal(conn, id)
}

pub fn get_terminal(conn: &Connection, id: i64) -> SqlResult<TerminalRecord> {
    conn.query_row(
        "SELECT id, task_id, pid, cmd, cwd, status, started_at, stopped_at FROM terminals WHERE id = ?1",
        params![id],
        map_terminal,
    )
}

pub fn get_terminal_by_pid(conn: &Connection, pid: i32) -> SqlResult<Option<TerminalRecord>> {
    match conn.query_row(
        "SELECT id, task_id, pid, cmd, cwd, status, started_at, stopped_at FROM terminals WHERE pid = ?1",
        params![pid],
        map_terminal,
    ) {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn list_terminals_for_task(conn: &Connection, task_id: &str) -> SqlResult<Vec<TerminalRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, pid, cmd, cwd, status, started_at, stopped_at
         FROM terminals WHERE task_id = ?1 ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map(params![task_id], map_terminal)?;
    rows.collect()
}

pub fn list_running_pids(conn: &Connection) -> SqlResult<Vec<i32>> {
    let mut stmt = conn.prepare("SELECT pid FROM terminals WHERE status = 'running'")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}

pub fn mark_stopped(conn: &Connection, pid: i32, status: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE terminals SET status = ?1, stopped_at = datetime('now') WHERE pid = ?2",
        params![status, pid],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open;

    #[test]
    fn list_running_pids_returns_only_running() {
        let path = std::env::temp_dir().join(format!(
            "sispace-terminals-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_file(&path);
        let conn = open(&path).expect("open test db");
        insert_terminal(&conn, None, 1001, "kitty", "/tmp").expect("insert running");
        insert_terminal(&conn, None, 1002, "kitty", "/tmp").expect("insert running");
        mark_stopped(&conn, 1002, "stopped").expect("mark stopped");

        let pids = list_running_pids(&conn).expect("list");
        assert_eq!(pids, vec![1001]);
    }
}

fn map_terminal(row: &rusqlite::Row<'_>) -> rusqlite::Result<TerminalRecord> {
    Ok(TerminalRecord {
        id: row.get(0)?,
        task_id: row.get(1)?,
        pid: row.get(2)?,
        cmd: row.get(3)?,
        cwd: row.get(4)?,
        status: row.get(5)?,
        started_at: row.get(6)?,
        stopped_at: row.get(7)?,
    })
}
