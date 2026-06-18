#!/usr/bin/env bash
# Build + run the PREVIEW stack (isolated ports/data/containers). Runs alongside
# the live server and shares nothing with the real ./data library or with main.
#
#   ./scripts/preview.sh                       # preview the branch you're on
#   ./scripts/preview.sh claude/some-branch    # fetch + preview a specific branch
#   ./scripts/preview.sh some-branch --no-build # skip the rebuild
#
# Stop it with:
#   docker compose -p music-preview -f docker-compose.preview.yml down
#
# NOTE: run this from a dev clone or your laptop — NOT the live server's deploy
# folder — so checking out a branch can't disturb what the nightly deploy ships.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=music-preview
FILE=docker-compose.preview.yml

# Optional first arg: a branch to preview. (Anything starting with "-" is a
# compose flag, not a branch.)
if [ "$#" -gt 0 ] && [ "${1#-}" = "$1" ]; then
  target="$1"; shift
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "You have uncommitted changes here — commit or stash them before" >&2
    echo "switching to '$target' to preview it." >&2
    exit 1
  fi
  echo "==> Fetching $target"
  git fetch origin "$target"
  git checkout "$target"
  git reset --hard "origin/$target"
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
echo "==> Previewing branch: $branch"

mkdir -p data-preview

# Default to a build; let callers override (e.g. --no-build) by passing args.
if [ "$#" -eq 0 ]; then
  set -- --build
fi

docker compose -p "$PROJECT" -f "$FILE" up -d "$@"

cat <<EOF

Preview is up (isolated from the live server AND from main):
  Frontend  ->  http://localhost:3100
  Backend   ->  http://localhost:3101

Logs:   docker compose -p $PROJECT -f $FILE logs -f
Stop:   docker compose -p $PROJECT -f $FILE down
EOF
