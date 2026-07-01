---
name: gtk-app
description: Rust GTK4 / libadwaita workflow for gtk-app (sispace-gtk). Use before editing gtk-app UI code or adding gtk4-rs / libadwaita imports.
disable-model-invocation: true
---

# GTK App (gtk4-rs / libadwaita)

## Scope

Apply when editing `gtk-app/` or other gtk4-rs + libadwaita UI in this workspace. Do not guess prelude trait names or version-gated APIs from web examples.

## Before importing traits

1. Grep the **installed** crate sources under `~/.cargo/registry` — read `prelude.rs` and `auto/*.rs` for the gtk4-rs and libadwaita versions pinned in `gtk-app/Cargo.toml`.
2. Prefer **inherent widget methods** when no extension trait exists (e.g. `Label::set_text`, `ListBox::append` — gtk4-rs 0.9 has no `LabelExt` / `ListBoxExt`).
3. When `adw::prelude::*` is in scope, **never** import `gtk::prelude::*`. Import only the gtk traits you need (`BoxExt`, `ButtonExt`, `WidgetExt`, `TextBufferExt`, etc.) to avoid wildcard conflicts and unused-import warnings.
4. Before using version-gated widgets or APIs (e.g. `AdwDialog`), enable the matching feature in `gtk-app/Cargo.toml` (e.g. `libadwaita` feature `v1_5`) and confirm the API in the registry sources.

## Verification

After prelude or feature changes, run `cargo build -p sispace-gtk` (or the relevant workspace member).
