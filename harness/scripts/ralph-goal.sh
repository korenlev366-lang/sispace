#!/bin/sh
# Thin wrapper: run SDK Ralph loop from harness template node_modules.

set -eu

ROOT=${HARNESS_PROJECT_ROOT:-$(pwd)}
HARNESS_HOME=${HARNESS_HOME:-$HOME/.cursor-harness}
SCRIPT=$HARNESS_HOME/harness/scripts/dist/lib/ralph-agent-loop.js

if [ ! -f "$SCRIPT" ]; then
  SCRIPT=$ROOT/harness/scripts/dist/lib/ralph-agent-loop.js
fi

if [ ! -f "$SCRIPT" ]; then
  printf 'ralph-goal: compiled script missing — run npm run build in %s\n' "$HARNESS_HOME" >&2
  exit 1
fi

cd "$ROOT"
exec node "$SCRIPT" "$@"
