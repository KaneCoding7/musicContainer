#!/usr/bin/env bash
# revoke-sessions.sh <dev|prod> [--apply]   (default: DRY RUN, changes nothing)
#
# Invalidates ALL Better Auth sessions of ONE environment (every user signs in again; media tokens
# die with their sessions). Prepared for Phase 5; needs explicit approval to run with --apply.
#
# Guards (refuses unless all pass):
#   * the env is verifiably running the FIXED build (credentials-in-URL refused). Revoking earlier
#     would just leak the new sessions again.
#   * no import is running and the DB has been quiet for QUIET seconds (someone making music)
#   * a SQLite-safe backup of app.db is taken and passes integrity_check first
# Prints counts only, never token values.
set -euo pipefail
ENV=${1:?usage: revoke-sessions.sh <dev|prod> [--apply]}; APPLY=${2:-}
QUIET=${QUIET:-120}
case $ENV in
  dev)  DB=/mnt/media/appdata/music/app.db;              CTR=music-backend;      PORT=3001; BK=/mnt/media/safety/music-predeploy/dev;;
  prod) DB=/mnt/media/appdata/marcus-music/data/app.db;  CTR=music-backend-prod; PORT=5007; BK=/mnt/media/safety/music-predeploy/prod;;
  *) echo "env must be dev or prod"; exit 1;;
esac
DB=${REVOKE_TEST_DB:-$DB}                 # test hook: point at a scratch copy
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] [$ENV] $*"; }

if [ -z "${REVOKE_TEST_DB:-}" ]; then
  # 1. fixed build? The fixed sync endpoint refuses any query string with 400; the old build answered 401.
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "http://127.0.0.1:$PORT/api/sync?probe=1" || true)
  [ "$code" = 400 ] || { log "REFUSED: $ENV is not running the fixed build (sync probe answered $code, expected 400). Deploy the fix first."; exit 1; }
  log "fixed build confirmed (credential-in-URL refused)"
  # 2. activity
  docker top "$CTR" -o pid,args | grep -qE 'yt-dlp|spotdl|ffmpeg|aeneas' && { log "REFUSED: an import is running"; exit 1; }
  age=$(( $(date +%s) - $(for f in "$DB" "$DB-wal"; do [ -e "$f" ] && stat -c %Y "$f"; done | sort -n | tail -1) ))
  [ "$age" -ge "$QUIET" ] || { log "REFUSED: database written ${age}s ago (someone is using the app); retry when quiet (QUIET=$QUIET)"; exit 1; }
  log "no import running; DB quiet for ${age}s"
fi

# 3. counts (dry run stops here)
python3 -I - "$DB" <<'PY'
import sqlite3,sys,time,datetime
c=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro",uri=True); now=time.time()
ts=lambda v: datetime.datetime.fromisoformat(str(v).replace("Z","+00:00")).timestamp()
rows=c.execute('select "expiresAt","userId" from session').fetchall()
live=[r for r in rows if ts(r[0])>now]
print(f"sessions: total={len(rows)} live={len(live)} users-with-live-session={len({r[1] for r in live})}")
PY
[ "$APPLY" = --apply ] || { log "DRY RUN: nothing changed. Re-run with --apply (approved) to revoke all sessions."; exit 0; }

# 4. backup, then revoke in one transaction
install -d -m 700 "$BK"; TS=$(date -u +%Y%m%dT%H%M%SZ); B="$BK/$TS-$ENV-pre-session-revocation.db"
python3 -I - "$DB" "$B" <<'PY'
import sys,sqlite3; sys.path.insert(0,"/usr/local/lib/restic"); import sqlite_snapshot as s
n=s.snapshot(sys.argv[1],sys.argv[2]); c=sqlite3.connect(f"file:{sys.argv[2]}?mode=ro",uri=True)
r=c.execute("pragma integrity_check").fetchone()[0]
if r!="ok": print("backup integrity FAILED:",r); sys.exit(1)
print(f"backup ok: {n} bytes, integrity ok")
PY
chmod 600 "$B"
python3 -I - "$DB" <<'PY'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1],timeout=30); c.isolation_level=None
c.execute("BEGIN IMMEDIATE"); n=c.execute("DELETE FROM session").rowcount; c.execute("COMMIT")
left=c.execute("select count(*) from session").fetchone()[0]
print(f"revoked {n} sessions; remaining {left}")
PY
log "done. Old tokens stop working within 60 s (auth cache). Users must sign in again. Backup: $B"
