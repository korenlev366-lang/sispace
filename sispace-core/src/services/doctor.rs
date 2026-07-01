use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::services::node_host::project_root;

pub fn run_harness_doctor(project: &Path) -> Result<(String, i32), String> {
    let script = resolve_doctor_script(project);
    if !script.exists() {
        return Err(format!("harness-doctor.sh not found at {}", script.display()));
    }
    let output = Command::new("sh")
        .arg(&script)
        .arg(project)
        .output()
        .map_err(|e| format!("harness-doctor failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = if stderr.is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };
    Ok((combined, output.status.code().unwrap_or(1)))
}

pub fn run_meta_readiness(project: &Path) -> Result<String, String> {
    let script = resolve_meta_script(project);
    if !script.exists() {
        return Err(format!(
            "doctor-meta-readiness.sh not found at {}",
            script.display()
        ));
    }
    let output = Command::new("sh")
        .arg(&script)
        .arg(project)
        .output()
        .map_err(|e| format!("meta-readiness failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(if stderr.is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    })
}

fn resolve_doctor_script(project: &Path) -> PathBuf {
    let local = project.join("harness/scripts/harness-doctor.sh");
    if local.exists() {
        return local;
    }
    dirs::home_dir()
        .map(|h| h.join(".cursor-harness/harness/scripts/harness-doctor.sh"))
        .filter(|p| p.exists())
        .unwrap_or(local)
}

fn resolve_meta_script(project: &Path) -> PathBuf {
    let local = project.join("harness/scripts/doctor-meta-readiness.sh");
    if local.exists() {
        return local;
    }
    project_root().join("harness/scripts/doctor-meta-readiness.sh")
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MilestoneProgress {
    pub id: u32,
    pub title: String,
    pub current: u32,
    pub target: u32,
    pub passed: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MetaReadinessParsed {
    pub overall_ready: bool,
    pub milestones: Vec<MilestoneProgress>,
    pub raw: String,
}

pub fn parse_meta_readiness(raw: &str) -> MetaReadinessParsed {
    let mut milestones = Vec::new();
    let mut current_title = String::new();
    let mut id = 0u32;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit())
            && trimmed.contains('.')
        {
            id += 1;
            current_title = trimmed
                .split_once('.')
                .map(|(_, rest)| rest.trim().to_string())
                .unwrap_or_else(|| trimmed.to_string());
        } else if trimmed.starts_with("current:") {
            let (current, target, passed) = parse_current_line(trimmed);
            if !current_title.is_empty() {
                milestones.push(MilestoneProgress {
                    id,
                    title: current_title.clone(),
                    current,
                    target,
                    passed,
                });
            }
        }
    }

    let overall_ready = raw.contains("READY for meta-optimization loop")
        && !raw.contains("NOT READY for meta-optimization loop");

    MetaReadinessParsed {
        overall_ready,
        milestones,
        raw: raw.to_string(),
    }
}

fn parse_current_line(line: &str) -> (u32, u32, bool) {
    // current: 5 / 40  [FAIL]
    let nums: Vec<u32> = line
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    let current = nums.first().copied().unwrap_or(0);
    let target = nums.get(1).copied().unwrap_or(1);
    let passed = line.contains("[PASS]");
    (current, target, passed)
}

pub fn sidecar_watch_interval() -> Duration {
    Duration::from_secs(10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_meta_readiness_output() {
        let sample = r#"Meta-harness readiness
1. Full post-task sessions (1000+ output tokens)
   current: 5 / 40  [FAIL]
2. Rejected lessons with rubric reasons
   current: 15 / 15  [PASS]
Overall: NOT READY for meta-optimization loop
"#;
        let parsed = parse_meta_readiness(sample);
        assert!(!parsed.overall_ready);
        assert_eq!(parsed.milestones.len(), 2);
        assert_eq!(parsed.milestones[0].current, 5);
        assert_eq!(parsed.milestones[1].passed, true);
    }
}
