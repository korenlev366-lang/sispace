//! Compile embedded icons and, after each build, refresh the user .desktop launcher.

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir.join("..");
    let packaging = workspace_root.join("packaging");
    let install_script = workspace_root.join("scripts/install-desktop.sh");
    let resources = manifest_dir.join("resources");

    glib_build_tools::compile_resources(
        &[resources.to_str().expect("resources path utf-8")],
        resources.join("icons.gresource.xml").to_str().expect("gresource xml utf-8"),
        "icons.gresource",
    );

    println!("cargo:rerun-if-changed={}", resources.join("icons.gresource.xml").display());
    println!("cargo:rerun-if-changed={}", resources.join("sispace.svg").display());
    println!("cargo:rerun-if-changed={}", packaging.join("dev.lev.sispace.desktop.in").display());
    println!("cargo:rerun-if-changed={}", packaging.join("icons/sispace.svg").display());
    println!("cargo:rerun-if-changed={}", install_script.display());

    if env::var_os("SISPACE_SKIP_DESKTOP").is_some() {
        return;
    }

    if !install_script.is_file() {
        return;
    }

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let target_dir = env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root.join("target"));
    let target_dir = if target_dir.is_absolute() {
        target_dir
    } else {
        workspace_root.join(target_dir)
    };
    let exe = target_dir.join(&profile).join("sispace-gtk");

    let status = Command::new("sh")
        .arg(&install_script)
        .env("SISPACE_PROFILE", &profile)
        .env("SISPACE_EXEC", &exe)
        .env("CARGO_TARGET_DIR", &target_dir)
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => {
            println!(
                "cargo:warning=sispace desktop install exited with status {}",
                s.code().unwrap_or(-1)
            );
        }
        Err(e) => {
            println!("cargo:warning=sispace desktop install failed: {e}");
        }
    }
}
