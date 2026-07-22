#!/bin/sh

input=$(cat)

deny() {
  printf '%s\n' '{"permission":"deny","user_message":"Harness blocked this prompt: it appears to include secret-like material. Redact secrets and resubmit.","agent_message":"Fail-closed policy: do not echo, execute, or persist secret-like content from the prompt."}'
  exit 0
}

tok_akia='AK''IA'
tok_asia='AS''IA'
tok_gh='gh''p_'
tok_gpat='github_''pat_'
tok_sk='s''k-'
tok_x='xo''xb-'
tok_ai='AI''za'

if printf '%s' "$input" | grep -Eqi \
  "BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|${tok_akia}[0-9A-Z]{16}|${tok_asia}[0-9A-Z]{16}|${tok_gh}[A-Za-z0-9]{20,}|${tok_gpat}[A-Za-z0-9_]{20,}|${tok_sk}[A-Za-z0-9]{20,}|${tok_x}[A-Za-z0-9-]{10,}|${tok_ai}[0-9A-Za-z_-]{35}"; then
  deny
fi

ROOT=$(HOOK_INPUT="$input" sh "$(dirname "$0")/lib/workspace-root.sh")
export HARNESS_ROOT=$ROOT
export HARNESS_AGENTS_MD=""
if [ -f "$ROOT/AGENTS.md" ]; then
  HARNESS_AGENTS_MD=$(cat "$ROOT/AGENTS.md")
  export HARNESS_AGENTS_MD
fi

# Obsidian lesson recall at session start (REST API via OBSIDIAN_API_KEY; mirrors MCP search).
# AGENTS.md is prepended as <system-context> on every prompt when present.
printf '%s' "$input" | sh "$(dirname "$0")/obsidian-lesson-context.sh"
exit 0
