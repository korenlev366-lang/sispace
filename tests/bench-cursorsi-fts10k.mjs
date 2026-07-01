/**
 * Benchmark FTS discovery on 10k messages (Phase 0c target <20ms).
 * Run: node tests/bench-cursorsi-fts10k.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const MIGRATION = `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  task_type TEXT NOT NULL DEFAULT 'feature',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE task_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE task_messages_fts USING fts5(
  content,
  content='task_messages',
  content_rowid='id',
  tokenize='porter unicode61'
);
CREATE TRIGGER task_messages_ai AFTER INSERT ON task_messages BEGIN
  INSERT INTO task_messages_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

const tmp = mkdtempSync(join(tmpdir(), "cursorsi-fts-bench-"));
const dbPath = join(tmp, "bench.db");

try {
  const db = new DatabaseSync(dbPath);
  db.exec(MIGRATION);
  db.prepare(
    "INSERT INTO tasks (id, title, status, task_type) VALUES (?, ?, ?, ?)",
  ).run("t_bench", "Bench task", "in_progress", "feature");

  const insert = db.prepare(
    "INSERT INTO task_messages (task_id, role, content) VALUES (?, ?, ?)",
  );
  db.exec("BEGIN");
  for (let i = 0; i < 10_000; i += 1) {
    const content =
      i % 17 === 0
        ? `auth middleware token validation step ${i}`
        : `routine log line ${i}`;
    insert.run("t_bench", "assistant", content);
  }
  db.exec("COMMIT");

  const fts =
    '"auth" OR "middleware"';
  const stmt = db.prepare(
    `SELECT tm.task_id, tm.id, snippet(task_messages_fts, 0, '[[', ']]', '…', 48) AS snip,
            bm25(task_messages_fts) AS score
     FROM task_messages_fts
     JOIN task_messages tm ON tm.id = task_messages_fts.rowid
     WHERE task_messages_fts MATCH ?
     ORDER BY score
     LIMIT 40`,
  );

  const times = [];
  for (let i = 0; i < 20; i += 1) {
    const t0 = performance.now();
    stmt.all(fts);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];

  db.close();

  console.log(`bench-cursorsi-fts10k: median discovery query ${median.toFixed(2)}ms`);
  if (median >= 20) {
    console.error("FAIL: target is <20ms median");
    process.exit(1);
  }
  console.log("bench-cursorsi-fts10k: passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
