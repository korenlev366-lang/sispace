/**
 * Verify stale Cursor active-run recovery (cancel race fix).
 * Run: node tests/verify-cursorsi-stale-run.mjs
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

assert(
  existsSync(path.join(root, "cli/src/sdk/cursor-stale-run.ts")),
  "cursor-stale-run.ts exists",
);

const stale = read("cli/src/sdk/cursor-stale-run.ts");
assert(stale.includes("forceCancelStaleCursorActiveRun"), "forceCancel export");
assert(stale.includes("already has active run"), "error matcher");
assert(stale.includes("sdk-agent-store"), "scans sdk-agent-store");

const backend = read("cli/src/sdk/cursor-agent-backend.ts");
assert(backend.includes("forceCancelStaleCursorActiveRun"), "backend recovers stale run");
assert(backend.includes("isAlreadyHasActiveRunError"), "backend detects active-run error");
assert(backend.includes("run.cancel"), "backend awaits run.cancel");

const session = read("cli/src/sdk/session-agent.ts");
assert(
  session.includes("Do NOT close the agent handle here") ||
    session.includes("onAbortSideEffects"),
  "session-agent does not close-on-abort before cancel",
);
assert(
  !/onAbort\s*=\s*\(\)\s*=>\s*\{[\s\S]*?agent\.close\(\)/.test(session),
  "session-agent abort no longer calls agent.close()",
);

const dist = path.join(root, "cli/dist/sdk/cursor-stale-run.js");
assert(existsSync(dist), "cli/dist/sdk/cursor-stale-run.js built");

if (existsSync(dist)) {
  const { forceCancelStaleCursorActiveRun, isAlreadyHasActiveRunError } =
    await import(pathToFileURL(dist).href);

  assert(
    isAlreadyHasActiveRunError(
      new Error("Agent agent-x already has active run"),
    ),
    "isAlreadyHasActiveRunError true",
  );
  assert(
    !isAlreadyHasActiveRunError(new Error("unrelated")),
    "isAlreadyHasActiveRunError false",
  );

  const project = path.join(
    homedir(),
    ".cursor",
    "projects",
    "_cursorsi-stale-run-test",
    "sdk-agent-store",
    "testhash",
  );
  mkdirSync(project, { recursive: true });
  const dbPath = path.join(project, "index.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE agents (
      agent_id TEXT PRIMARY KEY,
      status TEXT,
      active_run_id TEXT,
      updated_at TEXT
    );
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY,
      agent_id TEXT,
      status TEXT,
      updated_at TEXT,
      cancelled_at TEXT
    );
  `);
  const aid = "agent-test-stale-run-001";
  const rid = "run-test-stale-001";
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (agent_id, status, active_run_id, updated_at) VALUES (?, 'RUNNING', ?, ?)`,
  ).run(aid, rid, now);
  db.prepare(
    `INSERT INTO runs (run_id, agent_id, status, updated_at, cancelled_at) VALUES (?, ?, 'RUNNING', ?, NULL)`,
  ).run(rid, aid, now);
  db.close();

  const cleared = forceCancelStaleCursorActiveRun(aid);
  assert(cleared, "forceCancel cleared synthetic row");

  const check = new DatabaseSync(dbPath);
  const agent = check
    .prepare(`SELECT status, active_run_id FROM agents WHERE agent_id=?`)
    .get(aid);
  const run = check
    .prepare(`SELECT status FROM runs WHERE run_id=?`)
    .get(rid);
  check.close();
  rmSync(path.join(homedir(), ".cursor", "projects", "_cursorsi-stale-run-test"), {
    recursive: true,
    force: true,
  });

  assert(agent?.status === "IDLE", "agent IDLE after clear");
  assert(agent?.active_run_id == null, "active_run_id null after clear");
  assert(run?.status === "CANCELLED", "run CANCELLED after clear");
}

if (failures.length) {
  console.error("FAIL:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("ok — stale Cursor active-run recovery verified");
