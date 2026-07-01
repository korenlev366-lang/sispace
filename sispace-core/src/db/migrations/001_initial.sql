CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'in_review', 'complete', 'reflected', 'learned')),
    task_type TEXT NOT NULL DEFAULT 'custom'
        CHECK (task_type IN ('feature', 'bug', 'docs', 'swarm', 'custom')),
    project_root TEXT,
    assignee_agent TEXT,
    parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    swarm_root_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    obsidian_note_path TEXT,
    cursor_agent_id TEXT,
    cursor_run_id TEXT,
    runtime TEXT NOT NULL DEFAULT 'local' CHECK (runtime IN ('local', 'cloud')),
    model_id TEXT,
    skill_bundle TEXT,
    cloud_repo_url TEXT,
    reflection_locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    reflected_at TEXT,
    learned_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_root);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);

CREATE TABLE IF NOT EXISTS task_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    token_count INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id, id);

CREATE VIRTUAL TABLE IF NOT EXISTS task_messages_fts USING fts5(
    content,
    content='task_messages',
    content_rowid='id',
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS task_messages_ai AFTER INSERT ON task_messages BEGIN
    INSERT INTO task_messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS task_messages_ad AFTER DELETE ON task_messages BEGIN
    INSERT INTO task_messages_fts(task_messages_fts, rowid, content)
    VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS task_messages_au AFTER UPDATE ON task_messages BEGIN
    INSERT INTO task_messages_fts(task_messages_fts, rowid, content)
    VALUES ('delete', old.id, old.content);
    INSERT INTO task_messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TABLE IF NOT EXISTS terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    pid INTEGER NOT NULL,
    cmd TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'stopped', 'crashed')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at TEXT
);

CREATE TABLE IF NOT EXISTS swarm_graph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    swarm_root_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('root', 'worker', 'verifier', 'synthesizer')),
    gate_on_task_ids TEXT NOT NULL DEFAULT '[]',
    UNIQUE (swarm_root_id, task_id)
);
