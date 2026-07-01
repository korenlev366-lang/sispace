use rusqlite::{params, Connection, Result as SqlResult};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskMessage {
    pub id: i64,
    pub task_id: String,
    pub run_id: Option<String>,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

pub fn insert_message(
    conn: &Connection,
    task_id: &str,
    role: &str,
    content: &str,
    run_id: Option<&str>,
) -> SqlResult<i64> {
    conn.execute(
        "INSERT INTO task_messages (task_id, role, content, run_id) VALUES (?1, ?2, ?3, ?4)",
        params![task_id, role, content, run_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_messages(conn: &Connection, task_id: &str) -> SqlResult<Vec<TaskMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, run_id, role, content, created_at
         FROM task_messages WHERE task_id = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(TaskMessage {
            id: row.get(0)?,
            task_id: row.get(1)?,
            run_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn messages_around(
    conn: &Connection,
    task_id: &str,
    center_id: i64,
    window: i64,
) -> SqlResult<Vec<TaskMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, run_id, role, content, created_at
         FROM task_messages
         WHERE task_id = ?1 AND id BETWEEN ?2 AND ?3
         ORDER BY id ASC",
    )?;
    let lo = center_id.saturating_sub(window);
    let hi = center_id + window;
    let rows = stmt.query_map(params![task_id, lo, hi], |row| {
        Ok(TaskMessage {
            id: row.get(0)?,
            task_id: row.get(1)?,
            run_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn clear_messages(conn: &Connection, task_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM task_messages WHERE task_id = ?1", params![task_id])?;
    Ok(())
}

/// True when an assistant row already stores the same body for this task/run.
pub fn assistant_message_exists(
    conn: &Connection,
    task_id: &str,
    run_id: Option<&str>,
    content: &str,
) -> SqlResult<bool> {
    let count: i64 = match run_id {
        Some(rid) => conn.query_row(
            "SELECT COUNT(*) FROM task_messages
             WHERE task_id = ?1 AND role = 'assistant' AND run_id = ?2 AND content = ?3",
            params![task_id, rid, content],
            |row| row.get(0),
        )?,
        None => conn.query_row(
            "SELECT COUNT(*) FROM task_messages
             WHERE task_id = ?1 AND role = 'assistant' AND run_id IS NULL AND content = ?2",
            params![task_id, content],
            |row| row.get(0),
        )?,
    };
    Ok(count > 0)
}

/// Minutes since last message or task update (whichever is more recent).
pub fn idle_minutes(conn: &Connection, task_id: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT CAST(
            (julianday('now') - julianday(
                COALESCE(
                    (SELECT MAX(created_at) FROM task_messages WHERE task_id = ?1),
                    (SELECT updated_at FROM tasks WHERE id = ?1)
                )
            )) * 24 * 60 AS INTEGER)",
        params![task_id],
        |row| row.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assistant_message_exists_detects_duplicate() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE task_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                run_id TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        let body = "### researcher-agent\n\nreport";
        insert_message(&conn, "t1", "assistant", body, Some("run-1")).unwrap();
        assert!(assistant_message_exists(&conn, "t1", Some("run-1"), body).unwrap());
        assert!(!assistant_message_exists(&conn, "t1", Some("run-2"), body).unwrap());
    }

    #[test]
    fn idle_minutes_uses_last_message() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (id TEXT PRIMARY KEY, updated_at TEXT);
             CREATE TABLE task_messages (id INTEGER PRIMARY KEY, task_id TEXT, created_at TEXT);
             INSERT INTO tasks VALUES ('t1', datetime('now', '-60 minutes'));
             INSERT INTO task_messages VALUES (1, 't1', datetime('now', '-45 minutes'));",
        )
        .unwrap();
        let idle = idle_minutes(&conn, "t1").unwrap();
        assert!(idle >= 44 && idle <= 46);
    }
}
