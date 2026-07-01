#!/bin/sh
# Replay post-task-chain for generation starts that never completed (no done / reasoning).
# Usage: retroactive-reflect.sh [YYYY-MM-DD] [--dry-run]
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SISPACE_HOME=${SISPACE_HOME:-$HOME/sispace}
HARNESS_HOME=${HARNESS_HOME:-$HOME/.cursor-harness}
MEMORY_ROOT=$ROOT
if [ -d "$SISPACE_HOME/harness/memory" ]; then
  MEMORY_ROOT=$SISPACE_HOME
fi
DATE="2026-06-02"
MIN_TOKENS=3000
PAUSE_SEC=10
DRY_RUN=0

CHAIN_SCRIPT=$HARNESS_HOME/harness/scripts/dist/post-task-chain.js
if [ ! -f "$CHAIN_SCRIPT" ]; then
  CHAIN_SCRIPT=$ROOT/harness/scripts/dist/post-task-chain.js
fi

LOG=$MEMORY_ROOT/harness/reports/post-task-chain.log
RUN_LOG=$MEMORY_ROOT/harness/reports/retroactive-reflect.log
OBSIDIAN_API_URL=${OBSIDIAN_API_URL:-http://127.0.0.1:27123}
TRANSCRIPT_DIR=${CURSOR_TRANSCRIPTS_DIR:-$HOME/.cursor/projects}

usage() {
  cat <<'EOF'
Usage: retroactive-reflect.sh [YYYY-MM-DD] [--dry-run]

Re-runs post-task-chain.js for substantive sessions (tokens >= 3000) on the given
date that started but never finished. Uses --generation-id <id>-retro to bypass dedup.

Environment: CURSOR_API_KEY, OBSIDIAN_API_KEY (optional), HARNESS_HOME, OBSIDIAN_API_URL
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) DATE=$1 ;;
  esac
  shift
done

log() {
  msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1"
  printf '%s\n' "$msg" >>"$RUN_LOG"
  printf '%s\n' "$msg"
}

# Log slice after start_ln until the next "start generation=" (exclusive).
log_window_after_line() {
  start_ln=$1
  rest=$(tail -n +"$((start_ln + 1))" "$LOG")
  next_off=$(printf '%s\n' "$rest" | grep -n 'start generation=' | head -n 1 | cut -d: -f1)
  if [ -n "$next_off" ]; then
    printf '%s\n' "$rest" | head -n "$((next_off - 1))"
  else
    printf '%s\n' "$rest"
  fi
}

# Session-scoped completion: reasoning for this session only (not interleaved done from another chain).
session_completed_in_window() {
  gen=$1
  window=$2
  printf '%s\n' "$window" | grep -qF "reasoning pattern appended session=${gen}"
}

generation_in_progress() {
  gen=$1
  retro_start_ln=$(grep -nF "start generation=${gen}-retro tokens=" "$LOG" 2>/dev/null | tail -n 1 | cut -d: -f1)
  [ -n "$retro_start_ln" ] || return 1
  window=$(log_window_after_line "$retro_start_ln")
  if session_completed_in_window "$gen" "$window"; then
    return 1
  fi
  return 0
}

generation_completed() {
  gen=$1
  if grep -qF "reasoning pattern appended session=${gen}" "$LOG" 2>/dev/null; then
    return 0
  fi
  retro_start_ln=$(grep -nF "start generation=${gen}-retro tokens=" "$LOG" 2>/dev/null | tail -n 1 | cut -d: -f1)
  if [ -n "$retro_start_ln" ]; then
    window=$(log_window_after_line "$retro_start_ln")
    if session_completed_in_window "$gen" "$window"; then
      return 0
    fi
  fi
  start_ln=$(grep -nF "start generation=${gen} tokens=" "$LOG" 2>/dev/null | grep -vF -- "-retro tokens=" | head -n 1 | cut -d: -f1)
  if [ -z "$start_ln" ]; then
    return 1
  fi
  window=$(log_window_after_line "$start_ln")
  session_completed_in_window "$gen" "$window"
}

# Self-test for verify-harness-commands (PENDING-20260602-RETRO-DONE-GUARD).
run_done_guard_selftest() {
  fixture=$ROOT/harness/scripts/fixtures/retro-done-guard.log
  if [ ! -f "$fixture" ]; then
    printf 'FAIL retro-done-guard fixture missing\n' >&2
    return 1
  fi
  gen=65239e03-d238-49e2-aced-c19a683e1fbe
  bad_log=$(mktemp)
  ok_log=$(mktemp)
  cp "$fixture" "$bad_log"
  cp "$fixture" "$ok_log"

  LOG=$bad_log
  if generation_completed "$gen"; then
    rm -f "$bad_log" "$ok_log"
    printf 'FAIL retro-done-guard: interleaved foreign done must not complete session\n' >&2
    return 1
  fi
  printf 'PASS retro-done-guard interleaved done ignored\n'

  LOG=$ok_log
  printf '%s\n' "[2026-06-02T21:00:00Z] reasoning pattern appended session=${gen}" >>"$LOG"
  if generation_completed "$gen"; then
    rm -f "$bad_log" "$ok_log"
    printf 'PASS retro-done-guard session reasoning completes\n'
    return 0
  fi
  rm -f "$bad_log" "$ok_log"
  printf 'FAIL retro-done-guard: session reasoning should complete\n' >&2
  return 1
}

find_transcript() {
  gen=$1
  if [ -d "$TRANSCRIPT_DIR" ]; then
    found=$(find "$TRANSCRIPT_DIR" -type f -name "${gen}.jsonl" 2>/dev/null | head -n 1)
    if [ -n "$found" ]; then
      printf '%s' "$found"
      return 0
    fi
  fi
  return 1
}

if [ "${HARNESS_RETRO_SELFTEST:-}" = "1" ]; then
  run_done_guard_selftest
  exit $?
fi

if [ ! -f "$LOG" ]; then
  log "ERROR: missing $LOG"
  exit 1
fi

if [ ! -f "$CHAIN_SCRIPT" ]; then
  log "ERROR: missing post-task-chain.js (build harness scripts)"
  exit 1
fi

mkdir -p "$(dirname "$RUN_LOG")"
log "retroactive-reflect date=$DATE min_tokens=$MIN_TOKENS dry_run=$DRY_RUN"

processed=0
skipped=0
queued=0

# Collect starts for DATE (log timestamps are [YYYY-MM-DDTHH:MM:SSZ])
starts_file=$(mktemp)
trap 'rm -f "$starts_file"' EXIT INT TERM

grep "\[${DATE}" "$LOG" | grep 'start generation=' >"$starts_file" || true

while IFS= read -r line; do
  gen=$(printf '%s' "$line" | sed -n 's/.*start generation=\([^ ]*\) tokens=\([0-9][0-9]*\).*/\1/p')
  tok=$(printf '%s' "$line" | sed -n 's/.*tokens=\([0-9][0-9]*\).*/\1/p')
  [ -n "$gen" ] && [ -n "$tok" ] || continue

  case $gen in
    unknown|*-retro|*-retry|*-retry-*) skipped=$((skipped + 1)); continue ;;
  esac

  if [ "$tok" -lt "$MIN_TOKENS" ] 2>/dev/null; then
    log "skip $gen tokens=$tok (< $MIN_TOKENS)"
    skipped=$((skipped + 1))
    continue
  fi

  if generation_in_progress "$gen"; then
    log "skip $gen (retro in progress)"
    skipped=$((skipped + 1))
    continue
  fi

  if generation_completed "$gen"; then
    log "skip $gen (already completed)"
    skipped=$((skipped + 1))
    continue
  fi

  retro_id="${gen}-retro"
  queued=$((queued + 1))
  log "queue $gen tokens=$tok -> generation-id=$retro_id"

  if [ "$DRY_RUN" -eq 1 ]; then
    continue
  fi

  chain_dir=$HARNESS_HOME
  if [ ! -d "$chain_dir" ]; then
    chain_dir=$ROOT
  fi

  transcript_path=""
  if tp=$(find_transcript "$gen"); then
    transcript_path=$tp
    log "  transcript=$transcript_path"
  fi

  (
    cd "$chain_dir" 2>/dev/null || cd "$ROOT"
    export CURSOR_API_KEY OBSIDIAN_API_KEY
    set -- node "$CHAIN_SCRIPT" \
      --project-root "$ROOT" \
      --session-id "$gen" \
      --generation-id "$retro_id" \
      --output-tokens "$tok" \
      --obsidian-api-url "$OBSIDIAN_API_URL"
    if [ -n "$transcript_path" ]; then
      set -- "$@" --transcript-path "$transcript_path"
    fi
    if [ -n "${CURSOR_API_KEY:-}" ]; then
      set -- "$@" --cursor-key "$CURSOR_API_KEY"
    fi
    if [ -n "${OBSIDIAN_API_KEY:-}" ]; then
      set -- "$@" --obsidian-token "$OBSIDIAN_API_KEY"
    fi
    "$@" >>"$LOG" 2>&1
  )

  processed=$((processed + 1))
  log "processed $retro_id (exit=$?)"
  sleep "$PAUSE_SEC"
done <"$starts_file"

log "summary date=$DATE queued=$queued processed=$processed skipped=$skipped dry_run=$DRY_RUN"
log "see $LOG for start/done lines; this run log: $RUN_LOG"
