#!/bin/sh
# Phase 10 verification. Run from repo root: sh harness/scripts/verify-phase10.sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
CONFIG=$ROOT/harness/config/harness.yaml
GATE=$ROOT/harness/scripts/rollout-gate.sh
pass=0
fail=0

ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [ -f "$CONFIG" ]; then ok harness.yaml exists; else bad harness.yaml exists; fi
if [ -f "$ROOT/harness/reports/rollout-log.md" ]; then ok rollout-log.md exists; else bad rollout-log.md exists; fi

enabled=$(awk '/^[[:space:]]+enabled:/ { print $2; exit }' "$CONFIG" 2>/dev/null || true)
if [ "$enabled" = true ]; then ok 'auto_apply.enabled is true'; else bad "auto_apply.enabled is true (got $enabled)"; fi

for cat in docs memory backtests; do
  val=$(awk -v c="$cat" '$1 == c ":" { print $2; exit }' "$CONFIG" 2>/dev/null || true)
  if [ "$val" = true ]; then ok "category $cat is true"; else bad "category $cat is true (got $val)"; fi
done

check_gate() {
  name=$1
  layer=$2
  want_action=$3
  out=$(sh "$GATE" "$layer")
  if printf '%s' "$out" | grep -q "\"action\":\"$want_action\""; then
    ok "$name -> $want_action"
  else
    bad "$name want $want_action got $out"
  fi
}

check_gate "rules layer" rule blocked_locked_layer
check_gate "hooks layer" hook blocked_locked_layer
check_gate "skills layer" skill blocked_locked_layer
check_gate "docs eligible" docs apply
check_gate "memory eligible" memory apply
check_gate "backtests eligible" backtest apply

if sh -n "$GATE"; then ok 'sh -n rollout-gate.sh'; else bad 'sh -n rollout-gate.sh'; fi

printf 'summary pass=%s fail=%s\n' "$pass" "$fail"
test "$fail" -eq 0
