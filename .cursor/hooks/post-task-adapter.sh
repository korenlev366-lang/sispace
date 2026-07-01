#!/bin/sh

INPUT=$(cat)
THRESHOLD=1000

extract_json_field() {
  field=$1
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -r ".${field} // empty" 2>/dev/null
    return
  fi
  printf '%s' "$INPUT" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

extract_output_tokens() {
  if command -v jq >/dev/null 2>&1; then
    val=$(printf '%s' "$INPUT" | jq -r '.output_tokens // empty' 2>/dev/null)
    case "$val" in
      ''|null) echo -1 ;;
      *[!0-9]*) echo -1 ;;
      *) echo "$val" ;;
    esac
    return
  fi

  val=$(printf '%s' "$INPUT" | sed -n 's/.*"output_tokens"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
  if [ -n "$val" ]; then
    echo "$val"
  else
    echo -1
  fi
}

extract_session_id() {
  sid=$(extract_json_field session_id)
  if [ -n "$sid" ]; then
    printf '%s' "$sid"
    return
  fi
  extract_json_field conversation_id
}

extract_transcript_path() {
  tp=$(extract_json_field transcript_path)
  if [ -n "$tp" ]; then
    printf '%s' "$tp"
    return
  fi
  extract_json_field agent_transcript_path
}

output_tokens=$(extract_output_tokens)
if [ "$output_tokens" -lt 0 ] 2>/dev/null; then
  output_tokens=$THRESHOLD
fi

session_id=$(extract_session_id)
if [ -z "$session_id" ]; then
  session_id=unknown
fi

generation_id=$(extract_json_field generation_id)
if [ -z "$generation_id" ]; then
  generation_id=unknown
fi

ROOT=$(pwd)
SISPACE_HOME=${SISPACE_HOME:-$HOME/sispace}
HARNESS_HOME=${HARNESS_HOME:-$HOME/.cursor-harness}
CHAIN_SCRIPT=$HARNESS_HOME/harness/scripts/dist/post-task-chain.js

# Memory ledgers and reports always land in SISpace (PROP cross-repo memory consolidation).
MEMORY_ROOT=$ROOT
if [ -d "$SISPACE_HOME/harness/memory" ]; then
  MEMORY_ROOT=$SISPACE_HOME
fi
CHAIN_LOG=$MEMORY_ROOT/harness/reports/post-task-chain.log

if [ ! -f "$CHAIN_SCRIPT" ]; then
  CHAIN_SCRIPT=$ROOT/harness/scripts/dist/post-task-chain.js
fi

json_escape() {
  printf '%s' "$1" | tr '\n\r' '  ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

run_sdk_chain() {
  transcript_path=$(extract_transcript_path)
  obsidian_api_url=${OBSIDIAN_API_URL:-http://127.0.0.1:27123}

  if [ ! -f "$CHAIN_SCRIPT" ]; then
    printf '%s\n' '{"agent_message":"Harness postTask: SDK chain script missing; rebuild ~/.cursor-harness (npm run build)."}'
    return 0
  fi

  mkdir -p "$(dirname "$CHAIN_LOG")"

  chain_dir=$HARNESS_HOME
  if [ ! -d "$chain_dir" ]; then
    chain_dir=$ROOT
  fi

  # Detach from hook process group — otherwise node is killed when the hook exits.
  export CURSOR_API_KEY OBSIDIAN_API_KEY
  (
    cd "$chain_dir" 2>/dev/null || cd "$ROOT"
    if command -v setsid >/dev/null 2>&1; then
      setsid node "$CHAIN_SCRIPT" \
        --project-root "$ROOT" \
        --session-id "$session_id" \
        --generation-id "$generation_id" \
        --output-tokens "$output_tokens" \
        ${transcript_path:+--transcript-path "$transcript_path"} \
        ${CURSOR_API_KEY:+--cursor-key "$CURSOR_API_KEY"} \
        ${OBSIDIAN_API_KEY:+--obsidian-token "$OBSIDIAN_API_KEY"} \
        --obsidian-api-url "$obsidian_api_url" \
        >>"$CHAIN_LOG" 2>&1 &
    else
      nohup node "$CHAIN_SCRIPT" \
        --project-root "$ROOT" \
        --session-id "$session_id" \
        --generation-id "$generation_id" \
        --output-tokens "$output_tokens" \
        ${transcript_path:+--transcript-path "$transcript_path"} \
        ${CURSOR_API_KEY:+--cursor-key "$CURSOR_API_KEY"} \
        ${OBSIDIAN_API_KEY:+--obsidian-token "$OBSIDIAN_API_KEY"} \
        --obsidian-api-url "$obsidian_api_url" \
        >>"$CHAIN_LOG" 2>&1 &
    fi
  )

  printf '%s\n' '{}'
}

if [ "$output_tokens" -ge "$THRESHOLD" ]; then
  run_sdk_chain
else
  msg="Harness postTask: short session (${output_tokens} output tokens). Lightweight nudge only — skip the auto chain unless there was a user correction, failure, or explicit reflection request."
  esc=$(json_escape "$msg")
  printf '%s\n' "{\"agent_message\":\"$esc\"}"
fi

exit 0
