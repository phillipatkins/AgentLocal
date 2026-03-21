#!/usr/bin/env bash
set -euo pipefail

MAGNET="${1:-}"
RPC_PORT="${ARIA2_RPC_PORT:-6800}"
RPC_SECRET="${ARIA2_RPC_SECRET:-}"

if [[ -z "$MAGNET" ]]; then
  echo "No magnet link provided"
  exit 1
fi

python3 - "$MAGNET" "$RPC_PORT" "$RPC_SECRET" <<'PY'
import json
import sys
import urllib.request

magnet = sys.argv[1]
port = int(sys.argv[2])
secret = sys.argv[3]

payload = {"jsonrpc":"2.0","id":"whatsapp-bot","method":"aria2.addUri","params":[]}
if secret:
    payload["params"].append(f"token:{secret}")
payload["params"].append([magnet])
req = urllib.request.Request(f"http://127.0.0.1:{port}/jsonrpc", data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"})
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read().decode())
if "error" in data:
    print(f"Failed to add magnet via aria2 RPC: {data['error'].get('message','Unknown RPC error')}")
    sys.exit(1)
print(f"Magnet queued (gid: {data.get('result','')})")
PY
