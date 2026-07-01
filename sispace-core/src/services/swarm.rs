//! Git worktree isolation for SISwarm workers (Grok Build-style).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

const WORKTREES_DIR: &str = ".sispace-worktrees";

/// Whether `project_root` is inside a git repository.
pub fn detect_git_repo(project_root: &Path) -> bool {
    Command::new("git")
        .args([
            "-C",
            &project_root.to_string_lossy(),
            "rev-parse",
            "--git-dir",
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn worker_branch_name(worker_id: &str) -> String {
    format!("sispace/worker-{worker_id}")
}

pub fn worker_worktree_rel_path(worker_id: &str) -> PathBuf {
    PathBuf::from(WORKTREES_DIR).join(format!("worker-{worker_id}"))
}

pub fn worker_worktree_abs(project_root: &Path, worker_id: &str) -> PathBuf {
    project_root.join(worker_worktree_rel_path(worker_id))
}

#[derive(Debug, Clone, Default)]
pub struct WorktreeLayout {
    pub git_available: bool,
    /// worker task id → absolute worktree path
    pub worker_paths: HashMap<String, String>,
}

impl WorktreeLayout {
    pub fn cwd_for_worker(&self, worker_id: &str, project_root: &str) -> String {
        self.worker_paths
            .get(worker_id)
            .cloned()
            .unwrap_or_else(|| project_root.to_string())
    }
}

/// Create isolated git worktrees for each worker (no-op when not a git repo).
pub fn prepare_worker_worktrees(
    project_root: &Path,
    worker_ids: &[String],
) -> Result<WorktreeLayout, String> {
    if !detect_git_repo(project_root) {
        eprintln!("[swarm] git worktrees unavailable, sharing root");
        return Ok(WorktreeLayout::default());
    }

    let parent = project_root.join(WORKTREES_DIR);
    std::fs::create_dir_all(&parent).map_err(|e| format!("mkdir {WORKTREES_DIR}: {e}"))?;

    let mut worker_paths = HashMap::new();
    for id in worker_ids {
        let branch = worker_branch_name(id);
        let wt_path = worker_worktree_abs(project_root, id);
        let wt_str = wt_path.to_string_lossy().into_owned();

        if wt_path.exists() {
            let _ = remove_worktree_path(project_root, &wt_path);
        }

        let created = git_worktree_add(project_root, &branch, &wt_path, true);
        if !created {
            let _ = git_worktree_add(project_root, &branch, &wt_path, false);
        }

        if !wt_path.is_dir() {
            return Err(format!("worktree not created at {wt_str}"));
        }

        worker_paths.insert(id.clone(), wt_str);
    }

    Ok(WorktreeLayout {
        git_available: true,
        worker_paths,
    })
}

fn git_worktree_add(project_root: &Path, branch: &str, wt_path: &Path, create_branch: bool) -> bool {
    let root = project_root.to_string_lossy().into_owned();
    let wt_arg = wt_path.to_string_lossy().into_owned();
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&root).arg("worktree").arg("add");
    if create_branch {
        cmd.arg("-b").arg(branch).arg(&wt_arg).arg("HEAD");
    } else {
        cmd.arg(&wt_arg).arg(branch);
    }
    cmd.output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn remove_worktree_path(project_root: &Path, wt_path: &Path) -> bool {
    Command::new("git")
        .args([
            "-C",
            &project_root.to_string_lossy(),
            "worktree",
            "remove",
            "--force",
            &wt_path.to_string_lossy(),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Remove all worker worktrees for a swarm session.
pub fn remove_worker_worktrees(project_root: &Path, worker_ids: &[String]) {
    if !detect_git_repo(project_root) {
        return;
    }
    for id in worker_ids {
        let wt_path = worker_worktree_abs(project_root, id);
        if wt_path.exists() {
            let _ = remove_worktree_path(project_root, &wt_path);
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkerMergeStatus {
    pub task_id: String,
    pub branch: String,
    pub status: String,
    pub has_conflicts: bool,
    pub merged: bool,
    pub message: String,
}

fn branch_exists(project_root: &Path, branch: &str) -> bool {
    Command::new("git")
        .args([
            "-C",
            &project_root.to_string_lossy(),
            "show-ref",
            "--verify",
            &format!("refs/heads/{branch}"),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Dry-run merge conflict check for a worker branch against current HEAD.
pub fn worker_branch_has_conflicts(project_root: &Path, worker_id: &str) -> bool {
    let branch = worker_branch_name(worker_id);
    if !branch_exists(project_root, &branch) {
        return false;
    }
    let root = project_root.to_string_lossy().into_owned();
    let merge = Command::new("git")
        .args(["-C", &root, "merge", "--no-commit", "--no-ff", &branch])
        .output();
    let merge_ok = merge.as_ref().map(|o| o.status.success()).unwrap_or(false);
    let conflicts = Command::new("git")
        .args(["-C", &root, "diff", "--name-only", "--diff-filter=U"])
        .output()
        .ok()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);
    let _ = Command::new("git")
        .args(["-C", &root, "merge", "--abort"])
        .output();
    !merge_ok || conflicts
}

/// Merge completed worker branches into the current branch with --no-ff.
pub fn merge_worker_branches(
    project_root: &Path,
    workers: &[(String, String)],
) -> Vec<WorkerMergeStatus> {
    if !detect_git_repo(project_root) {
        return workers
            .iter()
            .map(|(id, status)| WorkerMergeStatus {
                task_id: id.clone(),
                branch: worker_branch_name(id),
                status: status.clone(),
                has_conflicts: false,
                merged: false,
                message: "not a git repo".into(),
            })
            .collect();
    }

    let root = project_root.to_string_lossy().into_owned();
    workers
        .iter()
        .map(|(id, task_status)| {
            let branch = worker_branch_name(id);
            if task_status != "complete" {
                return WorkerMergeStatus {
                    task_id: id.clone(),
                    branch: branch.clone(),
                    status: task_status.clone(),
                    has_conflicts: false,
                    merged: false,
                    message: "worker not complete — skipped".into(),
                };
            }
            if !branch_exists(project_root, &branch) {
                return WorkerMergeStatus {
                    task_id: id.clone(),
                    branch,
                    status: task_status.clone(),
                    has_conflicts: false,
                    merged: false,
                    message: "branch missing".into(),
                };
            }
            if worker_branch_has_conflicts(project_root, id) {
                return WorkerMergeStatus {
                    task_id: id.clone(),
                    branch,
                    status: task_status.clone(),
                    has_conflicts: true,
                    merged: false,
                    message: "merge conflicts detected".into(),
                };
            }
            let msg = format!("Merge swarm worker {id}");
            let output = Command::new("git")
                .args(["-C", &root, "merge", "--no-ff", &branch, "-m", &msg])
                .output();
            match output {
                Ok(o) if o.status.success() => WorkerMergeStatus {
                    task_id: id.clone(),
                    branch,
                    status: task_status.clone(),
                    has_conflicts: false,
                    merged: true,
                    message: "merged".into(),
                },
                Ok(o) => {
                    let detail = String::from_utf8_lossy(&o.stderr);
                    let _ = Command::new("git")
                        .args(["-C", &root, "merge", "--abort"])
                        .output();
                    WorkerMergeStatus {
                        task_id: id.clone(),
                        branch,
                        status: task_status.clone(),
                        has_conflicts: detail.contains("conflict"),
                        merged: false,
                        message: detail.trim().to_string(),
                    }
                }
                Err(e) => WorkerMergeStatus {
                    task_id: id.clone(),
                    branch,
                    status: task_status.clone(),
                    has_conflicts: false,
                    merged: false,
                    message: e.to_string(),
                },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run_git(cwd: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn init_test_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sispace-worktree-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init"]);
        run_git(&dir, &["config", "user.email", "test@sispace.local"]);
        run_git(&dir, &["config", "user.name", "SISpace Test"]);
        std::fs::write(dir.join("README.md"), "init\n").unwrap();
        run_git(&dir, &["add", "README.md"]);
        run_git(&dir, &["commit", "-m", "init"]);
        dir
    }

    #[test]
    fn worktree_detect_git_repo() {
        if !git_available() {
            return;
        }
        let dir = init_test_repo();
        assert!(detect_git_repo(&dir));
        let non_git = std::env::temp_dir().join(format!("no-git-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&non_git);
        assert!(!detect_git_repo(&non_git));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&non_git);
    }

    #[test]
    fn worktree_prepare_and_remove() {
        if !git_available() {
            return;
        }
        let dir = init_test_repo();
        let worker_id = "t_worker_test".to_string();
        let layout = prepare_worker_worktrees(&dir, &[worker_id.clone()]).unwrap();
        assert!(layout.git_available);
        assert!(layout.worker_paths.contains_key(&worker_id));
        let wt = worker_worktree_abs(&dir, &worker_id);
        assert!(wt.is_dir());
        assert!(branch_exists(&dir, &worker_branch_name(&worker_id)));

        remove_worker_worktrees(&dir, &[worker_id]);
        assert!(!wt.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_non_git_shares_root() {
        let dir = std::env::temp_dir().join(format!("sispace-no-git-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let layout = prepare_worker_worktrees(&dir, &["t_x".into()]).unwrap();
        assert!(!layout.git_available);
        assert!(layout.worker_paths.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worktree_branch_naming() {
        assert_eq!(worker_branch_name("t_abc"), "sispace/worker-t_abc");
        assert_eq!(
            worker_worktree_rel_path("t_abc"),
            PathBuf::from(".sispace-worktrees/worker-t_abc")
        );
    }
}
