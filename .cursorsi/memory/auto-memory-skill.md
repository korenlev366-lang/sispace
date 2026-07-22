# Auto memory and skill extraction

- Qwen-style automatic memory extraction and skill creation.
- **Skills:** proposed once the session hits ≥20 tool calls (mid-session, after a turn). SkillPicker opens immediately; the agent keeps working while you Accept / Reject / Skip.
- **Memory:** still extracted on session end (with harness reflect).
- Session-end also proposes skills if the mid-session pass never ran.
- Defaults: enabled.
- Commands: `/memory`, `/memory auto-memory on|off`, `/memory auto-skill on|off`, `/memory extract`, `/memory review`.
- Memory writes to `.cursorsi/memory/` with notices `memory created [name]` / `memory updated [name]`.
- Skills stay pending until accepted → `.cursorsi/skills/<slug>/SKILL.md` with `source: auto-skill`.
- Pending queue: `.cursorsi/pending-skills.json` (backup if you force-quit mid-review).
