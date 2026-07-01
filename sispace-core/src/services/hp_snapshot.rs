use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::services::doctor::{parse_meta_readiness, run_meta_readiness, MetaReadinessParsed};
use crate::services::node_host::project_root;
use crate::services::obsidian::resolve_project_root;

#[derive(Debug, Clone, Serialize)]
pub struct HarnessLedgerEntry {
    pub id: String,
    pub title: String,
    pub body: String,
    pub status: Option<String>,
    pub target_layer: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RolloutTimelineEntry {
    pub id: String,
    pub timestamp: Option<String>,
    pub session_id: Option<String>,
    pub gate_action: Option<String>,
    pub gate_result: Option<String>,
    pub proposal_id: Option<String>,
    pub change_summary: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HarnessPanelSnapshot {
    pub project_root: String,
    pub meta_readiness: MetaReadinessParsed,
    pub pending_proposals: Vec<HarnessLedgerEntry>,
    pub accepted_lessons: Vec<HarnessLedgerEntry>,
    pub rejected_lessons: Vec<HarnessLedgerEntry>,
    pub reasoning_patterns: Vec<HarnessLedgerEntry>,
    pub rollout_entries: Vec<RolloutTimelineEntry>,
    pub user_model: String,
    pub latest_reflection: String,
    pub latest_grade: String,
    pub doctor_report: String,
}

fn memory_path(root: &Path, name: &str) -> PathBuf {
    root.join("harness").join("memory").join(name)
}

fn reports_path(root: &Path, name: &str) -> PathBuf {
    root.join("harness").join("reports").join(name)
}

fn read_file_lossy(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

pub fn parse_section_entries(content: &str, prefix: &str) -> Vec<HarnessLedgerEntry> {
    let mut entries = Vec::new();
    let mut current_id = String::new();
    let mut current_title = String::new();
    let mut current_lines: Vec<String> = Vec::new();

    let flush = |entries: &mut Vec<HarnessLedgerEntry>,
                 id: &str,
                 title: &str,
                 lines: &[String]| {
        if id.is_empty() {
            return;
        }
        let body = lines.join("\n").trim().to_string();
        let status = field_value(&body, "Status");
        let target_layer = field_value(&body, "Target layer");
        let summary = field_value(&body, "Summary")
            .or_else(|| field_value(&body, "Proposed change"));
        entries.push(HarnessLedgerEntry {
            id: id.to_string(),
            title: title.to_string(),
            body,
            status,
            target_layer,
            summary,
        });
    };

    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("### ") {
            let heading = rest.trim();
            if heading.starts_with(prefix) {
                flush(&mut entries, &current_id, &current_title, &current_lines);
                current_lines.clear();
                if let Some((id, title)) = heading.split_once(':') {
                    current_id = id.trim().to_string();
                    current_title = title.trim().to_string();
                } else {
                    current_id = heading.to_string();
                    current_title = String::new();
                }
                continue;
            }
        }
        if !current_id.is_empty() {
            current_lines.push(line.to_string());
        }
    }
    flush(&mut entries, &current_id, &current_title, &current_lines);
    entries
}

/// Hide proposals already applied unless a locked-layer panel apply still needs file edits.
fn proposal_visible_in_panel(status: &Option<String>, target_layer: &Option<String>) -> bool {
    let Some(st) = status else {
        return true;
    };
    let lower = st.to_lowercase();
    if !lower.contains("applied") {
        return true;
    }
    if !lower.contains("harness panel apply-all") {
        return false;
    }
    let layer = target_layer
        .as_deref()
        .unwrap_or("")
        .to_lowercase()
        .replace(' ', "-");
    ["rules", "rule", "hooks", "hook", "skills", "skill", "commands", "command", "mcp", "user-model"]
        .iter()
        .any(|locked| layer.contains(locked))
}

fn field_value(body: &str, key: &str) -> Option<String> {
    let needle = format!("- {key}:");
    for line in body.lines() {
        let t = line.trim();
        if t.starts_with(&needle) {
            return Some(t[needle.len()..].trim().to_string());
        }
    }
    None
}

pub fn parse_rollout_entries(content: &str) -> Vec<RolloutTimelineEntry> {
    let mut entries = Vec::new();
    let mut current_id = String::new();
    let mut lines: Vec<String> = Vec::new();

    let flush = |entries: &mut Vec<RolloutTimelineEntry>, id: &str, lines: &[String]| {
        if id.is_empty() {
            return;
        }
        let body = lines.join("\n");
        entries.push(RolloutTimelineEntry {
            id: id.to_string(),
            timestamp: field_value(&body, "Timestamp"),
            session_id: field_value(&body, "Session ID"),
            gate_action: field_value(&body, "Gate action"),
            gate_result: field_value(&body, "Gate result"),
            proposal_id: field_value(&body, "Proposal ID"),
            change_summary: field_value(&body, "Change summary"),
            body,
        });
    };

    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("### ROLLOUT-") {
            flush(&mut entries, &current_id, &lines);
            lines.clear();
            current_id = format!("ROLLOUT-{rest}");
            continue;
        }
        if let Some(rest) = line.strip_prefix("### ") {
            let heading = rest.trim();
            if heading.starts_with("ROLLOUT-") {
                flush(&mut entries, &current_id, &lines);
                lines.clear();
                current_id = heading.to_string();
                continue;
            }
        }
        if !current_id.is_empty() {
            lines.push(line.to_string());
        }
    }
    flush(&mut entries, &current_id, &lines);
    entries
}

pub fn build_snapshot(project_root_override: Option<&str>) -> Result<HarnessPanelSnapshot, String> {
    let root = resolve_project_root(&project_root(), project_root_override);
    let meta_raw = run_meta_readiness(&root)?;
    let meta = parse_meta_readiness(&meta_raw);

    let pending = read_file_lossy(&memory_path(&root, "pending-proposals.md"));
    let accepted = read_file_lossy(&memory_path(&root, "accepted-lessons.md"));
    let rejected = read_file_lossy(&memory_path(&root, "rejected-lessons.md"));
    let patterns = read_file_lossy(&memory_path(&root, "reasoning-patterns.md"));
    let rollout = read_file_lossy(&reports_path(&root, "rollout-log.md"));
    let user_model = read_file_lossy(&memory_path(&root, "user-model.md"));

    Ok(HarnessPanelSnapshot {
        project_root: root.to_string_lossy().into_owned(),
        meta_readiness: meta,
        pending_proposals: parse_section_entries(&pending, "PROP-")
            .into_iter()
            .chain(parse_section_entries(&pending, "PENDING-"))
            .filter(|e| proposal_visible_in_panel(&e.status, &e.target_layer))
            .collect(),
        accepted_lessons: parse_section_entries(&accepted, "ACCEPTED-")
            .into_iter()
            .chain(parse_section_entries(&accepted, "PROP-"))
            .collect(),
        rejected_lessons: parse_section_entries(&rejected, "REJECTED-"),
        reasoning_patterns: parse_section_entries(&patterns, "PATTERN-"),
        rollout_entries: parse_rollout_entries(&rollout),
        user_model,
        latest_reflection: read_file_lossy(&reports_path(&root, "latest-reflection.md")),
        latest_grade: read_file_lossy(&reports_path(&root, "latest-grade.md")),
        doctor_report: String::new(),
    })
}

pub fn spawn_reflect_chain(project_root: &Path) -> Result<String, String> {
    let chain_parts = ["invoke", "-chain", ".sh"];
    let script = project_root.join("scripts").join(chain_parts.join(""));
    if !script.exists() {
        return Err(format!(
            "invoke-chain.sh not found at {}",
            script.display()
        ));
    }
    let session_id = format!("sispace-harness-{}", chrono_lite_id());
    let generation_id = format!("harness-panel-{session_id}");
    let tmp = std::env::temp_dir().join(format!("sispace-harness-reflect-{session_id}.txt"));
    std::fs::write(
        &tmp,
        "[harness-panel] Manual reflect from SISpace V2 harness tab.\n",
    )
    .map_err(|e| e.to_string())?;

    let output = Command::new("sh")
        .arg(&script)
        .arg(project_root)
        .arg(&session_id)
        .arg(&generation_id)
        .arg("1500")
        .arg(&tmp)
        .output()
        .map_err(|e| format!("reflect chain failed: {e}"))?;

    let code = output.status.code().unwrap_or(1);
    if code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("invoke-chain exited {code}: {stderr}"));
    }
    Ok(format!("Reflection chain completed (session {session_id})"))
}

