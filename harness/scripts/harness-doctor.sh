#!/bin/sh
# Read-only harness health audit. Does not modify files.
# Usage: sh harness/scripts/harness-doctor.sh [PROJECT_ROOT]
# See harness/scripts/harness-doctor.md

set -eu

ROOT=${1:-$(pwd)}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
HARNESS_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

GLOBAL_MCP="${HOME}/.cursor/mcp.json"
PROJECT_MCP="$ROOT/.cursor/mcp.json"

mcp_has_obsidian() {
  f=$1
  [ -f "$f" ] && grep -qE '"obsidian"[[:space:]]*:' "$f" 2>/dev/null
}

mcp_literal_bearer() {
  f=$1
  [ -f "$f" ] && grep -qE 'Bearer [0-9a-f]{20,}' "$f" 2>/dev/null
}

mcp_env_key_ref() {
  f=$1
  [ -f "$f" ] && grep -qE 'OBSIDIAN_API_KEY|\$\{OBSIDIAN_API_KEY\}' "$f" 2>/dev/null
}

printf 'Harness doctor\n'
printf '  project: %s\n' "$ROOT"
printf '  harness: %s\n' "$HARNESS_ROOT"
printf '\n'

# --- MCP ---
printf 'MCP configuration\n'
printf '  Audits global (~/.cursor/mcp.json) and project-local (.cursor/mcp.json).\n'
printf '  Obsidian is healthy if configured in either location.\n'
printf '\n'

global_obs=0
project_obs=0

if mcp_has_obsidian "$GLOBAL_MCP"; then
  printf '  global (~/.cursor/mcp.json): Obsidian server entry found\n'
  global_obs=1
elif [ -f "$GLOBAL_MCP" ]; then
  printf '  global (~/.cursor/mcp.json): present, no Obsidian server entry\n'
else
  printf '  global (~/.cursor/mcp.json): file missing\n'
fi
if [ -f "$GLOBAL_MCP" ]; then
  if mcp_literal_bearer "$GLOBAL_MCP"; then
    printf '    global credential: WARN literal bearer token — prefer ${OBSIDIAN_API_KEY}\n'
  elif mcp_env_key_ref "$GLOBAL_MCP"; then
    printf '    global credential: ok (OBSIDIAN_API_KEY env reference)\n'
  fi
fi

if mcp_has_obsidian "$PROJECT_MCP"; then
  printf '  project (.cursor/mcp.json): Obsidian server entry found\n'
  project_obs=1
elif [ -f "$PROJECT_MCP" ]; then
  printf '  project (.cursor/mcp.json): present, no Obsidian server entry\n'
else
  printf '  project (.cursor/mcp.json): file missing\n'
fi
if [ -f "$PROJECT_MCP" ]; then
  if mcp_literal_bearer "$PROJECT_MCP"; then
    printf '    project credential: WARN literal bearer token in repo-adjacent config\n'
  elif mcp_env_key_ref "$PROJECT_MCP"; then
    printf '    project credential: ok (OBSIDIAN_API_KEY env reference)\n'
  fi
fi

printf '\n'
if [ "$global_obs" -eq 1 ] || [ "$project_obs" -eq 1 ]; then
  printf '  Obsidian MCP: HEALTHY (found in %s)\n' \
    "$(if [ "$global_obs" -eq 1 ] && [ "$project_obs" -eq 1 ]; then printf 'global and project'; \
       elif [ "$global_obs" -eq 1 ]; then printf 'global only'; else printf 'project only'; fi)"
else
  printf '  Obsidian MCP: UNHEALTHY (not in global or project mcp.json)\n'
  printf '  recommendation: add obsidian server to ~/.cursor/mcp.json per docs/obsidian-setup.md\n'
fi
printf '\n'

# --- Hooks (summary) ---
printf 'Hooks\n'
if [ -f "$ROOT/.cursor/hooks.json" ]; then
  printf '  hooks.json: present\n'
else
  printf '  hooks.json: missing\n'
fi
if [ -x "$ROOT/.cursor/hooks/pre-tool-use.sh" ] 2>/dev/null; then
  printf '  pre-tool-use.sh: executable\n'
elif [ -f "$ROOT/.cursor/hooks/pre-tool-use.sh" ]; then
  printf '  pre-tool-use.sh: present but not executable\n'
else
  printf '  pre-tool-use.sh: missing\n'
fi
printf '\n'

# --- Meta-harness readiness ---
if [ -f "$SCRIPT_DIR/doctor-meta-readiness.sh" ]; then
  sh "$SCRIPT_DIR/doctor-meta-readiness.sh" "$ROOT"
fi

exit 0
