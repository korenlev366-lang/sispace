use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::blocking::Client;
use rusqlite::Connection;
use serde_json::Value;
use std::sync::Arc;

use crate::services::pane_ipc::PaneEventDispatcher;

use crate::db::{messages, open, tasks};
use crate::models::task::{normalize_model_id, normalize_subagent_model_id, DEFAULT_MODEL_ID};
use crate::services::git::detect_git_remote;
use crate::services::node_host::resolve_port;
use crate::state::{
    emit_pipeline_queue_updated, register_active_pipeline,
    unregister_active_pipeline, AppState,
};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct PipelineRunRequest {
    pub task_id: String,
    pub title: String,
    pub task_type: String,
    pub parent_goal: String,
    pub project_root: String,
    pub obsidian_note_path: Option<String>,
    pub model: String,
    pub subagent_model: String,
    pub runtime: String,
    pub repo_url: Option<String>,
    pub token: String,
}

fn cursor_token() -> Result<String, String> {
    std::env::var("CURSOR_API_KEY").map_err(|_| "CURSOR_API_KEY is not set".to_string())
}

/// Start a pipeline immediately (caller must have acquired a concurrency slot).
pub fn launch_pipeline(
    events: Arc<dyn PaneEventDispatcher>,
    state: Arc<AppState>,
    task_id: String,
    goal: Option<String>,
    model: Option<String>,
    subagent_model: Option<String>,
    runtime: Option<String>,
    clear_messages: Option<bool>,
) -> Result<(), String> {
    let token = cursor_token()?;
    register_active_pipeline(&state.active_pipelines, &task_id)?;

    let goal_text = goal.unwrap_or_default();
    let (task, db_path) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut task = tasks::get_task(&conn, &task_id).map_err(|e| e.to_string())?;

        if task.status == "todo" {
            task = tasks::transition_task(&conn, &task_id, "in_progress")
                .map_err(|e| e.to_string())?;
        }

        let model_val = model
            .clone()
            .unwrap_or_else(|| normalize_model_id(task.model_id.as_deref()));
        let subagent_model_val = subagent_model.clone().unwrap_or_else(|| {
            normalize_subagent_model_id(task.subagent_model_id.as_deref())
        });
        let runtime_val = runtime.clone().unwrap_or_else(|| task.runtime.clone());

        conn.execute(
            "UPDATE tasks SET model_id = ?1, subagent_model_id = ?2, runtime = ?3, updated_at = datetime('now') WHERE id = ?4",
            rusqlite::params![model_val, subagent_model_val, runtime_val, task_id],
        )
        .map_err(|e| e.to_string())?;

        if clear_messages.unwrap_or(true) {
            messages::clear_messages(&conn, &task_id).map_err(|e| e.to_string())?;
        }

        task.model_id = Some(model_val);
        task.subagent_model_id = Some(subagent_model_val);
        task.runtime = runtime_val;
        (task, PathBuf::from(&state.db_path))
    };

    let parent_goal = if goal_text.trim().is_empty() {
        task.title.clone()
    } else {
        goal_text
    };

    let request = build_pipeline_request(
        &task,
        &parent_goal,
        model,
        subagent_model,
        runtime,
        token,
    );
    spawn_pipeline_stream(events, state, db_path, request);
    Ok(())
}

/// Dequeue and start pipelines while capacity remains.
///
/// Lock ordering: `active_pipelines` → `pipeline_queue` (never reverse).
/// This matches `spawn_pipeline_stream`'s thread (unregister → drain) to
/// prevent ABBA deadlock.
pub fn drain_pipeline_queue(state: Arc<AppState>, events: Arc<dyn PaneEventDispatcher>) {
    loop {
        // Lock active_pipelines FIRST (global ordering: active_pipelines > pipeline_queue).
        let mut active_guard = match state.active_pipelines.lock() {
            Ok(g) => g,
            Err(_) => break,
        };
        if active_guard.len() >= state.max_concurrent_pipelines {
            break;
        }

        // Now lock pipeline_queue (second in ordering).
        let mut queue_guard = match state.pipeline_queue.lock() {
            Ok(g) => g,
            Err(_) => break,
        };

        let Some(item) = queue_guard.pop_front() else {
            break;
        };

        // Register while holding both locks — atomic check-and-register.
        if active_guard.contains(&item.task_id) {
            eprintln!("drain queue: task {} already active, skipping", item.task_id);
            continue;
        }
        active_guard.insert(item.task_id.clone());

        // Release locks before launching (launch_pipeline takes state.db lock,
        // which has no ordering constraint with active/pipeline locks).
        drop(queue_guard);
        drop(active_guard);

        let task_id = item.task_id.clone();
        if let Err(err) = launch_pipeline(
            Arc::clone(&events),
            Arc::clone(&state),
            item.task_id,
            item.goal,
            item.model,
            item.subagent_model,
            item.runtime,
            item.clear_messages,
        ) {
            eprintln!("dequeued pipeline start failed: {err}");
            // Unregister on launch failure so capacity slot is freed.
            unregister_active_pipeline(&state.active_pipelines, &task_id);
            continue; // try next item in queue
        }
    }

    emit_pipeline_queue_updated(events.as_ref(), state.as_ref());
}

