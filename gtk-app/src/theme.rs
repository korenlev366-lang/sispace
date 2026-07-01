//! CursorSI-aligned GTK theme (yellow chrome, cyan focus, TUI density).

pub const CURSORSI_THEME_CSS: &str = r#"
/* Palette — mirrors Ink TUI named ANSI roles */
@define-color cursorsi-yellow #e5c07b;
@define-color cursorsi-cyan #56b6c2;
@define-color cursorsi-green #89b482;
@define-color cursorsi-amber #9c7531;
@define-color cursorsi-red #e06c75;
@define-color cursorsi-magenta #c678dd;
@define-color cursorsi-dim alpha(@window_fg_color, 0.55);
@define-color cursorsi-sep #5b574d;

/* ── Brand / chrome ─────────────────────────────────────────── */
.cursorsi-brand {
  color: @cursorsi-yellow;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.cursorsi-statusbar {
  background-color: alpha(@card_bg_color, 0.92);
  border: 1px solid alpha(@cursorsi-yellow, 0.45);
  border-radius: 8px;
  padding: 6px 10px;
  margin: 0 8px 4px;
}
.cursorsi-sep {
  color: @cursorsi-sep;
}
.cursorsi-mode-chat {
  color: @cursorsi-green;
  font-weight: 600;
  font-size: 0.85em;
}
.session-count-chip {
  background: #17161c;
  border: 1px solid #1f1e1a;
  border-radius: 6px;
  padding: 3px 9px;
  color: @cursorsi-dim;
  font-size: 0.85em;
}

/* ── Session sidebar (navigation-sidebar + cards) ───────────── */
.session-card {
  background: #17161c;
  border: 1px solid #1f1e1a;
  border-radius: 7px;
  padding: 11px 12px;
  margin: 3px 4px;
  transition: border-color 160ms ease, background-color 160ms ease;
}
.session-card:hover {
  border-color: #26241f;
}
.session-card.selected {
  border-color: #5c4a26;
  border-left: 2.5px solid #d8a657;
  padding-left: 9.5px;
  background: linear-gradient(to bottom right, rgba(216, 165, 87, 0.05), rgba(216, 165, 87, 0.01));
}
listview row:selected .session-card {
  background-color: alpha(@cursorsi-cyan, 0.06);
}

.session-name {
  font-family: monospace;
  font-weight: 600;
  font-size: 12.5px;
  color: #e9e5dc;
}

.session-run-dot {
  color: #89b482;
  font-size: 6px;
  margin-left: 6px;
  text-shadow: 0 0 7px rgba(137,180,130,0.6);
}

.session-stats {
  font-family: monospace;
  font-size: 10.5px;
  color: #5b574d;
  margin-top: 3px;
}

.session-delete {
  color: #5b574d;
  font-size: 10px;
  opacity: 0;
  transition: opacity 120ms ease;
  padding: 0 4px;
  min-width: 0;
  min-height: 0;
}
.session-card:hover .session-delete {
  opacity: 1;
}
.session-delete:hover {
  color: #c77;
}

.cursorsi-status-idle {
  color: @cursorsi-dim;
}
.cursorsi-status-working {
  color: @cursorsi-yellow;
}
.cursorsi-status-complete {
  color: @cursorsi-green;
}

/* ── Meta orchestrator panel ──────────────────────────────────── */
.meta-panel-frame {
  background-color: alpha(@card_bg_color, 0.6);
  border: 1px solid alpha(@cursorsi-yellow, 0.35);
  border-radius: 8px;
  padding: 8px;
  margin-top: 4px;
}
.meta-feed {
  background-color: alpha(black, 0.25);
  border: 1px solid alpha(@borders, 0.35);
  border-radius: 6px;
  padding: 4px;
}
.meta-feed textview {
  font-size: 11px;
}

.orch-panel {
  border-top: 1px solid #1f1e1a;
  padding: 12px;
}
.orch-title {
  color: #d8a657;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.orch-sub {
  color: #5b574d;
  font-family: monospace;
  font-size: small;
}

.orch-prompt {
  background: #1a1920;
  border: 1px solid #26241f;
  border-radius: 7px;
  padding: 9px 11px;
}

.orch-actions button {
  min-height: 34px;
}

.orch-log {
  background: #0d0d0f;
  border: 1px solid #1f1e1a;
  border-radius: 7px;
  padding: 6px 8px;
  min-height: 90px;
  overflow: hidden;
}
.orch-log label {
  font-family: monospace;
  font-size: 10px;
  color: #5b574d;
  padding: 1px 0;
}


/* ── Terminal panes (lifted, amber focus glow) ──────────────── */
.terminal-columns {
  padding: 6px;
}
.terminal-column {
  min-width: 200px;
}
.tiled-pane {
  background-color: alpha(@card_bg_color, 0.95);
  border: 1px solid #26241f;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 6px;
  transition:
    border-color 200ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 200ms ease;
}
.tiled-pane.focused {
  border-color: @cursorsi-amber;
  box-shadow:
    0 0 0 1px rgba(216,166,87,0.10),
    0 8px 30px rgba(0,0,0,0.35);
}
.pane-titlebar {
  background-color: alpha(@headerbar_bg_color, 0.92);
  border-bottom: 1px solid alpha(@cursorsi-yellow, 0.2);
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
  padding: 5px 10px;
  transition: background-color 180ms ease;
}
.tiled-pane.focused .pane-titlebar {
  background-color: alpha(@cursorsi-amber, 0.07);
}
.pane-title {
  font-size: 11px;
  font-weight: 600;
  color: @cursorsi-yellow;
}
.pane-status {
  font-size: 9px;
  padding: 2px 10px 5px;
  opacity: 0.7;
}
.pane-close {
  min-height: 14px;
  min-width: 16px;
  padding: 0 3px;
  font-size: 11px;
  opacity: 0.55;
  transition: opacity 120ms ease;
}
.pane-close:hover {
  opacity: 1;
  color: @cursorsi-red;
}

/* Spawn / primary actions — yellow accent like TUI prompt */
.cursorsi-action {
  background: alpha(@cursorsi-yellow, 0.15);
  border: 1px solid alpha(@cursorsi-yellow, 0.4);
  transition: background 150ms ease, border-color 150ms ease;
}
.cursorsi-action:hover {
  background: alpha(@cursorsi-yellow, 0.25);
  border-color: @cursorsi-yellow;
}

/* Row entrance (new session spawned) */
@keyframes session-row-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.session-row-new {
  animation: session-row-in 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── Directory pill (folder + path + quick-picks) ───────────────── */
.dir-group {
  background: #17161c;
  border: 1px solid #26241f;
  border-radius: 7px;
  padding: 3px;
}
.dir-group > * {
  margin: 0 2px;
}
.dir-group > button.flat {
  background: transparent;
  border: none;
  border-radius: 5px;
  padding: 4px 6px;
  min-width: 0;
  min-height: 0;
}
.dir-group > button.flat:hover {
  background: #1f1d25;
}

/* The folder/📁 button — amber icon, transparent */
.folder-btn {
  background: transparent;
  border: none;
  border-radius: 5px;
  color: @cursorsi-amber;
  font-size: 1.1em;
  padding: 4px 6px;
}
.folder-btn:hover {
  background: #1f1d25;
}

/* Path label — separates folder from quick-picks */
.dir-path {
  font-family: monospace;
  color: #928d80;
  padding: 4px 8px;
  border-right: 1px solid #26241f;
  margin-right: 4px;
}
.dir-path .active-dir {
  color: #e9e5dc;
}

/* Quick-pick buttons — small, dim */
.qp {
  font-size: 11.5px;
  color: @cursorsi-dim;
  border-radius: 5px;
  padding: 3px 8px;
  background: transparent;
  border: none;
  min-width: 0;
  min-height: 0;
}
.qp:hover {
  background: #1f1d25;
}
.qp.active {
  color: #d8a657;
  background: #1f1d25;
}

/* Error labels — visible with red background */
.error {
  color: @cursorsi-red;
  background-color: alpha(@cursorsi-red, 0.12);
  border: 1px solid alpha(@cursorsi-red, 0.35);
  border-radius: 6px;
  padding: 4px 8px;
  font-weight: 600;
  font-size: 0.9em;
}

@media (prefers-reduced-motion: reduce) {
  .tiled-pane,
  .session-card,
  .pane-close,
  .cursorsi-action {
    transition: none;
  }
  .session-row-new {
    animation: none;
  }
}
"#;
