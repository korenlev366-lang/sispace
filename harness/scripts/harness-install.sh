#!/bin/sh
# Install cursor-harness + SISpace integration into a project (or sync global template).
# Usage: sh harness/scripts/harness-install.sh [--force] [--sync-global] [--sispace-home PATH] [TARGET_DIR]
# Template: repo containing this script (preferred) or ~/.cursor-harness

set -eu

FORCE=false
SYNC_GLOBAL=false
SISPACE_HOME_ARG=""
TARGET_DIR=""

while [ $# -gt 0 ]; do
  arg=$1
  case "$arg" in
    --force) FORCE=true; shift ;;
    --sync-global) SYNC_GLOBAL=true; shift ;;
    --sispace-home)
      if [ $# -lt 2 ]; then
        printf '%s\n' "ERROR: --sispace-home requires a path" >&2
        exit 1
      fi
      SISPACE_HOME_ARG=$2
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: sh harness-install.sh [--force] [--sync-global] [--sispace-home PATH] [TARGET_DIR]

Installs the current harness template into TARGET_DIR (default: cwd).

Copies:
  .cursor/hooks.json, .cursor/hooks/ (post-task adapter, pre-tool, lesson context)
  .cursor/commands/ (harness-* slash commands)
  .cursor/agents/ (reflection, grading, rollout, checker agents, …)
  .cursor/skills/harness-workflow/, harness-reflection/
  harness/config/ (harness.yaml, obsidian.yaml, …)
  harness/scripts/ (shell tools + dist/*.js; excludes node_modules)
  Empty memory/report ledgers from harness/scaffold/ (skip existing unless --force)

SISpace integration:
  When ~/sispace/harness/memory exists (or --sispace-home), ledgers and reports
  scaffold there — post-task hooks write canonical memory to SISpace, not TARGET.
  project-index.md in TARGET documents the canonical store and SISPACE_HOME.

  Runs `npm run build` in harness/scripts when dist/ is missing or --force.

--sync-global  Also refresh ~/.cursor-harness from this template (hooks + scripts dist).

Restart Cursor after install so hook changes load.
EOF
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n' "$arg" >&2
      exit 1
      ;;
    *)
      if [ -z "$TARGET_DIR" ]; then
        TARGET_DIR=$arg
      else
        printf 'Unexpected argument: %s\n' "$arg" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$TARGET_DIR" ]; then
  TARGET_DIR=$(pwd)
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
HARNESS_HOME=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

if [ ! -f "$HARNESS_HOME/.cursor/hooks.json" ]; then
  if [ -d "$HOME/.cursor-harness/.cursor/hooks" ]; then
    HARNESS_HOME=$HOME/.cursor-harness
  else
    printf 'Harness template not found at %s or ~/.cursor-harness\n' "$HARNESS_HOME" >&2
    exit 1
  fi
fi

SRC_CURSOR=$HARNESS_HOME/.cursor
SRC_HARNESS=$HARNESS_HOME/harness

COPIED=0
SKIPPED=0

copy_file() {
  src=$1
  dst=$2
  if [ ! -f "$src" ]; then
    return 0
  fi
  if [ -f "$dst" ] && [ "$dst" -ef "$src" ]; then
    printf 'SKIP  %s (same inode)\n' "$dst"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi
  if [ -f "$dst" ] && [ "$FORCE" != true ]; then
    printf 'SKIP  %s\n' "$dst"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  cp -f "$src" "$dst"
  printf 'COPY  %s\n' "$dst"
  COPIED=$((COPIED + 1))
}

should_skip_path() {
  rel=$1
  case "$rel" in
    node_modules|node_modules/*|*/node_modules|*/node_modules/*) return 0 ;;
    vault-mirror|vault-mirror/*|*/vault-mirror|*/vault-mirror/*) return 0 ;;
    scaffold|scaffold/*) return 0 ;;
    *) return 1 ;;
  esac
}

copy_tree() {
  src_root=$1
  dst_root=$2
  if [ ! -d "$src_root" ]; then
    return 0
  fi
  mkdir -p "$dst_root"
  for src in $(find "$src_root" -type f | sort); do
    rel=${src#"$src_root"/}
    if should_skip_path "$rel"; then
      continue
    fi
    dst=$dst_root/$rel
    copy_file "$src" "$dst"
    case $dst in
      *.sh) chmod +x "$dst" 2>/dev/null || true ;;
    esac
  done
}

resolve_sispace_home() {
  if [ -n "$SISPACE_HOME_ARG" ]; then
    printf '%s' "$SISPACE_HOME_ARG"
    return
  fi
  if [ -n "${SISPACE_HOME:-}" ] && [ -d "${SISPACE_HOME}/harness/memory" ]; then
    printf '%s' "$SISPACE_HOME"
    return
  fi
  default_home=$HOME/sispace
  if [ -d "$default_home/harness/memory" ]; then
    printf '%s' "$default_home"
    return
  fi
  printf '%s' ""
}

SISPACE_CANONICAL=$(resolve_sispace_home)
MEMORY_ROOT=$TARGET_DIR
USE_SISPACE_MEMORY=false

if [ -n "$SISPACE_CANONICAL" ] && [ -d "$SISPACE_CANONICAL/harness/memory" ]; then
  case $(CDPATH= cd -- "$TARGET_DIR" && pwd) in
    "$(CDPATH= cd -- "$SISPACE_CANONICAL" && pwd)")
      MEMORY_ROOT=$TARGET_DIR
      ;;
    *)
      MEMORY_ROOT=$SISPACE_CANONICAL
      USE_SISPACE_MEMORY=true
      ;;
  esac
fi

printf 'Harness install\n'
printf '  template:      %s\n' "$HARNESS_HOME"
printf '  target:        %s\n' "$TARGET_DIR"
printf '  memory root:   %s\n' "$MEMORY_ROOT"
if [ "$USE_SISPACE_MEMORY" = true ]; then
  printf '  sispace mode:  canonical memory in SISpace (hooks use SISPACE_HOME)\n'
fi
printf '  force:         %s\n' "$FORCE"
printf '  sync-global:   %s\n' "$SYNC_GLOBAL"
printf '\n'

if [ ! -f "$SRC_CURSOR/hooks.json" ]; then
  printf 'Missing template: %s\n' "$SRC_CURSOR/hooks.json" >&2
  exit 1
fi

DST_CURSOR=$TARGET_DIR/.cursor

copy_file "$SRC_CURSOR/hooks.json" "$DST_CURSOR/hooks.json"

if [ -d "$SRC_CURSOR/hooks" ]; then
  copy_tree "$SRC_CURSOR/hooks" "$DST_CURSOR/hooks"
else
  printf 'WARN  template hooks directory missing: %s\n' "$SRC_CURSOR/hooks" >&2
fi

if [ -f "$DST_CURSOR/mcp.json" ] && [ "$FORCE" != true ]; then
  printf 'SKIP  %s\n' "$DST_CURSOR/mcp.json"
  SKIPPED=$((SKIPPED + 1))
elif [ -f "$SRC_CURSOR/mcp.json" ]; then
  copy_file "$SRC_CURSOR/mcp.json" "$DST_CURSOR/mcp.json"
else
  printf 'NOTE  no template mcp.json — keep Obsidian MCP in ~/.cursor/mcp.json only\n'
fi

if [ -d "$SRC_CURSOR/commands" ]; then
  copy_tree "$SRC_CURSOR/commands" "$DST_CURSOR/commands"
fi

if [ -d "$SRC_CURSOR/agents" ]; then
  copy_tree "$SRC_CURSOR/agents" "$DST_CURSOR/agents"
fi

if [ -d "$SRC_CURSOR/skills" ]; then
  for skill_dir in "$SRC_CURSOR"/skills/harness-*; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    copy_tree "$skill_dir" "$DST_CURSOR/skills/$skill_name"
  done
fi

if [ -d "$SRC_HARNESS/config" ]; then
  copy_tree "$SRC_HARNESS/config" "$TARGET_DIR/harness/config"
fi

if [ -d "$SRC_HARNESS/scaffold/memory" ]; then
  copy_tree "$SRC_HARNESS/scaffold/memory" "$MEMORY_ROOT/harness/memory"
fi

if [ -d "$SRC_HARNESS/scaffold/reports" ]; then
  copy_tree "$SRC_HARNESS/scaffold/reports" "$MEMORY_ROOT/harness/reports"
fi

if [ -d "$SRC_HARNESS/scripts" ]; then
  copy_tree "$SRC_HARNESS/scripts" "$TARGET_DIR/harness/scripts"
fi

if [ -f "$SRC_HARNESS/memory/README.md" ]; then
  copy_file "$SRC_HARNESS/memory/README.md" "$MEMORY_ROOT/harness/memory/README.md"
fi

if [ -f "$SRC_HARNESS/reports/README.md" ]; then
  copy_file "$SRC_HARNESS/reports/README.md" "$MEMORY_ROOT/harness/reports/README.md"
fi

if [ -f "$HARNESS_HOME/docs/meta-harness-readiness.md" ]; then
  copy_file "$HARNESS_HOME/docs/meta-harness-readiness.md" "$TARGET_DIR/docs/meta-harness-readiness.md"
fi

# Ensure post-task chain can run from target or global home
SCRIPTS_DIR=$TARGET_DIR/harness/scripts
if [ -f "$SCRIPTS_DIR/package.json" ]; then
  need_build=false
  if [ ! -f "$SCRIPTS_DIR/dist/post-task-chain.js" ]; then
    need_build=true
  fi
  if [ ! -f "$SCRIPTS_DIR/dist/panel-actions.js" ]; then
    need_build=true
  fi
  if [ "$FORCE" = true ]; then
    need_build=true
  fi
  if [ "$need_build" = true ]; then
    if [ ! -d "$SCRIPTS_DIR/node_modules" ] || [ "$FORCE" = true ]; then
      printf 'BUILD npm install in %s\n' "$SCRIPTS_DIR"
      (cd "$SCRIPTS_DIR" && npm install --no-fund --no-audit) || {
        printf 'WARN  npm install failed — run manually in %s\n' "$SCRIPTS_DIR" >&2
      }
    fi
    if [ -d "$SCRIPTS_DIR/node_modules" ]; then
      printf 'BUILD npm run build in %s\n' "$SCRIPTS_DIR"
      (cd "$SCRIPTS_DIR" && npm run build) || {
        printf 'WARN  npm run build failed — dist may be stale\n' "$SCRIPTS_DIR" >&2
      }
    fi
  fi
fi

if [ "$SYNC_GLOBAL" = true ]; then
  GLOBAL=$HOME/.cursor-harness
  printf '\nSync global template → %s\n' "$GLOBAL"
  mkdir -p "$GLOBAL/.cursor" "$GLOBAL/harness"
  copy_file "$SRC_CURSOR/hooks.json" "$GLOBAL/.cursor/hooks.json"
  if [ -d "$SRC_CURSOR/hooks" ]; then
    copy_tree "$SRC_CURSOR/hooks" "$GLOBAL/.cursor/hooks"
  fi
  if [ -d "$SRC_CURSOR/commands" ]; then
    copy_tree "$SRC_CURSOR/commands" "$GLOBAL/.cursor/commands"
  fi
  if [ -d "$SRC_CURSOR/agents" ]; then
    copy_tree "$SRC_CURSOR/agents" "$GLOBAL/.cursor/agents"
  fi
  if [ -d "$SRC_CURSOR/skills" ]; then
    for skill_dir in "$SRC_CURSOR"/skills/harness-*; do
      [ -d "$skill_dir" ] || continue
      skill_name=$(basename "$skill_dir")
      copy_tree "$skill_dir" "$GLOBAL/.cursor/skills/$skill_name"
    done
  fi
  if [ -d "$SRC_HARNESS/config" ]; then
    copy_tree "$SRC_HARNESS/config" "$GLOBAL/harness/config"
  fi
  if [ -d "$SRC_HARNESS/scaffold" ]; then
    copy_tree "$SRC_HARNESS/scaffold" "$GLOBAL/harness/scaffold"
  fi
  if [ -d "$SRC_HARNESS/scripts" ]; then
    copy_tree "$SRC_HARNESS/scripts" "$GLOBAL/harness/scripts"
  fi
  if [ -f "$GLOBAL/harness/scripts/package.json" ] && [ -d "$GLOBAL/harness/scripts/node_modules" ]; then
    (cd "$GLOBAL/harness/scripts" && npm run build) 2>/dev/null || true
  fi
fi

INSTALL_DATE=$(date +%Y-%m-%d)
INDEX=$TARGET_DIR/harness/memory/project-index.md
mkdir -p "$(dirname "$INDEX")"

SISPACE_NOTE=""
if [ "$USE_SISPACE_MEMORY" = true ]; then
  SISPACE_NOTE="- Canonical memory/reports: $MEMORY_ROOT (SISpace). Hooks set MEMORY_ROOT from SISPACE_HOME.
- Override: export SISPACE_HOME=$MEMORY_ROOT"
fi

if [ ! -f "$INDEX" ]; then
  {
    printf '%s\n' '# Project Memory Index'
    printf '%s\n' ''
    if [ -n "$SISPACE_NOTE" ]; then
      printf '%s\n' '## SISpace canonical store'
      printf '%s\n' ''
      printf '%s\n' "$SISPACE_NOTE"
      printf '%s\n' ''
    fi
    printf '%s\n' '## Harness installation'
    printf '%s\n' ''
    printf -- '- Harness installed: %s\n' "$INSTALL_DATE"
    printf -- '- Template source: %s\n' "$HARNESS_HOME"
    printf '%s\n' '- Installed: .cursor/hooks.json, .cursor/hooks/, .cursor/commands/, .cursor/agents/, .cursor/skills/harness-*/'
    printf '%s\n' '- Scripts: harness/scripts/ (post-task-chain, panel-actions accept/reject/apply-all, doctor, retroactive-reflect)'
    printf '%s\n' ''
    printf '%s\n' '## Ledgers (see harness/memory/README.md in canonical store)'
    printf '%s\n' ''
    printf '%s\n' '- pending-proposals.md, accepted-lessons.md, rejected-lessons.md'
    printf '%s\n' '- user-model.md, reasoning-patterns.md, tool-override-log.md'
    printf '%s\n' ''
    printf '%s\n' '## Reports'
    printf '%s\n' ''
    printf '%s\n' '- rollout-log.md, latest-reflection.md, latest-grade.md, post-task-chain.log'
  } > "$INDEX"
  printf 'CREATE %s\n' "$INDEX"
  COPIED=$((COPIED + 1))
else
  if ! grep -q 'Harness installed:' "$INDEX" 2>/dev/null; then
    {
      printf '\n## Harness installation\n\n'
      printf -- '- Harness installed: %s\n' "$INSTALL_DATE"
      printf -- '- Template source: %s\n' "$HARNESS_HOME"
    } >> "$INDEX"
    printf 'UPDATE %s (install note appended)\n' "$INDEX"
    COPIED=$((COPIED + 1))
  fi
  if [ -n "$SISPACE_NOTE" ] && ! grep -q 'Canonical memory/reports' "$INDEX" 2>/dev/null; then
    {
      printf '\n## SISpace canonical store\n\n'
      printf '%s\n' "$SISPACE_NOTE"
    } >> "$INDEX"
    printf 'UPDATE %s (SISpace note appended)\n' "$INDEX"
    COPIED=$((COPIED + 1))
  fi
fi

printf '\nSummary\n'
printf '  copied:  %s\n' "$COPIED"
printf '  skipped: %s\n' "$SKIPPED"
if [ "$USE_SISPACE_MEMORY" = true ]; then
  printf '\nSISpace: post-task memory and reports write to %s\n' "$MEMORY_ROOT"
  printf 'Set SISPACE_HOME=%s in your shell or Cursor env if needed.\n' "$MEMORY_ROOT"
fi
printf '\nRestart Cursor (or start a new agent session) so hook changes load.\n'
