#!/bin/sh
# Resolve Cursor workspace root from a hook JSON payload.
# Works for project hooks (process cwd = project) and user hooks (cwd = ~/.cursor).
#
# Usage from a hook script (payload already in $input or $INPUT):
#   ROOT=$(HOOK_INPUT="$input" sh "$(dirname "$0")/lib/workspace-root.sh")

payload=${HOOK_INPUT:-${INPUT:-${1:-}}}
cursor_home=${HOME}/.cursor
cwd=""
wr=""

if [ -n "$payload" ] && command -v jq >/dev/null 2>&1; then
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)
  wr=$(printf '%s' "$payload" | jq -r '.workspace_roots[0] // empty' 2>/dev/null || true)
elif [ -n "$payload" ]; then
  cwd=$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  wr=$(printf '%s' "$payload" | sed -n 's/.*"workspace_roots"[[:space:]]*:[[:space:]]*\[[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi

# User hooks run with cwd=~/.cursor — prefer workspace_roots (or fall through).
case "$cwd" in
  "$cursor_home"|"$cursor_home"/)
    if [ -n "$wr" ] && [ "$wr" != "null" ]; then
      printf '%s\n' "$wr"
      exit 0
    fi
    ;;
esac

if [ -n "$cwd" ] && [ "$cwd" != "null" ]; then
  printf '%s\n' "$cwd"
  exit 0
fi

if [ -n "$wr" ] && [ "$wr" != "null" ]; then
  printf '%s\n' "$wr"
  exit 0
fi

# Last resort: process cwd (project hooks) or parent of hooks dir.
pwd_now=$(pwd)
case "$pwd_now" in
  "$cursor_home"|"$cursor_home"/)
    printf '%s\n' "$pwd_now"
    ;;
  *)
    printf '%s\n' "$pwd_now"
    ;;
esac
