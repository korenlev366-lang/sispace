### PENDING-20260605-GTK-CARGO-ALIAS:: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: documentation-only skill subsection; no secrets, hook/MCP/cost/runtime violations. Evidence 19/20: Phase 2 session 88c27d55 cites first-build unresolved-import failure from gtk4/libadwaita Cargo keys vs use gtk::/use adw:: imports; live gtk-app/Cargo.toml uses gtk = { package = "gtk4" } and adw = { package = "libadwaita" } and main.rs imports adw::/gtk::; cargo build -p sispace-gtk and verify-sispace-gtk4-phase2.mjs exit 0 per reflection. Generality 13/15: standard gtk4-rs Cargo alias pattern, not SISpace-specific logic. Layer fit 10/10: complements existing .cursor/skills/gtk-app/SKILL.md (PROP-20260604-001 prelude/feature guidance) without blending layers. Safety 15/15. Backtest 13/15: session compile-fix backtest passes; gap—no static verify asserts Cargo alias keys (unlike prelude conventions). Contradiction 9/10: no conflict with accepted gtk-app lesson; fresh proposalId; fills documented repeated friction. Cost 10/10; reversibility 5/5 with explicit rollback. Total 91; skills layer locked per harness.yaml—requires /harness-apply despite accept-band score.
- Target layer: skill
- Date: 2026-06-04
- Rollback note: Revert the added subsection in .cursor/skills/gtk-app/SKILL.md.
- Applied change:

Add a 'Cargo.toml dependency aliases' subsection to .cursor/skills/gtk-app/SKILL.md: dependency keys must be `gtk` and `adw` with `package = "gtk4"` / `package = "libadwaita"` to match `use gtk::` and `use adw::` imports; using bare gtk4/libadwaita keys causes first-build unresolved-import failures (observed in Phase 2 session).
