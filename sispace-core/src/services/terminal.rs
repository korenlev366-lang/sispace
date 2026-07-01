use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use std::sync::Arc;

use crate::db::terminals::{self, TerminalRecord};
use crate::services::pane_ipc::PaneEventDispatcher;
use crate::services::config::load_terminal_config;

pub fn resolve_terminal_binary(cfg: &crate::services::config::TerminalConfig) -> String {
    if let Ok(name) = std::env::var(&cfg.detect_env) {
        let t = name.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    if let Ok(term) = std::env::var("TERMINAL") {
        let t = term.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    cfg.fallback.clone()
}

pub fn build_terminal_cmd(cfg: &crate::services::config::TerminalConfig, cwd: &Path) -> (String, Vec<String>) {
    let bin = resolve_terminal_binary(cfg);
    let cwd_str = cwd.to_string_lossy().into_owned();
    let args: Vec<String> = cfg
        .args
        .iter()
        .map(|a| a.replace("{cwd}", &cwd_str))
        .collect();
    (bin, args)
}

pub fn spawn_terminal(
    events: Arc<dyn PaneEventDispatcher>,
    db_path: std::path::PathBuf,
    task_id: Option<String>,
    cwd: &Path,
) -> Result<TerminalRecord, String> {
    let cfg = if cwd.join("config").join("sispace.yaml").exists() {
        load_terminal_config(cwd)
    } else {
        load_terminal_config(cwd)
    };

    let (bin, args) = build_terminal_cmd(&cfg, &cwd);
    let cmd_display = format!("{bin} {}", args.join(" "));

    let mut command = Command::new(&bin);
    command.args(&args).current_dir(&cwd).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|e| format!("failed to spawn terminal {bin}: {e}"))?;

    let pid = child.id() as i32;
    let cwd_str = cwd.to_string_lossy().into_owned();

    let record = {
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        terminals::insert_terminal(&conn, task_id.as_deref(), pid, &cmd_display, &cwd_str)
            .map_err(|e| e.to_string())?
    };

    events.dispatch(
        "terminal:started",
        serde_json::json!({
            "terminalId": record.id,
            "taskId": record.task_id,
            "pid": record.pid,
            "cwd": record.cwd,
        }),
    );

    let events_clone = Arc::clone(&events);
    thread::spawn(move || {
        monitor_terminal_pid(events_clone, db_path, pid);
    });

    Ok(record)
}

fn monitor_terminal_pid(events: Arc<dyn PaneEventDispatcher>, db_path: std::path::PathBuf, pid: i32) {
    loop {
        thread::sleep(Duration::from_secs(2));
        let alive = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !alive {
            let _ = rusqlite::Connection::open(&db_path).and_then(|conn| {
                terminals::mark_stopped(&conn, pid, "stopped").map_err(|e| {
                    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        e.to_string(),
                    )))
                })
            });
            events.dispatch(
                "terminal:exited",
                serde_json::json!({ "pid": pid, "status": "stopped" }),
            );
            break;
        }
    }
}

pub fn focus_terminal_pid(pid: i32) -> Result<(), String> {
    let target = format!("pid:{}", pid);
    let output = Command::new("hyprctl")
        .args(["dispatch", "focuswindow", &target])
        .output()
        .map_err(|e| format!("hyprctl failed: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("hyprctl focuswindow failed: {}", stderr.trim()))
    }
}
