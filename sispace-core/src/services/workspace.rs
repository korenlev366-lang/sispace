use crate::db::presets::{
    self, parse_layout_json, save_preset, PresetPaneSpec, WorkspaceLayout, WorkspacePreset,
};
use crate::services::pane::{PaneInfo, PaneSpawnConfig};
use crate::services::pane_ipc::PaneIpcContext;
use crate::state::AppState;

pub fn list_presets(state: &AppState) -> Result<Vec<WorkspacePreset>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    presets::list_presets(&conn).map_err(|e| e.to_string())
}

pub fn save_preset_layout(
    state: &AppState,
    name: &str,
    layout: &WorkspaceLayout,
) -> Result<WorkspacePreset, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_preset(&conn, name, layout).map_err(|e| e.to_string())
}

pub fn delete_preset(state: &AppState, name: &str) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    presets::delete_preset(&conn, name).map_err(|e| e.to_string())
}

pub fn layout_from_panes(panes: &[PaneInfo]) -> WorkspaceLayout {
    WorkspaceLayout {
        workspace_type: Some("sispace".into()),
        panes: panes
            .iter()
            .map(|p| PresetPaneSpec {
                title: p.title.clone(),
                cwd: Some(p.cwd.clone()),
                command: Some(p.command.clone()),
                task_id: p.task_id.clone(),
                skill_bundle: None,
                model_id: None,
                subagent_model_id: None,
                rows: Some(p.rows),
                cols: Some(p.cols),
                swarm_role: p.swarm_role.clone(),
                gate_locked: Some(p.gate_locked),
            })
            .collect(),
        layout: None,
        harness_panel: Some(true),
        file_viewer: None,
    }
}

pub fn default_solo_layout(project_root: &str) -> WorkspaceLayout {
    WorkspaceLayout {
        workspace_type: Some("sispace".into()),
        panes: vec![PresetPaneSpec {
            title: "agent".into(),
            cwd: Some(project_root.to_string()),
            command: None,
            task_id: None,
            skill_bundle: None,
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
    }
}

pub fn default_duo_layout(project_root: &str) -> WorkspaceLayout {
    WorkspaceLayout {
        workspace_type: Some("sispace".into()),
        panes: vec![
            PresetPaneSpec {
                title: "pane-1".into(),
                cwd: Some(project_root.to_string()),
                command: None,
                task_id: None,
                skill_bundle: None,
                model_id: Some("composer-2.5".into()),
                subagent_model_id: None,
                rows: Some(24),
                cols: Some(80),
                swarm_role: None,
                gate_locked: None,
            },
            PresetPaneSpec {
                title: "pane-2".into(),
                cwd: Some(project_root.to_string()),
                command: None,
                task_id: None,
                skill_bundle: None,
                model_id: Some("composer-2.5".into()),
                subagent_model_id: None,
                rows: Some(24),
                cols: Some(80),
                swarm_role: None,
                gate_locked: None,
            },
        ],
        layout: None,
        harness_panel: Some(true),
        file_viewer: None,
    }
}

/// Seed `sispace-solo` / `sispace-duo` when the presets table is empty.
pub fn ensure_default_presets(state: &AppState, project_root: &str) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let existing = presets::list_presets(&conn).map_err(|e| e.to_string())?;
    if !existing.is_empty() {
        return Ok(());
    }
    save_preset(&conn, "sispace-solo", &default_solo_layout(project_root))
        .map_err(|e| e.to_string())?;
    save_preset(&conn, "sispace-duo", &default_duo_layout(project_root))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn spec_to_spawn_config(spec: PresetPaneSpec) -> PaneSpawnConfig {
    PaneSpawnConfig {
        title: spec.title,
        cwd: spec.cwd,
        command: spec.command,
        task_id: spec.task_id,
        skill_bundle: spec.skill_bundle,
        model_id: spec.model_id,
        subagent_model_id: spec.subagent_model_id,
        rows: spec.rows.unwrap_or(24),
        cols: spec.cols.unwrap_or(80),
        swarm_role: spec.swarm_role,
        gate_locked: spec.gate_locked,
    }
}

pub fn apply_preset_for_vte(
    ctx: &PaneIpcContext,
    state: &AppState,
    name: &str,
) -> Result<Vec<PaneInfo>, String> {
    let layout = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let preset = presets::get_preset(&conn, name).map_err(|e| e.to_string())?;
        parse_layout_json(&preset.layout_json)?
    };

    let mut spawned = Vec::new();
    for spec in layout.panes {
        let config = spec_to_spawn_config(spec);
        let info = state.pane_manager.spawn_for_vte(ctx, config)?;
        spawned.push(info);
    }
    Ok(spawned)
}
