# beforeSubmitPrompt Contract

Script: `.cursor/hooks/before-submit-prompt.sh` (delegates lesson recall to `obsidian-lesson-context.sh` / `.py`)

Mode: Phase 9 controlled enforcement — fail-closed for clear secret-like material; Obsidian lesson recall at session start.

## Enforces

- Deny when the submitted prompt appears to include secret-like material (PEM headers, cloud key prefixes, obvious credential tokens).
- At session start (once per `conversation_id` when present), query Obsidian for relevant harness lessons:
  - Search topic derived from the user prompt.
  - Scope: `Harness/accepted-lessons/`, `Harness/rejected-lessons/`, `Harness/user-model/`, `Harness/reasoning-patterns/`.
  - Inject top 3 matches into `additional_context` (and `agent_message` summary).
  - Uses `OBSIDIAN_API_KEY` and optional `OBSIDIAN_API_URL` env vars — never hardcoded tokens in the repo.

## Does not enforce

- It does not block normal prompts or benign mentions of configuration files.
- It does not rewrite prompts.
- It does not make planning decisions.
- It does not write to Obsidian (writes happen in post-task Step 4b via MCP).

## Obsidian index

Vault layout and sync rules: `.cursor/hooks/lib/obsidian-sync.md`, `harness/config/obsidian.yaml`.

Reason for hook:
- Prompt inspection must happen before the model starts working. Lesson recall from Obsidian gives cross-session context without duplicating source-of-truth markdown in the repo.
