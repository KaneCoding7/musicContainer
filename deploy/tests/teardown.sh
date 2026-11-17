#!/usr/bin/env bash
# teardown.sh [--all] - remove disposable test stacks/state. --all also removes the restored master copy.
set -uo pipefail
R=/mnt/media/.restic/restoretest/phase3
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
for p in $(docker compose ls -a --format json 2>/dev/null | python3 -I -c 'import json,sys;print(" ".join(x["Name"] for x in json.load(sys.stdin) if x["Name"].startswith("musictest-")))'); do
  docker compose -p "$p" down --remove-orphans >/dev/null 2>&1 && echo "removed project $p"
done
for c in $(docker ps -aq --filter name='^mt[dp]-' --filter name='^musictest-'); do docker rm -f "$c" >/dev/null; done
mountpoint -q $R/backups-full 2>/dev/null && umount $R/backups-full
for d in stacks data state backups backups-full conf am t11.log t12.log alerts-received.jsonl test-results.txt; do
  t="$R/$d"; [ -e "$t" ] || continue
  case "$(realpath "$t")" in "$R"/*) rm -rf --one-file-system -- "$t";; *) echo "REFUSED $t";; esac
done
[ "${1:-}" = --all ] && [ -d $R ] && [ "$(realpath $R)" = "$R" ] && rm -rf --one-file-system -- "$R" && echo "removed $R"
echo "teardown done"; ls -A $R 2>/dev/null
