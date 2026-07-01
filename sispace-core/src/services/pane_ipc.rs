use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::Value;

use super::notify_hub;
use super::pane::PaneManager;

const MAX_LINE_BYTES: usize = 8192;

/// Dispatches pane / pipeline UI events to the host (Tauri webview, GTK4, or tests).
pub trait PaneEventDispatcher: Send + Sync {
    fn dispatch(&self, channel: &str, payload: Value);
}

/// Shared context for pane IPC listener threads.
#[derive(Clone)]
pub struct PaneIpcContext {
    pub events: Arc<dyn PaneEventDispatcher>,
    pub pane_manager: Arc<PaneManager>,
}

/// Build IPC context from app state and an event dispatcher (Tauri, GTK, tests).
pub fn pane_ipc_ctx(
    state: &crate::state::AppState,
    events: Arc<dyn PaneEventDispatcher>,
) -> PaneIpcContext {
    PaneIpcContext {
        events,
        pane_manager: Arc::clone(&state.pane_manager),
    }
}

#[derive(Default)]
pub struct NoopPaneEventDispatcher;

impl PaneEventDispatcher for NoopPaneEventDispatcher {
    fn dispatch(&self, _channel: &str, _payload: Value) {}
}

#[derive(Clone)]
pub struct PaneIpcHub {
    inner: Arc<Mutex<HashMap<String, PaneIpcWatch>>>,
}

struct PaneIpcWatch {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl PaneIpcHub {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_listener(&self, ctx: PaneIpcContext, pane_id: String, socket_path: PathBuf) {
        self.stop_listener(&pane_id);
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let pane_id_thread = pane_id.clone();
        let ctx_thread = ctx.clone();

        let handle = thread::spawn(move || {
            listen_loop(ctx_thread, pane_id_thread, socket_path, stop_flag);
        });

        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(
                pane_id,
                PaneIpcWatch {
                    stop,
                    thread: Some(handle),
                },
            );
        }
    }

    pub fn stop_listener(&self, pane_id: &str) {
        let watch = self.inner.lock().ok().and_then(|mut g| g.remove(pane_id));
        if let Some(w) = watch {
            w.stop.store(true, Ordering::SeqCst);
            if let Some(t) = w.thread {
                let _ = t.join();
            }
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self
            .inner
            .lock()
            .map(|g| g.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.stop_listener(&id);
        }
    }
}

fn listen_loop(
    ctx: PaneIpcContext,
    pane_id: String,
    socket_path: PathBuf,
    stop: Arc<AtomicBool>,
) {
    let _ = std::fs::remove_file(&socket_path);
    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            dispatch_error(
                &ctx.events,
                &pane_id,
                "bind_failed",
                format!("ipc bind failed: {e}"),
            );
            return;
        }
    };
    if let Err(e) = listener.set_nonblocking(true) {
        dispatch_error(
            &ctx.events,
            &pane_id,
            "ipc_setup",
            format!("ipc nonblocking: {e}"),
        );
        return;
    }

    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let ctx_conn = ctx.clone();
                let pane_conn = pane_id.clone();
                thread::spawn(move || {
                    read_connection(ctx_conn, pane_conn, BufReader::new(stream));
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
    let _ = std::fs::remove_file(&socket_path);
}

fn read_connection(
    ctx: PaneIpcContext,
    pane_id: String,
    reader: BufReader<std::os::unix::net::UnixStream>,
) {
    for line in reader.lines() {
        match line {
            Ok(raw) => {
                if let Some(event) = parse_ndjson_line(&pane_id, &raw) {
                    forward_event(&ctx, &pane_id, event);
                }
            }
            Err(_) => break,
        }
    }
}

#[derive(Debug)]
struct ParsedPaneEvent {
    event_type: String,
    session_id: Option<String>,
    task_id: Option<String>,
    timestamp: Option<String>,
    payload: Value,
}

fn parse_ndjson_line(pane_id: &str, raw: &str) -> Option<ParsedPaneEvent> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() > MAX_LINE_BYTES {
        return None;
    }
    let mut value: Value = serde_json::from_str(trimmed).ok()?;
    truncate_large_payload(&mut value);
    let event_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let session_id = value
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let task_id = value.get("taskId").and_then(|v| v.as_str()).map(str::to_string);
    let timestamp = value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let payload = value
        .get("payload")
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));
    if value.get("paneId").is_none() {
        if let Value::Object(ref mut map) = value {
            map.insert(
                "paneId".to_string(),
                Value::String(pane_id.to_string()),
            );
        }
    }
    Some(ParsedPaneEvent {
        event_type,
        session_id,
        task_id,
        timestamp,
        payload,
    })
}

