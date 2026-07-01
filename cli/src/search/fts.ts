import type { DatabaseSync } from "node:sqlite";
import { ftsQueryTerms } from "./query.js";
import { listMessages, messagesAround } from "./messages.js";
import type {
  TaskMessage,
  TaskSearchBrowseResult,
  TaskSearchDiscoveryResult,
  TaskSearchHit,
  TaskSearchScrollResult,
} from "./types.js";

const CONTEXT_WINDOW = 5;
const BOOKEND_COUNT = 3;

type FtsRow = {
  task_id: string;
  id: number;
  role: string;
  content: string;
  created_at: string;
  snip: string;
  score: number;
};

function mapMessageRow(row: TaskMessage): TaskMessage {
  return row;
}

/** Discovery — port of `discovery_search` in search.rs */
export function discoverySearch(
  db: DatabaseSync,
  query: string,
  limit = 10,
): TaskSearchDiscoveryResult {
  const started = performance.now();
  const fts = ftsQueryTerms(query);
  if (!fts) {
    return {
      query,
      hits: [],
      elapsed_ms: Math.round(performance.now() - started),
    };
  }

  const cap = Math.max(limit * 8, 40);
  const rows = db
    .prepare(
      `SELECT tm.task_id, tm.id, tm.role, tm.content, tm.created_at,
              snippet(task_messages_fts, 0, '[[', ']]', '…', 48) AS snip,
              bm25(task_messages_fts) AS score
       FROM task_messages_fts
       JOIN task_messages tm ON tm.id = task_messages_fts.rowid
       WHERE task_messages_fts MATCH ?
       ORDER BY score
       LIMIT ?`,
    )
    .all(fts, cap) as unknown as FtsRow[];

  const bestByTask = new Map<
    string,
    { score: number; msgId: number; snippet: string }
  >();
  for (const row of rows) {
    const existing = bestByTask.get(row.task_id);
    if (!existing || row.score < existing.score) {
      bestByTask.set(row.task_id, {
        score: row.score,
        msgId: row.id,
        snippet: row.snip,
      });
    }
  }

  const ranked = [...bestByTask.entries()]
    .map(([task_id, v]) => ({
      task_id,
      score: v.score,
      msgId: v.msgId,
      snippet: v.snippet,
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);

  const hits: TaskSearchHit[] = [];
  const taskStmt = db.prepare(
    "SELECT title, status, task_type FROM tasks WHERE id = ?",
  );

  for (const { task_id, score, msgId, snippet } of ranked) {
    const taskRow = taskStmt.get(task_id) as
      | { title: string; status: string; task_type: string }
      | undefined;
    if (!taskRow) {
      continue;
    }

    const all = listMessages(db, task_id);
    const bookend_start = all.slice(0, BOOKEND_COUNT);
    const match_window = messagesAround(db, task_id, msgId, CONTEXT_WINDOW);

    hits.push({
      task_id,
      title: taskRow.title,
      status: taskRow.status,
      task_type: taskRow.task_type,
      snippet,
      match_message_id: msgId,
      bookend_start,
      match_window,
      score,
    });
  }

  return {
    query,
    hits,
    elapsed_ms: Math.round(performance.now() - started),
  };
}

/** Scroll — port of `scroll_messages` in search.rs */
export function scrollMessages(
  db: DatabaseSync,
  taskId: string,
  before: number | undefined,
  after: number | undefined,
  limit = 20,
): TaskSearchScrollResult {
  let messages: TaskMessage[];

  if (before !== undefined) {
    const rows = db
      .prepare(
        `SELECT id, task_id, run_id, role, content, created_at
         FROM task_messages
         WHERE task_id = ? AND id < ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(taskId, before, limit) as unknown as TaskMessage[];
    messages = rows.map(mapMessageRow).reverse();
  } else if (after !== undefined) {
    messages = db
      .prepare(
        `SELECT id, task_id, run_id, role, content, created_at
         FROM task_messages
         WHERE task_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(taskId, after, limit) as unknown as TaskMessage[];
  } else {
    const all = listMessages(db, taskId);
    messages = all.slice(-limit);
  }

  const minId = messages[0]?.id;
  const maxId = messages[messages.length - 1]?.id;

  const has_before =
    minId !== undefined
      ? (db
          .prepare(
            "SELECT COUNT(*) AS c FROM task_messages WHERE task_id = ? AND id < ?",
          )
          .get(taskId, minId) as { c: number }).c > 0
      : false;

  const has_after =
    maxId !== undefined
      ? (db
          .prepare(
            "SELECT COUNT(*) AS c FROM task_messages WHERE task_id = ? AND id > ?",
          )
          .get(taskId, maxId) as { c: number }).c > 0
      : false;

  return {
    task_id: taskId,
    messages,
    has_before,
    has_after,
  };
}

/** Browse — port of `browse_messages` in search.rs */
export function browseMessages(
  db: DatabaseSync,
  taskId: string,
  limit = 50,
  offset = 0,
): TaskSearchBrowseResult {
  const total = (
    db
      .prepare("SELECT COUNT(*) AS c FROM task_messages WHERE task_id = ?")
      .get(taskId) as { c: number }
  ).c;

  const messages = db
    .prepare(
      `SELECT id, task_id, run_id, role, content, created_at
       FROM task_messages
       WHERE task_id = ?
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(taskId, limit, offset) as unknown as TaskMessage[];

  return {
    task_id: taskId,
    messages,
    total,
    offset,
    limit,
  };
}
