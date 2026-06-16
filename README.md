# Music Server

Personal music server for storing, managing, and playing unreleased beats/music.
See [`Claude.md`](./Claude.md) for the full project plan and architecture.

## Quick start (Docker)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Local development (no Docker)

```bash
# Terminal 1 — backend API (http://localhost:3001)
cd backend
npm install
npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

The frontend talks to the backend via `PUBLIC_API_BASE_URL`
(defaults to `http://localhost:3001`).

## Status

- ✅ **Cycle 1** — Upload & list songs
- ✅ **Cycle 2** — Player & streaming
- ✅ **Cycle 3** — Playlists
- ✅ **Cycle 4** — Delete songs
- ✅ **Cycle 5** — Search / filter
- ✅ **Cycle 6** — Rename songs
- ✅ **Cycle 7** — Player polish (shuffle, repeat, download)
- ✅ **Cycle 8** — Reorder playlist songs (drag & drop)
- ✅ **Cycle 9** — Metadata & album art
- ✅ **Cycle 10** — Rename & delete playlists
- ✅ **Cycle 11** — Keyboard shortcuts
- ✅ **Cycle 12** — Queue / up-next view
- ✅ **Cycle 13** — Track duration
- ✅ **Cycle 14** — Sidebar layout & collapsible queue
- ✅ **Cycle 15** — Playlist art & counts (+ sidebar cleanup)
- ✅ **Cycle 16** — Bulk add to playlist
