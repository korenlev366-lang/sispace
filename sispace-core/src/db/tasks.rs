use rusqlite::{params, Connection, Result as SqlResult};

use crate::models::task::{can_user_transition, Task, TaskCreateInput};

pub fn new_task_id(conn: &Connection) -> SqlResult<String> {
    // Use UUID v4 for collision-free task IDs. Retry on the vanishingly rare
    // DB-level collision (SQL PRIMARY KEY).
    for _ in 0..3 {
        let id = format!("t_{}", uuid::Uuid::new_v4().to_string().replace('-', "_"));
        let exists: i32 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Ok(id);
        }
    }
    Err(rusqlite::Error::ToSqlConversionFailure(
        "failed to generate unique task id after 3 UUID attempts".into(),
    ))
}

fn parse_related_task_ids(metadata_json: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(metadata_json)
        .ok()
        .and_then(|v| v.get("related_task_ids").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn parse_metadata_flag(metadata_json: &str, key: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(metadata_json)
        .ok()
        .and_then(|v| v.get(key).and_then(|b| b.as_bool()))
        .unwrap_or(false)
}

fn parse_metadata_string(metadata_json: &str, key: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(metadata_json)
        .ok()
        .and_then(|v| v.get(key).and_then(|s| s.as_str()).map(|s| s.to_string()))
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let metadata_json: String = row.get(18)?;
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        task_type: row.get(3)?,
        project_root: row.get(4)?,
        obsidian_note_path: row.get(5)?,
        model_id: row.get(6)?,
        subagent_model_id: row.get(7)?,
        runtime: row.get(8)?,
        cursor_agent_id: row.get(9)?,
        reflection_locked: row.get::<_, i32>(10)? != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        completed_at: row.get(13)?,
        reflected_at: row.get(14)?,
        learned_at: row.get(15)?,
        parent_id: row.get(16)?,
        swarm_root_id: row.get(17)?,
        related_task_ids: parse_related_task_ids(&metadata_json),
        reflecting: parse_metadata_flag(&metadata_json, "reflecting"),
        swarm_role: parse_metadata_string(&metadata_json, "swarm_role"),
        swarm_gate_locked: parse_metadata_flag(&metadata_json, "swarm_gate_locked"),
    })
}

const TASK_SELECT: &str = "SELECT id, title, status, task_type, project_root, obsidian_note_path, model_id, subagent_model_id, runtime, cursor_agent_id, reflection_locked, created_at, updated_at, completed_at, reflected_at, learned_at, parent_id, swarm_root_id, metadata_json FROM tasks";

pub fn set_related_task_ids(
    conn: &Connection,
    task_id: &str,
    related: &[String],
) -> SqlResult<()> {
    merge_metadata(conn, task_id, |meta| {
        meta["related_task_ids"] = serde_json::json!(related);
    })
}

pub fn set_swarm_gate_locked(conn: &Connection, task_id: &str, locked: bool) -> SqlResult<()> {
    merge_metadata(conn, task_id, |meta| {
        meta["swarm_gate_locked"] = serde_json::json!(locked);
    })
}

pub fn set_reflecting(conn: &Connection, task_id: &str, reflecting: bool) -> SqlResult<()> {
    merge_metadata(conn, task_id, |meta| {
        meta["reflecting"] = serde_json::json!(reflecting);
    })
}

pub fn merge_metadata_key(
    conn: &Connection,
    task_id: &str,
    key: &str,
    value: serde_json::Value,
) -> SqlResult<()> {
    merge_metadata(conn, task_id, |meta| {
        meta[key] = value;
    })
}

pub fn set_reflection_locked(conn: &Connection, task_id: &str, locked: bool) -> SqlResult<()> {
    conn.execute(
        "UPDATE tasks SET reflection_locked = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![if locked { 1 } else { 0 }, task_id],
    )?;
    Ok(())
}

