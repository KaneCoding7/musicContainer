#!/usr/bin/env bash
# run-tests.sh - end-to-end tests for deploy/deploy.sh on DISPOSABLE scratch stacks.
# Must run as root. Touches ONLY: $R (scratch data/stacks/state), docker projects musictest-*,
# containers mtd-*/mtp-*, a disposable alertmanager on 127.0.0.1:19093 and a listener on :19095.
set -uo pipefail
R=/mnt/media/.restic/restoretest/phase3
HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY=${DEPLOY:-$HERE/../repo/deploy/deploy.sh}
MON=$(cd "$(dirname "$DEPLOY")" && pwd)/monitoring
CONF=$R/conf; STATE=$R/state
A_B=music-backend@sha256:387282bc5658832d7594b965f17080d8aacb00088a4303572019ba44b7d4bbea      # DEV Sep-19 build
A_F=music-frontend@sha256:8383dd084cb87b89200b0a05136f90adbcec9d2d7708653a7997e238858a9965
B_B=mrkane7/music-backend@sha256:dd9fbb1da1d327272b5dfaa019c6bbabc849372fcdc3ae929634424ee8f20394   # = PROD (main c35355a)
B_F=mrkane7/music-frontend@sha256:5bccf1bf04d8749519095127e0178e75274920950c815f4ce366aecaee72a14b
BRK=musictest/backend-broken@$(docker image inspect -f "{{.Id}}" musictest/backend-broken:t1)   # built from images/broken
GATE=musictest/backend-gate@$(docker image inspect -f "{{.Id}}" musictest/backend-gate:t1)   # only for promotion-gate fixtures
REL=musictest/backend-relabel@$(docker image inspect -f "{{.Id}}" musictest/backend-relabel:t1)   # built from images/relabel
NOPE=mrkane7/music-backend@sha256:0000000000000000000000000000000000000000000000000000000000000000
PASS=0; FAIL=0; RESULTS=()
ok()   { PASS=$((PASS+1)); RESULTS+=("PASS  $*"); echo "  PASS  $*"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $*"); echo "  FAIL  $*"; }
check(){ local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
chk(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }   # compound conditions (single-quoted)
livefp(){ for c in music-backend music-frontend music-backend-prod music-frontend-prod cloudflared-marcus; do docker inspect -f "{{.Id}} {{.Image}} {{.State.StartedAt}} {{.RestartCount}}" $c; done; sha256sum /mnt/media/stacks/music/.env /mnt/media/stacks/marcus-music/.env /mnt/media/stacks/marcus-music/compose.yaml /mnt/media/stacks/music/compose.yaml; }
LIVE0=$(livefp)
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -d $R/master-dev ] || { echo "no master copy at $R/master-dev"; exit 1; }

# ---------------------------------------------------------------- scratch stacks
mkstack() { # mkstack <name> <prefix> <backend> <frontend>
  local n=$1 p=$2 S=$R/stacks/$1 D=$R/data/$1
  install -d -m 700 $S $D
  cp -a $R/master-dev/app.db $D/app.db
  for d in music art clips; do cp -al $R/master-dev/$d $D/$d; done
  cat > $S/compose.yaml <<EOF
# DISPOSABLE TEST STACK ($n) - internal network, no ports, throwaway secret
services:
  backend:
    image: \${MT_BACKEND_IMAGE:?}
    container_name: $p-backend
    pull_policy: missing
    restart: "no"
    networks: [t]
    environment: [PORT=3001, DATA_DIR=/data, "BETTER_AUTH_SECRET=\${MT_SECRET:?}", BETTER_AUTH_URL=http://localhost:3001, FRONTEND_ORIGIN=http://localhost:3000, INVITE_ONLY=true, YTDLP_AUTO_UPDATE=false]
    volumes: ["$D:/data"]
    healthcheck: {test: ["CMD","curl","-fsS","-o","/dev/null","http://127.0.0.1:3001/api/health"], interval: 5s, timeout: 5s, retries: 3, start_period: 20s}
  frontend:
    image: \${MT_FRONTEND_IMAGE:?}
    container_name: $p-frontend
    pull_policy: missing
    restart: "no"
    networks: [t]
    environment: [PORT=3000, PUBLIC_API_BASE_URL=http://localhost:3001]
    healthcheck: {test: ["CMD","node","-e","fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: 5s, timeout: 5s, retries: 3, start_period: 10s}
networks:
  t: {internal: true}
EOF
  printf 'MT_SECRET=%s\nMT_BACKEND_IMAGE=%s\nMT_FRONTEND_IMAGE=%s' "$(openssl rand -hex 32)" "$3" "$4" > $S/.env   # no trailing newline, like live PROD
  chmod 600 $S/.env
  (cd $S && docker compose -p musictest-$n up -d --pull never >/dev/null 2>&1)
}
mkconf() { # mkconf <env> <stack> <prefix> [extra lines]
  install -d -m 700 $CONF
  umask 022; cat > $CONF/$1.conf <<EOF
STACK_DIR=$R/stacks/$2
COMPOSE_PROJECT=musictest-$2
DATA_DIR=$R/data/$2
BACKEND_SERVICE=backend
FRONTEND_SERVICE=frontend
BACKEND_CONTAINER=$3-backend
FRONTEND_CONTAINER=$3-frontend
BACKEND_VAR=MT_BACKEND_IMAGE
FRONTEND_VAR=MT_FRONTEND_IMAGE
BACKUP_DIR=$R/backups/$1
STATE_DIR=$STATE
HEALTH_TIMEOUT=75
QUIET_SECONDS=3
QUIET_WAIT=15
ALERT_URL=http://127.0.0.1:19093
${4:-}
EOF
}
dep() { # dep <env> args... ; sets RC, OUT
  OUT=$(DEPLOY_CONF_DIR=$CONF bash "$DEPLOY" "$@" 2>&1 </dev/null); RC=$?
  echo "$OUT" | tail -2 | sed 's/^/        | /'
}
running() { docker inspect -f '{{.Image}}' "$1" 2>/dev/null; }
envref() { grep -E "^MT_BACKEND_IMAGE=" $R/stacks/$1/.env | cut -d= -f2-; }
health() { docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null; }
waith() { local i; for i in $(seq 1 30); do [ "$(health $1)" = healthy ] && return 0; sleep 3; done; return 1; }
schema() { python3 -I -c 'import sqlite3,hashlib,sys;c=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro",uri=True);print(hashlib.sha256("\n".join(r[0] or "" for r in c.execute("select sql from sqlite_master order by type,name")).encode()).hexdigest()[:16])' $R/data/$1/app.db; }
lastres() { python3 -I -c 'import json,sys;H=[json.loads(l) for l in open(sys.argv[1]) if l.strip()];print(H[-1]["result"] if H else "")' $STATE/$1.jsonl 2>/dev/null; }
nbackups() { ls $R/backups/$1 2>/dev/null | grep -c '\.db$'; }
fp() { echo "$(docker inspect -f '{{.Id}}' $1-backend $1-frontend | tr '\n' ' ')$(sha256sum < $R/stacks/$2/.env)"; }   # containers+env fingerprint

# ---------------------------------------------------------------- disposable alertmanager + listener
python3 -I -c '
import http.server,sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(s):
        b=s.rfile.read(int(s.headers["Content-Length"])); open(sys.argv[1],"ab").write(b+b"\n"); s.send_response(200); s.end_headers()
    def log_message(s,*a): pass
http.server.HTTPServer(("127.0.0.1",19095),H).serve_forever()' $R/alerts-received.jsonl &
LISTENER=$!
install -d -m 755 $R/am; cat > $R/am/am.yml <<'EOF'
route: {receiver: hook, group_by: [alertname, env], group_wait: 1s, group_interval: 1s, repeat_interval: 1h}
receivers: [{name: hook, webhook_configs: [{url: "http://127.0.0.1:19095/", send_resolved: false}]}]
EOF
docker run -d --rm --pull never --name musictest-alertmanager --network host -v $R/am/am.yml:/etc/am.yml:ro prom/alertmanager:latest \
  --config.file=/etc/am.yml --web.listen-address=127.0.0.1:19093 --cluster.listen-address= --storage.path=/tmp >/dev/null
cleanup() { kill $LISTENER 2>/dev/null; docker rm -f musictest-alertmanager >/dev/null 2>&1; }
trap cleanup EXIT

# ================================================================= TESTS
echo "== setup: mtdev at A (Sep-19 DEV build, DEV data copy); mtprod at A (PROMOTE_FROM=mtdev)"
mkstack mtdev mtd "$A_B" "$A_F"; mkconf mtdev mtdev mtd
mkstack mtprod mtp "$A_B" "$A_F"; mkconf mtprod mtprod mtp "PROMOTE_FROM=mtdev
SOAK_HOURS=24
CONFIRM=yes"
mkconf mtdevrepo mtdev mtd "BACKEND_REPO=mrkane7/music-backend
FRONTEND_REPO=mrkane7/music-frontend"
mkconf mtdevbadurl mtdev mtd "HEALTH_URLS=http://127.0.0.1:1/"
check "setup: mtdev healthy on A"  waith mtd-backend
check "setup: mtprod healthy on A" waith mtp-backend
S_A=$(schema mtdev)

echo "== T1 refusals before any change"
F0=$(fp mtd mtdev)
dep mtdev mrkane7/music-backend:latest "$B_F";         check "T1a :latest tag refused (exit 1)"       [ $RC = 1 ]
dep mtdev "$B_B" mrkane7/music-frontend:dev;           check "T1b mutable :dev tag refused"           [ $RC = 1 ]
dep mtdevrepo --build latest;                           chk "T1c --build latest refused, reason shown" '[ $RC = 1 ] && echo "$OUT" | grep -q "not an immutable build"'
dep mtdev "$NOPE" "$B_F";                               check "T1d nonexistent digest refused"        [ $RC = 1 ]
echo "$OUT" | grep -q 'image not found' && ok "T1d   reason: image not found" || bad "T1d   reason"
dep mtdevrepo "$BRK" "$B_F";                            check "T1e wrong repository refused"           [ $RC = 1 ]
check "T1  containers + .env untouched by refusals" [ "$(fp mtd mtdev)" = "$F0" ]
check "T1  no backups taken by refusals" [ "$(nbackups mtdev)" = 0 ]

echo "== T2 failed DB backup (backup disk full: 64 KiB tmpfs on a scratch path)"
install -d -m 700 $R/backups-full; mount -t tmpfs -o size=64k,mode=700 musictest-full $R/backups-full
mkconf mtdevfull mtdev mtd "DISK_MIN_GB=0
BACKUP_DIR=$R/backups-full"
dep mtdevfull "$B_B" "$B_F" --yes;                      check "T2  backup failure aborts (exit 1)"     [ $RC = 1 ]
echo "$OUT" | grep -q 'backup failed' && ok "T2   reason: backup failed (disk full)" || bad "T2   reason"
check "T2  no partial backup left behind" [ -z "$(ls -A $R/backups-full)" ]
umount $R/backups-full; rmdir $R/backups-full
check "T2  nothing changed (containers/.env)" [ "$(fp mtd mtdev)" = "$F0" ]
check "T2  schema untouched" [ "$(schema mtdev)" = "$S_A" ]

echo "== T3 active import in backend"
docker exec mtd-backend sh -c 'cp /bin/sleep /tmp/yt-dlp' ; docker exec -d mtd-backend /tmp/yt-dlp 300; sleep 1
check "T3  (fixture) fake yt-dlp visible" sh -c 'docker top mtd-backend -o pid,args | grep -q yt-dlp'
sleep 1; dep mtdev "$B_B" "$B_F" --yes;                 check "T3  refused while yt-dlp runs"          [ $RC = 1 ]
echo "$OUT" | grep -q 'import/processing job' && ok "T3   reason: import running" || bad "T3   reason"
docker exec mtd-backend sh -c 'for p in /proc/[0-9]*; do grep -qa /tmp/yt-dlp $p/cmdline 2>/dev/null && kill ${p#/proc/} 2>/dev/null; done; true'

echo "== T4 database being written (someone using the app)"
( for i in $(seq 1 25); do touch $R/data/mtdev/app.db; sleep 1; done ) & W=$!
dep mtdev "$B_B" "$B_F" --yes;                          check "T4  refused while DB is written"        [ $RC = 1 ]
echo "$OUT" | grep -q 'still being written' && ok "T4   reason: active writes" || bad "T4   reason"
wait $W; check "T4  nothing changed" [ "$(fp mtd mtdev)" = "$F0" ]
sleep 4

echo "== T5 successful deploy A -> B (the real DEV upgrade path: Sep-19 -> main, with migration)"
dep mtdev "$B_B" "$B_F" --yes;                          check "T5  deploy succeeded (exit 0)"         [ $RC = 0 ]
check "T5  running backend == B"                         [ "$(running mtd-backend)" = "${B_B##*@}" ]
check "T5  .env == B digest"                             [ "$(envref mtdev)" = "$B_B" ]
check "T5  history: success"                             [ "$(lastres mtdev)" = success ]
check "T5  one pre-deploy backup"                        [ "$(nbackups mtdev)" = 1 ]
S_B=$(schema mtdev); check "T5  schema migrated (A != B)" [ "$S_B" != "$S_A" ]
BK=$(ls $R/backups/mtdev/*.db | head -1)
check "T5  backup integrity ok + holds the OLD schema" python3 -I -c 'import sqlite3,hashlib,sys;c=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro",uri=True);assert c.execute("pragma integrity_check").fetchone()[0]=="ok";h=hashlib.sha256("\n".join(r[0] or "" for r in c.execute("select sql from sqlite_master order by type,name")).encode()).hexdigest()[:16];sys.exit(0 if h==sys.argv[2] else 1)' "$BK" "$S_A"
check "T5  .env still has no surprises (3 lines)" [ "$(grep -c . $R/stacks/mtdev/.env)" = 3 ]

echo "== T6 rollback after a migration is refused (no DB restore, ever)"
F1=$(fp mtd mtdev)
dep mtdev --rollback;                                   check "T6  rollback refused (exit 3)"         [ $RC = 3 ]
chk "T6  nothing changed; DB not restored" '[ "$(fp mtd mtdev)" = "$F1" ] && [ "$(schema mtdev)" = "$S_B" ]'

echo "== T7 downgrade across a migration is refused"
dep mtdev "$A_B" "$A_F" --yes;                          check "T7  deploying A over migrated DB refused" [ $RC = 1 ]
echo "$OUT" | grep -q 'downgrade across a migration' && ok "T7   reason: downgrade guard" || bad "T7   reason"

echo "== T8 deploy same-schema build (REL) then roll back to B"
dep mtdev "$REL" "$B_F" --yes;                          chk "T8a deploy REL ok" '[ $RC = 0 ] && [ "$(running mtd-backend)" = "${REL##*@}" ]'
dep mtdev --rollback;                                   chk "T8b rollback to B ok (exit 0)" '[ $RC = 0 ] && [ "$(running mtd-backend)" = "${B_B##*@}" ]'
dep mtdev --rollback;                                   chk "T21 rollback of a rollback refused (no flip-flop)" '[ $RC = 1 ] && echo "$OUT" | grep -q "already a rollback"'
check "T8  schema unchanged throughout"                  [ "$(schema mtdev)" = "$S_B" ]

echo "== T9 failed health check -> automatic code rollback"
: > $R/alerts-received.jsonl
dep mtdev "$BRK" "$B_F" --yes;                          check "T9  failed deploy rolled back (exit 2)" [ $RC = 2 ]
chk "T9  running B again + healthy" '[ "$(running mtd-backend)" = "${B_B##*@}" ] && waith mtd-backend'
check "T9  .env back on B"                               [ "$(envref mtdev)" = "$B_B" ]
check "T9  history: rolled_back"                         [ "$(lastres mtdev)" = rolled_back ]
for i in $(seq 1 15); do grep -q "\"env\":\"mtdev\"" $R/alerts-received.jsonl 2>/dev/null && break; sleep 1; done
check "T9  alert reached Alertmanager -> webhook (env=mtdev)" grep -q "\"env\":\"mtdev\"" $R/alerts-received.jsonl

echo "== T10 failed endpoint check (containers healthy, URL fails) -> rollback"
dep mtdevbadurl "$REL" "$B_F" --yes;                    chk "T10 endpoint failing for both versions: rollback applied, flagged (exit 4)" '[ $RC = 4 ] && [ "$(running mtd-backend)" = "${B_B##*@}" ] && echo "$OUT" | grep -q "ROLLBACK APPLIED"'

echo "== T11 interrupted BEFORE recreate (+ concurrent deploy lock)"
F2=$(fp mtd mtdev)
DEPLOY_TEST_HOOK=after_env DEPLOY_TEST_SLEEP=60 DEPLOY_CONF_DIR=$CONF bash "$DEPLOY" mtdev "$REL" "$B_F" --yes >$R/t11.log 2>&1 </dev/null & P=$!
for i in $(seq 1 40); do grep -q 'TEST HOOK after_env' $R/t11.log && break; sleep 1; done
dep mtdev "$REL" "$B_F" --yes;                          chk "T11 concurrent deploy refused by lock" '[ $RC = 1 ] && echo "$OUT" | grep -q '"'"'another deploy'"'"''
kill -TERM $P; wait $P; RC=$?
check "T11 interrupted run exits 5"                     [ $RC = 5 ]
check "T11 .env restored, containers untouched"         [ "$(fp mtd mtdev)" = "$F2" ]
check "T11 history: aborted (nothing changed)"          [ "$(lastres mtdev)" = aborted ]

echo "== T11b SIGHUP (ssh drop) before recreate is handled like an interrupt"
F2b=$(fp mtd mtdev)
DEPLOY_TEST_HOOK=after_env DEPLOY_TEST_SLEEP=60 DEPLOY_CONF_DIR=$CONF bash "$DEPLOY" mtdev "$REL" "$B_F" --yes >$R/t11b.log 2>&1 </dev/null & P=$!
for i in $(seq 1 40); do grep -q 'TEST HOOK after_env' $R/t11b.log && break; sleep 1; done
kill -HUP $P; wait $P; RC=$?
chk "T11b HUP -> exit 5, .env restored, containers untouched" '[ $RC = 5 ] && [ "$(fp mtd mtdev)" = "$F2b" ] && [ "$(lastres mtdev)" = aborted ]'
echo "== T11c real Ctrl-C (SIGINT to the whole process group, incl. tee) before recreate"
F2c=$(fp mtd mtdev)
RC=$(python3 -I - "$DEPLOY" "$CONF" "$REL" "$B_F" "$R/t11c.log" <<'EOF'
import subprocess,os,signal,sys,time
dep,conf,b,f,logf=sys.argv[1:6]
env=dict(os.environ,DEPLOY_CONF_DIR=conf,DEPLOY_TEST_HOOK="after_env",DEPLOY_TEST_SLEEP="60")
with open(logf,"w") as lf:
    p=subprocess.Popen(["bash",dep,"mtdev",b,f,"--yes"],stdin=subprocess.DEVNULL,stdout=lf,stderr=lf,env=env,start_new_session=True)
for _ in range(60):
    if "TEST HOOK after_env" in open(logf).read(): break
    time.sleep(1)
os.killpg(p.pid,signal.SIGINT); print(p.wait())
EOF
)
chk "T11c Ctrl-C -> exit 5, .env restored, containers untouched, recorded" '[ "$RC" = 5 ] && [ "$(fp mtd mtdev)" = "$F2c" ] && [ "$(lastres mtdev)" = aborted ] && grep -q "INTERRUPTED" $R/t11c.log'
echo "== T12 interrupted AFTER recreate, then --rollback"
DEPLOY_TEST_HOOK=after_up DEPLOY_TEST_SLEEP=60 DEPLOY_CONF_DIR=$CONF bash "$DEPLOY" mtdev "$REL" "$B_F" --yes >$R/t12.log 2>&1 </dev/null & P=$!
for i in $(seq 1 90); do grep -q 'TEST HOOK after_up' $R/t12.log && break; sleep 1; done
kill -TERM $P; wait $P; RC=$?
check "T12 interrupted run exits 5"                     [ $RC = 5 ]
chk "T12 left on new version (REL), recorded" '[ "$(running mtd-backend)" = "${REL##*@}" ] && [ "$(lastres mtdev)" = interrupted ]'
dep mtdev --rollback;                                   chk "T12 --rollback returns to B" '[ $RC = 0 ] && [ "$(running mtd-backend)" = "${B_B##*@}" ]'

echo "== T13 promotion gate (mtprod only accepts builds soaked on mtdev)"
F3=$(fp mtp mtprod)
dep mtprod "$BRK" "$B_F" --yes;                         chk "T13a never-tested build refused" '[ $RC = 1 ] && echo "$OUT" | grep -q '"'"'never deployed successfully'"'"''
dep mtprod mrkane7/music-backend:latest "$B_F" --yes;   check "T13b :latest refused on prod"          [ $RC = 1 ]
dep mtprod --promote --yes;                              chk "T13c promote before soak refused" '[ $RC = 1 ] && echo "$OUT" | grep -q '"'"'need 24h'"'"''
python3 -I - $STATE/mtdev.jsonl <<'EOF'
import json,sys,datetime   # TEST ONLY: age mtdev's records by 48h to simulate the soak period
p=sys.argv[1]; H=[json.loads(l) for l in open(p) if l.strip()]
for h in H:
    t=datetime.datetime.strptime(h["ts"],"%Y%m%dT%H%M%SZ")-datetime.timedelta(hours=48); h["ts"]=t.strftime("%Y%m%dT%H%M%SZ")
open(p,"w").write("".join(json.dumps(h,sort_keys=True)+"\n" for h in H))
EOF
dep mtprod --promote;                                    chk "T13d prod without --yes and no TTY refused (confirmation)" '[ $RC = 1 ] && echo "$OUT" | grep -q "confirmation required"'
check "T13  mtprod untouched by refusals"                [ "$(fp mtp mtprod)" = "$F3" ]
python3 -I - $STATE/mtdev.jsonl "$B_B" "$A_F" <<'EOF'
import json,sys   # TEST ONLY: an old BASELINE-only record (B backend + A frontend) must not be promotable
p,b,f=sys.argv[1:4]; open(p,"a").write(json.dumps({"ts":"20200101T000000Z","env":"mtdev","mode":"baseline","result":"success","from":{"backend":b,"frontend":f},"to":{"backend":b,"frontend":f},"schema_before":"x","schema_after":"x","backup":""},sort_keys=True)+"\n")
EOF
dep mtprod "$B_B" "$A_F" --yes;                         chk "T13f baseline-only record is not promotable (refused as untested, not on schema)" '[ $RC = 1 ] && echo "$OUT" | grep -q "baselines don" && ! echo "$OUT" | grep -q "not one the build ran against"'
sed -i "s#^MT_BACKEND_IMAGE=.*#MT_BACKEND_IMAGE=$REL#" $R/stacks/mtdev/.env
dep mtprod --promote --yes;                              chk "T22 promote refused when DEV .env != what DEV runs" '[ $RC = 1 ] && echo "$OUT" | grep -q "not running what its .env says"'
sed -i "s#^MT_BACKEND_IMAGE=.*#MT_BACKEND_IMAGE=$B_B#" $R/stacks/mtdev/.env
dep mtprod --promote --yes;                              chk "T13e promote after soak succeeds (A->B on prod copy)" '[ $RC = 0 ] && [ "$(running mtp-backend)" = "${B_B##*@}" ]'

echo "== T13g promote refused when target DB schema was never seen with that build"
python3 -I - $STATE/mtdev.jsonl "$GATE" "$A_F" <<'EOF'
import json,sys   # TEST ONLY: the ONLY mtdev success for pair (GATE, A_F) ran on unrelated schemas
import datetime; ts=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=30)).strftime("%Y%m%dT%H%M%SZ")
p,b,f=sys.argv[1:4]; open(p,"a").write(json.dumps({"ts":ts,"env":"mtdev","mode":"deploy","result":"success","from":{"backend":b,"frontend":f},"to":{"backend":b,"frontend":f},"schema_before":"aaaa","schema_after":"bbbb","backup":""},sort_keys=True)+"\n")
EOF
dep mtprod "$GATE" "$A_F" --yes;                        chk "T13g schema-mismatch promotion refused" '[ $RC = 1 ] && echo "$OUT" | grep -q "not one the build ran against"'
echo "== T13h soak counts only how long DEV KEPT running the build"
python3 -I - $STATE/mtdev.jsonl "$BRK" "$A_F" "$(schema mtprod)" <<'EOF'
import json,sys,datetime   # TEST ONLY: (BRK,A_F) deployed on mtdev 48h ago, rolled away 47h ago -> ran 1h
p,b,f,sc=sys.argv[1:5]; now=datetime.datetime.now(datetime.timezone.utc); T=lambda h:(now-datetime.timedelta(hours=h)).strftime("%Y%m%dT%H%M%SZ")
rec=lambda **k: json.dumps(k,sort_keys=True)+"\n"
open(p,"a").write(rec(ts=T(48),env="mtdev",mode="deploy",result="success",**{"from":{"backend":"x@sha256:"+"0"*64,"frontend":f},"to":{"backend":b,"frontend":f}},schema_before=sc,schema_after=sc,backup="")
                 +rec(ts=T(47),env="mtdev",mode="rollback",result="success",**{"from":{"backend":b,"frontend":f},"to":{"backend":"x@sha256:"+"0"*64,"frontend":f}},schema_before=sc,schema_after=sc,backup=""))
EOF
dep mtprod "$BRK" "$A_F" --yes;                         chk "T13h build DEV left after 1h is refused despite 48h age" '[ $RC = 1 ] && echo "$OUT" | grep -q "for only 1h continuously"'
echo "== T14 alert path survives an unreachable Alertmanager"
sed -i 's#^ALERT_URL=.*#ALERT_URL=http://127.0.0.1:1#' $CONF/mtdev.conf
dep mtdev "$BRK" "$B_F" --yes;                          chk "T14 still rolls back with dead alert URL (exit 2)" '[ $RC = 2 ] && echo "$OUT" | grep -q '"'"'could not post alert'"'"''

echo "== T16 baseline: records running state once, changes nothing"
F5=$(fp mtp mtprod); mkconf mtbase mtprod mtp
dep mtbase --baseline;                                  chk "T16a baseline recorded (exit 0)" '[ $RC = 0 ] && [ "$(lastres mtbase)" = success ]'
chk "T16b baseline = running digest" 'grep -q "${B_B##*@}" $STATE/mtbase.jsonl'
dep mtbase --baseline;                                  check "T16c second baseline refused" [ $RC = 1 ]
check "T16d nothing changed" [ "$(fp mtp mtprod)" = "$F5" ]
check "T13g/T16 mtprod still on B after the refused promotion" [ "$(running mtp-backend)" = "${B_B##*@}" ]
echo "== T17 config hardening: group-writable config refused"
mkconf mtperm mtprod mtp; chmod 664 $CONF/mtperm.conf
dep mtperm --status;                                    chk "T17 writable config refused" '[ $RC = 1 ] && echo "$OUT" | grep -q "must be owned by root"'
echo "== T18 DB closed cleanly (no -wal file): check must not exit silently"
docker stop -t 20 mtd-backend >/dev/null; ls $R/data/mtdev/app.db-wal >/dev/null 2>&1 && echo "        (wal still present)"
dep mtdev --check;                                      chk "T18 --check with no WAL reports a result (exit 0, CHECK PASSED)" '[ $RC = 0 ] && echo "$OUT" | grep -q "CHECK PASSED"'
docker start mtd-backend >/dev/null; waith mtd-backend
echo "== T19 DATA_DIR must be the directory the backend mounts at /data"
mkconf mtdevmount mtdev mtd "DATA_DIR=$R/master-dev"
dep mtdevmount "$REL" "$B_F" --yes;                     chk "T19 mismatched DATA_DIR refused (wrong DB would be backed up)" '[ $RC = 1 ] && echo "$OUT" | grep -q "is not what backend mounts"'
echo "== T20 failure before any restart aborts cleanly (no rollback, no restart)"
F6=$(fp mtd mtdev); chattr +i $R/stacks/mtdev
dep mtdev "$REL" "$B_F" --yes;                          chk "T20 aborted before restart (exit 1)" '[ $RC = 1 ] && echo "$OUT" | grep -q "aborted before any restart"'
chattr -i $R/stacks/mtdev
chk "T20 containers + .env untouched, history: aborted" '[ "$(fp mtd mtdev)" = "$F6" ] && [ "$(lastres mtdev)" = aborted ]'
echo "== T23 REQUIRE_REGISTRY=yes refuses local-only images"
mkconf mtregistry mtdev mtd "REQUIRE_REGISTRY=yes"
dep mtregistry "$REL" "$B_F" --yes;                     chk "T23 local-only image refused when registry required" '[ $RC = 1 ] && echo "$OUT" | grep -q "not in the registry"'
echo "== T25 SIGKILL mid-deploy (no trap possible) -> later deploys refuse, --rollback recovers"
sed -i 's#^ALERT_URL=.*#ALERT_URL=http://127.0.0.1:19093#' $CONF/mtdev.conf
DEPLOY_TEST_HOOK=after_up DEPLOY_TEST_SLEEP=60 DEPLOY_CONF_DIR=$CONF bash "$DEPLOY" mtdev "$REL" "$B_F" --yes >$R/t25.log 2>&1 </dev/null & P=$!
for i in $(seq 1 90); do grep -q 'TEST HOOK after_up' $R/t25.log && break; sleep 1; done
kill -KILL $P; wait $P 2>/dev/null; sleep 1   # the orphaned hook sleep holds no lock (fd 9 closed) and exits by itself
chk "T25 left on REL with an unfinished record" '[ "$(running mtd-backend)" = "${REL##*@}" ] && [ "$(lastres mtdev)" = started ]'
dep mtdev "$B_B" "$B_F" --yes;                          chk "T25 normal deploy refused while a run is unfinished" '[ $RC = 1 ] && echo "$OUT" | grep -q "never finished"'
dep mtdev --rollback;                                   chk "T25 --rollback recovers to B" '[ $RC = 0 ] && [ "$(running mtd-backend)" = "${B_B##*@}" ]'
echo "== T15 live-data guard: config pointing at a non-app dir is refused"
mkconf mtdevwrong mtdev mtd; sed -i "s#^DATA_DIR=.*#DATA_DIR=$R/am#" $CONF/mtdevwrong.conf
dep mtdevwrong "$REL" "$B_F" --yes;                     chk "T15 wrong data dir refused" '[ $RC = 1 ] && echo "$OUT" | grep -q '"'"'does not look like'"'"''

echo "== T24 migration ran but health fails -> NEW code left running (never old code on a migrated DB)"
mkstack mtmig mtm "$A_B" "$A_F"; mkconf mtmig mtmig mtm "HEALTH_URLS=http://127.0.0.1:1/"; waith mtm-backend; S_M0=$(schema mtmig)
dep mtmig "$B_B" "$B_F" --yes;                          chk "T24 exit 3 (failed after migration)" '[ $RC = 3 ] && [ "$(lastres mtmig)" = failed_migrated ]'
chk "T24 schema migrated and NEW backend running again (B), not old A" '[ "$(schema mtmig)" != "$S_M0" ] && [ "$(running mtm-backend)" = "${B_B##*@}" ] && [ "$(docker inspect -f {{.State.Running}} mtm-backend)" = true ]'
echo "== T26 health watcher mutes only the env being deployed; alerts on a stuck deploy lock"
W="MUSIC_WATCH_CONTAINERS='mtd-backend musictest-gone-prod' MUSIC_WATCH_STATE=$R/watch MUSIC_DEPLOY_STATE=$R/watchlocks MUSIC_ALERT_BIN=$MON/music-alert MUSIC_ALERT_URL=http://127.0.0.1:19093"
rm -rf --one-file-system -- "$R/watch" "$R/watchlocks"; install -d -m 700 $R/watchlocks; touch $R/watchlocks/dev.lock $R/watchlocks/prod.lock
( flock 9; sleep 30 ) 9>$R/watchlocks/dev.lock & H1=$!; sleep 1
OUT=$(bash -c "$W bash $MON/music-health-watch" 2>&1)
chk "T26a dev lock mutes dev container only (prod container still checked)" 'echo "$OUT" | grep -q "mtd-backend: deploy of dev in progress" && echo "$OUT" | grep -qE "musictest-gone-prod is missing/none|container.: .musictest-gone-prod"'
kill $H1 2>/dev/null; wait $H1 2>/dev/null
touch -d "-45 minutes" $R/watchlocks/prod.lock; ( flock 9; sleep 30 ) 9>>$R/watchlocks/prod.lock & H2=$!; sleep 1; touch -d "-45 minutes" $R/watchlocks/prod.lock
: > $R/alerts-received.jsonl; OUT=$(bash -c "$W bash $MON/music-health-watch" 2>&1); sleep 4
chk "T26b stale prod lock -> MusicDeployStuck alert and prod container NOT muted" 'grep -q MusicDeployStuck $R/alerts-received.jsonl && echo "$OUT" | grep -q "musictest-gone-prod"'
kill $H2 2>/dev/null; wait $H2 2>/dev/null
echo "== T27 PROMOTE_FROM must be a plain env name"
mkconf mtbadsrc mtprod mtp "PROMOTE_FROM=../etc"
dep mtbadsrc --status;                                  chk "T27 path-like PROMOTE_FROM refused" '[ $RC = 1 ] && echo "$OUT" | grep -q "bad PROMOTE_FROM"'
check "SAFETY live DEV/PROD containers + stack files unchanged by the whole suite" [ "$(livefp)" = "$LIVE0" ]
echo; echo "================ $PASS passed, $FAIL failed"
printf '%s\n' "${RESULTS[@]}" > $R/test-results.txt
exit $FAIL
