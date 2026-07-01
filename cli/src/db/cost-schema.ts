import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const COST_SESSION = `
CREATE TABLE IF NOT EXISTS cli_session_costs (
    session_id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cli_session_costs_project ON cli_session_costs(project_key);
`;

const COST_PROJECT = `
CREATE TABLE IF NOT EXISTS cli_project_costs (
    project_key TEXT PRIMARY KEY,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let ensured = false;

export function ensureCostTables(
  db: InstanceType<typeof DatabaseSync>,
): void {
  if (ensured) {
    return;
  }
  db.exec(COST_SESSION);
  db.exec(COST_PROJECT);
  ensured = true;
}
