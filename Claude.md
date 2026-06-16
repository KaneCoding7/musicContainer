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

### Cycle 9: Metadata & Album Art  ✅ (post-MVP)
**Goal:** Show artist/album + embedded album art; edit metadata

**Backend Tasks:**
- Add `artist`, `album`, `art_filename` columns (in-place migration)
- Extract tags + cover art on upload (`music-metadata`); art stored in
  `/data/art/`
- `updateSong(id, {name?, artist?, album?})`; generalize `PATCH /api/songs/:id`
- `GET /api/songs/:id/art` serves album art; delete also removes the art file

**Frontend Tasks:**
- Song type gains `artist`/`album`/`hasArt`; `artUrl`, `updateSongMeta`
- SongList: album-art thumbnails + artist subtitle; edit opens a dialog
- EditSongDialog: name/artist/album modal
- Player shows album art + artist

**Done When:** Uploaded songs show their art/artist and metadata is editable

---

### Cycle 10: Rename & Delete Playlists  ✅ (post-MVP)
**Goal:** Manage playlists, not just create them

**Backend Tasks:**
- `renamePlaylist(id, name)`, `deletePlaylist(id)` (song links cascade)
- Routes: `PATCH /api/playlists/:id`, `DELETE /api/playlists/:id`

**Frontend Tasks:**
- PlaylistService rename/delete; PlaylistViewModel rename/remove (clears
  selection on delete)
- PlaylistManager: rename + delete buttons in the selected-playlist header

**Done When:** Can rename and delete playlists from the UI

---

### Cycle 11: Keyboard Shortcuts  ✅ (post-MVP)
**Goal:** Control playback from the keyboard

**Frontend Tasks:**
- Move volume into SongViewModel; add `togglePlay`/`adjustVolume`
- Global keydown handler: Space (play/pause), ←/→ (prev/next),
  ↑/↓ (volume), `/` (focus search); ignored while typing in a field
- Subtle shortcuts hint at the bottom of the page

**Done When:** Shortcuts control playback without touching the mouse

---

### Cycle 12: Queue / Up-Next View  ✅ (post-MVP)
**Goal:** See and navigate the active play queue

**Frontend Tasks:**
- QueueView component listing the current queue (now-playing highlighted,
  played tracks dimmed); click any track to jump to it
- "Up Next" section on the page, shown only when something is queued

**Done When:** The queue is visible and you can jump to any track in it

---

### Cycle 13: Track Duration  ✅ (post-MVP)
**Goal:** Show each track's length

**Backend Tasks:**
- Add `duration` column (in-place migration); extract `format.duration` on
  upload (`music-metadata`); thread through `recordSong`/queries

**Frontend Tasks:**
- Song type gains `duration`; SongList shows m:ss (falls back to upload date
  for songs without it)

**Done When:** Uploaded songs display their length

---

### Cycle 14: Sidebar Layout & Collapsible Queue  ✅ (post-MVP)
**Goal:** Spotify-style app shell instead of one long page

**Frontend Tasks:**
- App shell: left sidebar (brand, nav, upload, shortcuts) + scrollable content
- Sidebar nav switches views: All Songs / Playlists / Albums
- AlbumsView groups songs by album (cover from embedded art) with a detail view
- Sticky bottom player gains a queue toggle; queue is an expandable/collapsible
  panel above the bar
- Layout via column flex; `+layout.svelte` no longer constrains width

**Done When:** Can navigate sections from the sidebar and expand/collapse the
queue from the player

---

### Cycle 15: Playlist Art & Counts (+ sidebar cleanup)  ✅ (post-MVP)
**Goal:** Richer playlist browsing; tidy the sidebar footer

**Backend Tasks:**
- `listPlaylists` returns `trackCount` + `coverSongId` (first track with art)

**Frontend Tasks:**
- Playlist type gains `trackCount`/`coverSongId`; PlaylistManager shows
  playlists as cards with cover art + track count; counts refresh on add/remove
- Sidebar footer cleanup: full-width Upload button; shortcuts moved into a
  collapsible disclosure

