use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Serialize;

use crate::services::node_host::NodeHost;
use crate::services::pane::PaneManager;
use crate::services::pane_ipc::PaneEventDispatcher;
use crate::services::swarm_workspace::ActiveSiswarmSession;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: String,
    pub node_host: NodeHost,
    pub node_host_ready: bool,
    pub active_pipelines: Mutex<HashSet<String>>,
    pub pipeline_queue: Mutex<VecDeque<QueuedPipelineStart>>,
    pub max_concurrent_pipelines: usize,
    pub pane_manager: Arc<PaneManager>,
    pub siswarm_session: Mutex<Option<ActiveSiswarmSession>>,
}

#[derive(Debug, Clone)]
pub struct QueuedPipelineStart {
    pub task_id: String,
    pub goal: Option<String>,
    pub model: Option<String>,
    pub subagent_model: Option<String>,
    pub runtime: Option<String>,
    pub clear_messages: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueuedPipelineEntry {
    pub task_id: String,
    pub position: usize,
}

pub fn register_active_pipeline(
    active: &Mutex<HashSet<String>>,
    task_id: &str,
) -> Result<(), String> {
    let mut guard = active.lock().map_err(|e| e.to_string())?;
    if guard.contains(task_id) {
        return Err("Pipeline already running for this task".to_string());
    }
    guard.insert(task_id.to_string());
    Ok(())
}

/// Atomically check capacity and register. Returns "max_concurrent" if at capacity.
pub fn try_register_active_pipeline(
    active: &Mutex<HashSet<String>>,
    task_id: &str,
    max_concurrent: usize,
) -> Result<(), String> {
    let mut guard = active.lock().map_err(|e| e.to_string())?;
    if guard.len() >= max_concurrent {
        return Err("max_concurrent".to_string());
    }
    if guard.contains(task_id) {
        return Err("Pipeline already running for this task".to_string());
    }
    guard.insert(task_id.to_string());
    Ok(())
}

pub fn unregister_active_pipeline(active: &Mutex<HashSet<String>>, task_id: &str) {
    if let Ok(mut guard) = active.lock() {
        guard.remove(task_id);
    }
}

pub fn active_pipeline_count(active: &Mutex<HashSet<String>>) -> usize {
    active.lock().map(|g| g.len()).unwrap_or(0)
}

/// Snapshot then clear all in-flight pipeline slots (e.g. after sidecar restart).
pub fn drain_active_pipelines(active: &Mutex<HashSet<String>>) -> Vec<String> {
    active
        .lock()
        .map(|mut guard| guard.drain().collect())
        .unwrap_or_default()
}

pub fn snapshot_pipeline_queue(queue: &Mutex<VecDeque<QueuedPipelineStart>>) -> Vec<QueuedPipelineEntry> {
    queue
        .lock()
        .map(|q| {
            q.iter()
                .enumerate()
                .map(|(i, item)| QueuedPipelineEntry {
                    task_id: item.task_id.clone(),
                    position: i + 1,
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn emit_pipeline_queue_updated(events: &dyn PaneEventDispatcher, state: &AppState) {
    let queued = snapshot_pipeline_queue(&state.pipeline_queue);
    events.dispatch(
        "pipeline-queue-updated",
        serde_json::json!({ "queued": queued }),
    );
}

pub fn enqueue_pipeline(
    queue: &Mutex<VecDeque<QueuedPipelineStart>>,
    item: QueuedPipelineStart,
) -> Result<usize, String> {
    let mut guard = queue.lock().map_err(|e| e.to_string())?;
    if guard.iter().any(|q| q.task_id == item.task_id) {
        let pos = guard
            .iter()
            .position(|q| q.task_id == item.task_id)
            .unwrap_or(0)
            + 1;
        return Ok(pos);
    }
    guard.push_back(item);
    Ok(guard.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_rejects_duplicate_task() {
        let active = Mutex::new(HashSet::new());
        register_active_pipeline(&active, "t_abc").unwrap();
        let err = register_active_pipeline(&active, "t_abc").unwrap_err();
        assert_eq!(err, "Pipeline already running for this task");
    }

    #[test]
    fn unregister_removes_task() {
        let active = Mutex::new(HashSet::new());
        register_active_pipeline(&active, "t_abc").unwrap();
        unregister_active_pipeline(&active, "t_abc");
        register_active_pipeline(&active, "t_abc").unwrap();
    }

    #[test]
    fn register_allows_concurrent_different_tasks() {
        let active = Mutex::new(HashSet::new());
        register_active_pipeline(&active, "t_one").unwrap();
        register_active_pipeline(&active, "t_two").unwrap();
        register_active_pipeline(&active, "t_three").unwrap();

        let guard = active.lock().unwrap();
        assert_eq!(guard.len(), 3);
        assert!(guard.contains("t_one"));
        assert!(guard.contains("t_two"));
        assert!(guard.contains("t_three"));
    }

    #[test]
    fn drain_active_pipelines_clears_all() {
        let active = Mutex::new(HashSet::new());
        register_active_pipeline(&active, "t_a").unwrap();
        register_active_pipeline(&active, "t_b").unwrap();
        let drained = drain_active_pipelines(&active);
        assert_eq!(drained.len(), 2);
        assert!(drained.contains(&"t_a".to_string()));
        assert!(active.lock().unwrap().is_empty());
    }

    #[test]
    fn enqueue_preserves_position_for_duplicate_task() {
        let queue = Mutex::new(VecDeque::new());
        let pos1 = enqueue_pipeline(
            &queue,
            QueuedPipelineStart {
                task_id: "t_a".into(),
                goal: None,
                model: None,
                subagent_model: None,
                runtime: None,
                clear_messages: None,
            },
        )
        .unwrap();
        assert_eq!(pos1, 1);
        let pos2 = enqueue_pipeline(
            &queue,
            QueuedPipelineStart {
                task_id: "t_a".into(),
                goal: None,
                model: None,
                subagent_model: None,
                runtime: None,
                clear_messages: None,
            },
        )
        .unwrap();
        assert_eq!(pos2, 1);
        assert_eq!(queue.lock().unwrap().len(), 1);
    }
}
