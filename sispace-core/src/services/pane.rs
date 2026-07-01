use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::fd::RawFd;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::pane_ipc::{emit_session_end, PaneEventDispatcher, PaneIpcContext, PaneIpcHub};

pub const DEFAULT_MAX_RETRIES: u32 = 0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneSpawnConfig {
    pub title: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub skill_bundle: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub subagent_model_id: Option<String>,
    #[serde(default)]
    pub rows: u16,
    #[serde(default)]
    pub cols: u16,
    #[serde(default)]
    pub swarm_role: Option<String>,
    #[serde(default)]
    pub gate_locked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub command: String,
    pub event_socket: String,
    pub status: String,
    pub pid: Option<u32>,
    pub rows: u16,
    pub cols: u16,
    pub retry_count: u32,
    #[serde(default)]
    pub swarm_role: Option<String>,
    #[serde(default)]
    pub gate_locked: bool,
    #[serde(default = "default_agent_status")]
    pub agent_status: String,
    #[serde(default)]
    pub current_task: Option<String>,
    #[serde(default)]
    pub session_tokens: i64,
    #[serde(default)]
    pub task_id: Option<String>,
}

fn default_agent_status() -> String {
    "idle".to_string()
}

struct PaneRuntime {
    info: PaneInfo,
    spawn_config: PaneSpawnConfig,
    gate_locked: bool,
    /// When true, a background thread forwards PTY output as `pane-output` events (Tauri/xterm).
    /// When false, a VTE widget reads the master PTY fd directly (GTK4).
    bridge_output: bool,
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
}

#[derive(Clone)]
pub struct PaneManager {
    project_root: PathBuf,
    panes: Arc<Mutex<HashMap<String, PaneRuntime>>>,
    active_pane: Arc<Mutex<Option<String>>>,
    max_retries: u32,
    ipc_hub: Option<Arc<PaneIpcHub>>,
}

