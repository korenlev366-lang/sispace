---
name: gtk-app-dev
description: Rust GTK4 / libadwaita workflow for gtk-app (sispace-gtk). Use when adding UI, fixing compile errors from prelude traits, or enabling version-gated Adw/Gtk APIs.
---

# gtk-app / Rust-GTK workflow

## Prelude and extension traits

Before importing `gtk4-rs` or `libadwaita` prelude traits:

1. **Grep the installed crate** — inspect `prelude.rs` and `auto/*.rs` under `~/.cargo/registry/src/*/gtk4-*/` and `~/.cargo/registry/src/*/libadwaita-*/` for the exact version resolved in `gtk-app/Cargo.toml`.
2. **Prefer inherent methods** — when a widget method exists on the type itself, call it directly; do not import an extension trait for it.
3. **No wildcard gtk prelude when adw is in scope** — never use `gtk::prelude::*` when `adw::prelude::*` is already imported. Import only the traits you need, e.g. `gtk::prelude::{BoxExt, ButtonExt, WidgetExt}`.
4. **Match existing files** — follow `canvas_tab.rs`, `meta_panel.rs`, and `presets_dialog.rs` (`adw::prelude::*` plus explicit gtk trait imports).

## Version-gated APIs

Enable the required crate features in `gtk-app/Cargo.toml` before using version-gated APIs (e.g. `libadwaita` feature `v1_5` for `AdwDialog`, `gtk4` feature `v4_12` for newer Gtk APIs). Re-run `cargo build -p sispace-gtk` after feature changes.

## Verification

After UI changes: `cargo build -p sispace-gtk` and the relevant `npm run verify:sispace-gtk4-phase*` script for the touched area.
