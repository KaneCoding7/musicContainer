#!/usr/bin/env bash
# One-time installer for the midnight nightly-deploy timer. Run this ON THE LIVE
# SERVER, from the cloned repo. It writes systemd units pointed at THIS repo
# (no manual path editing), then enables the timer so the live stack rebuilds
# once a day at local midnight instead of on every merge.
#
#   sudo ./scripts/install-nightly-deploy.sh
#   sudo DEPLOY_BRANCH=production ./scripts/install-nightly-deploy.sh   # optional
#
# Re-run it any time to update the units (e.g. after moving the repo).
set -euo pipefail

# Absolute path to the repo root (parent of this script's dir).
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
UNIT_DIR=/etc/systemd/system

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (sudo), so the units can be written to $UNIT_DIR." >&2
  exit 1
fi

echo "==> Repo:          $REPO_DIR"
echo "==> Deploy branch: $DEPLOY_BRANCH"

if [ ! -x "$REPO_DIR/scripts/deploy.sh" ]; then
  echo "deploy.sh not found or not executable at $REPO_DIR/scripts/deploy.sh" >&2
  exit 1
fi

cat > "$UNIT_DIR/music-deploy.service" <<EOF
[Unit]
Description=Rebuild the music server from the latest $DEPLOY_BRANCH (nightly deploy)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
Environment=DEPLOY_BRANCH=$DEPLOY_BRANCH
ExecStart=$REPO_DIR/scripts/deploy.sh
EOF

# The timer carries no paths, so install it verbatim from the repo.
install -m 0644 "$REPO_DIR/deploy/music-deploy.timer" "$UNIT_DIR/music-deploy.timer"

echo "==> Reloading systemd and enabling the timer"
systemctl daemon-reload
systemctl enable --now music-deploy.timer

echo
echo "Installed. The live server will rebuild at local midnight when there are"
echo "new commits on '$DEPLOY_BRANCH'. Useful checks:"
echo "  systemctl list-timers music-deploy.timer     # next scheduled run"
echo "  journalctl -u music-deploy.service -f         # watch a run"
echo "  sudo systemctl start music-deploy.service     # run a deploy now"
echo
echo "Don't forget: disable whatever currently rebuilds on merge, so the timer"
echo "is the only thing that deploys."
