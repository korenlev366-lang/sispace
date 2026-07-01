use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::db::{swarm, tasks};
use crate::services::node_host::resolve_port;
use crate::services::pane_ipc::PaneEventDispatcher;
use crate::state::AppState;

pub struct SwarmDispatchRequest {
    pub root_id: String,
    pub project_root: String,
    pub title: String,
    pub task_type: String,
    pub obsidian_note_path: String,
    pub token: String,
    pub workers: Vec<SwarmWorkerDispatch>,
}

pub struct SwarmWorkerDispatch {
    pub task_id: String,
    pub prompt: String,
}

pub fn spawn_swarm_dispatch(
    events: Arc<dyn PaneEventDispatcher>,
    state: Arc<AppState>,
    db_path: PathBuf,
    req: SwarmDispatchRequest,
) {
    thread::spawn(move || {
        if let Err(err) = run_swarm_sse(events.as_ref(), &state, &db_path, &req) {
            events.dispatch(
                "swarm:error",
                serde_json::json!({ "rootId": req.root_id, "error": err }),
            );
        }
    });
}

fn run_swarm_sse(
    events: &dyn PaneEventDispatcher,
    state: &AppState,
    db_path: &PathBuf,
    req: &SwarmDispatchRequest,
) -> Result<(), String> {
    let body = serde_json::json!({
        "rootId": req.root_id,
        "projectRoot": req.project_root,
        "title": req.title,
        "taskType": req.task_type,
        "obsidianNotePath": req.obsidian_note_path,
        "token": req.token,
        "workers": req.workers.iter().map(|w| serde_json::json!({
            "taskId": w.task_id,
            "prompt": w.prompt,
        })).collect::<Vec<_>>(),
    });

    let payload = body.to_string();
    let port = resolve_port();
    let request = format!(
        "POST /swarm/create HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len(),
    );

    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}"))
        .map_err(|e| format!("sidecar connect failed: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3600)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .ok();
    std::io::Write::write_all(&mut stream, request.as_bytes())
        .map_err(|e| format!("sidecar write failed: {e}"))?;

    let reader = BufReader::new(stream);
    let mut in_body = false;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if !in_body {
            if line.is_empty() {
                in_body = true;
            }
            continue;
        }
        let data = line.strip_prefix("data: ").unwrap_or(&line);
        if data.is_empty() {
            continue;
        }
        let event: serde_json::Value =
            serde_json::from_str(data).map_err(|e| format!("invalid sse json: {e}"))?;
        handle_swarm_event(events, state, db_path, req.root_id.as_str(), &event)?;
    }
    Ok(())
}

fn handle_swarm_event(
    events: &dyn PaneEventDispatcher,
    state: &AppState,
    db_path: &PathBuf,
    root_id: &str,
    event: &serde_json::Value,
) -> Result<(), String> {
    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "worker_done" => {
            let task_id = event
                .get("taskId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !task_id.is_empty() {
                let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
                let current = tasks::get_task(&conn, task_id).map_err(|e| e.to_string())?;
                if current.status == "todo" || current.status == "in_progress" {
                    let _ = tasks::transition_task(&conn, task_id, "in_progress");
                    let _ = tasks::transition_task(&conn, task_id, "in_review");
                }
            }
            emit_swarm_gates(events, state, db_path, root_id)?;
        }
        "swarm_dispatch_done" => {
            emit_swarm_gates(events, state, db_path, root_id)?;
        }
        _ => {}
    }
    Ok(())
}

pub fn emit_swarm_gates(
    events: &dyn PaneEventDispatcher,
    state: &AppState,
    db_path: &PathBuf,
    root_id: &str,
) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let (workers_new, verifier_new, _, _) =
        swarm::refresh_gates(&conn, root_id).map_err(|e| e.to_string())?;

    if workers_new {
        events.dispatch(
            "swarm:worker-complete",
            serde_json::json!({ "rootId": root_id }),
        );
        events.dispatch(
            "swarm:verifier-ready",
            serde_json::json!({ "rootId": root_id }),
        );
    }
    if verifier_new {
        events.dispatch(
            "swarm:synthesizer-ready",
            serde_json::json!({ "rootId": root_id }),
        );
    }

    crate::services::swarm_workspace::apply_gate_unlocks(events, state, root_id);
    Ok(())
}

pub fn on_task_status_changed(
    events: &dyn PaneEventDispatcher,
    state: &AppState,
    db_path: &PathBuf,
    task_id: &str,
) {
    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return;
    };
    let Ok(Some(root_id)) = swarm::swarm_root_for_task(&conn, task_id) else {
        return;
    };
    let _ = emit_swarm_gates(events, state, db_path, &root_id);
}
