#!/usr/bin/env bash
set -euo pipefail

RPC_PORT="${ARIA2_RPC_PORT:-6800}"
DOWNLOAD_DIR="${ARIA2_DOWNLOAD_DIR:-${HOME}/Downloads}"
RPC_SECRET="${ARIA2_RPC_SECRET:-}"
LOG_FILE="${ARIA2_LOG_FILE:-/tmp/aria2-daemon.log}"

mkdir -p "$DOWNLOAD_DIR"

if ! command -v aria2c >/dev/null 2>&1; then
  echo "aria2c is not installed"
  exit 1
fi

PORT_INFO="$(ss -ltnp 2>/dev/null | grep ":$RPC_PORT" || true)"
if [[ -n "$PORT_INFO" ]]; then
  if echo "$PORT_INFO" | grep -q "aria2c"; then
    echo "aria2 daemon already running on port $RPC_PORT"
    exit 0
  fi
  echo "Port $RPC_PORT is already in use by another process"
  echo "$PORT_INFO"
  exit 1
fi

CMD=(
  aria2c
  --enable-rpc=true
  --rpc-listen-all=false
  --rpc-allow-origin-all
  --rpc-listen-port="$RPC_PORT"
  --seed-time=0
  --dir="$DOWNLOAD_DIR"
)

if [[ -n "$RPC_SECRET" ]]; then
  CMD+=(--rpc-secret="$RPC_SECRET")
fi

nohup "${CMD[@]}" >"$LOG_FILE" 2>&1 &
sleep 3

PORT_INFO="$(ss -ltnp 2>/dev/null | grep ":$RPC_PORT" || true)"
if [[ -n "$PORT_INFO" ]] && echo "$PORT_INFO" | grep -q "aria2c"; then
  echo "aria2 daemon started on port $RPC_PORT"
  exit 0
fi

echo "Failed to start aria2 daemon"
[[ -f "$LOG_FILE" ]] && cat "$LOG_FILE"
exit 1
