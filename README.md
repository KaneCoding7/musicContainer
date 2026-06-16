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
- ✅ **Cycle 17** — Light/dark theme toggle
- ✅ **Cycle 18** — Play counts & recently played
- ✅ **Cycle 19** — Favorites / liked songs
- ✅ **Cycle 20** — Auth & multi-user (Better Auth; isolated libraries)
- ✅ **Cycle 21** — Friend invites
- ✅ **Cycle 22** — Playlist sharing (read-only)
- ✅ **Cycle 23** — Public share links (listen without an account)
- ✅ **Cycle 24** — Automated test suite (Vitest, functional core)
- ✅ **Cycle 25** — CI workflow (GitHub Actions: typecheck, tests, build)
- ✅ **Cycle 26** — Media Session (lock-screen / headphone controls)
- ✅ **Cycle 27** — Search across artist/album + Artists view
- ✅ **Cycle 28** — Multi-file / drag-and-drop upload
- ✅ **Cycle 29** — Queue management (play next / add to queue / reorder / remove)
- ✅ **Cycle 30** — Account settings (display name + password)
- ✅ **Cycle 31** — Home view (smart sections) + theme toggle in Settings
- ✅ **Cycle 32** — Custom album art (upload / replace / remove)

## Tests

```bash
cd backend && npm test   # Vitest over the functional core (in-memory SQLite)
```
