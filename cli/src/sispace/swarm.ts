import { createRequire } from "node:module";
import { openSharedDbRead, openSharedDbWrite } from "../db/shared.js";
import { getTaskRow } from "../session/task-row.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface SwarmNodeSummary {
  task_id: string;
  title: string;
  status: string;
  role: string;
}

export interface SwarmCreateResult {
  ok: boolean;
  rootId?: string;
  workers?: SwarmNodeSummary[];
  verifier?: SwarmNodeSummary;
  synthesizer?: SwarmNodeSummary;
  error?: string;
}

function newTaskId(db: InstanceType<typeof DatabaseSync>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `t_${(Date.now() ^ attempt).toString(16).slice(-8).padStart(8, "0")}`;
    const exists = db
      .prepare("SELECT COUNT(*) AS c FROM tasks WHERE id = ?")
      .get(id) as { c: number };
    if (!exists.c) {
      return id;
    }
  }
  throw new Error("failed to generate unique task id");
}

function mergeMetadata(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
  patch: Record<string, unknown>,
): void {
  const row = db
    .prepare("SELECT metadata_json FROM tasks WHERE id = ?")
    .get(taskId) as { metadata_json: string } | undefined;
  const meta = row?.metadata_json
    ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
    : {};
  Object.assign(meta, patch);
  db.prepare(
    "UPDATE tasks SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(meta), taskId);
}

function recordEvent(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  db.prepare(
    "INSERT INTO task_events (task_id, event_type, payload_json) VALUES (?, ?, ?)",
  ).run(taskId, eventType, JSON.stringify(payload));
}

function insertTask(
  db: InstanceType<typeof DatabaseSync>,
  id: string,
  title: string,
  taskType: string,
  projectRoot: string,
  notePath: string,
): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, task_type, project_root, obsidian_note_path)
     VALUES (?, ?, 'todo', ?, ?, ?)`,
  ).run(id, title.trim(), taskType, projectRoot, notePath);
  recordEvent(db, id, "created", {});
}

function insertSwarmChild(
  db: InstanceType<typeof DatabaseSync>,
  id: string,
  title: string,
  projectRoot: string,
  notePath: string,
  parentId: string,
  swarmRootId: string,
  role: string,
  gateLocked: boolean,
): void {
  insertTask(db, id, title, "custom", projectRoot, notePath);
  db.prepare(
    "UPDATE tasks SET parent_id = ?, swarm_root_id = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(parentId, swarmRootId, id);
  mergeMetadata(db, id, {
    swarm_role: role,
    swarm_gate_locked: gateLocked,
  });
}

function insertGraphRow(
  db: InstanceType<typeof DatabaseSync>,
  swarmRootId: string,
  taskId: string,
  role: string,
  gateOn: string[],
): void {
  db.prepare(
    `INSERT INTO swarm_graph (swarm_root_id, task_id, role, gate_on_task_ids)
     VALUES (?, ?, ?, ?)`,
  ).run(swarmRootId, taskId, role, JSON.stringify(gateOn));
}

function upsertSwarmMeta(
  db: InstanceType<typeof DatabaseSync>,
  rootId: string,
  workerIds: string[],
  verifierId: string,
  synthesizerId: string,
): void {
  db.prepare(
    `INSERT INTO swarm_meta (swarm_root_id, worker_ids_json, verifier_id, synthesizer_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(swarm_root_id) DO UPDATE SET
       worker_ids_json = excluded.worker_ids_json,
       verifier_id = excluded.verifier_id,
       synthesizer_id = excluded.synthesizer_id,
       updated_at = datetime('now')`,
  ).run(rootId, JSON.stringify(workerIds), verifierId, synthesizerId);
}

function swarmExists(db: InstanceType<typeof DatabaseSync>, rootId: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM swarm_meta WHERE swarm_root_id = ?")
    .get(rootId) as { c: number };
  return row.c > 0;
}

export interface SwarmGraphSummary {
  root_id: string;
  root_title: string;
  root_status: string;
  workers: SwarmNodeSummary[];
  verifier?: SwarmNodeSummary;
  synthesizer?: SwarmNodeSummary;
  workers_complete: boolean;
  verifier_passed: boolean;
}

function resolveSwarmRootId(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
): string | null {
  const meta = db
    .prepare("SELECT swarm_root_id FROM swarm_meta WHERE swarm_root_id = ?")
    .get(taskId) as { swarm_root_id: string } | undefined;
  if (meta) {
    return taskId;
  }
  const row = getTaskRow(db, taskId);
  if (row?.swarm_root_id?.trim()) {
    return row.swarm_root_id.trim();
  }
  if (row?.task_type === "swarm") {
    return taskId;
  }
  return null;
}

/** Read swarm graph for status display (slash /swarm). */
export function getSwarmGraph(taskId: string): SwarmGraphSummary | null {
  const db = openSharedDbRead();
  if (!db) {
    return null;
  }
  const rootId = resolveSwarmRootId(db, taskId);
  if (!rootId) {
    return null;
  }

  const meta = db
    .prepare(
      `SELECT worker_ids_json, verifier_id, synthesizer_id, workers_complete, verifier_passed
       FROM swarm_meta WHERE swarm_root_id = ?`,
    )
    .get(rootId) as
    | {
        worker_ids_json: string;
        verifier_id: string | null;
        synthesizer_id: string | null;
        workers_complete: number;
        verifier_passed: number;
      }
    | undefined;
  if (!meta) {
    return null;
  }

  const root = getTaskRow(db, rootId);
  if (!root) {
    return null;
  }

  const workerIds = JSON.parse(meta.worker_ids_json) as string[];
  const workers = workerIds
    .map((id) => summarize(db, id, "worker"))
    .filter((x): x is SwarmNodeSummary => !!x);

  return {
    root_id: root.id,
    root_title: root.title,
    root_status: root.status,
    workers,
    verifier: meta.verifier_id
      ? summarize(db, meta.verifier_id, "verifier")
      : undefined,
    synthesizer: meta.synthesizer_id
      ? summarize(db, meta.synthesizer_id, "synthesizer")
      : undefined,
    workers_complete: meta.workers_complete !== 0,
    verifier_passed: meta.verifier_passed !== 0,
  };
}

function summarize(
  db: InstanceType<typeof DatabaseSync>,
  taskId: string,
  role: string,
): SwarmNodeSummary | undefined {
  const row = getTaskRow(db, taskId);
  if (!row) {
    return undefined;
  }
  return {
    task_id: row.id,
    title: row.title,
    status: row.status,
    role,
  };
}

/** Port of src-tauri/src/db/swarm.rs create_swarm_graph. */
export function createSwarmGraph(
  rootId: string,
  workerCount: number,
): SwarmCreateResult {
  const db = openSharedDbWrite();
  if (!db) {
    return {
      ok: false,
      error: "Shared tasks database not found. Run SISpace once or pass --db-path.",
    };
  }

  const root = getTaskRow(db, rootId);
  if (!root) {
    return { ok: false, error: `Task not found: ${rootId}` };
  }
  if (root.swarm_root_id && root.swarm_root_id !== root.id) {
    return { ok: false, error: "cannot create swarm on a swarm child task" };
  }
  if (swarmExists(db, rootId)) {
    return { ok: false, error: "swarm already exists for this task" };
  }
  if (root.status !== "todo" && root.status !== "in_progress") {
    return {
      ok: false,
      error: `root task must be todo or in_progress (status=${root.status})`,
    };
  }

  const projectRoot = root.project_root?.trim() || process.cwd();
  const note =
    root.obsidian_note_path?.trim() || `SISpace/tasks/${rootId}.md`;
  const n = Math.max(3, workerCount);
  const workerIds: string[] = [];

  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE tasks SET task_type = 'swarm', updated_at = datetime('now') WHERE id = ?",
    ).run(rootId);
    insertGraphRow(db, rootId, rootId, "root", []);

    for (let i = 1; i <= n; i += 1) {
      const wid = newTaskId(db);
      const title = `Worker ${i}: ${root.title}`;
      const wNote = `SISpace/tasks/${wid}.md`;
      insertSwarmChild(
        db,
        wid,
        title,
        projectRoot,
        wNote,
        rootId,
        rootId,
        "worker",
        false,
      );
      insertGraphRow(db, rootId, wid, "worker", []);
      workerIds.push(wid);
    }

    const verifierId = newTaskId(db);
    insertSwarmChild(
      db,
      verifierId,
      `Verifier: ${root.title}`,
      projectRoot,
      `SISpace/tasks/${verifierId}.md`,
      rootId,
      rootId,
      "verifier",
      true,
    );
    insertGraphRow(db, rootId, verifierId, "verifier", [...workerIds]);

    const synthesizerId = newTaskId(db);
    insertSwarmChild(
      db,
      synthesizerId,
      `Synthesizer: ${root.title}`,
      projectRoot,
      `SISpace/tasks/${synthesizerId}.md`,
      rootId,
      rootId,
      "synthesizer",
      true,
    );
    insertGraphRow(db, rootId, synthesizerId, "synthesizer", [verifierId]);

    upsertSwarmMeta(db, rootId, workerIds, verifierId, synthesizerId);
    recordEvent(db, rootId, "swarm_created", {
      worker_ids: workerIds,
      verifier_id: verifierId,
      synthesizer_id: synthesizerId,
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const workers = workerIds
    .map((id) => summarize(db, id, "worker"))
    .filter((x): x is SwarmNodeSummary => !!x);
  const verifierRow = db
    .prepare("SELECT verifier_id FROM swarm_meta WHERE swarm_root_id = ?")
    .get(rootId) as { verifier_id: string } | undefined;
  const synthRow = db
    .prepare("SELECT synthesizer_id FROM swarm_meta WHERE swarm_root_id = ?")
    .get(rootId) as { synthesizer_id: string } | undefined;

  return {
    ok: true,
    rootId,
    workers,
    verifier: verifierRow?.verifier_id
      ? summarize(db, verifierRow.verifier_id, "verifier")
      : undefined,
    synthesizer: synthRow?.synthesizer_id
      ? summarize(db, synthRow.synthesizer_id, "synthesizer")
      : undefined,
  };
}