fn merge_metadata<F>(conn: &Connection, task_id: &str, mutator: F) -> SqlResult<()>
where
    F: FnOnce(&mut serde_json::Value),
{
    let current: String = conn.query_row(
        "SELECT metadata_json FROM tasks WHERE id = ?1",
        params![task_id],
        |row| row.get(0),
    )?;
    let mut meta: serde_json::Value =
        serde_json::from_str(&current).unwrap_or_else(|_| serde_json::json!({}));
    mutator(&mut meta);
    conn.execute(
        "UPDATE tasks SET metadata_json = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![meta.to_string(), task_id],
    )?;
    Ok(())
}

pub fn system_transition(conn: &Connection, id: &str, new_status: &str) -> SqlResult<Task> {
    let current = get_task(conn, id)?;
    if !crate::models::task::can_system_transition(&current.status, new_status) {
        return Err(rusqlite::Error::ToSqlConversionFailure(
            format!("invalid system transition: {} -> {}", current.status, new_status).into(),
        ));
    }

    match new_status {
        "complete" => {
            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ?2",
                params![new_status, id],
            )?;
        }
        "reflected" => {
            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = datetime('now'), reflected_at = datetime('now') WHERE id = ?2",
                params![new_status, id],
            )?;
            set_reflecting(conn, id, false)?;
        }
        "learned" => {
            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = datetime('now'), learned_at = datetime('now') WHERE id = ?2",
                params![new_status, id],
            )?;
        }
        _ => {
            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![new_status, id],
            )?;
        }
    }

    record_event(
        conn,
        id,
        "status_change",
        &serde_json::json!({ "from": current.status, "to": new_status, "system": true }).to_string(),
    )?;
    get_task(conn, id)
}

pub fn insert_swarm_child(
    conn: &Connection,
    id: &str,
    input: &TaskCreateInput,
    obsidian_note_path: &str,
    parent_id: &str,
    swarm_root_id: &str,
    swarm_role: &str,
    gate_locked: bool,
) -> SqlResult<Task> {
    let task = insert_task(conn, id, input, obsidian_note_path)?;
    conn.execute(
        "UPDATE tasks SET parent_id = ?1, swarm_root_id = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![parent_id, swarm_root_id, id],
    )?;
    merge_metadata(conn, id, |meta| {
        meta["swarm_role"] = serde_json::json!(swarm_role);
        meta["swarm_gate_locked"] = serde_json::json!(gate_locked);
    })?;
    Ok(task)
}

pub fn insert_task(
    conn: &Connection,
    id: &str,
    input: &TaskCreateInput,
    obsidian_note_path: &str,
) -> SqlResult<Task> {
    let task_type = if crate::models::task::TASK_TYPES.contains(&input.task_type.as_str()) {
        input.task_type.as_str()
    } else {
        "custom"
    };

    conn.execute(
        "INSERT INTO tasks (id, title, status, task_type, project_root, obsidian_note_path)
         VALUES (?1, ?2, 'todo', ?3, ?4, ?5)",
        params![
            id,
            input.title.trim(),
            task_type,
            input.project_root,
            obsidian_note_path,
        ],
    )?;

    record_event(conn, id, "created", "{}")?;
    get_task(conn, id)
}

