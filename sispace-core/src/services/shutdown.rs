use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::state::AppState;

static SHUTDOWN_DONE: AtomicBool = AtomicBool::new(false);

/// Kill node host, in-app VTE panes, and clear pipeline tracking. Idempotent.
///
/// Does not sweep the legacy `terminals` SQLite table — that can include unrelated
/// kitty/cursorsi sessions from harness tasks and must not be killed on app exit.
pub fn graceful_shutdown(state: &AppState) {
    if SHUTDOWN_DONE.swap(true, Ordering::SeqCst) {
        return;
    }

    state.node_host.shutdown();
    state.pane_manager.kill_all();
    let _ = state
        .active_pipelines
        .lock()
        .map(|mut guard| guard.clear());
    let _ = state
        .pipeline_queue
        .lock()
        .map(|mut guard| guard.clear());
}

pub(crate) fn kill_pid(pid: i32) {
    // Use libc::kill directly to avoid TOCTOU between shell commands.
    // SIGTERM first, poll with waitpid WNOHANG, then SIGKILL if still alive.
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(100));
        let mut status: i32 = 0;
        let ret = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if ret != 0 {
            return; // exited or already reaped
        }
    }
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
}
