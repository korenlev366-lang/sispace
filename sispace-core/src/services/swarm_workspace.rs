use serde::Serialize;

use crate::db::{swarm, tasks};
use crate::db::swarm::SwarmGraph;
use crate::models::task::TaskCreateInput;
use crate::services::node_host::project_root;
use crate::services::obsidian::{
    extract_blackboard_section, load_config, obsidian_token, resolve_project_root, vault_read,
};
use crate::services::pane::PaneSpawnConfig;
use crate::services::pane_ipc::{PaneEventDispatcher, PaneIpcContext};
use crate::services::swarm::{
    merge_worker_branches, prepare_worker_worktrees, remove_worker_worktrees,
    worker_branch_has_conflicts, WorktreeLayout, WorkerMergeStatus,
};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct SwarmPaneBinding {
    pub pane_id: String,
    pub task_id: String,
    pub role: String,
    pub title: String,
    pub gate_locked: bool,
    #[serde(default)]
    pub worktree_path: Option<String>,
    #[serde(default)]
    pub merge_conflict: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SwarmMessageEdge {
    pub from_role: String,
    pub to_role: String,
    pub label: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiswarmWorkspaceState {
    pub root_id: String,
    pub obsidian_note_path: String,
    pub graph: SwarmGraph,
    pub bindings: Vec<SwarmPaneBinding>,
    pub blackboard: String,
    pub edges: Vec<SwarmMessageEdge>,
    pub git_worktrees: bool,
    pub merge_conflicts: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ActiveSiswarmSession {
    pub root_id: String,
    pub obsidian_note_path: String,
    pub bindings: Vec<SwarmPaneBinding>,
    pub edges: Vec<SwarmMessageEdge>,
}

pub fn role_skill_bundle(role: &str) -> &'static str {
    match role {
        "coordinator" => "feature",
        "worker" => "feature",
        "verifier" => "bug",
        "synthesizer" => "docs",
        _ => "feature",
    }
}

pub fn role_model(_role: &str) -> &'static str {
    "composer-2.5"
}

fn spawn_role_pane(
    ctx: &PaneIpcContext,
    title: &str,
    cwd: &str,
    task_id: &str,
    role: &str,
    gate_locked: bool,
    for_vte: bool,
) -> Result<crate::services::pane::PaneInfo, String> {
    let config = PaneSpawnConfig {
        title: title.to_string(),
        cwd: Some(cwd.to_string()),
        command: None,
        task_id: Some(task_id.to_string()),
        skill_bundle: Some(role_skill_bundle(role).to_string()),
        model_id: Some(role_model(role).to_string()),
        subagent_model_id: Some("composer-2.5".to_string()),
        rows: 20,
        cols: 80,
        swarm_role: Some(role.to_string()),
        gate_locked: Some(gate_locked),
    };
    if for_vte {
        ctx.pane_manager.spawn_for_vte(ctx, config)
    } else {
        ctx.pane_manager.spawn(ctx, config)
    }
}

pub fn launch_siswarm(
    ctx: &PaneIpcContext,
    state: &AppState,
    root_id: Option<String>,
    title: Option<String>,
    worker_count: Option<usize>,
) -> Result<SiswarmWorkspaceState, String> {
    launch_siswarm_inner(ctx, state, root_id, title, worker_count, false)
}

/// Spawn coordinator + workers + gated verifier/synthesizer for native VTE panes (GTK4).
pub fn launch_siswarm_for_vte(
    ctx: &PaneIpcContext,
    state: &AppState,
    root_id: Option<String>,
    title: Option<String>,
    worker_count: Option<usize>,
) -> Result<SiswarmWorkspaceState, String> {
    launch_siswarm_inner(ctx, state, root_id, title, worker_count, true)
}

fn launch_siswarm_inner(
    ctx: &PaneIpcContext,
    state: &AppState,
    root_id: Option<String>,
    title: Option<String>,
    worker_count: Option<usize>,
    for_vte: bool,
) -> Result<SiswarmWorkspaceState, String> {
    let proj = project_root();
    let proj_str = proj.to_string_lossy().into_owned();
    let proj_path = proj.as_path();

    let root_id = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if let Some(rid) = root_id.filter(|s| !s.trim().is_empty()) {
            rid
        } else {
            let t = title
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "SISwarm session".to_string());
            let id = tasks::new_task_id(&conn).map_err(|e| e.to_string())?;
            let input = TaskCreateInput {
                title: t,
                task_type: "swarm".to_string(),
                project_root: Some(proj_str.clone()),
                goal: Some("Parallel swarm workspace (SISwarm V2).".to_string()),
            };
            let note = format!("SISpace/tasks/{id}.md");
            tasks::insert_task(&conn, &id, &input, &note).map_err(|e| e.to_string())?;
            id
        }
    };

    let (graph, note_path) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if !swarm::swarm_exists_for_root(&conn, &root_id).map_err(|e| e.to_string())? {
            let root = tasks::get_task(&conn, &root_id).map_err(|e| e.to_string())?;
            let note = root
                .obsidian_note_path
                .clone()
                .unwrap_or_else(|| format!("SISpace/tasks/{root_id}.md"));
            let count = worker_count.unwrap_or(3);
            swarm::create_swarm_graph(
                &conn,
                &root_id,
                &root.title,
                &proj_str,
                &note,
                count,
            )
            .map_err(|e| e.to_string())?;
        }
        let graph = swarm::get_swarm_graph(&conn, &root_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "swarm graph missing after create".to_string())?;
        let root = tasks::get_task(&conn, &root_id).map_err(|e| e.to_string())?;
        let note = root
            .obsidian_note_path
            .clone()
            .unwrap_or_else(|| format!("SISpace/tasks/{root_id}.md"));
        (graph, note)
    };

    let worker_ids: Vec<String> = graph.workers.iter().map(|w| w.task_id.clone()).collect();
    let worktree_layout = ensure_worker_worktrees(&state, &root_id, proj_path, &worker_ids)?;

    let mut bindings = Vec::new();

    let coord = spawn_role_pane(
        ctx,
        "Coordinator",
        &proj_str,
        &root_id,
        "coordinator",
        false,
        for_vte,
    )?;
    bindings.push(SwarmPaneBinding {
        pane_id: coord.id.clone(),
        task_id: root_id.clone(),
        role: "coordinator".to_string(),
        title: coord.title.clone(),
        gate_locked: false,
        worktree_path: None,
        merge_conflict: false,
    });

    for (i, worker) in graph.workers.iter().enumerate() {
        let worker_cwd = worktree_layout.cwd_for_worker(&worker.task_id, &proj_str);
        let info = spawn_role_pane(
            ctx,
            &format!("Worker {}", i + 1),
            &worker_cwd,
            &worker.task_id,
            "worker",
            false,
            for_vte,
        )?;
        bindings.push(SwarmPaneBinding {
            pane_id: info.id,
            task_id: worker.task_id.clone(),
            role: "worker".to_string(),
            title: worker.title.clone(),
            gate_locked: false,
            worktree_path: worktree_layout.worker_paths.get(&worker.task_id).cloned(),
            merge_conflict: worker_merge_conflict(proj_path, &worker.task_id),
        });
    }

    if let Some(ref verifier) = graph.verifier {
        let locked = verifier.gate_locked;
        let info = spawn_role_pane(
            ctx,
            "Verifier",
            &proj_str,
            &verifier.task_id,
            "verifier",
            locked,
            for_vte,
        )?;
        bindings.push(SwarmPaneBinding {
            pane_id: info.id,
            task_id: verifier.task_id.clone(),
            role: "verifier".to_string(),
            title: verifier.title.clone(),
            gate_locked: locked,
            worktree_path: None,
            merge_conflict: false,
        });
    }

    if let Some(ref synth) = graph.synthesizer {
        let locked = synth.gate_locked;
        let info = spawn_role_pane(
            ctx,
            "Synthesizer",
            &proj_str,
            &synth.task_id,
            "synthesizer",
            locked,
            for_vte,
        )?;
        bindings.push(SwarmPaneBinding {
            pane_id: info.id,
            task_id: synth.task_id.clone(),
            role: "synthesizer".to_string(),
            title: synth.title.clone(),
            gate_locked: locked,
            worktree_path: None,
            merge_conflict: false,
        });
    }

    let blackboard = read_blackboard(&note_path, &proj_str);
    let merge_conflicts = merge_conflict_worker_ids(proj_path, &graph);

    let session = ActiveSiswarmSession {
        root_id: root_id.clone(),
        obsidian_note_path: note_path.clone(),
        bindings: bindings.clone(),
        edges: Vec::new(),
    };
    if let Ok(mut guard) = state.siswarm_session.lock() {
        *guard = Some(session);
    }

    Ok(SiswarmWorkspaceState {
        root_id,
        obsidian_note_path: note_path,
        graph,
        bindings,
        blackboard,
        edges: Vec::new(),
        git_worktrees: worktree_layout.git_available,
        merge_conflicts,
    })
}

