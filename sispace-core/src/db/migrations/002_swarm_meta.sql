CREATE TABLE IF NOT EXISTS swarm_meta (
    swarm_root_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    worker_ids_json TEXT NOT NULL DEFAULT '[]',
    verifier_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    synthesizer_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    workers_complete INTEGER NOT NULL DEFAULT 0,
    verifier_passed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_swarm_meta_verifier ON swarm_meta(verifier_id);
