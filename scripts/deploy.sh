#!/usr/bin/env bash
# Deploy the LIVE music server: pull the deploy branch and rebuild the prod
# stack. This is what the midnight timer runs (see deploy/) so that merges made
# during the day don't rebuild and interrupt people's music — the live server
# only updates once, overnight.
#
# Run it by hand any time you DO want to push an update immediately (a hotfix):
#   ./scripts/deploy.sh            # rebuild only if the branch has new commits
#   FORCE=1 ./scripts/deploy.sh    # rebuild even if nothing changed
#   DEPLOY_BRANCH=some-branch ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Default to whatever branch the live checkout is already on (normally `main`),
# so we redeploy the same line of work the server already tracks.
BRANCH="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

echo "==> Deploy starting $(date '+%Y-%m-%d %H:%M:%S')  (branch: $BRANCH)"

git fetch --quiet origin "$BRANCH"
before="$(git rev-parse HEAD)"
after="$(git rev-parse "origin/$BRANCH")"

if [ "$before" = "$after" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Already up to date ($before). Nothing to rebuild."
  echo "(Set FORCE=1 to rebuild anyway.)"
  exit 0
fi

echo "==> Updating working tree to origin/$BRANCH ($before -> $after)"
git checkout --quiet "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Rebuilding + restarting the live stack"
docker compose up -d --build

echo "==> Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

echo "==> Deploy done $(date '+%Y-%m-%d %H:%M:%S')"
