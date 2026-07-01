# Harness Doctor

Human-triggered entrypoint for auditing harness health without changing files.

Use `harness-project-intake` to inspect structure and current configuration. Use `harness-verification` to record the audit evidence. If the audit discovers a needed change, report it as a recommendation rather than applying it.

## Automated audit script (run first)

Read `harness/scripts/harness-doctor.md` and run:

```sh
sh ~/.cursor-harness/harness/scripts/harness-doctor.sh
```

From the project root (or pass the project path as the first argument). Include the full script output in the doctor report.

### MCP status (required)

The script checks **both**:

- `~/.cursor/mcp.json` (global)
- `.cursor/mcp.json` (project-local)

Report Obsidian MCP as **HEALTHY** if the `obsidian` server is configured in **either** location. Do not mark MCP unhealthy solely because project-local `mcp.json` is empty when global has Obsidian. Note which file(s) hold the server and any credential warnings (literal bearer vs `OBSIDIAN_API_KEY`).

## Meta-harness readiness (required section)

Read `docs/meta-harness-readiness.md` and run:

```sh
sh ~/.cursor-harness/harness/scripts/doctor-meta-readiness.sh
```

From the project root (or pass the project path as the first argument). Include the full script output in the doctor report under **Meta-harness readiness**.

Report all four milestones:

1. **40+** full post-task sessions (1000+ output tokens) — proxy: `### ROLLOUT-` count in `harness/reports/rollout-log.md`
2. **15+** rejected lessons with rubric reasons — `### REJECTED-` count in `harness/memory/rejected-lessons.md`
3. **User model idioms** — qualified `### USER-PREF-` entries (medium/high confidence); note subjective confirmation
4. **Pre-tool-use overrides** — entries in `harness/memory/tool-override-log.md` in the last 14 days (target: zero)

State **READY** or **NOT READY** for an outer meta-optimization loop and list gaps.

## Standard health audit

Expected output:
- Missing or unexpected files.
- Active hook, MCP (global **and** project-local; Obsidian healthy if either has it), CLI, rule, skill, and command status.
- Stub drift or scope violations.
- Meta-harness readiness progress (four milestones above).
- Recommended next command.

Do not edit files, enable hooks, configure MCP, or apply improvements from this command.
