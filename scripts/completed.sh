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
keys=['gid','status','totalLength','completedLength','files','bittorrent','dir']
try:
    stopped = rpc('aria2.tellStopped', [0,100,keys]) or []
except Exception as e:
    print(f'Could not connect to aria2 RPC: {e}')
    sys.exit(0)
def pick_name(item):
    bt=item.get('bittorrent') or {}; info=bt.get('info') or {}
    if info.get('name'): return info['name']
    files=item.get('files') or []
    if files:
        path=files[0].get('path') or ''
        if path: return path.split('/')[-1]
    return item.get('gid','unknown')
def size_string(item):
    total=float(int(item.get('totalLength') or 0)); units=['B','KiB','MiB','GiB','TiB']; i=0
    while total>=1024 and i<len(units)-1: total/=1024; i+=1
    return f"{int(total) if i==0 else round(total,1)} {units[i]}"
clean=[]; seen=set()
for item in stopped:
    if item.get('status') != 'complete': continue
    name=pick_name(item)
    if not name or name.startswith('[METADATA]'): continue
    key=(name,item.get('dir') or '')
    if key in seen: continue
    seen.add(key); clean.append(item)
if not clean:
    print('No completed downloads found.')
    sys.exit(0)
for idx,item in enumerate(clean[:10],1):
    print(f"{idx}. {pick_name(item)}")
    print(f"   Size: {size_string(item)} | Path: {item.get('dir') or ''}")
    print('---')
PY
