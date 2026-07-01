#!/usr/bin/env bash
# Build release sispace-gtk binary and copy to dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
DIST="$ROOT/dist"
BIN_NAME="sispace-gtk"

echo "==> cargo build --release -p sispace-gtk"
cargo build --release -p sispace-gtk

SRC="$ROOT/target/release/$BIN_NAME"
if [[ ! -f "$SRC" ]]; then
  echo "error: missing $SRC" >&2
  exit 1
fi

mkdir -p "$DIST"
DEST="$DIST/${BIN_NAME}-${VERSION}"
cp -f "$SRC" "$DEST"
chmod 755 "$DEST"

# Convenience symlink for local runs
ln -sf "${BIN_NAME}-${VERSION}" "$DIST/$BIN_NAME"

echo "==> packaged $DEST"
