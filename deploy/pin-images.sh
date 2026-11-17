#!/usr/bin/env bash
# pin-images.sh <pinned-tag> <backend@sha256:...> <frontend@sha256:...> [--apply]
# Give exact image digests a permanent, never-reused Docker Hub tag so the registry keeps them.
# Default is a DRY RUN. Refuses: tags outside the pinned-* namespace (CI never writes it),
# tags that already exist (never overwrite), and digests the registry doesn't have.
# --apply needs `docker login` as mrkane7 and is a registry WRITE: owner approval required.
set -euo pipefail
TAG=${1:?tag}; B=${2:?backend digest ref}; F=${3:?frontend digest ref}; APPLY=${4:-}
[[ $TAG =~ ^pinned-[a-z0-9.-]+$ ]] || { echo "refused: tag must match pinned-*"; exit 1; }
for r in "$B" "$F"; do
  [[ $r =~ ^mrkane7/music-(backend|frontend)@sha256:[0-9a-f]{64}$ ]] || { echo "refused: $r is not a mrkane7/music-* digest ref"; exit 1; }
  docker buildx imagetools inspect "$r" >/dev/null 2>&1 || { echo "refused: $r not found in registry"; exit 1; }
  repo=${r%@*}
  if docker buildx imagetools inspect "$repo:$TAG" >/dev/null 2>&1; then echo "refused: $repo:$TAG already exists (never overwritten)"; exit 1; fi
  echo "plan: $repo:$TAG  ->  ${r#*@}"
done
[ "$APPLY" = --apply ] || { echo "DRY RUN: nothing written. Re-run with --apply (after docker login) to create the tags."; exit 0; }
for r in "$B" "$F"; do docker buildx imagetools create -t "${r%@*}:$TAG" "$r"; done
for r in "$B" "$F"; do [ "$(docker buildx imagetools inspect "${r%@*}:$TAG" --format '{{json .Manifest}}' | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["digest"])')" = "${r#*@}" ] && echo "verified ${r%@*}:$TAG = ${r#*@}"; done
