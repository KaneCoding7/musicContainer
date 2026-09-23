# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS base
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for most platforms; build tools are a
# fallback in case a native rebuild is needed. ffmpeg measures each track's
# loudness (EBU R128) for volume normalization, and is also used by yt-dlp to
# extract/convert audio for the "import from link" feature.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip make g++ ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# spotdl handles Spotify links (it pulls the matching audio from YouTube using
# Spotify's metadata). It moves slowly, so it gets its own long-lived layer.
RUN pip install --break-system-packages --no-cache-dir spotdl \
    && rm -rf /root/.cache

# syncedlyrics: multi-provider synced (LRC) lyrics fetcher (Musixmatch, NetEase,
# Megalobiz, …) used as a fallback when LRCLIB has no time-synced lyrics, so more
# tracks get the line-by-line highlight.
RUN pip install --break-system-packages --no-cache-dir syncedlyrics \
    && rm -rf /root/.cache

# aeneas: CPU forced-alignment (audio + plain lyrics -> synced LRC timing), so
# tracks with no synced lyrics anywhere (and your own uploads) can still get the
# line-by-line highlight. Installed in its own venv to keep its pinned numpy<2
# away from spotdl/yt-dlp; espeak is its TTS backend for alignment.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-dev python3-venv espeak espeak-data libespeak-dev \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/aeneas \
    && /opt/aeneas/bin/pip install --no-cache-dir "numpy<2" setuptools wheel \
    && /opt/aeneas/bin/pip install --no-cache-dir --no-build-isolation aeneas \
    && rm -rf /root/.cache

# yt-dlp goes stale within weeks (YouTube keeps changing its player), so it is
# installed last, in a layer of its own: bumping it doesn't rebuild everything
# above, and nothing above can pin this layer's cache to a months-old release --
# the bug that used to freeze yt-dlp at whatever the very first build fetched.
# Installed with pip, not the standalone binary, so the `yt-dlp` CLI and the
# yt_dlp module spotdl imports are always the same version.
#
# "latest" tracks the newest release; CI passes the resolved version so a new
# yt-dlp release busts this layer. Pass --build-arg YTDLP_VERSION=2026.08.19 for
# a reproducible build. Containers also refresh yt-dlp on start (see
# docker-entrypoint.sh) -- set YTDLP_AUTO_UPDATE=false to hold this exact one.
ARG YTDLP_VERSION=latest
RUN if [ "$YTDLP_VERSION" = "latest" ]; then spec="yt-dlp"; else spec="yt-dlp==${YTDLP_VERSION}"; fi \
    && pip install --break-system-packages --no-cache-dir --upgrade "$spec" \
    && rm -rf /root/.cache

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

# --- build ---
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod a+rx /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
