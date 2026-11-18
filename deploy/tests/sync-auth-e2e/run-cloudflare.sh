#!/usr/bin/env bash
# Same checks as run.sh, but THROUGH CLOUDFLARE: backend + Caddy exposed via a temporary Cloudflare quick tunnel
# (trycloudflare.com, no account, pinned cloudflared as used in PROD), plus a real-browser test of the built frontend.
# Scratch data only; everything is removed on exit. Usage: bash run-cloudflare.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); OUT=$(mktemp -d)
NET=syncauth-cf-$$; B=syncauth-be-$$; C=syncauth-caddy-$$; T=syncauth-cfd-$$; F=syncauth-fe-$$
CFD=cloudflare/cloudflared:2026.11.0@sha256:b94b96edf2c9c4360f8879c8580cfaa99077f19c849ec595ca2f711b27d4f344
trap 'docker rm -f $B $C $T $F $F-pw >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; docker run --rm -v "$OUT":/o alpine sh -c "rm -rf /o/*" >/dev/null 2>&1; rmdir "$OUT" 2>/dev/null || true' EXIT
mkdir -p "$OUT/logs" "$OUT/data" "$OUT/out"; chmod 777 "$OUT"/*
[ -d "$REPO/frontend/build" ] || { echo "build the frontend first (npm run build)"; exit 1; }
docker network create $NET >/dev/null
docker run -d --name $B --network $NET --network-alias backend -v "$REPO":/repo -v "$OUT/data":/data -w /repo/backend \
  -e DATA_DIR=/data -e PORT=3001 -e BETTER_AUTH_SECRET="e2e-$(openssl rand -hex 24)" -e BETTER_AUTH_URL=http://caddy:8080 \
  -e FRONTEND_ORIGIN=http://frontend:3000 -e INVITE_ONLY=false node:20-bookworm npx tsx src/server.ts >/dev/null
docker run -d --name $C --network $NET --network-alias caddy -v "$HERE/Caddyfile":/etc/caddy/Caddyfile:ro -v "$OUT/logs":/logs caddy:2-alpine >/dev/null
docker run -d --name $T --network $NET $CFD tunnel --no-autoupdate --url http://caddy:8080 >/dev/null
URL=""; for i in $(seq 1 60); do URL=$(docker logs $T 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true); [ -n "$URL" ] && break; sleep 1; done
[ -n "$URL" ] || { echo "quick tunnel did not come up"; docker logs $T 2>&1 | tail -5; exit 1; }
for i in $(seq 1 60); do curl -fsS -m 5 "$URL/api/health" >/dev/null 2>&1 && break; sleep 2; done
echo "tunnel up (random trycloudflare host)"
docker run -d --name $F --network $NET --network-alias frontend -v "$REPO/frontend":/fe -w /fe -e PORT=3000 -e PUBLIC_API_BASE_URL="$URL" node:20-bookworm node build >/dev/null
sleep 3
docker run --rm --network $NET -e E2E_BASE="$URL" -v "$REPO":/repo:ro -v "$HERE":/e2e-src:ro -v "$OUT":/e2e node:20-bookworm \
  sh -c 'cp /e2e-src/e2e.mjs /e2e/e2e.mjs && node /e2e/e2e.mjs' > "$OUT/out/result.json" || true
PW=mcr.microsoft.com/playwright:v1.49.1-noble
mkdir -p "$OUT/mark"; chmod 777 "$OUT/mark"
docker run -d --name $F-pw --network $NET -v "$HERE":/t:ro -v "$OUT/mark":/mark -v "$OUT/out":/res $PW \
  bash -c 'mkdir -p /pw && cd /pw && npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.49.1 >/dev/null 2>&1 && node /t/browser.cjs http://frontend:3000 "'"$URL"'" /mark > /res/browser.json' >/dev/null
for step in restart1 restart2; do
  for i in $(seq 1 600); do [ -f "$OUT/mark/$step.req" ] && break; [ "$(docker inspect -f '{{.State.Running}}' $F-pw 2>/dev/null)" = true ] || break; sleep 1; done
  [ -f "$OUT/mark/$step.req" ] && { docker restart -t 5 $B >/dev/null; touch "$OUT/mark/$step.ack"; echo "host: $step done"; }
done
docker wait $F-pw >/dev/null 2>&1 || true; docker rm -f $F-pw >/dev/null 2>&1 || true
docker logs $T > "$OUT/out/cloudflared.log" 2>&1; docker logs $B > "$OUT/out/backend.log" 2>&1
docker run --rm -v "$OUT":/o alpine cat /o/logs/access.log > "$OUT/out/access.json"
python3 -I - "$OUT/out" <<'PY'
import json,sys
O=sys.argv[1]; s=json.load(open(f"{O}/secrets.json"))
r=json.load(open(f"{O}/result.json"))["results"]; b=json.load(open(f"{O}/browser.json"))["results"]
cfd=open(f"{O}/cloudflared.log").read(); be=open(f"{O}/backend.log").read()
L=[json.loads(l) for l in open(f"{O}/access.json") if l.strip()]
leaks={x["request"]["uri"].split("?")[0] for x in L if s["token"] in json.dumps(x)}
checks=[["API "+c[0],c[1],c[2]] for c in r]+[["BROWSER "+c[0],c[1],c[2]] for c in b]+[
 ["PASS" if leaks<= {"/api/songs","/api/songs/1/art","/api/sync"} else "FAIL","proxy log: session token only in the refused legacy probes",""],
 ["PASS" if s["token"] not in cfd else "FAIL","cloudflared log never contains the session token",""],
 ["PASS" if s["token"] not in be and s["mt"] not in be else "FAIL","backend never logs tokens",""]]
bad=0
for st,n,x in checks:
    ok=st.endswith("PASS"); bad+= not ok
    print(f"{'PASS' if ok else 'FAIL'}  {st.split()[0] if ' ' in st else ''} {n}" + (f"  [{x}]" if x not in ('',None) else ''))
print(f"\n{len(checks)-bad}/{len(checks)} passed (through Cloudflare)"); sys.exit(bad)
PY
