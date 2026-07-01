use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use std::sync::Arc;

use crate::db::{open, tasks};
use crate::services::pane_ipc::PaneEventDispatcher;
use crate::services::obsidian::obsidian_token;

pub const REFLECT_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReflectMessage {
    pub role: String,
    pub content: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ReflectRunRequest {
    pub task_id: String,
    pub project_root: String,
    pub session_id: String,
    pub generation_id: String,
    pub output_tokens: u64,
    pub messages: Vec<ReflectMessage>,
    pub credential: String,
    pub obsidian_credential: Option<String>,
}

#[derive(Debug, Clone)]
struct ReflectCompletion {
    status: String,
    promote_to_learned: bool,
    reflection_excerpt: String,
    grade_excerpt: String,
    rollout_entry: String,
    grade_decision: Option<String>,
    timed_out: bool,
}

pub fn estimate_output_tokens(chars: usize) -> u64 {
    (chars / 4).max(1000) as u64
}

pub fn reconstruct_transcript(msgs: &[ReflectMessage]) -> String {
    msgs.iter()
        .map(|m| {
            format!(
                "[{}] {}: {}",
                m.created_at.as_deref().unwrap_or(""),
                m.role.to_uppercase(),
                m.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub fn spawn_reflect_stream(
    events: Arc<dyn PaneEventDispatcher>,
    db_path: PathBuf,
    request: ReflectRunRequest,
) {
    thread::spawn(move || {
        if let Err(err) = run_reflect_flow(events, db_path, request) {
            eprintln!("harness reflect error: {err}");
        }
    });
}

fn run_reflect_flow(
    events: Arc<dyn PaneEventDispatcher>,
    db_path: PathBuf,
    request: ReflectRunRequest,
) -> Result<(), String> {
    events.dispatch(
        "harness:reflecting",
        serde_json::json!({ "taskId": request.task_id }),
    );

    let timed_out = match run_reflect_via_shell(&request) {
        Ok(done) => !done,
        Err(err) => {
            eprintln!("reflect shell error: {err}");
            true
        }
    };

    let result = if timed_out {
        handle_reflect_timeout_reports(&request.project_root)
    } else {
        read_reflect_reports(&request.project_root)
    };

    handle_reflect_completion(events.as_ref(), &db_path, &request.task_id, result)
}

fn run_reflect_via_shell(request: &ReflectRunRequest) -> Result<bool, String> {
    let tmp = std::env::temp_dir().join(format!("sispace-{}", request.task_id));
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let transcript = tmp.join("transcript.txt");
    std::fs::write(&transcript, reconstruct_transcript(&request.messages)).map_err(|e| e.to_string())?;

    let script_name = ["invoke", "-chain", ".sh"].concat();
    let script = PathBuf::from(&request.project_root)
        .join("scripts")
        .join(script_name);

    let mut child = Command::new("sh")
        .arg(&script)
        .arg(&request.project_root)
        .arg(&request.session_id)
        .arg(&request.generation_id)
        .arg(request.output_tokens.to_string())
        .arg(&transcript)
        .current_dir(&request.project_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    let timeout = Duration::from_secs(REFLECT_TIMEOUT_SECS);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let _ = std::fs::remove_dir_all(&tmp);
            return if status.success() {
                Ok(true)
            } else {
                Err(format!("reflect shell exited with {status}"))
            };
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_dir_all(&tmp);
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(400));
    }
}

fn handle_reflect_timeout_reports(_project_root: &str) -> ReflectCompletion {
    ReflectCompletion {
        status: "timeout".into(),
        promote_to_learned: false,
        reflection_excerpt: format!(
            "Reflection timed out after {} seconds. Marked reflected with timeout note.",
            REFLECT_TIMEOUT_SECS
        ),
        grade_excerpt: String::new(),
        rollout_entry: String::new(),
        grade_decision: None,
        timed_out: true,
    }
}

fn read_reflect_reports(project_root: &str) -> ReflectCompletion {
    let reports = PathBuf::from(project_root).join("harness").join("reports");
    let reflection = read_file(reports.join("latest-reflection.md"));
    let grade = read_file(reports.join("latest-grade.md"));
    let rollout = read_file(reports.join("rollout-log.md"));
    let grade_decision = grade
        .lines()
        .find_map(|line| line.strip_prefix("- Decision:").map(|s| s.trim().to_string()));
    let promote = matches!(
        grade_decision.as_deref(),
        Some("accept") | Some("accept with human review")
    );

    ReflectCompletion {
        status: "ok".into(),
        promote_to_learned: promote,
        reflection_excerpt: reflection.chars().take(4000).collect(),
        grade_excerpt: grade.chars().take(2000).collect(),
        rollout_entry: last_rollout_entry(&rollout),
        grade_decision,
        timed_out: false,
    }
}

fn read_file(path: PathBuf) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

fn last_rollout_entry(text: &str) -> String {
    let blocks: Vec<&str> = text.split("\n### ").collect();
    blocks
        .last()
        .map(|b| {
            if text.contains("\n### ") {
                format!("### {b}")
            } else {
                b.to_string()
            }
        })
        .unwrap_or_default()
}

fn handle_reflect_completion(
    events: &dyn PaneEventDispatcher,
    db_path: &PathBuf,
    task_id: &str,
    result: ReflectCompletion,
) -> Result<(), String> {
    if result.status == "duplicate" {
        let _ = with_db(db_path, |conn| {
            tasks::set_reflecting(conn, task_id, false).map_err(|e| e.to_string())
        });
        return Ok(());
    }

    with_db(db_path, |conn| {
        let current = tasks::get_task(conn, task_id).map_err(|e| e.to_string())?;
        if current.status == "complete" {
            tasks::system_transition(conn, task_id, "reflected").map_err(|e| e.to_string())?;
            tasks::set_reflection_locked(conn, task_id, true).map_err(|e| e.to_string())?;
            tasks::set_reflecting(conn, task_id, false).map_err(|e| e.to_string())?;
            if result.timed_out {
                tasks::merge_metadata_key(
                    conn,
                    task_id,
                    "reflection_timeout",
                    serde_json::json!(true),
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })?;

    events.dispatch(
        "harness:reflected",
        serde_json::json!({
            "taskId": task_id,
            "reflectionExcerpt": result.reflection_excerpt,
            "gradeExcerpt": result.grade_excerpt,
            "gradeDecision": result.grade_decision,
            "timedOut": result.timed_out,
        }),
    );

    if result.promote_to_learned && !result.timed_out {
        with_db(db_path, |conn| {
            let current = tasks::get_task(conn, task_id).map_err(|e| e.to_string())?;
            if current.status == "reflected" {
                tasks::system_transition(conn, task_id, "learned").map_err(|e| e.to_string())?;
            }
            Ok(())
        })?;

        events.dispatch(
            "harness:learned",
            serde_json::json!({
                "taskId": task_id,
                "rolloutEntry": result.rollout_entry,
            }),
        );
    }

    Ok(())
}

fn with_db<F, T>(db_path: &PathBuf, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let conn = open(db_path).map_err(|e| e.to_string())?;
    f(&conn)
}

pub fn build_reflect_request(
    task: &crate::models::task::Task,
    msgs: &[crate::db::messages::TaskMessage],
    credential: String,
) -> ReflectRunRequest {
    let project_root = task
        .project_root
        .clone()
        .unwrap_or_else(|| ".".to_string());
    let session_id = task
        .cursor_agent_id
        .clone()
        .unwrap_or_else(|| task.id.clone());
    let generation_id = format!("{}-{}", task.id, unix_secs());
    let chars: usize = msgs.iter().map(|m| m.content.len()).sum();

    ReflectRunRequest {
        task_id: task.id.clone(),
        project_root,
        session_id,
        generation_id,
        output_tokens: estimate_output_tokens(chars),
        messages: msgs
            .iter()
            .map(|m| ReflectMessage {
                role: m.role.clone(),
                content: m.content.clone(),
                created_at: Some(m.created_at.clone()),
            })
            .collect(),
        credential,
        obsidian_credential: obsidian_token(),
    }
}

fn unix_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_report_marks_timed_out() {
        let r = handle_reflect_timeout_reports("/tmp");
        assert!(r.timed_out);
        assert_eq!(r.status, "timeout");
        assert!(!r.promote_to_learned);
    }
}
