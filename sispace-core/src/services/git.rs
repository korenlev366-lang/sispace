use std::path::Path;
use std::process::Command;

pub fn detect_git_remote(project_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            project_root.to_string_lossy().as_ref(),
            "remote",
            "get-url",
            "origin",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}