pub fn spawn_pipeline_stream(
    events: Arc<dyn PaneEventDispatcher>,
    state: Arc<AppState>,
    db_path: PathBuf,
    request: PipelineRunRequest,
) {
    let task_id = request.task_id.clone();
    std::thread::spawn(move || {
        if let Err(err) = run_pipeline_stream(events.as_ref(), db_path, request) {
            eprintln!("pipeline stream error: {err}");
        }

        unregister_active_pipeline(&state.active_pipelines, &task_id);
        drain_pipeline_queue(Arc::clone(&state), Arc::clone(&events));

        // Always notify UI — normal completion may have emitted from pipeline_done, but
        // duplicates are harmless; abnormal/hung streams often skipped that path.
        events.dispatch(
            "agent-pipeline-finished",
            serde_json::json!({ "taskId": task_id }),
        );
    });
}

/// Sidecar died or was restarted; in-flight HTTP streams are dead. Clear slots so UI and agent_start recover.
pub fn abort_active_pipelines(state: Arc<AppState>, events: Arc<dyn PaneEventDispatcher>) {
    let task_ids = crate::state::drain_active_pipelines(&state.active_pipelines);
    for task_id in task_ids {
        events.dispatch(
            "agent-pipeline-finished",
            serde_json::json!({ "taskId": task_id }),
        );
    }
    drain_pipeline_queue(Arc::clone(&state), Arc::clone(&events));
    emit_pipeline_queue_updated(events.as_ref(), state.as_ref());
}

fn run_pipeline_stream(
    events: &dyn PaneEventDispatcher,
    db_path: PathBuf,
    request: PipelineRunRequest,
) -> Result<bool, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:{}/pipeline/run", resolve_port());
    let body = serde_json::json!({
        "taskId": request.task_id,
        "title": request.title,
        "taskType": request.task_type,
        "parentGoal": request.parent_goal,
        "projectRoot": request.project_root,
        "obsidianNotePath": request.obsidian_note_path,
        "model": request.model,
        "subagentModel": request.subagent_model,
        "runtime": request.runtime,
        "repoUrl": request.repo_url,
        "token": request.token,
    });

    let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    let response = client
        .post(url)
        .header("Accept", "text/event-stream")
        .header("Content-Type", "application/json")
        .body(body_str)
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("pipeline request failed: {}", response.status()));
    }

    let reader = BufReader::new(response);
    let mut finished_normally = false;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if !line.starts_with("data: ") {
            continue;
        }
        let payload: Value =
            serde_json::from_str(line.trim_start_matches("data: ").trim()).map_err(|e| e.to_string())?;

        let event_type = payload
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        if event_type == "pipeline_done" || event_type == "pipeline_error" {
            finished_normally = true;
        }

        if let Err(err) = handle_pipeline_event(events, &db_path, &request.task_id, &payload) {
            eprintln!("pipeline event handler error ({event_type}): {err}");
        }

        if should_emit_to_ui(&payload) {
            events.dispatch("agent-pipeline", slim_pipeline_ui_event(&payload));
        }
    }

    Ok(finished_normally)
}

/// Matches lib/pipeline-truncate.mjs PIPELINE_MESSAGE_MAX (SSE + DB cap).
const MAX_MESSAGE_CHARS: usize = 20_000;

fn truncate_for_db(text: &str) -> String {
    if text.len() <= MAX_MESSAGE_CHARS {
        return text.to_string();
    }
    let mut end = MAX_MESSAGE_CHARS;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n\n…(truncated, {} chars total)…",
        &text[..end],
        text.len()
    )
}

/// DB-only SSE events are not forwarded to the webview (avoids huge payloads).
fn should_emit_to_ui(payload: &Value) -> bool {
    payload
        .get("type")
        .and_then(|v| v.as_str())
        .map(|t| t != "step_content")
        .unwrap_or(true)
}

fn slim_pipeline_ui_event(payload: &Value) -> Value {
    let mut slim = payload.clone();
    if let Some(obj) = slim.as_object_mut() {
        obj.remove("result");
        obj.remove("steps");
    }
    slim
}

