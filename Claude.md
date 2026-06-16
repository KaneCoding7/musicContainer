# Music Server Project - Claude.md

## Project Overview
Personal music server for storing, managing, and playing unreleased beats/music. Access from anywhere via Cloudflare Tunnel. Foundation for future multi-user sharing.

---

## Tech Stack

- **Backend:** Node.js + Express (TypeScript)
- **Frontend:** SvelteKit (TypeScript, adapter-node)
- **Database:** SQLite (file-based)
- **Deployment:** Docker, Cloudflare Tunnel
- **Architecture:** Functional core pattern (pure functions) + Service layer + ViewModels

---

## Architecture Overview

### Backend (Node.js + Express)
- **Functional core:** Pure business logic functions (upload, create playlist, add songs, etc.)
- **HTTP layer:** Express routes call functional core, handle request/response
- **File storage:** Local folder `/data/music/` for audio files
- **Database:** SQLite for metadata (songs, playlists)
- **Error handling:** Result type pattern. Core functions return
  `Result<T> = { ok: true; value: T } | { ok: false; error: AppError }`.
  Pure functions never throw; routes translate `Result` into HTTP responses.

### Frontend (SvelteKit)
- **Service layer:** Calls backend API endpoints
- **ViewModels:** Manage component state (Svelte stores)
- **Helpers:** Utility functions as needed
- **Served from:** Node.js server (adapter-node)

### Database (SQLite)
Single `.db` file with minimal schema:

```
songs table:
  - id (primary key)
  - filename (actual file on disk)
  - original_filename (user-facing name)
  - uploaded_at (timestamp)

playlists table:
  - id (primary key)
  - name (playlist name)
  - created_at (timestamp)

playlist_songs table:
  - id (primary key)
  - playlist_id (foreign key)
  - song_id (foreign key)
  - position (for sorting songs in playlist)
```

---

## MVP Scope (No Extra Features)

### Features
1. **Upload** - Select MP3/WAV files, upload to server
2. **Play** - Stream files, basic player controls (play/pause, next/prev, progress, volume)
3. **Playlists** - Create playlists, add/remove songs, play in order

### What's NOT in MVP
- Metadata editing (song name, artist, album art)
- Lyrics
- User accounts / authentication
- Advanced player features (equalizer, effects)
- Search/filtering (just list view for now)

---

## API Endpoints (Backend)

```
POST   /api/upload                      - Upload audio file
GET    /api/songs                       - List all songs
GET    /api/songs/:id/stream            - Stream audio file

POST   /api/playlists                   - Create playlist
GET    /api/playlists                   - List playlists
GET    /api/playlists/:id               - Get songs in playlist
POST   /api/playlists/:id/songs         - Add song to playlist
DELETE /api/playlists/:id/songs/:songId - Remove song from playlist
```

---

## Project Structure

```
music-server/
├── docker-compose.yml
├── Claude.md (this file)
├── backend/
│   ├── src/
│   │   ├── functional/
│   │   │   ├── result.ts (Result type + helpers)
│   │   │   ├── songs.ts (upload, list, stream logic)
│   │   │   └── playlists.ts (create, add/remove songs logic)
│   │   ├── routes/
│   │   │   ├── songs.ts (express routes)
│   │   │   └── playlists.ts (express routes)
│   │   ├── db/
│   │   │   └── init.ts (sqlite setup)
│   │   ├── types.ts (shared domain types)
│   │   └── server.ts (express app)
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── services/
│   │   │   │   ├── songService.ts
│   │   │   │   └── playlistService.ts
│   │   │   ├── viewmodels/
│   │   │   │   ├── songViewModel.ts
│   │   │   │   └── playlistViewModel.ts
│   │   │   └── helpers/
│   │   │       └── (as needed)
│   │   ├── routes/
│   │   │   ├── +page.svelte (main page)
│   │   │   └── +layout.svelte
│   │   ├── components/
│   │   │   ├── Player.svelte
│   │   │   ├── SongList.svelte
│   │   │   ├── PlaylistManager.svelte
│   │   │   └── ...
│   │   └── app.html
│   ├── svelte.config.js
│   ├── package.json
│   └── tsconfig.json
├── data/
│   ├── music/ (audio files stored here)
│   └── app.db (sqlite database)
```

---

## Development Sprints (Feature-Based Cycles)

### Cycle 1: Upload & List Songs  ✅ (scaffold complete)
**Goal:** Upload files and see them in a list

**Backend Tasks:**
- Set up Express server + TypeScript
- Create SQLite database and songs table
- Implement functional core: `uploadSong(file) -> Song`
- Implement functional core: `listSongs() -> Song[]`
- Create routes: `POST /api/upload`, `GET /api/songs`

**Frontend Tasks:**
- Create SongService (calls API)
- Create SongViewModel (manages song list state)
- Create SongList.svelte component
- Create upload form/button

**Done When:** Can upload a file and see it in the list

---

### Cycle 2: Player & Streaming  ✅
**Goal:** Play songs with basic controls

**Backend Tasks:**
- Implement functional core: `streamSong(songId) -> AudioStream`
- Create route: `GET /api/songs/:id/stream`