impl PaneManager {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
            panes: Arc::new(Mutex::new(HashMap::new())),
            active_pane: Arc::new(Mutex::new(None)),
            max_retries: DEFAULT_MAX_RETRIES,
            ipc_hub: None,
        }
    }

    pub fn with_ipc_hub(mut self, hub: Arc<PaneIpcHub>) -> Self {
        self.ipc_hub = Some(hub);
        self
    }

    pub fn with_max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn pane_sockets_dir() -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("sispace")
            .join("panes")
    }

    pub fn list(&self) -> Vec<PaneInfo> {
        self.panes
            .lock()
            .map(|guard| guard.values().map(|p| p.info.clone()).collect())
            .unwrap_or_default()
    }

    pub fn get(&self, pane_id: &str) -> Option<PaneInfo> {
        self.panes
            .lock()
            .ok()
            .and_then(|guard| guard.get(pane_id).map(|p| p.info.clone()))
    }

    pub fn spawn(&self, ctx: &PaneIpcContext, config: PaneSpawnConfig) -> Result<PaneInfo, String> {
        let pane_id = format!("pane_{}", Uuid::new_v4().simple());
        self.spawn_with_id(ctx, pane_id, config, 0, true)
    }

    /// Spawn a pane for native VTE display (no `pane-output` bridge thread).
    pub fn spawn_for_vte(
        &self,
        ctx: &PaneIpcContext,
        config: PaneSpawnConfig,
    ) -> Result<PaneInfo, String> {
        let pane_id = format!("pane_{}", Uuid::new_v4().simple());
        self.spawn_with_id(ctx, pane_id, config, 0, false)
    }

    /// Duplicate of the portable-pty master fd for `vte_pty_new_foreign_sync`.
    pub fn master_pty_fd(&self, pane_id: &str) -> Result<RawFd, String> {
        let guard = self.panes.lock().map_err(|e| e.to_string())?;
        let runtime = guard
            .get(pane_id)
            .ok_or_else(|| format!("pane not found: {pane_id}"))?;
        let master_guard = runtime.master.lock().map_err(|e| e.to_string())?;
        let master = master_guard
            .as_ref()
            .ok_or_else(|| "pane is not running".to_string())?;
        let fd = master
            .as_raw_fd()
            .ok_or_else(|| "master pty has no raw fd".to_string())?;
        let dup = unsafe { libc::dup(fd) };
        if dup < 0 {
            return Err(format!(
                "dup master pty fd failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(dup)
    }

    pub fn respawn(&self, ctx: &PaneIpcContext, pane_id: &str) -> Result<PaneInfo, String> {
        let spawn_config = {
            let guard = self.panes.lock().map_err(|e| e.to_string())?;
            let runtime = guard
                .get(pane_id)
                .ok_or_else(|| format!("pane not found: {pane_id}"))?;
            runtime.spawn_config.clone()
        };
        self.kill_inner(pane_id)?;
        if let Some(ref hub) = self.ipc_hub {
            hub.stop_listener(pane_id);
        }
        let bridge_output = {
            let guard = self.panes.lock().map_err(|e| e.to_string())?;
            guard
                .get(pane_id)
                .map(|r| r.bridge_output)
                .unwrap_or(true)
        };
        self.spawn_with_id(ctx, pane_id.to_string(), spawn_config, 0, bridge_output)
    }

    pub fn apply_ipc_event(
        &self,
        ctx: &PaneIpcContext,
        pane_id: &str,
        event_type: &str,
        payload: &serde_json::Value,
    ) {
        let updated = {
            let mut guard = match self.panes.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let Some(runtime) = guard.get_mut(pane_id) else {
                return;
            };
            match event_type {
                "session_start" => {
                    runtime.info.agent_status = "idle".to_string();
                }
                "step_start" | "agent_turn" => {
                    runtime.info.agent_status = "working".to_string();
                }
                "agent_complete" => {
                    runtime.info.agent_status = "complete".to_string();
                }
                "session_end" => {
                    runtime.info.agent_status = "idle".to_string();
                }
                "goal_status" => {
                    if let Some(s) = payload.get("summary").and_then(|v| v.as_str()) {
                        runtime.info.current_task = Some(s.to_string());
                    }
                }
                "cost_update" => {
                    if let Some(n) = payload.get("sessionTokens").and_then(|v| v.as_i64()) {
                        runtime.info.session_tokens = n;
                    }
                }
                _ => {}
            }
            if let Some(tid) = payload.get("taskId").and_then(|v| v.as_str()) {
                runtime.info.task_id = Some(tid.to_string());
            }
            Some(runtime.info.clone())
        };
        if let Some(info) = updated {
            ctx.events.dispatch(
                "pane:session-update",
                serde_json::json!({
                    "paneId": info.id,
                    "agentStatus": info.agent_status,
                    "currentTask": info.current_task,
                    "sessionTokens": info.session_tokens,
                    "status": info.status,
                    "pid": info.pid,
                }),
            );
            self.emit_status(ctx, &info, &info.status);
        }
    }

    pub fn write(&self, pane_id: &str, data: &[u8]) -> Result<(), String> {
        let guard = self.panes.lock().map_err(|e| e.to_string())?;
        let runtime = guard
            .get(pane_id)
            .ok_or_else(|| format!("pane not found: {pane_id}"))?;
        if runtime.gate_locked {
            return Err("pane is gate-locked until swarm gate conditions are met".to_string());
        }
        let mut writer_guard = runtime.writer.lock().map_err(|e| e.to_string())?;
        let writer = writer_guard
            .as_mut()
            .ok_or_else(|| "pane is not running".to_string())?;
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|e| format!("pane write failed: {e}"))
    }

    /// Re-send PTY size then form-feed so Ink redraws after xterm focus loss.
    pub fn redraw(&self, pane_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        self.resize(pane_id, rows, cols)?;
        self.write(pane_id, &[0x0c])
    }

    pub fn resize(&self, pane_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let guard = self.panes.lock().map_err(|e| e.to_string())?;
        let runtime = guard
            .get(pane_id)
            .ok_or_else(|| format!("pane not found: {pane_id}"))?;
        let mut master_guard = runtime.master.lock().map_err(|e| e.to_string())?;
        let master = master_guard
            .as_mut()
            .ok_or_else(|| "pane is not running".to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("pane resize failed: {e}"))?;
        drop(master_guard);
        drop(guard);
        self.update_info(pane_id, |info| {
            info.rows = rows;
            info.cols = cols;
        })?;
        Ok(())
    }

    pub fn kill(&self, ctx: &PaneIpcContext, pane_id: &str) -> Result<(), String> {
        let pid = self
            .get(pane_id)
            .and_then(|info| info.pid.map(|p| p as i32));
        self.kill_inner(pane_id)?;
        if let Some(pid) = pid {
            crate::services::shutdown::kill_pid(pid);
        }
        if let Some(ref hub) = self.ipc_hub {
            hub.stop_listener(pane_id);
        }
        emit_session_end(ctx.events.as_ref(), pane_id, "killed", None);
        if let Ok(mut guard) = self.panes.lock() {
            guard.remove(pane_id);
        }
        Ok(())
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self
            .panes
            .lock()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            let pid = self
                .get(&id)
                .and_then(|info| info.pid.map(|p| p as i32));
            let _ = self.kill_inner(&id);
            if let Some(pid) = pid {
                crate::services::shutdown::kill_pid(pid);
            }
        }
        if let Some(ref hub) = self.ipc_hub {
            hub.stop_all();
        }
        if let Ok(mut guard) = self.panes.lock() {
            guard.clear();
        }
    }

    /// Meta-orchestrator inject: write prompt text directly to PTY stdin.
    pub fn inject_prompt(&self, pane_id: &str, text: &str) -> Result<(), String> {
        let mut payload = text.as_bytes().to_vec();
        if !payload.ends_with(b"\n") {
            payload.push(b'\n');
        }
        self.write(pane_id, &payload)
    }

    pub fn unlock_pane(&self, pane_id: &str, message: &str) -> Result<(), String> {
        {
            let mut guard = self.panes.lock().map_err(|e| e.to_string())?;
            let runtime = guard
                .get_mut(pane_id)
                .ok_or_else(|| format!("pane not found: {pane_id}"))?;
            runtime.gate_locked = false;
            runtime.info.gate_locked = false;
        }
        let banner = format!("Gate unlocked: {message}");
        self.inject_prompt(pane_id, &banner)
    }

    pub fn is_gate_locked(&self, pane_id: &str) -> bool {
        self.panes
            .lock()
            .ok()
            .and_then(|g| g.get(pane_id).map(|p| p.gate_locked))
            .unwrap_or(false)
    }

    pub fn focus_pane(&self, pane_id: &str) -> Result<(), String> {
        self.panes
            .lock()
            .map_err(|e| e.to_string())?
            .get(pane_id)
            .ok_or_else(|| format!("pane not found: {pane_id}"))?;
        if let Ok(mut active) = self.active_pane.lock() {
            *active = Some(pane_id.to_string());
        }
        Ok(())
    }

    pub fn set_active_pane(&self, pane_id: Option<&str>) {
        if let Ok(mut active) = self.active_pane.lock() {
            *active = pane_id.map(str::to_string);
        }
    }

    pub fn active_pane_id(&self) -> Option<String> {
        self.active_pane.lock().ok().and_then(|g| g.clone())
    }

    pub fn resolve_active_pane_id(&self) -> Option<String> {
        if let Some(id) = self.active_pane_id() {
            if self.get(&id).is_some() {
                return Some(id);
            }
        }
        self.list().first().map(|p| p.id.clone())
    }

    fn spawn_with_id(
        &self,
        ctx: &PaneIpcContext,
        pane_id: String,
        config: PaneSpawnConfig,
        retry_count: u32,
        bridge_output: bool,
    ) -> Result<PaneInfo, String> {
        std::fs::create_dir_all(Self::pane_sockets_dir()).map_err(|e| e.to_string())?;

        let socket_path = Self::pane_sockets_dir().join(format!("{pane_id}.sock"));
        if let Some(ref hub) = self.ipc_hub {
            hub.start_listener(ctx.clone(), pane_id.clone(), socket_path.clone());
        }

        let cwd = config
            .cwd
            .clone()
            .unwrap_or_else(|| self.project_root.to_string_lossy().into_owned());
        let cwd_path = PathBuf::from(&cwd);
        if !cwd_path.is_dir() {
            return Err(format!("cwd is not a directory: {cwd}"));
        }

        let rows = if config.rows > 0 { config.rows } else { 24 };
        let cols = if config.cols > 0 { config.cols } else { 80 };

        let inner_command = build_inner_shell_command(&self.project_root, &socket_path, &config);
        let command_display = build_command_display(&self.project_root, &socket_path, &config);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd_builder = CommandBuilder::new("sh");
        cmd_builder.arg("-lc");
        cmd_builder.arg(&inner_command);
        cmd_builder.cwd(&cwd_path);
        for (key, val) in std::env::vars() {
            cmd_builder.env(key, val);
        }
        // Force terminal identity since the parent GTK app
        // typically doesn't have these variables set.
        cmd_builder.env("TERM", "xterm-256color");
        cmd_builder.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd_builder)
            .map_err(|e| format!("pty spawn failed: {e}"))?;
        drop(pair.slave);

        let pid = child.process_id();
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("pty reader failed: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("pty writer failed: {e}"))?;

        let master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>> =
            Arc::new(Mutex::new(Some(pair.master)));
        let writer_arc: Arc<Mutex<Option<Box<dyn Write + Send>>>> =
            Arc::new(Mutex::new(Some(writer)));
        let child_arc: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>> =
            Arc::new(Mutex::new(Some(child)));

        let gate_locked = config.gate_locked.unwrap_or(false);
        let info = PaneInfo {
            id: pane_id.clone(),
            title: config.title.clone(),
            cwd,
            command: command_display,
            event_socket: socket_path.to_string_lossy().into_owned(),
            status: "running".to_string(),
            pid,
            rows,
            cols,
            retry_count,
            swarm_role: config.swarm_role.clone(),
            gate_locked,
            agent_status: "idle".to_string(),
            current_task: config.task_id.clone(),
            session_tokens: 0,
            task_id: config.task_id.clone(),
        };

        let runtime = PaneRuntime {
            info: info.clone(),
            spawn_config: config,
            gate_locked,
            bridge_output,
            master: Arc::clone(&master),
            writer: Arc::clone(&writer_arc),
            child: Arc::clone(&child_arc),
        };

        {
            let mut guard = self.panes.lock().map_err(|e| e.to_string())?;
            guard.insert(pane_id.clone(), runtime);
        }

        self.emit_status(ctx, &info, "running");
        if bridge_output {
            self.start_output_reader(ctx.events.clone(), pane_id.clone(), reader);
        }
        self.start_child_wait(
            ctx.clone(),
            pane_id.clone(),
            Arc::clone(&child_arc),
            Arc::clone(&master),
            Arc::clone(&writer_arc),
            retry_count,
        );

        if gate_locked {
            let lock_msg = match info.swarm_role.as_deref() {
                Some("verifier") => "Verifier pane locked — waiting for workers in_review.",
                Some("synthesizer") => "Synthesizer pane locked — waiting for verifier.",
                _ => "Pane gate-locked.",
            };
            let _ = self.inject_prompt(&pane_id, lock_msg);
        }

        Ok(info)
    }

    fn start_output_reader(
        &self,
        events: Arc<dyn PaneEventDispatcher>,
        pane_id: String,
        mut reader: Box<dyn Read + Send>,
    ) {
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = B64.encode(&buf[..n]);
                        events.dispatch(
                            "pane-output",
                            serde_json::json!({
                                "paneId": pane_id,
                                "data": data,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    fn start_child_wait(
        &self,
        ctx: PaneIpcContext,
        pane_id: String,
        child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
        master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
        writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
        retry_count: u32,
    ) {
        let panes = Arc::clone(&self.panes);
        let ipc_hub = self.ipc_hub.clone();
        let ctx_retry = ctx.clone();
        let pane_id_retry = pane_id.clone();
        let retry_meta = panes.lock().ok().and_then(|g| {
            g.get(&pane_id)
                .map(|r| (r.spawn_config.clone(), r.bridge_output))
        });
        let max_retries = self.max_retries;
        let project_root = self.project_root.clone();

        thread::spawn(move || {
            let exit_code = loop {
                thread::sleep(Duration::from_millis(200));
                let mut child_guard = match child.lock() {
                    Ok(g) => g,
                    Err(_) => break None,
                };
                let Some(ref mut ch) = *child_guard else {
                    break None;
                };
                match ch.try_wait() {
                    Ok(Some(status)) => break Some(status.exit_code() as i32),
                    Ok(None) => continue,
                    Err(_) => break Some(-1),
                }
            };

            if let Some(ref hub) = ipc_hub {
                hub.stop_listener(&pane_id);
            }

            if let Ok(mut g) = master.lock() {
                *g = None;
            }
            if let Ok(mut g) = writer.lock() {
                *g = None;
            }
            if let Ok(mut g) = child.lock() {
                *g = None;
            }

            let crashed = exit_code.map(|c| c != 0).unwrap_or(true);
            if crashed && retry_count < max_retries {
                if let Some((cfg, bridge_output)) = retry_meta {
                    let mgr = PaneManager {
                        project_root,
                        panes: Arc::clone(&panes),
                        active_pane: Arc::new(Mutex::new(None)),
                        max_retries,
                        ipc_hub: ipc_hub.clone(),
                    };
                    let _ = mgr.spawn_with_id(
                        &ctx_retry,
                        pane_id_retry,
                        cfg,
                        retry_count + 1,
                        bridge_output,
                    );
                    return;
                }
            }

            emit_session_end(ctx_retry.events.as_ref(), &pane_id, "pty_exited", None);
            if let Ok(mut guard) = panes.lock() {
                if let Some(runtime) = guard.get_mut(&pane_id) {
                    runtime.info.status = if exit_code == Some(0) || exit_code.is_none() {
                        "exited".to_string()
                    } else {
                        "crashed".to_string()
                    };
                    runtime.info.pid = None;
                    let info = runtime.info.clone();
                    ctx_retry.events.dispatch(
                        "pane-exit",
                        serde_json::json!({
                            "paneId": pane_id,
                            "exitCode": exit_code,
                            "status": info.status,
                        }),
                    );
                    ctx_retry.events.dispatch(
                        "pane-status",
                        serde_json::json!({
                            "paneId": info.id,
                            "status": info.status,
                            "pid": null,
                            "title": info.title,
                        }),
                    );
                }
            }
        });
    }

    fn kill_inner(&self, pane_id: &str) -> Result<(), String> {
        let (child, master, writer) = {
            let guard = self.panes.lock().map_err(|e| e.to_string())?;
            let runtime = guard
                .get(pane_id)
                .ok_or_else(|| format!("pane not found: {pane_id}"))?;
            (
                Arc::clone(&runtime.child),
                Arc::clone(&runtime.master),
                Arc::clone(&runtime.writer),
            )
        };

        if let Ok(mut ch) = child.lock() {
            if let Some(ref mut c) = *ch {
                let _ = c.kill();
                let _ = c.wait();
            }
            *ch = None;
        }
        *master.lock().map_err(|e| e.to_string())? = None;
        *writer.lock().map_err(|e| e.to_string())? = None;

        if let Ok(mut guard) = self.panes.lock() {
            if let Some(runtime) = guard.get_mut(pane_id) {
                runtime.info.pid = None;
                runtime.info.status = "exited".to_string();
            }
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn set_status(&self, ctx: &PaneIpcContext, pane_id: &str, status: &str, pid: Option<Option<u32>>) {
        let _ = self.update_info(pane_id, |info| {
            info.status = status.to_string();
            if let Some(p) = pid {
                info.pid = p;
            }
        });
        if let Some(info) = self.get(pane_id) {
            self.emit_status(ctx, &info, status);
        }
    }

    fn update_info(&self, pane_id: &str, f: impl FnOnce(&mut PaneInfo)) -> Result<(), String> {
        let mut guard = self.panes.lock().map_err(|e| e.to_string())?;
        let runtime = guard
            .get_mut(pane_id)
            .ok_or_else(|| format!("pane not found: {pane_id}"))?;
        f(&mut runtime.info);
        Ok(())
    }

    fn emit_status(&self, ctx: &PaneIpcContext, info: &PaneInfo, status: &str) {
        ctx.events.dispatch(
            "pane-status",
            serde_json::json!({
                "paneId": info.id,
                "status": status,
                "pid": info.pid,
                "title": info.title,
                "eventSocket": info.event_socket,
                "agentStatus": info.agent_status,
                "sessionTokens": info.session_tokens,
            }),
        );
    }
}

fn shell_escape(s: &str) -> String {
    if s.contains('\'') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        format!("'{s}'")
    }
}

fn build_inner_shell_command(
    project_root: &Path,
    socket_path: &Path,
    config: &PaneSpawnConfig,
) -> String {
    if let Some(ref custom) = config.command {
        return custom.clone();
    }
    let run_sh = project_root.join("cli").join("run.sh");
    let mut parts = vec![
        "sh".to_string(),
        shell_escape(&run_sh.to_string_lossy()),
        "--event-socket".to_string(),
        shell_escape(&socket_path.to_string_lossy()),
    ];
    if let Some(ref role) = config.swarm_role {
        parts.push("--swarm-role".into());
        parts.push(shell_escape(role));
    }
    append_optional_flags(&mut parts, config);
    parts.join(" ")
}

fn build_command_display(project_root: &Path, socket_path: &Path, config: &PaneSpawnConfig) -> String {
    if let Some(ref cmd) = config.command {
        return cmd.clone();
    }
    let run_sh = project_root.join("cli").join("run.sh");
    let mut parts = vec![
        "sh".to_string(),
        run_sh.to_string_lossy().into_owned(),
        "--event-socket".to_string(),
        socket_path.to_string_lossy().into_owned(),
    ];
    if let Some(ref role) = config.swarm_role {
        parts.push("--swarm-role".into());
        parts.push(role.clone());
    }
    append_optional_flags(&mut parts, config);
    parts.join(" ")
}

fn append_optional_flags(parts: &mut Vec<String>, config: &PaneSpawnConfig) {
    if let Some(ref model) = config.model_id {
        parts.push("--model".into());
        parts.push(model.clone());
    }
    if let Some(ref model) = config.subagent_model_id {
        parts.push("--subagent-model".into());
        parts.push(model.clone());
    }
    if let Some(ref bundle) = config.skill_bundle {
        parts.push("--skill-bundle".into());
        parts.push(bundle.clone());
    }
    if let Some(ref task_id) = config.task_id {
        parts.push("--resume".into());
        parts.push(task_id.clone());
    }
}
