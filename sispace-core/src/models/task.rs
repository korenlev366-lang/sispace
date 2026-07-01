use serde::{Deserialize, Serialize};

pub const STATUSES: &[&str] = &[
    "todo",
    "in_progress",
    "in_review",
    "complete",
    "reflected",
    "learned",
];

pub const TASK_TYPES: &[&str] = &["feature", "bug", "docs", "swarm", "custom"];

pub const DEFAULT_MODEL_ID: &str = "composer-2.5";

pub const DEFAULT_SUBAGENT_MODEL_ID: &str = "composer-2.5";

pub const VALID_MODEL_IDS: &[&str] = &["composer-2.5", "composer-2.5-fast", "composer-2"];

pub const VALID_RUNTIMES: &[&str] = &["local", "cloud"];

pub fn normalize_model_id(raw: Option<&str>) -> String {
    match raw {
        Some(id) if VALID_MODEL_IDS.contains(&id) => id.to_string(),
        Some("composer-2") => "composer-2".to_string(),
        _ => DEFAULT_MODEL_ID.to_string(),
    }
}

pub fn normalize_subagent_model_id(raw: Option<&str>) -> String {
    normalize_model_id(raw)
}

pub fn is_valid_runtime(runtime: &str) -> bool {
    VALID_RUNTIMES.contains(&runtime)
}

#[cfg(test)]
mod run_prefs_tests {
    use super::*;

    #[test]
    fn normalize_model_id_none_defaults() {
        assert_eq!(normalize_model_id(None), "composer-2.5");
    }

    #[test]
    fn normalize_model_id_fast_remains_fast() {
        assert_eq!(normalize_model_id(Some("composer-2.5-fast")), "composer-2.5-fast");
    }

    #[test]
    fn normalize_model_id_legacy_composer_2() {
        assert_eq!(normalize_model_id(Some("composer-2")), "composer-2");
    }

    #[test]
    fn normalize_model_id_known_passthrough() {
        assert_eq!(normalize_model_id(Some("composer-2.5")), "composer-2.5");
    }
}

/// Harness-managed stages — not draggable by users.
pub const HARNESS_STATUSES: &[&str] = &["reflected", "learned"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: String,
    pub task_type: String,
    pub project_root: Option<String>,
    pub obsidian_note_path: Option<String>,
    pub model_id: Option<String>,
    pub subagent_model_id: Option<String>,
    pub runtime: String,
    pub cursor_agent_id: Option<String>,
    pub reflection_locked: bool,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub reflected_at: Option<String>,
    pub learned_at: Option<String>,
    #[serde(default)]
    pub related_task_ids: Vec<String>,
    #[serde(default)]
    pub reflecting: bool,
    pub parent_id: Option<String>,
    pub swarm_root_id: Option<String>,
    #[serde(default)]
    pub swarm_role: Option<String>,
    #[serde(default)]
    pub swarm_gate_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCreateInput {
    pub title: String,
    pub task_type: String,
    pub project_root: Option<String>,
    pub goal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCreateResult {
    pub task: Task,
    pub obsidian_synced: bool,
    pub obsidian_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDeleteResult {
    pub deleted_id: String,
    pub obsidian_deleted: bool,
    pub obsidian_error: Option<String>,
}

pub fn can_user_transition(from: &str, to: &str) -> bool {
    if HARNESS_STATUSES.contains(&to) || HARNESS_STATUSES.contains(&from) {
        return false;
    }
    matches!(
        (from, to),
        ("todo", "in_progress")
            | ("in_progress", "in_review")
            | ("in_progress", "todo")
            | ("in_review", "in_progress")
    )
}

pub fn can_system_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("in_review", "complete")
            | ("complete", "reflected")
            | ("reflected", "learned")
    )
}

pub fn can_transition(from: &str, to: &str) -> bool {
    can_user_transition(from, to) || can_system_transition(from, to)
}
