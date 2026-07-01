#!/usr/bin/env bash
# Launch headroom compression proxy for cursorsi
# https://github.com/chopratejas/headroom
set -euo pipefail

CONTAINER_NAME="${HEADROOM_CONTAINER_NAME:-headroom}"
IMAGE="${HEADROOM_IMAGE:-ghcr.io/chopratejas/headroom:latest}"
HOST_PORT="${HEADROOM_HOST_PORT:-8787}"
CONTAINER_PORT=8787

# Check if already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[headroom] already running — $(docker inspect "${CONTAINER_NAME}" --format '{{.State.Status}}') on port ${HOST_PORT}"
  docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  exit 0
fi

# Remove stale container if exists
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

echo "[headroom] launching proxy on port ${HOST_PORT}..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  "${IMAGE}"

echo "[headroom] waiting for health..."
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${HOST_PORT}/health" > /dev/null 2>&1; then
    echo "[headroom] ready at http://localhost:${HOST_PORT}"
    exit 0
  fi
  sleep 1
done

echo "[headroom] timeout waiting for health check"
exit 1