fn with_db<F, T>(db_path: &Path, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let conn = open(db_path).map_err(|e| e.to_string())?;
    f(&conn)
}

fn handle_pipeline_event(
    events: &dyn PaneEventDispatcher,
    db_path: &Path,
    task_id: &str,
    payload: &Value,
) -> Result<(), String> {
    let event_type = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    with_db(db_path, |conn| {
        match event_type {
            "pipeline_start" => {
                let sequence = payload
                    .get("sequence")
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                messages::insert_message(
                    conn,
                    task_id,
                    "system",
                    &format!("Pipeline started: {sequence}"),
                    None,
                )
                .map_err(|e| e.to_string())?;
            }
            "step_start" => {
                let agent = payload.get("agent").and_then(|v| v.as_str()).unwrap_or("?");
                let index = payload.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                let total = payload.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
                messages::insert_message(
                    conn,
                    task_id,
                    "system",
                    &format!("Step {}/{}: {agent} running", index + 1, total),
                    None,
                )
                .map_err(|e| e.to_string())?;
            }
            "step_content" => {
                let agent = payload.get("agent").and_then(|v| v.as_str()).unwrap_or("?");
                let result = payload
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let run_id = payload.get("runId").and_then(|v| v.as_str());
                let body = truncate_for_db(&format!("### {agent}\n\n{result}"));
                messages::insert_message(conn, task_id, "assistant", &body, run_id)
                    .map_err(|e| e.to_string())?;
            }
            "step_done" => {
                // Legacy sidecar builds include result on step_done; step_content is canonical.
                if let Some(result) = payload.get("result").and_then(|v| v.as_str()) {
                    if !result.is_empty() {
                        let agent = payload.get("agent").and_then(|v| v.as_str()).unwrap_or("?");
                        let run_id = payload.get("runId").and_then(|v| v.as_str());
                        let body = truncate_for_db(&format!("### {agent}\n\n{result}"));
                        let exists = messages::assistant_message_exists(
                            conn, task_id, run_id, &body,
                        )
                        .map_err(|e| e.to_string())?;
                        if !exists {
                            messages::insert_message(conn, task_id, "assistant", &body, run_id)
                                .map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            "pipeline_done" => {
                let status = payload
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("ok");
                messages::insert_message(
                    conn,
                    task_id,
                    "system",
                    &format!("Pipeline finished: {status}"),
                    None,
                )
                .map_err(|e| e.to_string())?;
                let _ = tasks::transition_task(conn, task_id, "in_review");
                events.dispatch(
                    "agent-pipeline-finished",
                    serde_json::json!({ "taskId": task_id }),
                );
            }
            "pipeline_queued" => {
                let position = payload
                    .get("queuePosition")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                messages::insert_message(
                    conn,
                    task_id,
                    "system",
                    &format!("Pipeline queued at position {position}"),
                    None,
                )
                .map_err(|e| e.to_string())?;
            }
            "pipeline_error" => {
                let err = payload
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                messages::insert_message(
                    conn,
                    task_id,
                    "system",
                    &format!("Pipeline error: {err}"),
                    None,
                )
                .map_err(|e| e.to_string())?;
                events.dispatch(
                    "agent-pipeline-finished",
                    serde_json::json!({ "taskId": task_id }),
                );
            }
            _ => {}
        }
        Ok(())
    })
}

/// Map task types to default model IDs. Centralized to avoid hardcoded model strings
/// outside of models/task.rs.
fn default_model_for_task_type(task_type: &str) -> &str {
    match task_type {
        "bug" | "feature" => DEFAULT_MODEL_ID,
        "docs" | _ => DEFAULT_MODEL_ID,
    }
}

pub fn resolve_model(default: &str, override_model: Option<&str>, task_type: &str) -> String {
    if let Some(m) = override_model.filter(|s| !s.is_empty()) {
        return normalize_model_id(Some(m));
    }
    let model = default_model_for_task_type(task_type);
    if model == DEFAULT_MODEL_ID {
        default.to_string()
    } else {
        model.to_string()
    }
}

pub fn build_pipeline_request(
    task: &crate::models::task::Task,
    goal: &str,
    model: Option<String>,
    subagent_model: Option<String>,
    runtime: Option<String>,
    token: String,
) -> PipelineRunRequest {
    let project_root = task
        .project_root
        .clone()
        .unwrap_or_else(|| ".".to_string());
    let project_path = Path::new(&project_root);
    let runtime_val = runtime.unwrap_or_else(|| task.runtime.clone());
    let repo_url = if runtime_val == "cloud" {
        detect_git_remote(project_path)
    } else {
        None
    };

    let orchestrator_model = if let Some(m) = model.filter(|s| !s.is_empty()) {
        normalize_model_id(Some(&m))
    } else if let Some(ref mid) = task.model_id {
        normalize_model_id(Some(mid))
    } else {
        resolve_model(DEFAULT_MODEL_ID, None, &task.task_type)
    };

    let subagent_model_val = if let Some(m) = subagent_model.filter(|s| !s.is_empty()) {
        normalize_subagent_model_id(Some(&m))
    } else if let Some(ref mid) = task.subagent_model_id {
        normalize_subagent_model_id(Some(mid))
    } else {
        orchestrator_model.clone()
    };

    PipelineRunRequest {
        task_id: task.id.clone(),
        title: task.title.clone(),
        task_type: task.task_type.clone(),
        parent_goal: goal.to_string(),
        project_root,
        obsidian_note_path: task.obsidian_note_path.clone(),
        model: orchestrator_model,
        subagent_model: subagent_model_val,
        runtime: runtime_val,
        repo_url,
        token,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::task::{Task, DEFAULT_MODEL_ID};

    fn sample_task(task_type: &str, model_id: Option<&str>) -> Task {
        Task {
            id: "t_test".into(),
            title: "Test task".into(),
            status: "in_progress".into(),
            task_type: task_type.into(),
            project_root: Some("/tmp".into()),
            obsidian_note_path: None,
            model_id: model_id.map(|s| s.to_string()),
            subagent_model_id: None,
            runtime: "local".into(),
            cursor_agent_id: None,
            reflection_locked: false,
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-01".into(),
            completed_at: None,
            reflected_at: None,
            learned_at: None,
            related_task_ids: vec![],
            reflecting: false,
            parent_id: None,
            swarm_root_id: None,
            swarm_role: None,
            swarm_gate_locked: false,
        }
    }

    #[test]
    fn resolve_model_uses_override_when_present() {
        assert_eq!(
            resolve_model(DEFAULT_MODEL_ID, Some("composer-2.5-fast"), "feature"),
            "composer-2.5-fast"
        );
    }

    #[test]
    fn resolve_model_normalizes_legacy_override() {
        assert_eq!(
            resolve_model(DEFAULT_MODEL_ID, Some("composer-2"), "feature"),
            "composer-2"
        );
    }

    #[test]
    fn resolve_model_feature_defaults_without_override() {
        assert_eq!(resolve_model(DEFAULT_MODEL_ID, None, "feature"), "composer-2.5");
    }

    #[test]
    fn resolve_model_docs_defaults_without_override() {
        assert_eq!(resolve_model(DEFAULT_MODEL_ID, None, "docs"), DEFAULT_MODEL_ID);
    }

    #[test]
    fn resolve_model_custom_falls_back_to_default_param() {
        assert_eq!(resolve_model(DEFAULT_MODEL_ID, None, "custom"), DEFAULT_MODEL_ID);
    }

    #[test]
    fn build_pipeline_request_uses_persisted_model_when_override_none() {
        let task = sample_task("feature", Some("composer-2.5-fast"));
        let req = build_pipeline_request(&task, "goal", None, None, None, "tok".into());
        assert_eq!(req.model, "composer-2.5-fast");
        assert_eq!(req.subagent_model, "composer-2.5-fast");
    }

    #[test]
    fn build_pipeline_request_prefers_explicit_override() {
        let task = sample_task("feature", Some("composer-2.5-fast"));
        let req = build_pipeline_request(
            &task,
            "goal",
            Some("composer-2.5".into()),
            Some("composer-2.5-fast".into()),
            None,
            "tok".into(),
        );
        assert_eq!(req.model, "composer-2.5");
        assert_eq!(req.subagent_model, "composer-2.5-fast");
    }

    #[test]
    fn build_pipeline_request_splits_persisted_orchestrator_and_subagent_models() {
        let mut task = sample_task("feature", Some("composer-2.5-fast"));
        task.subagent_model_id = Some("composer-2.5".into());
        let req = build_pipeline_request(&task, "goal", None, None, None, "tok".into());
        assert_eq!(req.model, "composer-2.5-fast");
        assert_eq!(req.subagent_model, "composer-2.5");
    }

    #[test]
    fn build_pipeline_request_task_type_default_when_no_persisted_model() {
        let task = sample_task("feature", None);
        let req = build_pipeline_request(&task, "goal", None, None, None, "tok".into());
        assert_eq!(req.model, "composer-2.5");
    }

    #[test]
    fn build_pipeline_request_uses_task_runtime_when_override_none() {
        let mut task = sample_task("feature", Some("composer-2.5"));
        task.runtime = "cloud".into();
        let req = build_pipeline_request(&task, "goal", None, None, None, "tok".into());
        assert_eq!(req.runtime, "cloud");
    }
}
