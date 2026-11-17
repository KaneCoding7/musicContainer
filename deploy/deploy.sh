#!/usr/bin/env bash
# deploy.sh - deploy one immutable build of the music app to ONE environment (dev|prod).
#
#   deploy.sh <env> --build <build-tag>           resolve build-*/sha-* tag -> digests, deploy
#   deploy.sh <env> <backend-ref> <frontend-ref>  refs are repo@sha256:<digest>
#   deploy.sh prod  --promote                     deploy exactly what DEV runs (soak-gated)
#   deploy.sh <env> --rollback                    previous code version (refused across a migration)
#   deploy.sh <env> --status | --check            show state | run preflight only
#   deploy.sh <env> --baseline                    record what is running now as the starting state (no change)
#   flags: --dry-run  --yes  --no-public  --allow-active-writes
#
# Data rules (by design, not configurable):
#   * a SQLite-safe backup of the env's app.db is taken BEFORE anything changes; failure aborts.
#   * the script NEVER restores a database. If a migration ran, code rollback is refused and the
#     manual DB-recovery procedure is printed instead (runbook section 9.5).
#   * only digest references ever reach the stack's .env; :latest / mutable tags are refused.
#
# Exit codes: 0 ok | 1 refused/preflight failed (nothing changed) | 2 deploy failed, rolled back
#             3 deploy failed after a schema change (left as-is, human needed) | 4 rollback failed
#             5 interrupted
set -Eeuo pipefail
umask 077

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 2 ] || usage
ENV_NAME=$1; shift
case $ENV_NAME in *[!a-z0-9-]*|"") echo "bad env name"; exit 1;; esac

CONF_DIR=${DEPLOY_CONF_DIR:-/etc/music-deploy}
CONF="$CONF_DIR/$ENV_NAME.conf"
[ -r "$CONF" ] || { echo "no config $CONF"; exit 1; }
# The config is sourced as root: it must be root-owned and not writable by group/others.
[ "$(id -u)" = 0 ] || { echo "run with sudo (needs docker and the root-owned stack .env)"; exit 1; }
[ "$(stat -c %u "$CONF")" = 0 ] && [ -z "$(find "$CONF" -perm /022)" ] || { echo "refusing: $CONF must be owned by root and not group/world-writable"; exit 1; }
# shellcheck source=/dev/null
. "$CONF"
: "${STACK_DIR:?}" "${COMPOSE_PROJECT:?}" "${DATA_DIR:?}" "${BACKEND_SERVICE:?}" "${FRONTEND_SERVICE:?}"
: "${BACKEND_CONTAINER:?}" "${FRONTEND_CONTAINER:?}" "${BACKEND_VAR:?}" "${FRONTEND_VAR:?}"
: "${BACKUP_DIR:?}" "${STATE_DIR:?}"
BACKEND_REPO=${BACKEND_REPO:-}; FRONTEND_REPO=${FRONTEND_REPO:-}
HEALTH_URLS=${HEALTH_URLS:-}; PUBLIC_URLS=${PUBLIC_URLS:-}
PROMOTE_FROM=${PROMOTE_FROM:-}; SOAK_HOURS=${SOAK_HOURS:-24}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-240}; DISK_MIN_GB=${DISK_MIN_GB:-5}
QUIET_SECONDS=${QUIET_SECONDS:-15}; QUIET_WAIT=${QUIET_WAIT:-120}
ALERT_URL=${ALERT_URL:-}; CONFIRM=${CONFIRM:-no}
COUNT_TABLES=${COUNT_TABLES:-"user account songs playlists playlist_songs"}

MODE=deploy; BUILD=""; REF_B=""; REF_F=""; DRY=0; YES=0; NO_PUBLIC=0; ALLOW_WRITES=0
while [ $# -gt 0 ]; do
  case $1 in
    --build) BUILD=${2:?}; shift;;
    --promote) MODE=promote;; --rollback) MODE=rollback;; --status) MODE=status;; --check) MODE=check;; --baseline) MODE=baseline;;
    --dry-run) DRY=1;; --yes) YES=1;; --no-public) NO_PUBLIC=1;; --allow-active-writes) ALLOW_WRITES=1;;
    -*) echo "unknown flag $1"; exit 1;;
    *) if [ -z "$REF_B" ]; then REF_B=$1; elif [ -z "$REF_F" ]; then REF_F=$1; else usage; fi;;
  esac; shift