pub fn get_state(state: &AppState) -> Result<Option<SiswarmWorkspaceState>, String> {
    let session = state
        .siswarm_session
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let Some(session) = session else {
        return Ok(None);
    };

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let graph = swarm::get_swarm_graph(&conn, &session.root_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "swarm graph not found".to_string())?;

    let proj = project_root();
    let proj_path = proj.as_path();
    let blackboard = read_blackboard(&session.obsidian_note_path, &proj.to_string_lossy());

    let merge_conflicts = merge_conflict_worker_ids(proj_path, &graph);

    let bindings: Vec<SwarmPaneBinding> = session
        .bindings
        .iter()
        .map(|b| {
            let gate_locked = state.pane_manager.is_gate_locked(&b.pane_id);
            let merge_conflict = if b.role == "worker" {
                worker_merge_conflict(proj_path, &b.task_id)
            } else {
                false
            };
            SwarmPaneBinding {
                gate_locked,
                merge_conflict,
                ..b.clone()
            }
        })
        .collect();

    let git_worktrees = graph.workers.iter().any(|w| w.worktree_path.is_some());

    Ok(Some(SiswarmWorkspaceState {
        root_id: session.root_id,
        obsidian_note_path: session.obsidian_note_path,
        graph,
        bindings,
        blackboard,
        edges: session.edges.clone(),
        git_worktrees,
        merge_conflicts,
    }))
}