**Frontend Tasks:**
- Create Player.svelte component (play/pause, progress, volume)
- Extend SongViewModel for player state
- Integrate audio player with SongService

**Done When:** Can click a song and play it with controls

---

### Cycle 3: Playlists  ✅
**Goal:** Create playlists and play songs in order

**Backend Tasks:**
- Create SQLite tables: playlists, playlist_songs
- Implement functional core: `createPlaylist(name) -> Playlist`
- Implement functional core: `addSongToPlaylist(playlistId, songId) -> void`
- Implement functional core: `removeSongFromPlaylist(playlistId, songId) -> void`
- Implement functional core: `getPlaylistSongs(playlistId) -> Song[]`
- Create routes for all playlist operations

**Frontend Tasks:**
- Create PlaylistService (calls API)
- Create PlaylistViewModel (manages playlist state)
- Create PlaylistManager.svelte (create, view, manage playlists)
- Update Player to handle playlist queue

**Done When:** Can create playlists, add songs, and play them in order

---

### Cycle 4: Delete Songs  ✅ (post-MVP)
**Goal:** Remove songs from the library

**Backend Tasks:**
- Implement functional core: `deleteSong(id) -> void` (db row + file on disk;
  playlist references removed via `ON DELETE CASCADE`)
- Create route: `DELETE /api/songs/:id`

**Frontend Tasks:**
- Add `deleteSong` to SongService
- Add `remove(id)` to SongViewModel (reconciles the play queue / current track)
- Add a delete button (with confirm) to SongList; refresh open playlist

**Done When:** Can delete a song and it disappears from the library and any playlists

---

### Cycle 5: Search / Filter  ✅ (post-MVP)
**Goal:** Quickly find songs in a growing library

**Frontend Tasks:**
- Add `query` state + `filteredSongs` getter to SongViewModel
  (case-insensitive match on the song name)
- Add a search input to SongList; play within the filtered results

**Notes:** Instant client-side filtering over the already-loaded list — no
backend changes needed.

**Done When:** Typing in the search box narrows the list as you type

---

### Cycle 6: Rename Songs  ✅ (post-MVP)
**Goal:** Give beats friendlier display names (the upload filename is locked)

**Backend Tasks:**
- Implement functional core: `renameSong(id, name) -> Song` (updates
  `original_filename`; the file on disk is untouched)
- Create route: `PATCH /api/songs/:id`

**Frontend Tasks:**
- Add `renameSong` to SongService
- Add `rename(id, name)` to SongViewModel (updates library list + play queue)
- Add a rename button to SongList; refresh open playlist

**Done When:** Can rename a song and the new name shows everywhere

---

### Cycle 7: Player Polish  ✅ (post-MVP)
**Goal:** Shuffle, repeat, and downloading songs

**Backend Tasks:**
- Extend `resolveSongFile` to include the (extension-safe) download name
- Create route: `GET /api/songs/:id/download` (Content-Disposition: attachment)

**Frontend Tasks:**
- SongViewModel: `shuffle` + `repeat` (off/all/one); next/prev honor them;
  repeat-one replays the current track on end
- Player: shuffle + repeat toggle buttons
- SongList: per-song download link (`downloadUrl`)

**Done When:** Can shuffle/repeat playback and download any song

---

### Cycle 8: Reorder Playlist Songs  ✅ (post-MVP)
**Goal:** Drag to reorder songs within a playlist

**Backend Tasks:**
- Implement functional core: `reorderPlaylist(id, songIds) -> void`
  (rewrites `position` 1..n in a transaction)
- Create route: `PUT /api/playlists/:id/order`

**Frontend Tasks:**
- Add `reorderPlaylist` to PlaylistService
- Add `reorder(songs)` to PlaylistViewModel (optimistic; reverts on error)
- Drag-and-drop in PlaylistManager (drag handle + HTML5 DnD)

**Done When:** Dragging a song in a playlist persists the new order

---

## Docker Setup

`docker-compose.yml` runs two services:
- **backend** – Express API (port 3001), owns `/api/*` and file storage
- **frontend** – SvelteKit (adapter-node, port 3000)

Volume mounts persist `data/music/` and `data/app.db`.

Single command: `docker compose up --build`

---

## Local Development (without Docker)

```
# Terminal 1 - backend
cd backend && npm install && npm run dev   # http://localhost:3001

# Terminal 2 - frontend
cd frontend && npm install && npm run dev  # http://localhost:5173
```

The frontend reads the API base URL from `PUBLIC_API_BASE_URL`
(defaults to `http://localhost:3001`).

---

## Notes

- **Error Handling:** Result type pattern (see `backend/src/functional/result.ts`).
  Functional core returns `Result<T>`; routes map it to HTTP status codes.
- **Validation:** Input validation in functional core before operations.
- **File Types:** Support MP3 and WAV initially.
- **No Authentication:** MVP is single-user (you), accessed via Cloudflare Tunnel.
- **Streaming:** Use HTTP Range requests for audio streaming (allows seeking).
- **Icons:** Google Material Symbols, self-hosted as a variable woff2 in
  `frontend/static/fonts/` and rendered via `Icon.svelte` (no runtime CDN
  calls — works offline / behind the tunnel).