done

install -d -m 700 "$STATE_DIR" "$STATE_DIR/logs"
HIST="$STATE_DIR/$ENV_NAME.jsonl"; touch "$HIST"; chmod 600 "$HIST"
TS=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$STATE_DIR/logs/$TS-$ENV_NAME.log"
exec > >(tee -a "$LOG") 2>&1
log()  { echo "[$(date -u +%H:%M:%S)] [$ENV_NAME] $*"; }
die()  { log "REFUSED: $*"; exit 1; }
PY="python3 -I"
RUNNER="${SUDO_USER:-$(id -un)}"

# --------------------------------------------------------------------------- helpers
dc() { (exec 9>&-; cd "$STACK_DIR" && docker compose -p "$COMPOSE_PROJECT" --project-directory "$STACK_DIR" -f "$STACK_DIR/compose.yaml" "$@"); }
env_get() { grep -E "^$1=" "$STACK_DIR/.env" | tail -1 | cut -d= -f2-; }
running_digest() { docker inspect -f '{{.Image}}' "$1" 2>/dev/null || echo none; }

alert() { # alert <severity> <summary>; best effort, never fails the script
  logger -t music-deploy "[$ENV_NAME] $2" 2>/dev/null || true
  [ -n "$ALERT_URL" ] || return 0
  # one alert per deploy run (label deploy=<ts>): a second failure must page again, not be deduplicated
  local now ends; now=$(date -u +%Y-%m-%dT%H:%M:%SZ); ends=$(date -u -d '+6 hours' +%Y-%m-%dT%H:%M:%SZ)
  curl -fsS -m 10 -XPOST -H 'Content-Type: application/json' "$ALERT_URL/api/v2/alerts" -d "[{\"labels\":{\"alertname\":\"MusicDeployFailed\",\"env\":\"$ENV_NAME\",\"severity\":\"$1\",\"deploy\":\"$TS\"},\"annotations\":{\"summary\":\"music deploy ($ENV_NAME): $2\",\"description\":\"see $LOG\"},\"startsAt\":\"$now\",\"endsAt\":\"$ends\"}]" >/dev/null 2>&1 || log "warning: could not post alert"
}

hist_add() { # hist_add <json-object-string>
  $PY -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.dumps(d,sort_keys=True))' "$1" >> "$HIST"
}
hist_query() { # hist_query <python-expr over list H> ; prints result
  $PY - "$HIST" "$1" <<'EOF'
import json,sys
H=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
r=eval(sys.argv[2],{"H":H,"json":json})
print("" if r is None else (r if isinstance(r,str) else json.dumps(r)))
EOF
}

# SQLite helpers. All reads are mode=ro; the backup uses the online-backup API (consistent under writes).
db() { # db <action> [args]   actions: check | schema | counts | backup <dest>
  $PY - "$DATA_DIR/app.db" "$@" <<'EOF'
import sqlite3,sys,hashlib,json,os
src,act=sys.argv[1],sys.argv[2]
tables=os.environ.get("COUNT_TABLES","user account songs playlists playlist_songs").split()
def ro(p): return sqlite3.connect(f"file:{p}?mode=ro",uri=True,timeout=30)
def schema(c): return hashlib.sha256("\n".join(r[0] or "" for r in c.execute("select sql from sqlite_master order by type,name")).encode()).hexdigest()[:16]
def counts(c):
    have={r[0] for r in c.execute("select name from sqlite_master where type='table'")}
    return {t:c.execute(f'select count(*) from "{t}"').fetchone()[0] for t in tables if t in have}
if not os.path.isfile(src): print(f"ERROR no database at {src}"); sys.exit(1)
c=ro(src)
if act=="check":
    r=c.execute("pragma quick_check").fetchone()[0]; print(r); sys.exit(0 if r=="ok" else 1)
if act=="schema": print(schema(c)); sys.exit(0)
if act=="counts": print(json.dumps(counts(c),sort_keys=True)); sys.exit(0)
if act=="backup":
    dest=sys.argv[3]; tmp=dest+".partial"
    try:
        t=sqlite3.connect(tmp); c.backup(t); t.close()
        v=ro(tmp); r=v.execute("pragma integrity_check").fetchone()[0]
    except Exception as e:
        if os.path.exists(tmp): os.unlink(tmp)
        print(f"ERROR backup failed: {type(e).__name__}: {e}"); sys.exit(1)
    if r!="ok": os.unlink(tmp); print(f"ERROR backup integrity: {r}"); sys.exit(1)
    out={"path":dest,"bytes":os.path.getsize(tmp),"schema":schema(v),"counts":counts(v)}
    v.close(); os.chmod(tmp,0o600); os.replace(tmp,dest); print(json.dumps(out,sort_keys=True)); sys.exit(0)
sys.exit(2)
EOF
}
export COUNT_TABLES

