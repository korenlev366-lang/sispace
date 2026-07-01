use serde::{Deserialize, Serialize};

use crate::db::messages::TaskMessage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum TaskSearchMode {
    Discovery {
        query: String,
        #[serde(default = "default_limit")]
        limit: usize,
    },
    Scroll {
        task_id: String,
        before: Option<i64>,
        after: Option<i64>,
        #[serde(default = "default_scroll_limit")]
        limit: usize,
    },
    Browse {
        task_id: String,
        #[serde(default = "default_browse_limit")]
        limit: usize,
        #[serde(default)]
        offset: usize,
    },
}

fn default_limit() -> usize {
    10
}

fn default_scroll_limit() -> usize {
    20
}

fn default_browse_limit() -> usize {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TaskSearchHit {
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub task_type: String,
    pub snippet: String,
    pub match_message_id: Option<i64>,
    pub bookend_start: Vec<TaskMessage>,
    pub match_window: Vec<TaskMessage>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TaskSearchDiscoveryResult {
    pub query: String,
    pub hits: Vec<TaskSearchHit>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TaskSearchScrollResult {
    pub task_id: String,
    pub messages: Vec<TaskMessage>,
    pub has_before: bool,
    pub has_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TaskSearchBrowseResult {
    pub task_id: String,
    pub messages: Vec<TaskMessage>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum TaskSearchResult {
    Discovery(TaskSearchDiscoveryResult),
    Scroll(TaskSearchScrollResult),
    Browse(TaskSearchBrowseResult),
}