fn truncate_large_payload(value: &mut Value) {
    if let Some(payload) = value.get_mut("payload") {
        if let Some(result) = payload.get_mut("result") {
            if let Some(s) = result.as_str() {
                if s.len() > 2048 {
                    *result = Value::String(format!("{}…[truncated]", &s[..2048]));
                }
            }
        }
    }
}

fn forward_event(ctx: &PaneIpcContext, pane_id: &str, event: ParsedPaneEvent) {
    let channel = pane_event_channel(&event.event_type);
    let body = serde_json::json!({
        "paneId": pane_id,
        "type": event.event_type,
        "sessionId": event.session_id,
        "taskId": event.task_id,
        "timestamp": event.timestamp,
        "payload": event.payload,
    });
    ctx.events.dispatch(channel, body);

    ctx.pane_manager.apply_ipc_event(
        ctx,
        pane_id,
        &event.event_type,
        &event.payload,
    );

    if event.event_type == "agent_complete" {
        let title = ctx
            .pane_manager
            .get(pane_id)
            .map(|p| p.title)
            .unwrap_or_else(|| pane_id.to_string());
        let summary = event
            .payload
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        notify_hub::notify_agent_complete(ctx.events.as_ref(), pane_id, &title, summary);
    }
}

pub fn pane_event_channel(event_type: &str) -> &'static str {
    match event_type {
        "session_start" => "pane:session-start",
        "step_start" => "pane:step-start",
        "step_done" => "pane:step-done",
        "agent_complete" => "pane:agent-complete",
        "agent_turn" => "pane:agent-turn",
        "cost_update" => "pane:cost-update",
        "goal_status" => "pane:goal-status",
        "reflection_started" => "pane:reflection-started",
        "reflection_done" => "pane:reflection-done",
        "error" => "pane:error",
        "session_end" => "pane:session-end",
        _ => "pane:ipc-event",
    }
}

fn dispatch_error(events: &Arc<dyn PaneEventDispatcher>, pane_id: &str, code: &str, message: String) {
    events.dispatch(
        "pane:error",
        serde_json::json!({
            "paneId": pane_id,
            "payload": { "message": message, "code": code },
        }),
    );
}

pub fn ctrl_socket_path(event_socket: &Path) -> PathBuf {
    let s = event_socket.to_string_lossy();
    if s.ends_with(".sock") {
        PathBuf::from(format!("{}.ctrl.sock", &s[..s.len() - 5]))
    } else {
        PathBuf::from(format!("{s}.ctrl.sock"))
    }
}

/// Inject orchestrator prompt into a cursorsi pane (control socket).
pub fn send_inject(event_socket: &Path, text: &str) -> Result<(), String> {
    let ctrl = ctrl_socket_path(event_socket);
    let mut stream =
        UnixStream::connect(&ctrl).map_err(|e| format!("control socket connect failed: {e}"))?;
    let line = serde_json::json!({ "op": "inject_prompt", "text": text }).to_string() + "\n";
    stream
        .write_all(line.as_bytes())
        .map_err(|e| format!("control socket write failed: {e}"))?;
    Ok(())
}

pub fn emit_session_end(
    events: &dyn PaneEventDispatcher,
    pane_id: &str,
    reason: &str,
    session_id: Option<&str>,
) {
    events.dispatch(
        "pane:session-end",
        serde_json::json!({
            "paneId": pane_id,
            "type": "session_end",
            "sessionId": session_id,
            "timestamp": chrono_lite_iso(),
            "payload": { "reason": reason },
        }),
    );
}

fn chrono_lite_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_session_start_line() {
        let raw = r#"{"type":"session_start","sessionId":"s1","timestamp":"2026-01-01T00:00:00Z","payload":{"model":"composer-2.5"}}"#;
        let ev = parse_ndjson_line("pane_abc", raw).unwrap();
        assert_eq!(ev.event_type, "session_start");
        assert_eq!(ev.session_id.as_deref(), Some("s1"));
    }

    #[test]
    fn parse_agent_turn() {
        let raw = r#"{"type":"agent_turn","sessionId":"s1","payload":{"role":"user","text":"hi"}}"#;
        let ev = parse_ndjson_line("pane_x", raw).unwrap();
        assert_eq!(ev.event_type, "agent_turn");
    }

    #[test]
    fn rejects_oversize_line() {
        let raw = "x".repeat(MAX_LINE_BYTES + 1);
        assert!(parse_ndjson_line("p", &raw).is_none());
    }

    #[test]
    fn pane_event_channel_maps_agent_complete() {
        assert_eq!(pane_event_channel("agent_complete"), "pane:agent-complete");
    }
}