env_set() { # env_set <backend-ref> <frontend-ref> : atomic, newline-safe, verifies other lines unchanged
  $PY - "$STACK_DIR/.env" "$BACKEND_VAR" "$1" "$FRONTEND_VAR" "$2" <<'EOF'
import os,sys,tempfile
p,kb,vb,kf,vf=sys.argv[1:6]
raw=open(p,"rb").read().decode()
lines=raw.split("\n")
if lines and lines[-1]=="": lines=lines[:-1]
want={kb:vb,kf:vf}; seen=set(); out=[]
for l in lines:
    k=l.split("=",1)[0]
    if k in want:
        if k in seen: continue
        out.append(f"{k}={want[k]}"); seen.add(k)
    else: out.append(l)
for k in (kb,kf):
    if k not in seen: out.append(f"{k}={want[k]}")
st=os.stat(p); d=os.path.dirname(p)
fd,tmp=tempfile.mkstemp(dir=d,prefix=".env.deploy.")
with os.fdopen(fd,"w") as f: f.write("\n".join(out)+"\n"); f.flush(); os.fsync(f.fileno())
os.chown(tmp,st.st_uid,st.st_gid); os.chmod(tmp,st.st_mode&0o7777)
old=[l for l in lines if l.split("=",1)[0] not in want]; new=[l for l in out if l.split("=",1)[0] not in want]
if old!=new: os.unlink(tmp); print("ERROR other .env lines would change"); sys.exit(1)
os.replace(tmp,p)
EOF
}

