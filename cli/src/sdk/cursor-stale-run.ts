/**
 * Clear stuck Cursor SDK local-agent runs left as RUNNING/QUEUED after a hard
 * cancel/close race. Without this, Agent.resume + send throws:
 *   "Agent <id> already has active run"
 *
 * Store layout (SDK): ~/.cursor/projects/<cwd-slug>/sdk-agent-store/<hash>/index.db
 */
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

export function isAlreadyHasActiveRunError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already has active run/i.test(msg);
}

function listAgentStoreDbs(): string[] {
  const root = join(homedir(), ".cursor", "projects");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return [];
  }
  for (const project of projects) {
    const stores = join(root, project, "sdk-agent-store");
    if (!existsSync(stores)) continue;
    let hashes: string[];
    try {
      hashes = readdirSync(stores);
    } catch {
      continue;
    }
    for (const hash of hashes) {
      const dbPath = join(stores, hash, "index.db");
      if (existsSync(dbPath)) out.push(dbPath);
    }
  }
  return out;
}

/**
 * Mark the agent's non-terminal active run CANCELLED and clear active_run_id.
 * Returns true when a row was updated.
 */
export function forceCancelStaleCursorActiveRun(agentId: string): boolean {
  const id = agentId.trim();
  if (!id) return false;
  const now = new Date().toISOString();
  let cleared = false;

  for (const dbPath of listAgentStoreDbs()) {
    let db: InstanceType<typeof DatabaseSync> | undefined;
    try {
      db = new DatabaseSync(dbPath);
      const agent = db
        .prepare(
          `SELECT agent_id, status, active_run_id FROM agents WHERE agent_id = ?`,
        )
        .get(id) as
        | { agent_id: string; status: string; active_run_id: string | null }
        | undefined;
      if (!agent?.active_run_id) {
        db.close();
        continue;
      }

      const run = db
        .prepare(
          `SELECT run_id, status FROM runs WHERE agent_id = ? AND run_id = ?`,
        )
        .get(id, agent.active_run_id) as
        | { run_id: string; status: string }
        | undefined;

      if (run && !TERMINAL.has(run.status)) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            `UPDATE runs
               SET status = 'CANCELLED',
                   updated_at = ?,
                   cancelled_at = ?
             WHERE run_id = ? AND agent_id = ?
               AND status NOT IN ('FINISHED','ERROR','CANCELLED','EXPIRED')`,
          ).run(now, now, run.run_id, id);
          db.prepare(
            `UPDATE agents
               SET active_run_id = NULL,
                   status = CASE WHEN status = 'ARCHIVED' THEN status ELSE 'IDLE' END,
                   updated_at = ?
             WHERE agent_id = ?`,
          ).run(now, id);
          db.exec("COMMIT");
          cleared = true;
        } catch (e) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // ignore
          }
          throw e;
        }
      } else if (agent.active_run_id) {
        // Orphan pointer to missing/terminal run — still block follow-ups.
        db.prepare(
          `UPDATE agents
             SET active_run_id = NULL,
                 status = CASE WHEN status = 'ARCHIVED' THEN status ELSE 'IDLE' END,
                 updated_at = ?
           WHERE agent_id = ?`,
        ).run(now, id);
        cleared = true;
      }
      db.close();
      if (cleared) return true;
    } catch {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }
  return cleared;
}
