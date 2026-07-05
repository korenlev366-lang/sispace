#!/bin/sh
# Seed local harness state from harness/scaffold/ after clone (memory, reports, config).
# Usage: sh harness/scripts/harness-bootstrap.sh [PROJECT_ROOT]
set -eu

ROOT=${1:-$(pwd)}
SCAFFOLD="$ROOT/harness/scaffold"

if [ ! -d "$SCAFFOLD/memory" ]; then
  printf 'ERROR: harness/scaffold/memory missing — run from SISpace repo root\n' >&2
  exit 1
fi

copy_if_missing() {
  src=$1
  dst=$2
  if [ ! -f "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    printf 'INIT  %s\n' "$dst"
  fi
}

printf 'Harness bootstrap\n'
printf '  project: %s\n\n' "$ROOT"

mkdir -p "$ROOT/harness/memory/accepted-lessons"
mkdir -p "$ROOT/harness/reports"

for f in "$SCAFFOLD/memory"/*; do
  [ -f "$f" ] || continue
  copy_if_missing "$f" "$ROOT/harness/memory/$(basename "$f")"
done

for f in "$SCAFFOLD/reports"/*; do
  [ -f "$f" ] || continue
  copy_if_missing "$f" "$ROOT/harness/reports/$(basename "$f")"
done

if [ ! -f "$ROOT/harness/memory/lesson-index.json" ]; then
  mkdir -p "$ROOT/harness/memory"
  printf '%s\n' '{"version":1,"generated":"","source":"harness/memory/accepted-lessons/","entries":[]}' \
    > "$ROOT/harness/memory/lesson-index.json"
  printf 'INIT  harness/memory/lesson-index.json\n'
fi

if [ ! -f "$ROOT/harness/config/obsidian.yaml" ]; then
  if [ -f "$ROOT/harness/config/obsidian.yaml.example" ]; then
    cp "$ROOT/harness/config/obsidian.yaml.example" "$ROOT/harness/config/obsidian.yaml"
    printf 'INIT  harness/config/obsidian.yaml (from obsidian.yaml.example)\n'
  else
    printf 'WARN  harness/config/obsidian.yaml.example missing\n' >&2
  fi
fi

printf '\nLocal harness memory/reports ready (gitignored — not pushed to GitHub).\n'
printf 'Set vault_root in harness/config/obsidian.yaml or export OBSIDIAN_VAULT_ROOT.\n'
exit 0