is_digest_ref() { [[ $1 =~ ^[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; }
check_ref() { # check_ref <ref> <expected-repo-or-empty>
  local r=$1 repo=$2
  is_digest_ref "$r" || die "'$r' is not an immutable digest reference (repo@sha256:<64 hex>); tags such as :latest are refused"
  [ -z "$repo" ] || [ "${r%@*}" = "$repo" ] || die "'$r' is not from the configured repository $repo"
  if docker image inspect "$r" >/dev/null 2>&1; then log "image present locally: ${r:0:40}…"; return 0; fi
  docker buildx imagetools inspect "$r" >/dev/null 2>&1 && { log "image exists in registry: ${r:0:40}…"; return 0; }
  die "image not found locally or in the registry: $r"
}
resolve_build() { # resolve_build <tag> <repo> -> repo@sha256
  [[ $1 =~ ^(build-[0-9]+-[0-9a-f]{7,40}|sha-[0-9a-f]{7,40})$ ]] || die "build tag '$1' is not an immutable build-*/sha-* tag"
  local d; d=$(docker buildx imagetools inspect "$2:$1" --format '{{json .Manifest}}' 2>/dev/null | $PY -c 'import json,sys;print(json.load(sys.stdin)["digest"])' 2>/dev/null) || true
  [[ $d =~ ^sha256:[0-9a-f]{64}$ ]] || die "could not resolve $2:$1 in the registry"
  echo "$2@$d"
}

active_ops() { # refuse during imports; wait for the DB to go quiet
  # fail CLOSED: if the process list cannot be read, refuse (an unreadable list is not "idle")
  local procs
  if [ "$(docker inspect -f '{{.State.Running}}' "$BACKEND_CONTAINER" 2>/dev/null)" != true ]; then
    log "warning: $BACKEND_CONTAINER is not running, so no import can be in progress"
  else
    procs=$(docker top "$BACKEND_CONTAINER" -o pid,args 2>&1) || die "cannot list processes in $BACKEND_CONTAINER ($procs); refusing"
    if echo "$procs" | grep -qE 'yt-dlp|spotdl|ffmpeg|aeneas|syncedlyrics'; then
      die "an import/processing job is running in $BACKEND_CONTAINER (yt-dlp/spotdl/ffmpeg/aeneas); try again later"
    fi
  fi
  local waited=0 age
  while :; do
    age=$(( $(date +%s) - $(stat -c %Y "$DATA_DIR/app.db" "$DATA_DIR/app.db-wal" 2>/dev/null | sort -n | tail -1) ))
    [ "$age" -ge "$QUIET_SECONDS" ] && { log "database quiet for ${age}s"; return 0; }
    [ "$ALLOW_WRITES" = 1 ] && { log "database written ${age}s ago; continuing (--allow-active-writes)"; return 0; }
    [ "$waited" -ge "$QUIET_WAIT" ] && die "database still being written (last ${age}s ago) after ${QUIET_WAIT}s; someone is using the app. Retry later or pass --allow-active-writes"
    sleep 5; waited=$((waited+5))
  done
}

preflight() {
  log "preflight"
  [ -f "$STACK_DIR/compose.yaml" ] && [ -f "$STACK_DIR/.env" ] || die "stack files missing in $STACK_DIR"
  [ -f "$DATA_DIR/app.db" ] && [ -d "$DATA_DIR/music" ] || die "data dir $DATA_DIR does not look like this app's data (app.db + music/)"
  grep -qE "^$BACKEND_VAR=" "$STACK_DIR/.env" && grep -qE "^$FRONTEND_VAR=" "$STACK_DIR/.env" || die "$BACKEND_VAR/$FRONTEND_VAR not in .env (stack not converted to pinned images)"
  is_digest_ref "$(env_get "$BACKEND_VAR")" && is_digest_ref "$(env_get "$FRONTEND_VAR")" || die ".env image refs are not digests"
  dc config -q >/dev/null || die "compose config does not resolve"
  local free
  [ -d "$BACKUP_DIR" ] || install -d -m 700 "$BACKUP_DIR" 2>/dev/null || die "cannot create backup dir $BACKUP_DIR"
  free=$(df -P -BG "$BACKUP_DIR" | awk 'NR==2{gsub("G","",$4);print $4}')
  [ "${free:-0}" -ge "$DISK_MIN_GB" ] || die "only ${free}G free at $BACKUP_DIR (need ${DISK_MIN_GB}G)"
  local last; last=$(hist_query '([h for h in H if h.get("env")=="'"$ENV_NAME"'"] or [{}])[-1].get("result","")')
  [ "$last" = started ] && die "the previous deployment never finished (interrupted?). Inspect with --status, then use --rollback or fix by hand"
  db check >/dev/null || die "live database fails quick_check BEFORE deploy; not touching it"
  log "live database quick_check ok"
}

wait_healthy() { # returns 0 if both containers healthy + URLs ok
  local t0 c h; t0=$(date +%s)
  for c in "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
    while :; do
      h=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo missing)
      case $h in running/healthy|running/none) break;; esac
      [ $(( $(date +%s) - t0 )) -ge "$HEALTH_TIMEOUT" ] && { log "health timeout: $c is $h"; return 1; }
      sleep 3
    done
  done
  local u; for u in $HEALTH_URLS $([ "$NO_PUBLIC" = 1 ] || echo "$PUBLIC_URLS"); do
    curl -fsS -o /dev/null -m 10 --retry 5 --retry-delay 3 --retry-all-errors "$u" || { log "health URL failed: $u"; return 1; }
  done
  log "healthy: containers + ${HEALTH_URLS:+local }${PUBLIC_URLS:+public }endpoints"
}

verify_data() { # verify_data <counts-before-json> <files-before>
  db check >/dev/null || { log "post-deploy quick_check FAILED"; return 1; }
  local after; after=$(db counts)
  $PY -c 'import json,sys;a,b=json.loads(sys.argv[1]),json.loads(sys.argv[2]);bad={k:(a[k],b.get(k)) for k in a if b.get(k,-1)<a[k]};print("counts ok" if not bad else "COUNTS DROPPED %s"%bad);sys.exit(1 if bad else 0)' "$1" "$after" || return 1
  local f; f=$(find "$DATA_DIR/music" -type f | wc -l)
  [ "$f" -ge "$2" ] || { log "music files dropped: $2 -> $f"; return 1; }
  log "data verified: quick_check ok, counts >= before, music files $2 -> $f"
}

apply_refs() { # apply_refs <b> <f> : set .env, pull if needed, recreate backend+frontend only
  # NOTE: set -e is suspended inside if-conditions, so every step returns explicitly.
  env_set "$1" "$2" || return 1
  PHASE=env_updated; test_hook after_env
  dc pull -q "$BACKEND_SERVICE" "$FRONTEND_SERVICE" || return 1
  PHASE=recreating
  dc up -d --pull never --no-deps "$BACKEND_SERVICE" "$FRONTEND_SERVICE" || return 1
  PHASE=verifying; test_hook after_up; return 0
}
test_hook() { # test-only pause point; background sleep + wait so signal traps fire immediately
  [ "${DEPLOY_TEST_HOOK:-}" = "$1" ] || return 0
  log "TEST HOOK $1: pausing ${DEPLOY_TEST_SLEEP:-30}s"; sleep "${DEPLOY_TEST_SLEEP:-30}" 9>&- & HOOK_PID=$!; wait $HOOK_PID || true; }

# --------------------------------------------------------------------------- modes
CUR_B=$(env_get "$BACKEND_VAR" || true); CUR_F=$(env_get "$FRONTEND_VAR" || true)

if [ "$MODE" = status ]; then
  echo "env $ENV_NAME  stack $STACK_DIR  data $DATA_DIR"
  echo ".env    backend  $CUR_B"; echo ".env    frontend $CUR_F"
  echo "running backend  $(running_digest "$BACKEND_CONTAINER")  frontend $(running_digest "$FRONTEND_CONTAINER")"
  echo "schema  $(db schema 2>/dev/null || echo ?)   counts $(db counts 2>/dev/null || echo ?)"
  echo "last 5 history entries:"; grep -E "\"env\": \"$ENV_NAME\"" "$HIST" | tail -5 || true
  exit 0
fi

flock_file="$STATE_DIR/$ENV_NAME.lock"; exec 9>"$flock_file"
flock -n 9 || die "another deploy for $ENV_NAME is running"

if [ "$MODE" = baseline ]; then
  # Record the currently RUNNING images + schema as a completed state. Changes nothing else; works
  # even before a stack is converted to pinned images (reads the containers, not .env).
  [ -s "$HIST" ] && grep -q "\"env\": \"$ENV_NAME\"" "$HIST" && die "history for $ENV_NAME already exists; baseline is only for the first record"
  [ -f "$DATA_DIR/app.db" ] || die "no database at $DATA_DIR/app.db"
  db check >/dev/null || die "live database fails quick_check"
  ref_of() { local id; id=$(docker inspect -f '{{.Image}}' "$1" 2>/dev/null) || return 1; docker image inspect -f '{{index .RepoDigests 0}}' "$id" 2>/dev/null; }
  RB=$(ref_of "$BACKEND_CONTAINER") && RF=$(ref_of "$FRONTEND_CONTAINER") || die "containers not found"
  is_digest_ref "${RB#docker.io/}" && is_digest_ref "${RF#docker.io/}" || die "running images have no digest reference ($RB / $RF)"
  RB=${RB#docker.io/}; RF=${RF#docker.io/}; SC=$(db schema)
  hist_add "$($PY -c 'import json,sys;print(json.dumps({"ts":sys.argv[1],"env":sys.argv[2],"mode":"baseline","by":sys.argv[3],"from":{"backend":sys.argv[4],"frontend":sys.argv[5]},"to":{"backend":sys.argv[4],"frontend":sys.argv[5]},"backup":"","schema_before":sys.argv[6],"schema_after":sys.argv[6],"result":"success","note":"baseline: recorded running state, nothing changed","finished":sys.argv[1]}))' "$TS" "$ENV_NAME" "$RUNNER" "$RB" "$RF" "$SC")"
  log "baseline recorded: backend $RB"; log "                   frontend $RF"; log "                   schema $SC (nothing changed)"; exit 0
fi

preflight
[ "$MODE" = check ] && { active_ops; log "CHECK PASSED (nothing changed)"; exit 0; }

SCHEMA_NOW=$(db schema)
case $MODE in
  deploy)
    if [ -n "$BUILD" ]; then
      [ -n "$BACKEND_REPO" ] && [ -n "$FRONTEND_REPO" ] || die "--build needs BACKEND_REPO/FRONTEND_REPO in config"
      REF_B=$(resolve_build "$BUILD" "$BACKEND_REPO"); REF_F=$(resolve_build "$BUILD" "$FRONTEND_REPO")
    fi
    [ -n "$REF_B" ] && [ -n "$REF_F" ] || usage;;
  promote)
    [ -n "$PROMOTE_FROM" ] || die "this env has no PROMOTE_FROM configured"
    REF_B=$(DEPLOY_CONF_DIR="$CONF_DIR" bash -c '. "$0"; grep -E "^$BACKEND_VAR=" "$STACK_DIR/.env" | cut -d= -f2-' "$CONF_DIR/$PROMOTE_FROM.conf")
    REF_F=$(DEPLOY_CONF_DIR="$CONF_DIR" bash -c '. "$0"; grep -E "^$FRONTEND_VAR=" "$STACK_DIR/.env" | cut -d= -f2-' "$CONF_DIR/$PROMOTE_FROM.conf")
    log "promoting what $PROMOTE_FROM runs: ${REF_B##*@} / ${REF_F##*@}";;
  rollback)
    # undo the most recent completed change (a success, or an interrupted run that may have half-applied)
    prev=$(hist_query '([h for h in H if h.get("env")=="'"$ENV_NAME"'" and h.get("result") in ("success","interrupted")] or [None])[-1]')
    [ -n "$prev" ] && [ "$prev" != null ] || die "no completed deployment in history to roll back from"
    REF_B=$($PY -c 'import json,sys;print(json.loads(sys.argv[1])["from"]["backend"])' "$prev")
    REF_F=$($PY -c 'import json,sys;print(json.loads(sys.argv[1])["from"]["frontend"])' "$prev")
    PREV_SCHEMA=$($PY -c 'import json,sys;print(json.loads(sys.argv[1])["schema_before"])' "$prev")
    if [ "$PREV_SCHEMA" != "$SCHEMA_NOW" ]; then
      log "the last deployment changed the database schema ($PREV_SCHEMA -> $SCHEMA_NOW)."
      log "Rolling back code over a migrated database is unsafe, and this script never restores databases."
      log "Pre-deploy backup of that deployment: $($PY -c 'import json,sys;print(json.loads(sys.argv[1])["backup"])' "$prev")"
      log "Follow the manual DB-recovery procedure (runbook 9.5) if a rollback is truly required."
      alert warning "rollback refused: schema changed by last deploy"; exit 3
    fi
    log "rolling back code to ${REF_B##*@} / ${REF_F##*@} (schema unchanged since then)";;
