#!/usr/bin/env bash
set -euo pipefail
RPC_PORT="${ARIA2_RPC_PORT:-6800}"
RPC_SECRET="${ARIA2_RPC_SECRET:-}"
python3 - "$RPC_PORT" "$RPC_SECRET" <<'PY'
import json, sys, urllib.request
port = int(sys.argv[1]); secret = sys.argv[2]
def rpc(method, params=None):
    payload = {"jsonrpc":"2.0","id":method,"method":method,"params":[]}
    if secret: payload["params"].append(f"token:{secret}")
    if params: payload["params"].extend(params)
    req = urllib.request.Request(f"http://127.0.0.1:{port}/jsonrpc", data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    if "error" in data: raise RuntimeError(data["error"].get("message","Unknown RPC error"))
    return data.get("result")
keys=["gid","status","totalLength","completedLength","downloadSpeed","files","bittorrent"]
try:
    active = rpc("aria2.tellActive", [keys]) or []
    waiting = rpc("aria2.tellWaiting", [0,20,keys]) or []
except Exception as e:
    print(f"Could not connect to aria2 RPC: {e}")
    sys.exit(0)
items = [*active, *[i for i in waiting if i.get('status') in ('waiting','paused')]]
def pick_name(item):
    bt=item.get('bittorrent') or {}; info=bt.get('info') or {}
    if info.get('name'): return info['name']
    files=item.get('files') or []
    if files:
        path=files[0].get('path') or ''
        if path: return path.split('/')[-1]
    return item.get('gid','unknown')
def pct(item):
    total=int(item.get('totalLength') or 0); done=int(item.get('completedLength') or 0)
    return '0.0%' if total<=0 else f"{(done/total)*100:.1f}%"
def speed(item):
    v=float(int(item.get('downloadSpeed') or 0)); units=['B/s','KiB/s','MiB/s','GiB/s']; i=0
    while v>=1024 and i<len(units)-1: v/=1024; i+=1
    return f"{int(v) if i==0 else round(v,1)} {units[i]}"
clean=[]; seen=set()
for item in items:
    name=pick_name(item)
    if not name or name.startswith('[METADATA]'): continue
    k=(name,item.get('status',''))
    if k in seen: continue
    seen.add(k); clean.append(item)
if not clean:
    print('No active downloads found.')
    sys.exit(0)
for idx,item in enumerate(clean,1):
    print(f"{idx}. {pick_name(item)}")
    print(f"   Status: {item.get('status','unknown')} | Progress: {pct(item)} | Speed: {speed(item)}")
    print('---')
PY
