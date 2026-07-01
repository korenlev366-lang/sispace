#!/usr/bin/env sh
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
DB="${SISPACE_DB_PATH:-$HOME/.local/share/sispace/tasks.db}"
export SISPACE_DB_PATH="$DB"
export CURSORSI_DB_PATH="$DB"
# cursorsi reads CURSORSI_DB_PATH via cli/src/search/query.ts
exec node "$ROOT/bin/cursorsi.mjs" --db-path "$DB" "$@"
