use std::sync::{Arc, Mutex};

use sispace_core::db;
use sispace_core::services::node_host::{resolve_port, NodeHost};
use sispace_core::services::pane::PaneManager;
use sispace_core::services::pane_ipc::PaneIpcHub;
use sispace_core::state::AppState;

/// Initialize shared application state (DB, node host, pane manager + IPC hub).
pub fn init_app_state() -> Arc<AppState> {
    let db_path = db::db_path();
    let db_path_str = db_path.to_string_lossy().into_owned();
    let connection = db::open(&db_path).expect("failed to open SQLite database");

    let root = sispace_core::services::node_host::project_root();
    let port = resolve_port();
    let node_host = NodeHost::new(root.clone(), port);
    node_host
        .spawn_initial()
        .expect("failed to start node host");
    let node_host_ready = node_host.wait_ready(25);

    let pipeline_cfg = sispace_core::services::config::load_pipeline_config(&root);
    let pane_ipc_hub = Arc::new(PaneIpcHub::new());
    let pane_manager = Arc::new(PaneManager::new(root).with_ipc_hub(pane_ipc_hub));

    Arc::new(AppState {
        db: Mutex::new(connection),
        db_path: db_path_str,
        node_host,
        node_host_ready,
        active_pipelines: Mutex::new(std::collections::HashSet::new()),
        pipeline_queue: Mutex::new(std::collections::VecDeque::new()),
        max_concurrent_pipelines: pipeline_cfg.max_concurrent_pipelines,
        pane_manager,
        siswarm_session: Mutex::new(None),
    })
}