pub fn spawn_panel_script(
    project_root: &Path,
    action: &str,
    extra_args: &[&str],
) -> Result<String, String> {
    let script = project_root
        .join("harness")
        .join("scripts")
        .join("dist")
        .join("panel-actions.js");
    if !script.exists() {
        return Err(format!(
            "panel-actions.js not found at {} — run npm run build in harness/scripts",
            script.display()
        ));
    }
    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .arg(action)
        .arg("--project-root")
        .arg(project_root);
    for arg in extra_args {
        cmd.arg(arg);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("panel action {action} failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output.status.code().unwrap_or(1);
    if code != 0 {
        return Err(if stderr.is_empty() {
            format!("panel {action} exited {code}: {stdout}")
        } else {
            format!("panel {action} exited {code}: {stderr}")
        });
    }
    Ok(stdout.trim().to_string())
}

fn chrono_lite_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_applied_proposals_except_locked_layer_reapply() {
        let sample = r#"### PROP-20250603-004: Memory note
- Target layer: memory
- Status: **applied** 2026-06-04 (harness panel apply-all)
### PROP-20250603-007: Researcher checklist
- Target layer: skill
- Status: **applied** 2026-06-04 (harness panel apply-all)
### PROP-20260604-002: Pending
- Target layer: docs
- Status: pending
"#;
        let entries: Vec<_> = parse_section_entries(sample, "PROP-")
            .into_iter()
            .filter(|e| proposal_visible_in_panel(&e.status, &e.target_layer))
            .collect();
        assert_eq!(entries.len(), 2);
        let ids: Vec<_> = entries.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"PROP-20260604-002"));
        assert!(ids.contains(&"PROP-20250603-007"));
        assert!(!ids.contains(&"PROP-20250603-004"));
    }

    #[test]
    fn parses_prop_sections() {
        let sample = r#"## Entries
### PROP-20250603-001: Test title

- Target layer: skill
- Summary: Do the thing
- Status: pending
"#;
        let entries = parse_section_entries(sample, "PROP-");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "PROP-20250603-001");
        assert_eq!(entries[0].title, "Test title");
        assert_eq!(entries[0].target_layer.as_deref(), Some("skill"));
    }

    #[test]
    fn parses_rollout_sections() {
        let sample = r#"### ROLLOUT-20260603-050309-sdk

- Timestamp: 2026-06-03T02:03:09.582Z
- Session ID: abc
- Gate action: blocked_locked_layer
"#;
        let entries = parse_rollout_entries(sample);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "ROLLOUT-20260603-050309-sdk");
        assert_eq!(entries[0].session_id.as_deref(), Some("abc"));
    }
}
