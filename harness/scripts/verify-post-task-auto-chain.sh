#!/bin/sh
# Verify post-task adapter invokes SDK chain for long sessions (no model-space injection).
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
ADAPTER=$ROOT/.cursor/hooks/post-task-adapter.sh
pass=0
fail=0

ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

contains() {
  haystack=$1
  needle=$2
  printf '%s' "$haystack" | grep -q "$needle"
}

if [ -f "$ROOT/harness/scripts/dist/post-task-chain.js" ] || [ -f "$HOME/.cursor-harness/harness/scripts/dist/post-task-chain.js" ]; then
  ok 'post-task-chain.js compiled'
else
  bad 'post-task-chain.js compiled'
fi

long_input='{"event":"stop","session_id":"verify-sdk-long","output_tokens":1500}'
long_out=$(printf '%s' "$long_input" | sh "$ADAPTER")

if contains "$long_out" 'HARNESS_POSTTASK_AUTO_CHAIN'; then bad 'long session must not inject AUTO_CHAIN'; else ok 'long session no AUTO_CHAIN injection'; fi
if printf '%s' "$long_out" | grep -Eq '^\{\s*\}$'; then ok 'long session returns empty hook payload'; else bad 'long session returns empty hook payload'; fi

ROLLOUT=$ROOT/harness/reports/rollout-log.md
if [ -f "$ROLLOUT" ] && grep -qF 'verify-sdk-long' "$ROLLOUT" 2>/dev/null; then
  ok 'long session wrote rollout entry'
else
  bad 'long session wrote rollout entry'
fi

short_input='{"event":"stop","output_tokens":50}'
short_out=$(printf '%s' "$short_input" | sh "$ADAPTER")

if printf '%s' "$short_out" | grep -qi 'lightweight nudge'; then ok 'short session lightweight nudge'; else bad 'short session lightweight nudge'; fi
if contains "$short_out" 'HARNESS_POSTTASK_AUTO_CHAIN'; then bad 'short session must not emit AUTO_CHAIN'; else ok 'short session no AUTO_CHAIN'; fi

if sh -n "$ADAPTER"; then ok 'sh -n post-task-adapter.sh'; else bad 'sh -n post-task-adapter.sh'; fi

printf 'summary pass=%s fail=%s\n' "$pass" "$fail"
test "$fail" -eq 0
