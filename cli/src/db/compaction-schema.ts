import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const SESSION_COMPACTIONS = `
CREATE TABLE IF NOT EXISTS session_compactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    first_kept_entry_id TEXT NOT NULL,
    messages_summarized INTEGER NOT NULL DEFAULT 0,
    messages_kept INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_compactions_session
    ON session_compactions(session_id, id DESC);
`;

let ensured = false;

export function ensureCompactionTables(
  db: InstanceType<typeof DatabaseSync>,
): void {
  if (ensured) {
    return;
  }
  db.exec(SESSION_COMPACTIONS);
  ensured = true;
}
