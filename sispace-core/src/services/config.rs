use std::fs;
use std::path::Path;

pub const DEFAULT_MAX_CONCURRENT_PIPELINES: usize = 5;

#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub max_concurrent_pipelines: usize,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            max_concurrent_pipelines: DEFAULT_MAX_CONCURRENT_PIPELINES,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TerminalConfig {
    pub detect_env: String,
    pub fallback: String,
    pub args: Vec<String>,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            detect_env: "TERMINAL".to_string(),
            fallback: "kitty".to_string(),
            args: vec!["--directory".to_string(), "{cwd}".to_string()],
        }
    }
}

fn sispace_yaml_path(project_root: &Path) -> std::path::PathBuf {
    project_root.join("config").join("sispace.yaml")
}

fn read_sispace_yaml(project_root: &Path) -> Option<String> {
    fs::read_to_string(sispace_yaml_path(project_root)).ok()
}

pub fn load_pipeline_config(project_root: &Path) -> PipelineConfig {
    let mut cfg = PipelineConfig::default();
    let Some(raw) = read_sispace_yaml(project_root) else {
        return cfg;
    };

    let mut in_pipeline = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed == "pipeline:" {
            in_pipeline = true;
            continue;
        }
        if in_pipeline
            && !line.starts_with(' ')
            && !line.starts_with('\t')
            && trimmed.ends_with(':')
            && trimmed != "pipeline:"
        {
            break;
        }
        if !in_pipeline {
            continue;
        }
        if trimmed.starts_with("max_concurrent_pipelines:") {
            let val = yaml_value(trimmed.strip_prefix("max_concurrent_pipelines:").unwrap_or(""));
            if let Ok(n) = val.parse::<usize>() {
                cfg.max_concurrent_pipelines = n.max(1);
            }
        }
    }
    cfg
}

#[derive(Debug, Clone)]
pub struct NtfyConfig {
    pub server: String,
    pub topic: String,
}

impl Default for NtfyConfig {
    fn default() -> Self {
        Self {
            server: "https://ntfy.sh".to_string(),
            topic: String::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CostConfig {
    /// Estimated monthly Pro+ output-token allowance for usage bar.
    pub pro_plus_monthly_output_tokens: i64,
}

impl Default for CostConfig {
    fn default() -> Self {
        Self {
            pro_plus_monthly_output_tokens: 45_000_000,
        }
    }
}

pub fn load_ntfy_config(project_root: &Path) -> NtfyConfig {
    let mut cfg = NtfyConfig::default();
    let Some(raw) = read_sispace_yaml(project_root) else {
        return cfg;
    };
    let mut in_ntfy = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed == "ntfy:" {
            in_ntfy = true;
            continue;
        }
        if in_ntfy
            && !line.starts_with(' ')
            && !line.starts_with('\t')
            && trimmed.ends_with(':')
            && trimmed != "ntfy:"
        {
            break;
        }
        if !in_ntfy {
            continue;
        }
        if trimmed.starts_with("server:") {
            cfg.server = yaml_value(trimmed.strip_prefix("server:").unwrap_or(""));
        } else if trimmed.starts_with("topic:") {
            cfg.topic = yaml_value(trimmed.strip_prefix("topic:").unwrap_or(""));
        }
    }
    cfg
}

pub fn load_cost_config(project_root: &Path) -> CostConfig {
    let mut cfg = CostConfig::default();
    let Some(raw) = read_sispace_yaml(project_root) else {
        return cfg;
    };
    let mut in_cost = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed == "cost:" {
            in_cost = true;
            continue;
        }
        if in_cost
            && !line.starts_with(' ')
            && !line.starts_with('\t')
            && trimmed.ends_with(':')
            && trimmed != "cost:"
        {
            break;
        }
        if !in_cost {
            continue;
        }
        if trimmed.starts_with("pro_plus_monthly_output_tokens:") {
            let val = yaml_value(trimmed.strip_prefix("pro_plus_monthly_output_tokens:").unwrap_or(""));
            if let Ok(n) = val.parse::<i64>() {
                cfg.pro_plus_monthly_output_tokens = n.max(1);
            }
        }
    }
    cfg
}

pub fn load_terminal_config(project_root: &Path) -> TerminalConfig {
    let mut cfg = TerminalConfig::default();
    let Some(raw) = read_sispace_yaml(project_root) else {
        return cfg;
    };

    let mut in_terminal = false;
    let mut in_args = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed == "terminal:" {
            in_terminal = true;
            in_args = false;
            continue;
        }
        if in_terminal && !line.starts_with(' ') && !line.starts_with('\t') && trimmed.ends_with(':') && trimmed != "terminal:" {
            if !trimmed.starts_with("args:") {
                in_terminal = false;
                in_args = false;
            }
        }
        if !in_terminal {
            continue;
        }
        if trimmed.starts_with("detect_env:") {
            cfg.detect_env = yaml_value(trimmed.strip_prefix("detect_env:").unwrap_or(""));
        } else if trimmed.starts_with("fallback:") {
            cfg.fallback = yaml_value(trimmed.strip_prefix("fallback:").unwrap_or(""));
        } else if trimmed == "args:" {
            in_args = true;
            cfg.args.clear();
        } else if in_args && trimmed.starts_with("- ") {
            cfg.args.push(yaml_value(trimmed.strip_prefix("- ").unwrap_or("")));
        } else if in_args && line.starts_with("  - ") {
            cfg.args.push(yaml_value(line.trim().strip_prefix("- ").unwrap_or("")));
        }
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn load_pipeline_config_reads_max_concurrent() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let cfg = load_pipeline_config(&root);
        assert_eq!(cfg.max_concurrent_pipelines, 5);
    }
}

fn yaml_value(raw: &str) -> String {
    raw.trim().trim_matches('"').trim_matches('\'').to_string()
}
