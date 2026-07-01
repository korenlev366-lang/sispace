CREATE TABLE IF NOT EXISTS workspace_presets (
    name TEXT PRIMARY KEY,
    layout_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_panes (
    id TEXT PRIMARY KEY,
    preset_name TEXT,
    title TEXT NOT NULL,
    cwd TEXT NOT NULL,
    command TEXT NOT NULL,
    event_socket TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'starting'
        CHECK (status IN ('starting', 'running', 'exited', 'crashed')),
    pid INTEGER,
    rows INTEGER NOT NULL DEFAULT 24,
    cols INTEGER NOT NULL DEFAULT 80,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_panes_preset ON workspace_panes(preset_name);
CREATE INDEX IF NOT EXISTS idx_workspace_panes_status ON workspace_panes(status);
