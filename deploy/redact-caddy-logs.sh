#!/usr/bin/env bash
# redact-caddy-logs.sh <out-dir> <log-file>...   (READ-ONLY on the inputs)
# Writes redacted copies of Caddy JSON access logs (plain or .gz) into <out-dir>: the values of
# `token=` / `mt=` query parameters and Set-Auth-Token response headers become REDACTED; every other
# field (timestamps, paths, status, IPs, timings) is kept byte-for-byte. Verifies the line count and
# that no token pattern remains, and writes SHA-256 manifests of originals and copies.
# Swapping the copies in place of the originals is a separate, approved step (runbook).
set -euo pipefail
OUT=${1:?usage: redact-caddy-logs.sh <out-dir> <log>...}; shift
install -d -m 700 "$OUT"
for f in "$@"; do
  b=$(basename "$f")
  python3 -I - "$f" "$OUT/$b" <<'PY'
import gzip,json,re,sys
src,dst=sys.argv[1:3]
op=(lambda p,m: gzip.open(p,m)) if src.endswith(".gz") else (lambda p,m: open(p,m))
Q=re.compile(r"([?&](?:token|mt)=)[^&\s\"]*")
n_in=n_out=red=0
with op(src,"rt") as fi, op(dst,"wt") as fo:
    for line in fi:
        n_in+=1
        out=line
        if line.startswith("{"):
            try:
                d=json.loads(line); r=d.get("request",{}); changed=False
                if "uri" in r and Q.search(r["uri"]): r["uri"]=Q.sub(r"\1REDACTED",r["uri"]); changed=True
                for k in list((d.get("resp_headers") or {})):
                    if k.lower()=="set-auth-token": d["resp_headers"][k]=["REDACTED"]; changed=True
                if changed: out=json.dumps(d,separators=(",",":"))+"\n"; red+=1
            except ValueError:
                if Q.search(line): out=Q.sub(r"\1REDACTED",line); red+=1
        fo.write(out); n_out+=1
with op(dst,"rt") as fc:
    left=sum(1 for l in fc if re.search(r"[?&](?:token|mt)=(?!REDACTED)[^&\s\"]",l) or re.search(r'"Set-Auth-Token":\["(?!REDACTED)',l))
assert n_in==n_out, "line count changed"
assert left==0, f"{left} lines still contain a token"
print(f"{src.split('/')[-1]}: {n_in} lines, {red} redacted, 0 token patterns remain")
PY
  chmod 600 "$OUT/$b"
done
( cd "$(dirname "$1")" && sha256sum "$@" ) > "$OUT/SHA256SUMS.originals" 2>/dev/null || sha256sum "$@" > "$OUT/SHA256SUMS.originals"
( cd "$OUT" && sha256sum -- * | grep -v SHA256SUMS ) > "$OUT/SHA256SUMS.redacted"
chmod 600 "$OUT"/SHA256SUMS.*
echo "redacted copies + manifests in $OUT (originals untouched)"
