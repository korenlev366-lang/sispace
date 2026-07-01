import { ensureCostTables } from "../db/cost-schema.js";
import { openSharedDbWrite } from "../db/shared.js";
import { formatTokenCount } from "./tokens.js";

export function projectKeyFromCwd(cwd: string): string {
  return cwd.replace(/\/+$/, "") || cwd;
}

export function recordTurnOutputTokens(
  sessionId: string,
  projectKey: string,
  tokens: number,
): { sessionTotal: number; projectTotal: number } | null {
  if (tokens <= 0) {
    return loadCostTotals(sessionId, projectKey);
  }
  const db = openSharedDbWrite();
  if (!db) {
    return null;
  }
  ensureCostTables(db);
  db.prepare(
    `INSERT INTO cli_session_costs (session_id, project_key, output_tokens)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       output_tokens = output_tokens + excluded.output_tokens,
       project_key = excluded.project_key,
       updated_at = datetime('now')`,
  ).run(sessionId, projectKey, tokens);

  db.prepare(
    `INSERT INTO cli_project_costs (project_key, output_tokens)
     VALUES (?, ?)
     ON CONFLICT(project_key) DO UPDATE SET
       output_tokens = output_tokens + excluded.output_tokens,
       updated_at = datetime('now')`,
  ).run(projectKey, tokens);

  return loadCostTotals(sessionId, projectKey);
}

export function loadCostTotals(
  sessionId: string,
  projectKey: string,
): { sessionTotal: number; projectTotal: number } | null {
  const db = openSharedDbWrite();
  if (!db) {
    return null;
  }
  ensureCostTables(db);
  const sessionRow = db
    .prepare(
      "SELECT output_tokens FROM cli_session_costs WHERE session_id = ?",
    )
    .get(sessionId) as { output_tokens: number } | undefined;
  const projectRow = db
    .prepare(
      "SELECT output_tokens FROM cli_project_costs WHERE project_key = ?",
    )
    .get(projectKey) as { output_tokens: number } | undefined;
  return {
    sessionTotal: sessionRow?.output_tokens ?? 0,
    projectTotal: projectRow?.output_tokens ?? 0,
  };
}

export function formatCostStatusLine(
  sessionTotal: number,
  projectTotal: number,
): string {
  return `session: ${formatTokenCount(sessionTotal)} | project: ${formatTokenCount(projectTotal)}`;
}
