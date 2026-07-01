#!/bin/sh
# End-to-end verify for sispace-gtk: build, static checks, headless smoke (no stack overflow).
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

echo "== build =="
cargo build -p sispace-gtk 2>&1

echo "== static phase checks =="
for f in \
  tests/verify-sispace-gtk4-phase2.mjs \
  tests/verify-sispace-gtk4-phase3.mjs \
  tests/verify-sispace-gtk4-phase4.mjs \
  tests/verify-sispace-gtk4-phase5.mjs \
  tests/verify-sispace-gtk4-sicanvas.mjs
do
  if [ -f "$f" ]; then
    node "$f"
  fi
done

echo "== harness snapshot (core) =="
cargo test -p sispace-core hp_snapshot -- --quiet

echo "== gtk smoke (SISPACE_GTK_SMOKE=1) =="
BIN="$ROOT/target/debug/sispace-gtk"
if [ ! -x "$BIN" ]; then
  echo "verify-sispace-gtk-app: binary missing at $BIN" >&2
  exit 1
fi

SMOKE_LOG=$(mktemp)
trap 'rm -f "$SMOKE_LOG"' EXIT

_run_smoke() {
  env SISPACE_GTK_SMOKE=1 timeout 50 "$BIN" 2>"$SMOKE_LOG"
}

if command -v xvfb-run >/dev/null 2>&1; then
  env SISPACE_GTK_SMOKE=1 timeout 55 xvfb-run -a "$BIN" 2>"$SMOKE_LOG" || true
else
  _run_smoke || true
fi

if grep -q "stack overflow" "$SMOKE_LOG" 2>/dev/null; then
  echo "verify-sispace-gtk-app: stack overflow during smoke" >&2
  tail -30 "$SMOKE_LOG" >&2
  exit 1
fi

if grep -q "SIGABRT" "$SMOKE_LOG" 2>/dev/null; then
  echo "verify-sispace-gtk-app: abort during smoke" >&2
  tail -30 "$SMOKE_LOG" >&2
  exit 1
fi

if ! grep -q "SISPACE_GTK_SMOKE_OK" "$SMOKE_LOG"; then
  echo "verify-sispace-gtk-app: smoke did not complete (no SISPACE_GTK_SMOKE_OK)" >&2
  tail -40 "$SMOKE_LOG" >&2
  exit 1
fi

echo "verify-sispace-gtk-app OK"
cat "$SMOKE_LOG" | grep -E "smoke|SISPACE_GTK" || true
