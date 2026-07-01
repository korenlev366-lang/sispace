use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

pub const DEFAULT_NODE_PORT: u16 = 3847;
pub const MAX_SIDECAR_RESTARTS: u32 = 3;

/// Resolve the node sidecar port: `SISPACE_NODE_PORT` env var, or default 3847.
pub fn resolve_port() -> u16 {
    std::env::var("SISPACE_NODE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_NODE_PORT)
}

pub struct NodeHost {
    pub port: u16,
    project_root: PathBuf,
    child: Mutex<Option<Child>>,
    restart_count: Mutex<u32>,
}

impl NodeHost {
    pub fn new(project_root: PathBuf, port: u16) -> Self {
        Self {
            port,
            project_root,
            child: Mutex::new(None),
            restart_count: Mutex::new(0),
        }
    }

    pub fn from_child(project_root: PathBuf, port: u16, mut child: Child) -> Self {
        let host = Self::new(project_root, port);
        if let Ok(mut guard) = host.child.lock() {
            *guard = Some(child);
        } else {
            // Lock poisoned — child handle lost; spawner will create new sidecar.
            let _ = child.wait();
        }
        host
    }

    pub fn spawn_initial(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        *guard = Some(spawn_host(&self.project_root)?);
        Ok(())
    }

    pub fn wait_ready(&self, attempts: u32) -> bool {
        for _ in 0..attempts {
            if ping_http(self.port) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        false
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn restart_count(&self) -> u32 {
        *self.restart_count.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn ping(&self) -> bool {
        ping_http(self.port)
    }

    /// Restart sidecar if ping fails. Returns Ok(true) when healthy after attempt.
    pub fn ensure_alive(&self) -> Result<bool, String> {
        if self.ping() {
            return Ok(true);
        }

        let mut restarts = self
            .restart_count
            .lock()
            .map_err(|e| e.to_string())?;
        if *restarts >= MAX_SIDECAR_RESTARTS {
            return Ok(false);
        }

        self.kill_child();
        let child = spawn_host(&self.project_root)?;
        *self.child.lock().map_err(|e| e.to_string())? = Some(child);
        *restarts += 1;

        Ok(self.wait_ready(15))
    }

    pub fn shutdown(&self) {
        self.kill_child();
    }

    fn kill_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let pid = child.id() as i32;
                #[cfg(unix)]
                kill_process_group(pid);
                #[cfg(not(unix))]
                {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
}

#[cfg(unix)]
fn kill_process_group(pid: i32) {
    // Send SIGTERM to the process group (-PID).
    // Using libc::kill directly avoids TOCTOU between shell-out and check.
    unsafe {
        libc::kill(-pid, libc::SIGTERM);
    }

    // Poll with libc::waitpid WNOHANG on the child PID to reap without blocking.
    // If waitpid returns the child PID, it has exited — process group is done.
    // If it returns 0 (WNOHANG, child still running), continue waiting.
    // If it returns -1 (ECHILD), child was already reaped — also done.
    // This avoids the PID-reuse race of kill -0 (which only checks existence).
    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(100));
        let mut status: i32 = 0;
        let ret = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if ret != 0 {
            // Child exited (ret == pid) or already reaped (ret == -1, ECHILD)
            return;
        }
    }

    // Force kill if still alive after grace period.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
}

impl Drop for NodeHost {
    fn drop(&mut self) {
        self.kill_child();
    }
}

pub fn spawn_host(root: &Path) -> Result<Child, String> {
    let script = root.join("lib").join("node-server.mjs");
    let mut cmd = Command::new("node");
    cmd.arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn()
        .map_err(|e| format!("node host spawn failed: {e}"))
}

pub fn ping_http(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = match TcpStream::connect_timeout(
        &addr.parse().expect("loopback"),
        Duration::from_millis(800),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));

    let request = format!(
        "GET /ping HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).unwrap_or(0);
    if n == 0 {
        return false;
    }
    let response = String::from_utf8_lossy(&buf[..n]);
    if response.contains("pong") {
        return true;
    }
    false
}

pub fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_http_returns_false_when_nothing_listening() {
        assert!(!ping_http(39_999));
    }
}
