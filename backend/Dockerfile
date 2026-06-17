# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS base
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for most platforms; build tools are a
# fallback in case a native rebuild is needed. ffmpeg measures each track's
# loudness (EBU R128) for volume normalization, and is also used by yt-dlp to
# extract/convert audio for the "import from link" feature. yt-dlp's standalone
# release runs on the installed python3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ffmpeg curl ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

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

EXPOSE 3001
CMD ["node", "dist/server.js"]
