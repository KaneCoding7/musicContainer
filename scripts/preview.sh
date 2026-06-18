#!/usr/bin/env bash
# Build + run the PREVIEW stack (isolated ports/data/containers) for whatever
# branch is currently checked out. Safe to run while the live server is up —
# nothing is shared with the real ./data library.
#
#   ./scripts/preview.sh                 # build + (re)start the preview
#   ./scripts/preview.sh --no-build      # start without rebuilding
#
# Stop it with:
#   docker compose -p music-preview -f docker-compose.preview.yml down
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=music-preview
FILE=docker-compose.preview.yml

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
echo "==> Previewing branch: $branch"

mkdir -p data-preview

# Default to a build; let callers override (e.g. --no-build) by passing args.
if [ "$#" -eq 0 ]; then
  set -- --build
fi

docker compose -p "$PROJECT" -f "$FILE" up -d "$@"

cat <<EOF

Preview is up (isolated from the live server):
  Frontend  ->  http://localhost:3100
  Backend   ->  http://localhost:3101

Logs:   docker compose -p $PROJECT -f $FILE logs -f
Stop:   docker compose -p $PROJECT -f $FILE down
EOF
