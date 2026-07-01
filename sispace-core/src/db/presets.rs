use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspacePreset {
    pub name: String,
    pub layout_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetPaneSpec {
    pub title: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub skill_bundle: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub subagent_model_id: Option<String>,
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub swarm_role: Option<String>,
    #[serde(default)]
    pub gate_locked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceLayout {
    #[serde(default)]
    pub workspace_type: Option<String>,
    #[serde(default)]
    pub panes: Vec<PresetPaneSpec>,
    #[serde(default)]
    pub layout: Option<serde_json::Value>,
    #[serde(default)]
    pub harness_panel: Option<bool>,
    #[serde(default)]
    pub file_viewer: Option<bool>,
}

pub fn save_preset(conn: &Connection, name: &str, layout: &WorkspaceLayout) -> SqlResult<WorkspacePreset> {
    let layout_json = serde_json::to_string(layout).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;
    conn.execute(
        "INSERT INTO workspace_presets (name, layout_json, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
           layout_json = excluded.layout_json,
           updated_at = datetime('now')",
        params![name, layout_json],
    )?;
    get_preset(conn, name)
}

pub fn get_preset(conn: &Connection, name: &str) -> SqlResult<WorkspacePreset> {
    conn.query_row(
        "SELECT name, layout_json, created_at, updated_at FROM workspace_presets WHERE name = ?1",
        params![name],
        |row| {
            Ok(WorkspacePreset {
                name: row.get(0)?,
                layout_json: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
}

pub fn list_presets(conn: &Connection) -> SqlResult<Vec<WorkspacePreset>> {
    let mut stmt = conn.prepare(
        "SELECT name, layout_json, created_at, updated_at FROM workspace_presets ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkspacePreset {
            name: row.get(0)?,
            layout_json: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn delete_preset(conn: &Connection, name: &str) -> SqlResult<bool> {
    let n = conn.execute("DELETE FROM workspace_presets WHERE name = ?1", params![name])?;
    Ok(n > 0)
}

pub fn parse_layout_json(json: &str) -> Result<WorkspaceLayout, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid layout_json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open;

    #[test]
    fn save_and_list_preset() {
        let path = std::env::temp_dir().join(format!("sispace-preset-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = open(&path).expect("open");
        let layout = WorkspaceLayout {
            workspace_type: Some("sispace".into()),
            panes: vec![PresetPaneSpec {
                title: "coder-1".into(),
                cwd: None,
                command: None,
                task_id: None,
                skill_bundle: Some("feature".into()),
                model_id: Some("composer-2.5".into()),
                subagent_model_id: None,
                rows: Some(24),
                cols: Some(80),
                swarm_role: None,
                gate_locked: None,
            }],
            layout: None,
            harness_panel: Some(true),
            file_viewer: None,
        };
        let saved = save_preset(&conn, "test-preset", &layout).expect("save");
        assert_eq!(saved.name, "test-preset");
        let listed = list_presets(&conn).expect("list");
        assert_eq!(listed.len(), 1);
        let parsed = parse_layout_json(&listed[0].layout_json).expect("parse");
        assert_eq!(parsed.panes[0].title, "coder-1");
        let _ = std::fs::remove_file(path);
    }
}