pub fn record_edge(state: &AppState, from_role: &str, to_role: &str, label: &str) {
    let Ok(mut guard) = state.siswarm_session.lock() else {
        return;
    };
    let Some(session) = guard.as_mut() else {
        return;
    };
    session.edges.push(SwarmMessageEdge {
        from_role: from_role.to_string(),
        to_role: to_role.to_string(),
        label: label.to_string(),
        timestamp: chrono_lite_iso(),
    });
    if session.edges.len() > 200 {
        let drain = session.edges.len() - 200;
        session.edges.drain(0..drain);
    }
}

pub fn apply_gate_unlocks(events: &dyn PaneEventDispatcher, state: &AppState, root_id: &str) {
    let graph = {
        let Ok(conn) = state.db.lock() else {
            return;
        };
        let Ok(graph) = swarm::get_swarm_graph(&conn, root_id) else {
            return;
        };
        graph
    };
    let Some(graph) = graph else {
        return;
    };

    let session_bindings = state
        .siswarm_session
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.bindings.clone()));
    let Some(bindings) = session_bindings else {
        return;
    };
    if bindings.is_empty() {
        return;
    }

    if graph.workers_complete {
        if graph.verifier.is_some() {
            if let Some(b) = bindings.iter().find(|x| x.role == "verifier") {
                if state.pane_manager.is_gate_locked(&b.pane_id) {
                    let _ = state.pane_manager.unlock_pane(
                        &b.pane_id,
                        "All workers in review — verifier may begin.",
                    );
                    crate::services::notify_hub::notify_gate_unlock(events, "verifier", root_id);
                    events.dispatch(
                        "siswarm:gate-unlocked",
                        serde_json::json!({
                            "rootId": root_id,
                            "role": "verifier",
                            "paneId": b.pane_id,
                        }),
                    );
                }
            }
        }
    }

    if graph.verifier_passed {
        if graph.synthesizer.is_some() {
            if let Some(b) = bindings.iter().find(|x| x.role == "synthesizer") {
                if state.pane_manager.is_gate_locked(&b.pane_id) {
                    let _ = state.pane_manager.unlock_pane(
                        &b.pane_id,
                        "Verifier complete — synthesizer may begin.",
                    );
                    crate::services::notify_hub::notify_gate_unlock(events, "synthesizer", root_id);
                    events.dispatch(
                        "siswarm:gate-unlocked",
                        serde_json::json!({
                            "rootId": root_id,
                            "role": "synthesizer",
                            "paneId": b.pane_id,
                        }),
                    );
                }
            }
        }
    }

    if let Ok(mut guard) = state.siswarm_session.lock() {
        if let Some(session) = guard.as_mut() {
            if session.root_id == root_id {
                for b in &mut session.bindings {
                    b.gate_locked = state.pane_manager.is_gate_locked(&b.pane_id);
                }
            }
        }
    }
}

