#!/bin/sh
# Verify Obsidian harness integration. Run from repo root.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
pass=0
fail=0

ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

# No hardcoded bearer tokens in harness repo
if rg -n 'Bearer [0-9a-f]{32,}' "$ROOT" \
  --glob '!**/verify-obsidian-integration.sh' \
  --glob '!**/.cursor/hooks/obsidian-lesson-context.py' \
  --glob '!.cursor/hooks/state/**' >/dev/null 2>&1; then
  bad 'no hardcoded bearer tokens in repo'
else
  ok 'no hardcoded bearer tokens in repo'
fi

if [ -f "$ROOT/.cursor/hooks/obsidian-lesson-context.py" ]; then
  ok 'obsidian-lesson-context.py exists'
else
  bad 'obsidian-lesson-context.py exists'
fi

if [ -f "$ROOT/.cursor/hooks/obsidian-lesson-context.sh" ]; then
  ok 'obsidian-lesson-context.sh exists'
else
  bad 'obsidian-lesson-context.sh exists'
fi

# obsidian.yaml vault_root
if grep -q 'vault_root: "/home/lev/harness vault"' "$ROOT/harness/config/obsidian.yaml"; then
  ok 'obsidian.yaml vault_root is harness vault'
else
  bad 'obsidian.yaml vault_root is harness vault'
fi

# Quoted vault path helper and on-disk Harness dir
eval "$(sh "$ROOT/harness/scripts/obsidian-vault-path.sh")"
if [ -d "$OBSIDIAN_HARNESS_DIR" ]; then
  ok 'OBSIDIAN_HARNESS_DIR exists on disk (quoted path)'
else
  bad "OBSIDIAN_HARNESS_DIR missing: $OBSIDIAN_HARNESS_DIR"
fi

if [ ! -d "/home/lev/linux minecraft thing/gnu client dev/Harness" ]; then
  ok 'old vault Harness path removed'
else
  bad 'old vault Harness path still present'
fi

# beforeSubmitPrompt chains obsidian context
out=$(printf '%s' '{"prompt":"harness rollout memory sync"}' | sh "$ROOT/.cursor/hooks/before-submit-prompt.sh")
if printf '%s' "$out" | grep -q 'permission'; then
  ok 'before-submit-prompt returns JSON'
else
  bad 'before-submit-prompt returns JSON'
fi

if printf '%s' "$out" | grep -q 'Obsidian\|obsidian\|additional_context'; then
  ok 'before-submit-prompt references Obsidian context path'
else
  bad 'before-submit-prompt references Obsidian context path'
fi

if printf '%s' "$out" | grep -q 'system-context\|Agent Instructions'; then
  ok 'before-submit-prompt injects AGENTS.md system-context'
else
  bad 'before-submit-prompt injects AGENTS.md system-context'
fi

# post-task chain includes Obsidian mirror (compiled SDK chain)
CHAIN_JS="$ROOT/harness/scripts/dist/post-task-chain.js"
if [ -f "$CHAIN_JS" ] \
  && grep -q 'syncObsidianEntries' "$CHAIN_JS" \
  && grep -q 'logSyncResult' "$CHAIN_JS"; then
  ok 'post-task chain includes Obsidian mirror step'
else
  bad 'post-task chain includes Obsidian mirror step'
fi

if [ -f "$ROOT/harness/config/obsidian.yaml" ]; then ok 'obsidian.yaml config'; else bad 'obsidian.yaml config'; fi
if [ -f "$ROOT/.cursor/hooks/lib/obsidian-sync.md" ]; then ok 'obsidian-sync.md'; else bad 'obsidian-sync.md'; fi
if grep -q 'harness vault' "$ROOT/.cursor/hooks/lib/obsidian-sync.md"; then
  ok 'obsidian-sync documents vault root path'
else
  bad 'obsidian-sync documents vault root path'
fi

if grep -q 'POST.*search/simple' "$ROOT/.cursor/hooks/lib/obsidian-sync.md"; then
  ok 'obsidian-sync documents POST search'
else
  bad 'obsidian-sync documents POST search'
fi

# Live POST search smoke (skip when OBSIDIAN_API_KEY unset)
if [ -n "${OBSIDIAN_API_KEY:-}" ]; then
  api_url=${OBSIDIAN_API_URL:-http://127.0.0.1:27123}
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${OBSIDIAN_API_KEY}" \
    "${api_url%/}/search/simple/?query=harness&contextLength=80")
  if [ "$code" = "200" ]; then
    ok 'obsidian POST search returns 200'
  else
    bad "obsidian POST search returned HTTP $code"
  fi
else
  ok 'obsidian POST search skipped (OBSIDIAN_API_KEY unset)'
fi

printf 'summary pass=%s fail=%s\n' "$pass" "$fail"
test "$fail" -eq 0
