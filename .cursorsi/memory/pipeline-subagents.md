# Pipeline subagents

- Toggle with `/subagents on|off` (works for **openrouter**, **compatible**, and **cursor**).
- Uses the current session model by default; override with `/subagent-model`.
- Flow: gate → plan (2–6 subtasks) → execute in dependency waves → inject results into the main turn.
- TUI shows `[n planned]`, `[n working]`, `[n done|failed]` with a clear `── subagents ──` banner.
- Cursor: custom agents registered with parent model (`inherit` / explicit id) plus a Task-tool hint to avoid `composer-2.5-fast` unless that is the session model.
