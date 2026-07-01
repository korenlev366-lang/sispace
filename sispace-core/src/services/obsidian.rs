use std::fs;
use std::path::{Path, PathBuf};

use reqwest::blocking::Client;

#[derive(Debug, Clone)]
pub struct ObsidianConfig {
    pub vault_root: String,
    pub tasks_folder: String,
    pub api_url: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct ObsidianSearchMatch {
    pub(crate) context: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ObsidianSearchRawHit {
    pub filename: String,
    pub score: f64,
    #[serde(default)]
    pub(crate) matches: Vec<ObsidianSearchMatch>,
}

impl Default for ObsidianConfig {
    fn default() -> Self {
        Self {
            vault_root: String::new(),
            tasks_folder: "SISpace/tasks".to_string(),
            api_url: "http://127.0.0.1:27123".to_string(),
        }
    }
}

pub fn load_config(project_root: &Path) -> ObsidianConfig {
    let path = project_root.join("harness/config/obsidian.yaml");
    let mut config = ObsidianConfig::default();
    if let Ok(raw) = fs::read_to_string(&path) {
        let mut in_folders = false;
        for line in raw.lines() {
            if line.trim().is_empty() || line.trim_start().starts_with('#') {
                continue;
            }
            if line.starts_with("folders:") {
                in_folders = true;
                continue;
            }
            if in_folders && line.starts_with("  ") && !line.starts_with("   ") {
                let trimmed = line.trim();
                if let Some(val) = trimmed.strip_prefix("tasks:") {
                    config.tasks_folder = yaml_scalar(val);
                }
            } else if !line.starts_with(' ') {
                in_folders = false;
            }
            let trimmed = line.trim();
            if trimmed.starts_with("vault_root:") {
                config.vault_root =
                    yaml_scalar(trimmed.strip_prefix("vault_root:").unwrap_or(""));
            }
        }
    } else {
        // Config file missing or unreadable — use defaults. This is normal during
        // first-run or test environments; Obsidian sync ops will fail gracefully later.
        eprintln!(
            "[obsidian] warning: config not found at {}, using defaults",
            path.display()
        );
    }
    config
}

fn yaml_scalar(raw: &str) -> String {
    let s = raw.trim().trim_matches('"').trim();
    s.to_string()
}

pub fn task_note_path(config: &ObsidianConfig, task_id: &str) -> String {
    format!("{}/{}.md", config.tasks_folder.trim_end_matches('/'), task_id)
}

pub fn qualify_task_link(tasks_folder: &str, task_id: &str) -> String {
    format!("{}/{}", tasks_folder.trim_end_matches('/'), task_id)
}

pub fn render_task_note(
    task_id: &str,
    title: &str,
    task_type: &str,
    project_root: &str,
    status: &str,
    goal: &str,
    related: &[String],
    tasks_folder: &str,
) -> String {
    let goal_body = if goal.trim().is_empty() {
        title.trim()
    } else {
        goal.trim()
    };

    let related_yaml = if related.is_empty() {
        "[]".to_string()
    } else {
        format!(
            "[{}]",
            related
                .iter()
                .map(|id| format!("\"{id}\""))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    let mut links_section = String::new();
    if !related.is_empty() {
        links_section.push_str("\n");
        for id in related {
            let qualified = qualify_task_link(tasks_folder, id);
            links_section.push_str(&format!("- [[{qualified}]]\n"));
        }
    }

    format!(
        r#"---
sispace_task_id: {task_id}
status: {status}
task_type: {task_type}
project: {project_root}
runtime: local
related: {related_yaml}
tags: [sispace, {task_type}]
---

# Goal

{goal_body}

## Constraints

## Task Knowledge

## Blackboard

## Verification

## Links
{links_section}
"#
    )
}

pub fn update_note_status(note: &str, status: &str) -> String {
    if let Some(end) = note.find("\n---") {
        let front = &note[..end];
        if front.contains("status:") {
            let updated: String = front
                .lines()
                .map(|line| {
                    if line.trim_start().starts_with("status:") {
                        format!("status: {status}")
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            return format!("{updated}{}", &note[end..]);
        }
    }
    note.to_string()
}

fn encode_vault_path(vault_relative: &str) -> String {
    vault_relative
        .split('/')
        .map(|segment| urlencoding::encode(segment).into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn auth_header(token: &str) -> String {
    let trimmed = token.trim();
    if trimmed.to_lowercase().starts_with("bearer ") {
        trimmed.to_string()
    } else {
        format!("Bearer {trimmed}")
    }
}

pub fn vault_write(api_url: &str, token: &str, vault_path: &str, body: &str) -> Result<(), String> {
    let base = api_url.trim_end_matches('/');
    let url = format!("{base}/vault/{}", encode_vault_path(vault_path));
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .put(url)
        .header("Authorization", auth_header(token))
        .header("Content-Type", "text/markdown")
        .body(body.to_string())
        .send()
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let detail = response.text().unwrap_or_default();
        Err(format!(
            "obsidian write failed ({status}): {}",
            &detail[..detail.len().min(200)]
        ))
    }
}

pub fn vault_delete(api_url: &str, token: &str, vault_path: &str) -> Result<(), String> {
    let base = api_url.trim_end_matches('/');
    let url = format!("{base}/vault/{}", encode_vault_path(vault_path));
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .delete(url)
        .header("Authorization", auth_header(token))
        .send()
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let detail = response.text().unwrap_or_default();
        Err(format!(
            "obsidian delete failed ({status}): {}",
            &detail[..detail.len().min(200)]
        ))
    }
}

pub fn vault_read(api_url: &str, token: &str, vault_path: &str) -> Result<String, String> {
    let base = api_url.trim_end_matches('/');
    let url = format!("{base}/vault/{}", encode_vault_path(vault_path));
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .header("Authorization", auth_header(token))
        .send()
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        response.text().map_err(|e| e.to_string())
    } else {
        Err(format!("obsidian read failed: {}", response.status()))
    }
}

pub fn vault_search_simple(
    api_url: &str,
    token: &str,
    query: &str,
    context_length: u32,
) -> Result<Vec<ObsidianSearchRawHit>, String> {
    let base = api_url.trim_end_matches('/');
    let url = format!(
        "{base}/search/simple/?query={}&contextLength={context_length}",
        urlencoding::encode(query)
    );
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(url)
        .header("Authorization", auth_header(token))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("obsidian search failed: {}", response.status()));
    }

    response
        .json::<Vec<ObsidianSearchRawHit>>()
        .map_err(|e| e.to_string())
}

pub fn extract_wikilinks(markdown: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut i = 0;
    let bytes = markdown.as_bytes();
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            i += 2;
            let start = i;
            while i + 1 < bytes.len() && !(bytes[i] == b']' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 < bytes.len() {
                let raw = &markdown[start..i];
                let target = raw.split('|').next().unwrap_or(raw).trim();
                if !target.is_empty() && seen.insert(target.to_string()) {
                    links.push(target.to_string());
                }
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    links
}

pub fn vault_name(config: &ObsidianConfig) -> String {
    if config.vault_root.is_empty() {
        return "vault".to_string();
    }
    std::path::Path::new(&config.vault_root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("vault")
        .to_string()
}

pub fn obsidian_open_uri(config: &ObsidianConfig, vault_relative_path: &str) -> String {
    let name = vault_name(config);
    let vault = urlencoding::encode(&name);
    let file = urlencoding::encode(vault_relative_path);
    format!("obsidian://open?vault={vault}&file={file}")
}

pub fn task_id_from_obsidian_path(path: &str) -> Option<String> {
    let stem = path.rsplit('/').next()?.strip_suffix(".md")?;
    if stem.starts_with("t_") {
        Some(stem.to_string())
    } else {
        None
    }
}

pub fn obsidian_hit_context(hit: &ObsidianSearchRawHit) -> String {
    hit.matches
        .iter()
        .map(|m| m.context.as_str())
        .collect::<Vec<_>>()
        .join(" … ")
}

pub fn related_ids_from_obsidian_hits(hits: &[ObsidianSearchRawHit], exclude_id: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = std::collections::HashSet::new();
    seen.insert(exclude_id.to_string());
    for hit in hits {
        if let Some(id) = task_id_from_obsidian_path(&hit.filename) {
            if seen.insert(id.clone()) {
                ids.push(id);
            }
        }
    }
    ids
}

pub fn resolve_project_root(default_root: &Path, input: Option<&str>) -> PathBuf {
    input
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_root.to_path_buf())
}

pub fn obsidian_token() -> Option<String> {
    std::env::var("OBSIDIAN_API_KEY").ok().filter(|s| !s.trim().is_empty())
}

pub fn sync_task_note_create(
    config: &ObsidianConfig,
    task_id: &str,
    title: &str,
    task_type: &str,
    project_root: &str,
    goal: &str,
    related: &[String],
) -> Result<(), String> {
    let token = obsidian_token().ok_or_else(|| "OBSIDIAN_API_KEY not set".to_string())?;
    let path = task_note_path(config, task_id);
    let body = render_task_note(
        task_id,
        title,
        task_type,
        project_root,
        "todo",
        goal,
        related,
        &config.tasks_folder,
    );
    vault_write(&config.api_url, &token, &path, &body)?;
    Ok(())
}

pub fn sync_task_note_status(
    config: &ObsidianConfig,
    note_path: &str,
    new_status: &str,
) -> Result<(), String> {
    let token = obsidian_token().ok_or_else(|| "OBSIDIAN_API_KEY not set".to_string())?;
    let existing = vault_read(&config.api_url, &token, note_path)?;
    let updated = update_note_status(&existing, new_status);
    vault_write(&config.api_url, &token, note_path, &updated)
}

pub fn append_section(note: &str, heading: &str, content: &str) -> String {
    let stamp = chrono_like_timestamp();
    let block = format!("\n\n### {heading} entry ({stamp})\n\n{content}\n");
    if let Some(idx) = note.find(&format!("## {heading}")) {
        let after = note[idx..].find("\n## ").map(|rel| idx + rel).unwrap_or(note.len());
        let mut out = String::new();
        out.push_str(&note[..after]);
        out.push_str(&block);
        out.push_str(&note[after..]);
        return out;
    }
    format!("{note}{block}")
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

pub fn init_blackboard(note: &str) -> String {
    if note.contains("## Blackboard") {
        if !note.contains("## Blackboard\n\n") && !note.contains("## Blackboard\r\n\r\n") {
            return note.replace("## Blackboard", "## Blackboard\n\n_(orchestrator writes; workers read via MCP)_\n");
        }
        return note.to_string();
    }
    note.replace(
        "## Blackboard",
        "## Blackboard\n\n_(orchestrator writes; workers read via MCP)_\n",
    )
}

pub fn append_blackboard(note: &str, content: &str) -> String {
    append_section(note, "Blackboard", content)
}

/// Extract markdown body under `## Blackboard` until the next `##` heading.
pub fn extract_blackboard_section(note: &str) -> String {
    extract_section(note, "Blackboard")
}

pub fn extract_section(note: &str, heading: &str) -> String {
    let marker = format!("## {heading}");
    let Some(idx) = note.find(&marker) else {
        return String::new();
    };
    let start = idx + marker.len();
    let rest = &note[start..];
    let body_start = rest.trim_start_matches(['\r', '\n']).len();
    let body = &rest[body_start.min(rest.len())..];
    let end = body
        .find("\n## ")
        .or_else(|| body.find("\r\n## "))
        .unwrap_or(body.len());
    body[..end].trim().to_string()
}

pub fn append_human_review_rejection(note: &str, content: &str) -> String {
    let body = format!("**Rejected** — {content}");
    if note.contains("## Human Review") {
        return append_section(note, "Human Review", &body);
    }
    format!(
        "{note}\n\n## Human Review\n\n### Rejection entry ({})\n\n{body}\n",
        chrono_like_timestamp()
    )
}

pub fn sync_note_body(config: &ObsidianConfig, note_path: &str, body: &str) -> Result<(), String> {
    let token = obsidian_token().ok_or_else(|| "OBSIDIAN_API_KEY not set".to_string())?;
    vault_write(&config.api_url, &token, note_path, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_frontmatter_status() {
        let note = render_task_note(
            "t_abc",
            "Title",
            "feature",
            "/proj",
            "todo",
            "Do thing",
            &[],
            "SISpace/tasks",
        );
        let updated = update_note_status(&note, "in_progress");
        assert!(updated.contains("status: in_progress"));
        assert!(!updated.contains("status: todo"));
    }

    #[test]
    fn renders_path_qualified_task_links() {
        let note = render_task_note(
            "t_abc",
            "Title",
            "feature",
            "/proj",
            "todo",
            "Do thing",
            &["t_def".to_string()],
            "SISpace/tasks",
        );
        assert!(note.contains("[[SISpace/tasks/t_def]]"));
        assert!(!note.contains("[[t_def]]"));
    }
}