pub fn list_tasks(conn: &Connection, project_root: Option<&str>) -> SqlResult<Vec<Task>> {
    let mut tasks = Vec::new();
    if let Some(root) = project_root.filter(|s| !s.is_empty()) {
        let mut stmt = conn.prepare(&format!("{TASK_SELECT} WHERE project_root = ?1 ORDER BY updated_at DESC"))?;
        let rows = stmt.query_map(params![root], map_task)?;
        for row in rows {
            tasks.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(&format!("{TASK_SELECT} ORDER BY updated_at DESC"))?;
        let rows = stmt.query_map([], map_task)?;
        for row in rows {
            tasks.push(row?);
        }
    }
    Ok(tasks)
}

pub fn list_project_roots(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT project_root FROM tasks WHERE project_root IS NOT NULL ORDER BY project_root")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}

pub fn update_run_prefs(
    conn: &Connection,
    id: &str,
    model_id: Option<&str>,
    subagent_model_id: Option<&str>,
    runtime: Option<&str>,
) -> SqlResult<Task> {
    if model_id.is_none() && subagent_model_id.is_none() && runtime.is_none() {
        return Err(rusqlite::Error::ToSqlConversionFailure(
            "at least one of model_id, subagent_model_id, or runtime is required".into(),
        ));
    }

    if let Some(m) = model_id {
        let normalized = crate::models::task::normalize_model_id(Some(m));
        if !crate::models::task::VALID_MODEL_IDS.contains(&normalized.as_str()) {
            return Err(rusqlite::Error::ToSqlConversionFailure(
                format!("invalid model_id: {m}").into(),
            ));
        }
        conn.execute(
            "UPDATE tasks SET model_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![normalized, id],
        )?;
    }

    if let Some(m) = subagent_model_id {
        let normalized = crate::models::task::normalize_subagent_model_id(Some(m));
        if !crate::models::task::VALID_MODEL_IDS.contains(&normalized.as_str()) {
            return Err(rusqlite::Error::ToSqlConversionFailure(
                format!("invalid subagent_model_id: {m}").into(),
            ));
        }
        conn.execute(
            "UPDATE tasks SET subagent_model_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![normalized, id],
        )?;
    }

    if let Some(r) = runtime {
        if !crate::models::task::is_valid_runtime(r) {
            return Err(rusqlite::Error::ToSqlConversionFailure(
                format!("invalid runtime: {r}").into(),
            ));
        }
        conn.execute(
            "UPDATE tasks SET runtime = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![r, id],
        )?;
    }

    get_task(conn, id)
}

pub fn get_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    conn.query_row(
        &format!("{TASK_SELECT} WHERE id = ?1"),
        params![id],
        map_task,
    )
}

pub fn delete_task(conn: &Connection, id: &str) -> SqlResult<()> {
    let changes = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    if changes == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn transition_task(conn: &Connection, id: &str, new_status: &str) -> SqlResult<Task> {
    let current = get_task(conn, id)?;
    if !can_user_transition(&current.status, new_status) {
        return Err(rusqlite::Error::ToSqlConversionFailure(
            format!(
                "invalid transition: {} -> {} (complete requires task_approve_complete)",
                current.status, new_status
            )
            .into(),
        ));
    }

    if let Some(msg) = crate::db::swarm::swarm_blocks_transition(conn, id, new_status)? {
        return Err(rusqlite::Error::ToSqlConversionFailure(msg.into()));
    }

    conn.execute(
        "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![new_status, id],
    )?;

    let payload = serde_json::json!({
        "from": current.status,
        "to": new_status,
    });
    record_event(conn, id, "status_change", &payload.to_string())?;
    get_task(conn, id)
}

pub fn record_event(
    conn: &Connection,
    task_id: &str,
    event_type: &str,
    payload_json: &str,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO task_events (task_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
        params![task_id, event_type, payload_json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::task::TaskCreateInput;

    #[test]
    fn system_transition_complete_to_reflected() {
        let path = std::env::temp_dir().join(format!("sispace-sys-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();
        let input = TaskCreateInput {
            title: "Reflect flow".into(),
            task_type: "feature".into(),
            project_root: Some("/tmp".into()),
            goal: None,
        };
        let id = new_task_id(&conn).unwrap();
        insert_task(&conn, &id, &input, "SISpace/tasks/x.md").unwrap();
        transition_task(&conn, &id, "in_progress").unwrap();
        transition_task(&conn, &id, "in_review").unwrap();
        system_transition(&conn, &id, "complete").unwrap();
        let reflected = system_transition(&conn, &id, "reflected").unwrap();
        assert_eq!(reflected.status, "reflected");
        let learned = system_transition(&conn, &id, "learned").unwrap();
        assert_eq!(learned.status, "learned");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn transition_rejects_locked_status() {
        let path = std::env::temp_dir().join(format!("sispace-tr-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();
        let input = TaskCreateInput {
            title: "Test".into(),
            task_type: "feature".into(),
            project_root: Some("/tmp".into()),
            goal: None,
        };
        let id = new_task_id(&conn).unwrap();
        insert_task(&conn, &id, &input, "SISpace/tasks/test.md").unwrap();
        assert!(transition_task(&conn, &id, "learned").is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn related_tasks_link_on_similar_title() {
        let path = std::env::temp_dir().join(format!("sispace-rel-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();

        let first = TaskCreateInput {
            title: "Add auth middleware".into(),
            task_type: "feature".into(),
            project_root: Some("/tmp".into()),
            goal: Some("JWT validation".into()),
        };
        let id1 = new_task_id(&conn).unwrap();
        insert_task(&conn, &id1, &first, "SISpace/tasks/a.md").unwrap();
        crate::db::messages::insert_message(
            &conn,
            &id1,
            "assistant",
            "Implemented auth middleware with JWT",
            None,
        )
        .unwrap();

        let related = crate::db::search::find_related_task_ids(
            &conn,
            "t_new000",
            "Add auth middleware v2",
            "JWT tokens",
            5,
        )
        .unwrap();
        assert!(related.contains(&id1));

        let _ = std::fs::remove_file(path);
    }

    fn open_test_db(suffix: &str) -> (Connection, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "sispace-run-prefs-{}-{}",
            suffix,
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();
        (conn, path)
    }

    fn seed_task(conn: &Connection) -> String {
        let input = TaskCreateInput {
            title: "Run prefs".into(),
            task_type: "feature".into(),
            project_root: Some("/tmp".into()),
            goal: None,
        };
        let id = new_task_id(conn).unwrap();
        insert_task(conn, &id, &input, "SISpace/tasks/x.md").unwrap();
        id
    }

    #[test]
    fn update_run_prefs_sets_model_id() {
        let (conn, path) = open_test_db("model");
        let id = seed_task(&conn);
        let task = update_run_prefs(&conn, &id, Some("composer-2.5"), None, None).unwrap();
        assert_eq!(task.model_id.as_deref(), Some("composer-2.5"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_run_prefs_normalizes_legacy_composer_2() {
        let (conn, path) = open_test_db("legacy");
        let id = seed_task(&conn);
        let task = update_run_prefs(&conn, &id, Some("composer-2"), None, None).unwrap();
        assert_eq!(task.model_id.as_deref(), Some("composer-2"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_run_prefs_normalizes_unknown_model_to_default() {
        let (conn, path) = open_test_db("unknown-model");
        let id = seed_task(&conn);
        let task = update_run_prefs(&conn, &id, Some("gpt-4"), None, None).unwrap();
        assert_eq!(task.model_id.as_deref(), Some("composer-2.5"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_run_prefs_requires_at_least_one_field() {
        let (conn, path) = open_test_db("empty");
        let id = seed_task(&conn);
        assert!(update_run_prefs(&conn, &id, None, None, None).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_run_prefs_sets_runtime_only() {
        let (conn, path) = open_test_db("runtime");
        let id = seed_task(&conn);
        let task = update_run_prefs(&conn, &id, None, None, Some("cloud")).unwrap();
        assert_eq!(task.runtime, "cloud");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_run_prefs_sets_subagent_model_id() {
        let (conn, path) = open_test_db("subagent-model");
        let id = seed_task(&conn);
        let task =
            update_run_prefs(&conn, &id, None, Some("composer-2.5-fast"), None).unwrap();
        assert_eq!(task.subagent_model_id.as_deref(), Some("composer-2.5-fast"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_run_prefs_rejects_invalid_runtime() {
        let (conn, path) = open_test_db("invalid-runtime");
        let id = seed_task(&conn);
        assert!(update_run_prefs(&conn, &id, None, None, Some("edge")).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delete_task_removes_task_and_cascades_messages() {
        let (conn, path) = open_test_db("delete");
        let id = seed_task(&conn);
        crate::db::messages::insert_message(&conn, &id, "assistant", "hello", None).unwrap();
        delete_task(&conn, &id).unwrap();
        assert!(get_task(&conn, &id).is_err());
        let msgs = crate::db::messages::list_messages(&conn, &id).unwrap();
        assert!(msgs.is_empty());
        let _ = std::fs::remove_file(path);
    }
}