esac

[ "$REF_B" = "$CUR_B" ] && [ "$REF_F" = "$CUR_F" ] && [ "$(running_digest "$BACKEND_CONTAINER")" = "${REF_B##*@}" ] && { log "already running the requested version; nothing to do"; exit 0; }
check_ref "$REF_B" "$BACKEND_REPO"; check_ref "$REF_F" "$FRONTEND_REPO"

# Downgrade guard: a digest that previously ran on a different schema must not run over this one.
# Observations: a version we deployed (to + schema_after) or a version we replaced (from + schema_before),
# so even the version that ran before deploy.sh managed the env is covered.
known=$($PY - "$HIST" "$ENV_NAME" "$REF_B" <<'EOF2'
import json,sys
H=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; env,ref=sys.argv[2],sys.argv[3]
obs=[]
for h in H:
    if h.get("env")!=env: continue
    if h.get("result")=="success" and h.get("to",{}).get("backend")==ref and h.get("schema_after"): obs.append((h["ts"],h["schema_after"]))
    if h.get("from",{}).get("backend")==ref and h.get("schema_before"): obs.append((h["ts"],h["schema_before"]))
print(sorted(obs)[-1][1] if obs else "")
EOF2
)
if [ -n "$known" ] && [ "$known" != "$SCHEMA_NOW" ] && [ "$MODE" != rollback ]; then
  die "backend ${REF_B##*@} last ran on schema $known but the database is now $SCHEMA_NOW (migrated since). Deploying it is a downgrade across a migration"
