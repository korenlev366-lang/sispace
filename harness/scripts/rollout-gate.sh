#!/bin/sh
# Decide whether an accepted proposal may auto-apply.
# Usage: sh harness/scripts/rollout-gate.sh <target_layer>
# Prints one JSON object on stdout.

set -eu

layer=${1:-}
if [ -z "$layer" ]; then
  printf '%s\n' '{"action":"blocked","reason":"missing target_layer argument"}'
  exit 0
fi

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
CONFIG=$ROOT/harness/config/harness.yaml

if [ ! -f "$CONFIG" ]; then
  printf '%s\n' '{"action":"blocked","reason":"harness config missing"}'
  exit 0
fi

# Normalize target layer to category key used in harness.yaml.
normalize_layer() {
  case $(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-') in
    rule|rules) printf '%s' 'rules' ;;
    hook|hooks) printf '%s' 'hooks' ;;
    skill|skills) printf '%s' 'skills' ;;
    command|commands) printf '%s' 'commands' ;;
    mcp) printf '%s' 'mcp' ;;
    doc|docs|documentation) printf '%s' 'docs' ;;
    memory) printf '%s' 'memory' ;;
    backtest|backtests|test|tests) printf '%s' 'backtests' ;;
    user-model|user_model|usermodel) printf '%s' 'user-model' ;;
    *) printf '%s' "$1" ;;
  esac
}

category=$(normalize_layer "$layer")

is_locked() {
  case "$1" in
    rules|hooks|skills|commands|mcp|user-model) return 0 ;;
    *) return 1 ;;
  esac
}

read_enabled() {
  awk '
    /^auto_apply:/ { in_aa = 1; next }
    in_aa && /^[^[:space:]]/ && $0 !~ /^auto_apply:/ { in_aa = 0 }
    in_aa && /^[[:space:]]+enabled:/ { print $2; exit }
  ' "$CONFIG"
}

read_category_flag() {
  key=$1
  awk -v want="$key" '
    /^[[:space:]]+categories:/ { in_cat = 1; next }
    in_cat && /^[^[:space:]]/ { in_cat = 0 }
    in_cat && $1 == want ":" { print $2; exit }
  ' "$CONFIG"
}

enabled=$(read_enabled)
case "$enabled" in
  true|yes|1) enabled=true ;;
  *) enabled=false ;;
esac

if is_locked "$category"; then
  printf '%s\n' "{\"action\":\"blocked_locked_layer\",\"target_layer\":\"$layer\",\"category\":\"$category\",\"auto_apply_enabled\":$enabled,\"reason\":\"locked category; requires human review via /harness-apply\"}"
  exit 0
fi

case "$category" in
  docs|memory|backtests) ;;
  *)
    printf '%s\n' "{\"action\":\"blocked\",\"target_layer\":\"$layer\",\"category\":\"$category\",\"auto_apply_enabled\":$enabled,\"reason\":\"target layer is not an auto-apply eligible category\"}"
    exit 0
    ;;
esac

flag=$(read_category_flag "$category")
case "$flag" in
  true|yes|1) flag=true ;;
  *) flag=false ;;
esac

if [ "$enabled" = true ] && [ "$flag" = true ]; then
  printf '%s\n' "{\"action\":\"apply\",\"target_layer\":\"$layer\",\"category\":\"$category\",\"auto_apply_enabled\":true,\"category_enabled\":true}"
else
  printf '%s\n' "{\"action\":\"log_only\",\"target_layer\":\"$layer\",\"category\":\"$category\",\"auto_apply_enabled\":$enabled,\"category_enabled\":$flag,\"reason\":\"auto_apply disabled or category not opted in; record in harness/reports/rollout-log.md\"}"
fi

exit 0