pub fn clear_session(state: &AppState) {
    teardown_worktrees(state);
    if let Ok(mut guard) = state.siswarm_session.lock() {
        *guard = None;
    }
}

pub fn merge_siswarm_workers(state: &AppState, root_id: &str) -> Result<Vec<WorkerMergeStatus>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let graph = swarm::get_swarm_graph(&conn, root_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "swarm graph not found".to_string())?;
    drop(conn);

    let workers: Vec<(String, String)> = graph
        .workers
        .iter()
        .map(|w| (w.task_id.clone(), w.status.clone()))
        .collect();
    Ok(merge_worker_branches(&project_root(), &workers))
}

fn teardown_worktrees(state: &AppState) {
    let root_id = state
        .siswarm_session
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.root_id.clone()));
    let Some(root_id) = root_id else {
        return;
    };
    let worker_ids = {
        let Ok(conn) = state.db.lock() else {
            return;
        };
        let Ok(Some(graph)) = swarm::get_swarm_graph(&conn, &root_id) else {
            return;
        };
        graph.workers.iter().map(|w| w.task_id.clone()).collect::<Vec<_>>()
    };
    remove_worker_worktrees(&project_root(), &worker_ids);
}

fn ensure_worker_worktrees(
    state: &AppState,
    root_id: &str,
    proj_path: &std::path::Path,
    worker_ids: &[String],
) -> Result<WorktreeLayout, String> {
    let layout = prepare_worker_worktrees(proj_path, worker_ids)?;
    if layout.git_available {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for (id, path) in &layout.worker_paths {
            swarm::set_worktree_path(&conn, root_id, id, path).map_err(|e| e.to_string())?;
        }
    }
    Ok(layout)
}

fn worker_merge_conflict(proj_path: &std::path::Path, worker_id: &str) -> bool {
    crate::services::swarm::detect_git_repo(proj_path)
        && worker_branch_has_conflicts(proj_path, worker_id)
}

fn merge_conflict_worker_ids(proj_path: &std::path::Path, graph: &SwarmGraph) -> Vec<String> {
    if !crate::services::swarm::detect_git_repo(proj_path) {
        return Vec::new();
    }
    graph
        .workers
        .iter()
        .filter(|w| w.status == "complete" && worker_merge_conflict(proj_path, &w.task_id))
        .map(|w| w.task_id.clone())
        .collect()
}

pub fn read_blackboard_public(note_path: &str, project_root: &str) -> String {
    read_blackboard(note_path, project_root)
}

fn read_blackboard(note_path: &str, proj_root: &str) -> String {
    let root = crate::services::node_host::project_root();
    let proj = resolve_project_root(&root, Some(proj_root));
    let config = load_config(&proj);
    let Some(token) = obsidian_token() else {
        return "_(Obsidian API key not set — blackboard unavailable)_".to_string();
    };
    match vault_read(&config.api_url, &token, note_path) {
        Ok(body) => {
            let section = extract_blackboard_section(&body);
            if section.is_empty() {
                "_(Blackboard section empty)_".to_string()
            } else {
                section
            }
        }
        Err(e) => format!("_(Blackboard read failed: {e})_"),
    }
}

fn chrono_lite_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