**Done When:** Playlists show art + counts and the sidebar footer looks clean

---

### Cycle 16: Bulk Add to Playlist  ✅ (post-MVP)
**Goal:** Add many songs to a playlist at once

**Backend Tasks:**
- `addSongsToPlaylist(id, songIds)` (transactional, skips dupes/missing,
  returns count); route `POST /api/playlists/:id/songs/bulk`

**Frontend Tasks:**
- PlaylistService/ViewModel bulk add
- SongList "Select" mode: per-row checkboxes + a bar to pick a target playlist
  and add the selection

**Done When:** Can multi-select songs and add them to a playlist in one action

---

### Cycle 17: Light/Dark Theme Toggle  ✅ (post-MVP)
**Goal:** Switch between dark and light themes

**Frontend Tasks:**
- Convert the palette to CSS variables in `+layout.svelte` with a
  `[data-theme="light"]` override; components reference the variables
- Theme toggle in the sidebar; persisted to localStorage and applied on load

**Done When:** Toggling switches the whole UI and the choice persists

---

### Cycle 18: Play Counts & Recently Played  ✅ (post-MVP)
**Goal:** Track plays and surface recently played songs

**Backend Tasks:**
- Add `play_count` + `last_played_at` columns (in-place migration)
- `recordPlay(id)` (increment + timestamp); route `POST /api/songs/:id/play`

**Frontend Tasks:**
- Song type gains `playCount`/`lastPlayedAt`; service/VM `recordPlay`
- Player records a play when a new track loads
- New "Recently Played" sidebar view (sorted by last played, with play counts)

**Done When:** Playing songs updates counts and they appear under Recently Played

---

### Cycle 19: Favorites / Liked Songs  ✅ (post-MVP)
**Goal:** Like songs and browse the liked set

**Backend Tasks:**
- Add `liked` column (in-place migration); `setLiked(id, liked)`;
  route `PUT /api/songs/:id/like`

**Frontend Tasks:**
- Song type gains `liked`; service/VM `toggleLike` (optimistic) + `likedSongs`
- Heart toggle on each song row; new "Liked" sidebar view

**Done When:** Can like/unlike songs and see them under Liked

---

### Cycle 20: Auth & Multi-User (Phase 1)  ✅ (post-MVP)
**Goal:** Accounts with isolated, private libraries

**Backend Tasks:**
- Integrate **Better Auth** (`src/auth.ts`): email/password + `bearer` plugin,
  using the existing SQLite connection; auth tables folded into `migrate()`
- `requireAuth` middleware (token via `Authorization` header, or `?token=` for
  media elements); mount auth handler before `express.json()`
- Add `user_id` to songs/playlists; scope every query by the owner; first user
  claims pre-existing (ownerless) data
- Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_ORIGIN`,
  `BETTER_AUTH_TRUSTED_ORIGINS`

**Frontend Tasks:**
- `authService` (token in localStorage) + `authViewModel`; all API calls send
  the bearer token, media URLs append `?token=`
- `AuthScreen` (login/register); the app is gated behind auth; account +
  sign-out in the sidebar

**Done When:** Users sign up/in, see only their own library, and can't reach
others' songs

### Cycle 21: Invites (Phase 2)  ✅ (post-MVP)
**Goal:** Users invite friends to the server

**Backend Tasks:**
- `invites` table; functional core (create/list/validate/consume)
- Routes: `POST/GET /api/invites` (auth); public `POST /api/register` wrapper
  that validates+consumes an invite then calls Better Auth sign-up
- `INVITE_ONLY` env: when set, blocks direct sign-up and requires a valid
  invite (owner/first user exempt)

**Frontend Tasks:**
- `authService.signUp` → `/api/register` (optional invite); AuthScreen reads
  `?invite=` and shows an invite field
- `inviteService` + `InviteView` (sidebar "Invite"): generate + copy invite
  links, see used status

**Done When:** A user generates an invite link and a friend registers with it

---

### Cycle 22: Playlist Sharing  ✅ (post-MVP)
**Goal:** Share a playlist (read-only) with another user

**Backend Tasks:**
- `playlist_shares` table; functional core (share/unshare/list/shared-with-me)
- `canAccessSong` (owner OR a song in a playlist shared with the user);
  media routes (stream/art/download) gate on it via unscoped by-id resolvers
- Routes: `POST/GET/DELETE /api/playlists/:id/share(s)`, `GET /api/shared`,
  `GET /api/shared/:id`

**Frontend Tasks:**
- shareService; PlaylistManager gains a Share panel (share by email, list +
  revoke); new "Shared with me" sidebar view (read-only playback)

**Done When:** Owner shares a playlist; recipient sees and plays it but can't
edit; non-shared songs stay private

---

### Cycle 23: Public Share Links  ✅ (post-MVP)
**Goal:** Share a playlist via a link anyone can open (no account)

**Backend Tasks:**
- `public_shares` table (one token per playlist); functional core
  (enable/disable/get + resolve token → playlist+songs, token→song check)
- Public, unauthenticated routes `GET /api/public/:token`,
  `/public/:token/songs/:id/stream` + `/art` (mounted before requireAuth);
  shared Range-stream helper (`src/stream.ts`)
- Owner routes `GET/POST/DELETE /api/playlists/:id/public`

**Frontend Tasks:**
- publicService + standalone `/share/[token]` listen page (own simple player,
  no login)
- Share panel "Public link" toggle with copyable URL

**Done When:** Owner enables a public link; anyone opens it and listens without
an account; disabling revokes access

---

### Cycle 24: Automated Tests  ✅ (post-MVP)
**Goal:** Lock in the functional-core behavior with a test suite

**Tasks:**
- Add Vitest (`npm test` in `backend/`); export `migrate()` so tests build a
  fresh in-memory SQLite DB per case (`test/helpers.ts`)
- Cover the functional core: result, songs (scoping/isolation), playlists
  (ordering/dupes/cascade), invites, shares (canAccessSong, isolation),
  public shares (token gating/revoke)

**Done When:** `npm test` passes; core behavior + access control are covered

**Testing note:** functional-core functions take a `db` handle, so they unit-
test cleanly against `new Database(":memory:")` + `migrate()` — no server or
network needed.

---

### Cycle 25: CI Workflow  ✅ (post-MVP)
**Goal:** Run checks automatically on every PR

**Tasks:**
- `.github/workflows/ci.yml`: two jobs on push-to-main + PRs
  - backend: `npm ci` → `typecheck` → `test`
  - frontend: `npm ci` → `check` → `build`
- Node 20 with npm caching per workspace

**Done When:** CI runs and passes on pull requests

---

### Cycle 26: Media Session  ✅ (post-MVP)
**Goal:** OS-level playback controls + now-playing metadata

**Frontend Tasks:**
- In Player, publish `MediaMetadata` (title/artist/album/artwork) per track
- Register `mediaSession` action handlers (play/pause/prev/next/seek) and keep
  `playbackState` + `setPositionState` in sync

**Done When:** Lock-screen / Bluetooth / headphone controls drive playback and
show the current track

> Note: shuffle & repeat (off/all/one) were already implemented in the player
> (VM logic + controls), so no separate cycle was needed.

---

### Cycle 27: Search & Artists View  ✅ (post-MVP)
**Goal:** Make a large library navigable

**Frontend Tasks:**
- Broaden `filteredSongs` to match song name, artist, and album
- New `ArtistsView` (grouped like Albums, round avatars) + sidebar "Artists"

**Done When:** Search matches artist/album and an Artists view browses by artist

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
- **Authentication:** Better Auth (email/password, bearer token in
  localStorage). Libraries are isolated per user. See Cycle 20.
- **Streaming:** Use HTTP Range requests for audio streaming (allows seeking).
- **Icons:** Google Material Symbols, self-hosted as a variable woff2 in
  `frontend/static/fonts/` and rendered via `Icon.svelte` (no runtime CDN
  calls — works offline / behind the tunnel).
