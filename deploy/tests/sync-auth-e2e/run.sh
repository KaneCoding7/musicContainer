#!/usr/bin/env bash
# End-to-end check of credential handling: real backend + Better Auth behind a real Caddy (JSON access log),
# on an isolated docker network with a scratch database. Touches no live data. Usage: bash run.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); OUT=$(mktemp -d)
NET=syncauth-e2e-$$; B=syncauth-be-$$; C=syncauth-caddy-$$
trap 'docker rm -f $B $C >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; docker run --rm -v "$OUT":/o alpine sh -c "rm -rf /o/*" >/dev/null 2>&1; rmdir "$OUT" 2>/dev/null || true' EXIT
mkdir -p "$OUT/logs" "$OUT/data" "$OUT/out"; chmod 777 "$OUT"/*
docker network create $NET >/dev/null
docker run -d --name $B --network $NET --network-alias backend -v "$REPO":/repo -v "$OUT/data":/data -w /repo/backend \
  -e DATA_DIR=/data -e PORT=3001 -e BETTER_AUTH_SECRET="e2e-$(openssl rand -hex 24)" -e BETTER_AUTH_URL=http://caddy:8080 \
  -e FRONTEND_ORIGIN=http://localhost:3000 -e INVITE_ONLY=false node:20-bookworm npx tsx src/server.ts >/dev/null
docker run -d --name $C --network $NET --network-alias caddy -v "$HERE/Caddyfile":/etc/caddy/Caddyfile:ro -v "$OUT/logs":/logs caddy:2-alpine >/dev/null
docker run --rm --network $NET -v "$REPO":/repo:ro -v "$HERE":/e2e-src:ro -v "$OUT":/e2e node:20-bookworm \
  sh -c 'cp /e2e-src/e2e.mjs /e2e/e2e.mjs && node /e2e/e2e.mjs' > "$OUT/out/result.json"
docker run --rm -v "$OUT":/o alpine cat /o/logs/access.log > "$OUT/out/access.json"
docker logs $B > "$OUT/out/backend.log" 2>&1
python3 -I - "$OUT/out" <<'PY'
import json,sys
O=sys.argv[1]; r=json.load(open(f"{O}/result.json"))["results"]; s=json.load(open(f"{O}/secrets.json"))
L=[json.loads(l) for l in open(f"{O}/access.json") if l.strip()]
leaks=[x["request"]["uri"].split("?")[0] for x in L if s["token"] in json.dumps(x)]
legacy={"/api/songs","/api/songs/1/art","/api/sync"}   # the deliberate negative probes
checks=r+[["PASS" if set(leaks)<=legacy and len(leaks)==3 else "FAIL","session token in proxy log (URIs AND request/response headers) only for the 3 refused legacy probes",""],
          ["PASS" if s["token"] not in open(f"{O}/backend.log").read() and s["mt"] not in open(f"{O}/backend.log").read() else "FAIL","backend never logs tokens",""]]
for st,n,x in checks: print(f"{st}  {n}")
bad=sum(1 for c in checks if c[0]!="PASS"); print(f"\n{len(checks)-bad}/{len(checks)} passed"); sys.exit(bad)
PY
