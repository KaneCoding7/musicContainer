#!/bin/sh
# Refresh yt-dlp, then start the server.
#
# YouTube changes its player and signature scheme constantly, so a yt-dlp more
# than a few weeks old starts failing "import from link" with "unable to
# download video data: HTTP Error 403: Forbidden" -- it still resolves the
# video, then gets refused on the stream. The image bakes a current yt-dlp at
# build time, but any published image goes stale where it sits, so refresh on
# start rather than making everyone rebuild.
#
# A failed refresh is not fatal: an offline host, a read-only filesystem or a
# PyPI outage should not stop the server from booting. The baked version stands.
#
# pip rather than `yt-dlp -U`: /usr/local/bin/yt-dlp is pip's console script,
# and spotdl imports the same yt_dlp module for Spotify links, so one upgrade
# covers both the link importer and spotdl.
#
# Set YTDLP_AUTO_UPDATE=false to keep exactly the version the image shipped
# (pinned or air-gapped deploys).
set -e

if [ "${YTDLP_AUTO_UPDATE:-true}" = "true" ]; then
  before="$(yt-dlp --version 2>/dev/null || echo unknown)"
  if timeout "${YTDLP_UPDATE_TIMEOUT:-120}" \
       pip install -q --break-system-packages --no-cache-dir --upgrade yt-dlp >/dev/null 2>&1; then
    after="$(yt-dlp --version 2>/dev/null || echo unknown)"
    if [ "$before" = "$after" ]; then
      echo "[entrypoint] yt-dlp already current ($after)"
    else
      echo "[entrypoint] yt-dlp updated $before -> $after"
    fi
  else
    echo "[entrypoint] yt-dlp refresh failed, keeping the version baked into the image ($before)" >&2
  fi
fi

exec "$@"