fi

# Promotion gate: an env with PROMOTE_FROM only accepts builds that ran healthy there for SOAK_HOURS.
if [ -n "$PROMOTE_FROM" ] && [ "$MODE" != rollback ]; then
  SRC_HIST="$STATE_DIR/$PROMOTE_FROM.jsonl"; [ -f "$SRC_HIST" ] || die "no $PROMOTE_FROM history: build has not been tested on $PROMOTE_FROM"
  # Only real deployments count (a --baseline record proves nothing was tested), and this env's DB must be
  # on a schema the build actually ran against on the source env (before or after its migration there).
  age=$($PY - "$SRC_HIST" "$REF_B" "$REF_F" "$PROMOTE_FROM" "$SCHEMA_NOW" <<'EOF'
import json,sys,datetime
H=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; b,f,src,here=sys.argv[2:6]
ok=[h for h in H if h.get("env")==src and h.get("result")=="success" and h.get("mode")!="baseline" and h["to"]["backend"]==b and h["to"]["frontend"]==f]
bad=[h for h in H if h.get("env")==src and h.get("result")!="success" and h.get("to",{}).get("backend")==b]
if not ok or (bad and bad[-1]["ts"]>ok[-1]["ts"]): print(-1); sys.exit()
seen={x for h in ok for x in (h.get("schema_before"),h.get("schema_after")) if x}   # every schema this build ran against there
if here not in seen: print(-2); sys.exit()
t=datetime.datetime.strptime(ok[-1]["ts"],"%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
print(int((datetime.datetime.now(datetime.timezone.utc)-t).total_seconds()//3600))
EOF
)
  [ "$age" != -2 ] || die "this env's database schema ($SCHEMA_NOW) is not one the build ran against on $PROMOTE_FROM; promoting it could be a downgrade across a migration"
  [ "$age" -ge 0 ] || die "this exact build was never deployed successfully on $PROMOTE_FROM via music-deploy (baselines don't count), or failed there later. Deploy and test it on $PROMOTE_FROM first"
  [ "$age" -ge "$SOAK_HOURS" ] || die "build has run on $PROMOTE_FROM for only ${age}h (need ${SOAK_HOURS}h)"
  log "promotion gate ok: healthy on $PROMOTE_FROM for ${age}h"
fi

active_ops
log "plan: backend ${CUR_B##*@} -> ${REF_B##*@}"
log "      frontend ${CUR_F##*@} -> ${REF_F##*@}"
[ "$DRY" = 1 ] && { log "dry run: nothing changed"; exit 0; }
if [ "$CONFIRM" = yes ] && [ "$YES" != 1 ]; then
  read -r -p "Deploy to $ENV_NAME? type the env name to confirm: " a; [ "$a" = "$ENV_NAME" ] || die "not confirmed"
fi

# ---- point of no return: back up first
FILES_BEFORE=$(find "$DATA_DIR/music" -type f | wc -l)
BK="$BACKUP_DIR/$TS-$ENV_NAME-$(echo "${CUR_B##*@}" | cut -c8-19).db"
BKJ=$(db backup "$BK") || { log "$BKJ"; alert warning "pre-deploy DB backup failed; nothing changed"; die "pre-deploy database backup failed; nothing was changed"; }
COUNTS_BEFORE=$($PY -c 'import json,sys;print(json.dumps(json.loads(sys.argv[1])["counts"]))' "$BKJ")
log "pre-deploy backup ok: $BK ($BKJ)"
REC=$($PY -c 'import json,sys;print(json.dumps({"ts":sys.argv[1],"env":sys.argv[2],"mode":sys.argv[3],"by":sys.argv[4],"from":{"backend":sys.argv[5],"frontend":sys.argv[6]},"to":{"backend":sys.argv[7],"frontend":sys.argv[8]},"backup":sys.argv[9],"schema_before":sys.argv[10]}))' \
  "$TS" "$ENV_NAME" "$MODE" "$RUNNER" "$CUR_B" "$CUR_F" "$REF_B" "$REF_F" "$BK" "$SCHEMA_NOW")
finish() { # finish <result> [note]
  hist_add "$($PY -c 'import json,sys;d=json.loads(sys.argv[1]);d.update(result=sys.argv[2],note=sys.argv[3],schema_after=sys.argv[4],finished=sys.argv[5]);print(json.dumps(d))' "$REC" "$1" "${2:-}" "$(db schema 2>/dev/null || echo ?)" "$(date -u +%Y%m%dT%H%M%SZ)")"
}
hist_add "$($PY -c 'import json,sys;d=json.loads(sys.argv[1]);d["result"]="started";print(json.dumps(d))' "$REC")"

PHASE=start
on_interrupt() {
  trap - INT TERM
  [ -n "${HOOK_PID:-}" ] && kill "$HOOK_PID" 2>/dev/null
  log "INTERRUPTED during phase $PHASE"
  if [ "$PHASE" = env_updated ]; then
    env_set "$CUR_B" "$CUR_F" && log ".env restored; containers were not touched" && finish interrupted "before recreate; .env restored" && exit 5
  fi
  finish interrupted "during $PHASE; containers may be on the new version"
  alert warning "deploy interrupted during $PHASE"
  log "run '$0 $ENV_NAME --status' and then '--rollback' (or redeploy)"; exit 5
}
trap on_interrupt INT TERM

if apply_refs "$REF_B" "$REF_F" && wait_healthy && verify_data "$COUNTS_BEFORE" "$FILES_BEFORE"; then
  finish success; log "DEPLOY OK: $ENV_NAME now runs ${REF_B##*@}"; exit 0
fi

# ---- failure handling
trap - INT TERM
SCHEMA_AFTER=$(db schema 2>/dev/null || echo ?)
if [ "$SCHEMA_AFTER" != "$SCHEMA_NOW" ]; then
  finish failed_migrated "schema $SCHEMA_NOW -> $SCHEMA_AFTER; left running for a human"
  alert critical "deploy failed AFTER a schema change; NOT rolled back"
  log "DEPLOY FAILED after the database schema changed. Not rolling back automatically."
  log "Pre-deploy backup: $BK . Manual recovery: runbook 9.5 (never overwrite without preserving the current DB)."
  exit 3
fi
log "deploy failed with schema unchanged; rolling code back to the previous version"
if env_set "$CUR_B" "$CUR_F" && dc up -d --pull never --no-deps "$BACKEND_SERVICE" "$FRONTEND_SERVICE" && wait_healthy && db check >/dev/null; then
  finish rolled_back "health/verification failed; previous version restored"
  alert warning "deploy failed; rolled back to previous version"
  log "ROLLED BACK: $ENV_NAME runs ${CUR_B##*@} again"; exit 2
fi
if [ "$(running_digest "$BACKEND_CONTAINER")" = "${CUR_B##*@}" ]; then
  finish rollback_unhealthy "previous version restored but checks still fail (cause likely outside this deploy)"
  alert critical "deploy failed; previous version restored but the environment still fails health checks"
  log "ROLLBACK APPLIED (previous version is running) BUT CHECKS STILL FAIL. The problem is probably not this deploy"
  log "(e.g. tunnel/DNS/Caddy). Investigate by hand. DB backup: $BK"; exit 4
fi
finish rollback_failed "could not restore the previous version"
alert critical "deploy AND rollback failed"
log "ROLLBACK FAILED (previous version not running). Investigate by hand; DB backup: $BK"; exit 4
