#!/bin/sh
# Print Obsidian vault paths from harness/config/obsidian.yaml for shell sourcing.
# Usage: eval "$(sh harness/scripts/obsidian-vault-path.sh)"
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
CONFIG="$ROOT/harness/config/obsidian.yaml"
vault_root=""
vault_prefix="Harness"
if [ -f "$CONFIG" ]; then
  vault_root=$(awk -F': ' '/^vault_root:/ { gsub(/^["'\'']|["'\'']$/, "", $2); print $2; exit }' "$CONFIG")
  prefix_line=$(awk -F': ' '/^vault_prefix:/ { print $2; exit }' "$CONFIG")
  if [ -n "$prefix_line" ]; then
    vault_prefix=$prefix_line
  fi
fi
if [ -n "${OBSIDIAN_VAULT_ROOT:-}" ]; then
  vault_root=$OBSIDIAN_VAULT_ROOT
fi
printf "OBSIDIAN_VAULT_ROOT='%s'\n" "$vault_root"
printf "OBSIDIAN_VAULT_PREFIX='%s'\n" "$vault_prefix"
printf "OBSIDIAN_HARNESS_DIR='%s/%s'\n" "$vault_root" "$vault_prefix"
