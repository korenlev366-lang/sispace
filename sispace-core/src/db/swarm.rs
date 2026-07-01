use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde::{Deserialize, Serialize};

use crate::db::tasks::{get_task, insert_swarm_child, new_task_id, record_event};
use crate::models::task::TaskCreateInput;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmNode {
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub role: String,
    pub gate_locked: bool,
    #[serde(default)]
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmGraph {
    pub root_id: String,
    pub root_title: String,
    pub root_status: String,
    pub workers: Vec<SwarmNode>,
    pub verifier: Option<SwarmNode>,
    pub synthesizer: Option<SwarmNode>,
    pub workers_complete: bool,
    pub verifier_passed: bool,
}

#[derive(Debug, Clone)]
pub struct SwarmMetaRow {
    pub swarm_root_id: String,
    pub worker_ids: Vec<String>,
    pub verifier_id: Option<String>,
    pub synthesizer_id: Option<String>,
    pub workers_complete: bool,
    pub verifier_passed: bool,
}

pub fn get_swarm_meta(conn: &Connection, root_id: &str) -> SqlResult<Option<SwarmMetaRow>> {
    let mut stmt = conn.prepare(
        "SELECT swarm_root_id, worker_ids_json, verifier_id, synthesizer_id, workers_complete, verifier_passed
         FROM swarm_meta WHERE swarm_root_id = ?1",
    )?;
    let mut rows = stmt.query_map(params![root_id], |row| {
        let workers_json: String = row.get(1)?;
        let worker_ids: Vec<String> = serde_json::from_str(&workers_json).unwrap_or_default();
        Ok(SwarmMetaRow {
            swarm_root_id: row.get(0)?,
            worker_ids,
            verifier_id: row.get(2)?,
            synthesizer_id: row.get(3)?,
            workers_complete: row.get::<_, i32>(4)? != 0,
            verifier_passed: row.get::<_, i32>(5)? != 0,
        })
    })?;
    Ok(rows.next().transpose()?)
}

pub fn insert_graph_row(
    conn: &Connection,
    swarm_root_id: &str,
    task_id: &str,
    role: &str,
    gate_on: &[String],
    worktree_path: Option<&str>,
) -> SqlResult<()> {
    let gate_json = serde_json::to_string(gate_on).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO swarm_graph (swarm_root_id, task_id, role, gate_on_task_ids, worktree_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![swarm_root_id, task_id, role, gate_json, worktree_path],
    )?;
    Ok(())
}

pub fn set_worktree_path(
    conn: &Connection,
    swarm_root_id: &str,
    task_id: &str,
    worktree_path: &str,
) -> SqlResult<()> {
    conn.execute(
        "UPDATE swarm_graph SET worktree_path = ?1 WHERE swarm_root_id = ?2 AND task_id = ?3",
        params![worktree_path, swarm_root_id, task_id],
    )?;
    Ok(())
}

pub fn worktree_path_for_task(
    conn: &Connection,
    swarm_root_id: &str,
    task_id: &str,
) -> SqlResult<Option<String>> {
    conn.query_row(
        "SELECT worktree_path FROM swarm_graph WHERE swarm_root_id = ?1 AND task_id = ?2",
        params![swarm_root_id, task_id],
        |row| row.get(0),
    )
    .optional()
}

pub fn upsert_swarm_meta(
    conn: &Connection,
    root_id: &str,
    worker_ids: &[String],
    verifier_id: &str,
    synthesizer_id: &str,
) -> SqlResult<()> {
    let workers_json = serde_json::to_string(worker_ids).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;
    conn.execute(
        "INSERT INTO swarm_meta (swarm_root_id, worker_ids_json, verifier_id, synthesizer_id)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(swarm_root_id) DO UPDATE SET
           worker_ids_json = excluded.worker_ids_json,
           verifier_id = excluded.verifier_id,
           synthesizer_id = excluded.synthesizer_id,
           updated_at = datetime('now')",
        params![root_id, workers_json, verifier_id, synthesizer_id],
    )?;
    Ok(())
}

pub fn set_workers_complete(conn: &Connection, root_id: &str, complete: bool) -> SqlResult<()> {
    conn.execute(
        "UPDATE swarm_meta SET workers_complete = ?1, updated_at = datetime('now') WHERE swarm_root_id = ?2",
        params![if complete { 1 } else { 0 }, root_id],
    )?;
    Ok(())
}

pub fn set_verifier_passed(conn: &Connection, root_id: &str, passed: bool) -> SqlResult<()> {
    conn.execute(
        "UPDATE swarm_meta SET verifier_passed = ?1, updated_at = datetime('now') WHERE swarm_root_id = ?2",
        params![if passed { 1 } else { 0 }, root_id],
    )?;
    Ok(())
}

fn set_task_gate_locked(conn: &Connection, task_id: &str, locked: bool) -> SqlResult<()> {
    crate::db::tasks::set_swarm_gate_locked(conn, task_id, locked)
}

pub fn swarm_exists_for_root(conn: &Connection, root_id: &str) -> SqlResult<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM swarm_meta WHERE swarm_root_id = ?1",
        params![root_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn node_gate_locked(role: &str, meta: &SwarmMetaRow) -> bool {
    match role {
        "verifier" => !meta.workers_complete,
        "synthesizer" => !meta.verifier_passed,
        _ => false,
    }
}

pub fn get_swarm_graph(conn: &Connection, root_id: &str) -> SqlResult<Option<SwarmGraph>> {
    let meta = match get_swarm_meta(conn, root_id)? {
        Some(m) => m,
        None => return Ok(None),
    };
    let root = get_task(conn, root_id)?;

    let mut workers = Vec::new();
    for wid in &meta.worker_ids {
        let t = get_task(conn, wid)?;
        let worktree_path: Option<String> = conn
            .query_row(
                "SELECT worktree_path FROM swarm_graph WHERE swarm_root_id = ?1 AND task_id = ?2",
                params![root_id, wid],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        workers.push(SwarmNode {
            task_id: t.id,
            title: t.title,
            status: t.status,
            role: "worker".to_string(),
            gate_locked: false,
            worktree_path,
        });
    }

    let verifier = meta.verifier_id.as_ref().map(|vid| {
        let t = get_task(conn, vid).ok();
        t.map(|t| SwarmNode {
            task_id: t.id.clone(),
            title: t.title,
            status: t.status,
            role: "verifier".to_string(),
            gate_locked: node_gate_locked("verifier", &meta),
            worktree_path: None,
        })
    }).flatten();

    let synthesizer = meta.synthesizer_id.as_ref().map(|sid| {
        let t = get_task(conn, sid).ok();
        t.map(|t| SwarmNode {
            task_id: t.id.clone(),
            title: t.title,
            status: t.status,
            role: "synthesizer".to_string(),
            gate_locked: node_gate_locked("synthesizer", &meta),
            worktree_path: None,
        })
    }).flatten();

    Ok(Some(SwarmGraph {
        root_id: root.id,
        root_title: root.title,
        root_status: root.status,
        workers,
        verifier,
        synthesizer,
        workers_complete: meta.workers_complete,
        verifier_passed: meta.verifier_passed,
    }))
}

pub fn list_swarm_root_ids(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT swarm_root_id FROM swarm_meta ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}

/// Returns swarm root id if task belongs to a swarm.
pub fn swarm_root_for_task(conn: &Connection, task_id: &str) -> SqlResult<Option<String>> {
    if let Some(meta) = get_swarm_meta(conn, task_id).ok().flatten() {
        return Ok(Some(meta.swarm_root_id));
    }
    let root: Option<String> = conn
        .query_row(
            "SELECT swarm_root_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .ok();
    Ok(root.filter(|s| !s.is_empty()))
}

pub fn role_for_task(conn: &Connection, swarm_root_id: &str, task_id: &str) -> SqlResult<Option<String>> {
    match conn.query_row(
        "SELECT role FROM swarm_graph WHERE swarm_root_id = ?1 AND task_id = ?2",
        params![swarm_root_id, task_id],
        |row| row.get(0),
    ) {
        Ok(role) => Ok(Some(role)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn create_swarm_graph(
    conn: &Connection,
    root_id: &str,
    root_title: &str,
    project_root: &str,
    obsidian_note_path: &str,
    worker_count: usize,
) -> SqlResult<(SwarmGraph, Vec<(String, String)>)> {
    let n = worker_count.max(3);
    let mut worker_ids = Vec::new();
    let mut worker_prompts = Vec::new();

    conn.execute(
        "UPDATE tasks SET task_type = 'swarm', updated_at = datetime('now') WHERE id = ?1",
        params![root_id],
    )?;
    insert_graph_row(conn, root_id, root_id, "root", &[], None)?;

    for i in 1..=n {
        let wid = new_task_id(conn)?;
        let title = format!("Worker {i}: {root_title}");
        let input = TaskCreateInput {
            title: title.clone(),
            task_type: "custom".to_string(),
            project_root: Some(project_root.to_string()),
            goal: Some(format!(
                "Swarm worker {i} for root task {root_id}. Read the root Obsidian note ## Blackboard section via MCP before work. Report findings back to the blackboard."
            )),
        };
        let note = format!("SISpace/tasks/{wid}.md");
        insert_swarm_child(conn, &wid, &input, &note, root_id, root_id, "worker", false)?;
        insert_graph_row(conn, root_id, &wid, "worker", &[], None)?;
        worker_ids.push(wid.clone());
        worker_prompts.push((
            wid,
            format!(
                "You are swarm worker {i} for \"{root_title}\" (root {root_id}).\n\
                 Read ## Blackboard from Obsidian note {obsidian_note_path}.\n\
                 Execute your slice of the work and summarize deliverables."
            ),
        ));
    }

    let verifier_id = new_task_id(conn)?;
    let verifier_input = TaskCreateInput {
        title: format!("Verifier: {root_title}"),
        task_type: "custom".to_string(),
        project_root: Some(project_root.to_string()),
        goal: Some("Verify all worker outputs against acceptance criteria.".to_string()),
    };
    insert_swarm_child(
        conn,
        &verifier_id,
        &verifier_input,
        &format!("SISpace/tasks/{verifier_id}.md"),
        root_id,
        root_id,
        "verifier",
        true,
    )?;
    let gate_on: Vec<String> = worker_ids.clone();
    insert_graph_row(conn, root_id, &verifier_id, "verifier", &gate_on, None)?;

    let synthesizer_id = new_task_id(conn)?;
    let synth_input = TaskCreateInput {
        title: format!("Synthesizer: {root_title}"),
        task_type: "custom".to_string(),
        project_root: Some(project_root.to_string()),
        goal: Some("Synthesize verifier-approved worker outputs into a single deliverable.".to_string()),
    };
    insert_swarm_child(
        conn,
        &synthesizer_id,
        &synth_input,
        &format!("SISpace/tasks/{synthesizer_id}.md"),
        root_id,
        root_id,
        "synthesizer",
        true,
    )?;
    insert_graph_row(conn, root_id, &synthesizer_id, "synthesizer", &[verifier_id.clone()], None)?;

    upsert_swarm_meta(conn, root_id, &worker_ids, &verifier_id, &synthesizer_id)?;
    record_event(
        conn,
        root_id,
        "swarm_created",
        &serde_json::json!({
            "worker_ids": worker_ids,
            "verifier_id": verifier_id,
            "synthesizer_id": synthesizer_id,
        })
        .to_string(),
    )?;

    let graph = get_swarm_graph(conn, root_id)?.expect("swarm graph just created");
    Ok((graph, worker_prompts))
}

pub fn all_workers_in_review(conn: &Connection, meta: &SwarmMetaRow) -> SqlResult<bool> {
    for wid in &meta.worker_ids {
        let t = get_task(conn, wid)?;
        if t.status != "in_review" && t.status != "complete" {
            return Ok(false);
        }
    }
    Ok(!meta.worker_ids.is_empty())
}

pub fn verifier_complete(conn: &Connection, meta: &SwarmMetaRow) -> SqlResult<bool> {
    let Some(vid) = meta.verifier_id.as_ref() else {
        return Ok(false);
    };
    let t = get_task(conn, vid)?;
    Ok(t.status == "complete")
}

pub fn refresh_gates(conn: &Connection, root_id: &str) -> SqlResult<(bool, bool, bool, bool)> {
    let Some(meta) = get_swarm_meta(conn, root_id)? else {
        return Ok((false, false, false, false));
    };

    let workers_done = all_workers_in_review(conn, &meta)?;
    let was_workers = meta.workers_complete;
    if workers_done && !was_workers {
        set_workers_complete(conn, root_id, true)?;
        if let Some(vid) = meta.verifier_id.as_ref() {
            let _ = set_task_gate_locked(conn, vid, false);
        }
    }

    let verifier_done = verifier_complete(conn, &meta)?;
    let was_verifier = meta.verifier_passed;
    if verifier_done && !was_verifier {
        set_verifier_passed(conn, root_id, true)?;
        if let Some(sid) = meta.synthesizer_id.as_ref() {
            let _ = set_task_gate_locked(conn, sid, false);
        }
    }

    Ok((
        workers_done && !was_workers,
        verifier_done && !was_verifier,
        workers_done,
        verifier_done,
    ))
}

pub fn swarm_blocks_transition(
    conn: &Connection,
    task_id: &str,
    new_status: &str,
) -> SqlResult<Option<String>> {
    let Some(root_id) = swarm_root_for_task(conn, task_id)? else {
        return Ok(None);
    };
    let meta = match get_swarm_meta(conn, &root_id)? {
        Some(m) => m,
        None => return Ok(None),
    };

    let role = role_for_task(conn, &root_id, task_id)?.unwrap_or_default();

    if role == "verifier" && new_status != "todo" {
        if !meta.workers_complete {
            return Ok(Some(
                "Verifier is locked until all workers reach in_review".to_string(),
            ));
        }
    }

    if role == "synthesizer" && new_status != "todo" {
        if !meta.verifier_passed {
            return Ok(Some(
                "Synthesizer is locked until verifier reaches complete".to_string(),
            ));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tasks::{insert_task, transition_task};
    use crate::models::task::TaskCreateInput;

    #[test]
    fn swarm_gate_unlocks_verifier_when_workers_review() {
        let path = std::env::temp_dir().join(format!("sispace-swarm-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();

        let root_input = TaskCreateInput {
            title: "Build auth".into(),
            task_type: "feature".into(),
            project_root: Some("/tmp".into()),
            goal: None,
        };
        let root_id = new_task_id(&conn).unwrap();
        insert_task(&conn, &root_id, &root_input, "SISpace/tasks/root.md").unwrap();

        let (graph, _) =
            create_swarm_graph(&conn, &root_id, "Build auth", "/tmp", "SISpace/tasks/root.md", 3)
                .unwrap();
        assert_eq!(graph.workers.len(), 3);
        assert!(graph.verifier.as_ref().unwrap().gate_locked);

        let verifier_id = graph.verifier.as_ref().unwrap().task_id.clone();
        assert!(swarm_blocks_transition(&conn, &verifier_id, "in_progress")
            .unwrap()
            .is_some());

        for w in &graph.workers {
            transition_task(&conn, &w.task_id, "in_progress").unwrap();
            transition_task(&conn, &w.task_id, "in_review").unwrap();
        }

        let (workers_new, _, _, _) = refresh_gates(&conn, &root_id).unwrap();
        assert!(workers_new);

        assert!(swarm_blocks_transition(&conn, &verifier_id, "in_progress")
            .unwrap()
            .is_none());

        let _ = std::fs::remove_file(path);
    }
}
