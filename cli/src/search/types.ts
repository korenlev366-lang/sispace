/** Mirrors src-tauri/src/models/search.rs and db/messages.rs */

export interface TaskMessage {
  id: number;
  task_id: string;
  run_id: string | null;
  role: string;
  content: string;
  created_at: string;
}

export interface TaskSearchHit {
  task_id: string;
  title: string;
  status: string;
  task_type: string;
  snippet: string;
  match_message_id: number | null;
  bookend_start: TaskMessage[];
  match_window: TaskMessage[];
  score: number;
}

export interface TaskSearchDiscoveryResult {
  query: string;
  hits: TaskSearchHit[];
  elapsed_ms: number;
}

export interface TaskSearchScrollResult {
  task_id: string;
  messages: TaskMessage[];
  has_before: boolean;
  has_after: boolean;
}

export interface TaskSearchBrowseResult {
  task_id: string;
  messages: TaskMessage[];
  total: number;
  offset: number;
  limit: number;
}

export type TaskSearchMode =
  | { mode: "discovery"; query: string; limit: number }
  | {
      mode: "scroll";
      task_id: string;
      before?: number;
      after?: number;
      limit: number;
    }
  | {
      mode: "browse";
      task_id: string;
      limit: number;
      offset: number;
    };
