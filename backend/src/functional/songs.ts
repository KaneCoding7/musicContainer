import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { copyFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import type { Song } from "../types.js";
import { parseYouTubeId } from "../youtube.js";
import { err, ok, type AppError, type Result } from "./result.js";
import { canAccessSong } from "./shares.js";

// Maps a stored art file's extension to the MIME type used when serving it.
export function artContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// Allowed audio formats for the MVP.
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav"]);
const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
]);

// --- Pure validation -------------------------------------------------------

// Validates an upload's file type by extension and MIME type. Pure: no I/O.
export function validateUpload(
  originalFilename: string,
  mimeType: string
): Result<void> {
  const ext = extname(originalFilename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return err(
      "validation",
      `Unsupported file extension "${ext || "(none)"}". Allowed: .mp3, .wav`
    );
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return err(
      "validation",
      `Unsupported content type "${mimeType}". Expected an MP3 or WAV file.`
    );
  }
  return ok(undefined);
}

// --- Database-backed operations -------------------------------------------

interface SongRow {
  id: number;
  filename: string;
  original_filename: string;
  uploaded_at: string;
  artist: string | null;
  album: string | null;
  art_filename: string | null;
  duration: number | null;
  play_count: number;
  last_played_at: string | null;
  liked: number;
  loudness: number | null;
  sort_order: number | null;
  album_sort_order: number | null;
  source_url: string | null;
  clip_filename: string | null;
  clip_disabled: number;
  suggestion: number;
  track_no: number | null;
  disc_no: number | null;
}

const SONG_COLUMNS =
  "id, filename, original_filename, uploaded_at, artist, album, art_filename, duration, play_count, last_played_at, liked, loudness, sort_order, album_sort_order, source_url, clip_filename, clip_disabled, suggestion, track_no, disc_no";

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    uploadedAt: row.uploaded_at,
    artist: row.artist,
    artists: [], // filled in by attachArtists() for the UI-facing reads
    album: row.album,
    hasArt: row.art_filename !== null,
    duration: row.duration,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
    liked: row.liked === 1,
    loudness: row.loudness,
    sortOrder: row.sort_order,
    albumSortOrder: row.album_sort_order,
    trackNo: row.track_no,
    discNo: row.disc_no,
    hasSource: row.source_url !== null,
    hasClip: row.clip_filename !== null,
    clipDisabled: row.clip_disabled === 1,
    sourceUrl: row.source_url,
    isSuggestion: row.suggestion === 1,
  };
}

// --- Artists (relational) --------------------------------------------------

// Resolves an artist name to its id for a user, creating the row if needed.
// Case-insensitive (the artists table has UNIQUE(user_id, name COLLATE NOCASE)),
// so "Drake" and "drake" collapse to one artist; the first-seen casing wins.
export function findOrCreateArtist(
  db: Database,
  userId: string,
  name: string
): number {
  const trimmed = name.trim();
  db.prepare(
    "INSERT OR IGNORE INTO artists (user_id, name) VALUES (?, ?)"
  ).run(userId, trimmed);
  const row = db
    .prepare(
      "SELECT id FROM artists WHERE user_id = ? AND name = ? COLLATE NOCASE"
    )
    .get(userId, trimmed) as { id: number } | undefined;
  // The row was just inserted or already existed, so this is always defined.
  return row!.id;
}

// Sets a song's ordered artist list (the source of truth), replacing any
// existing links, and refreshes the denormalized songs.artist display string.
// Blank/duplicate names are ignored; an empty result clears the artist. Also
// prunes artists that this change left with no songs, image, or public share.
// Owner-scoped; assumes it runs inside a caller transaction where appropriate.
export function syncSongArtists(
  db: Database,
  songId: number,
  userId: string,
  names: string[]
): void {
  // Normalize: trim, drop blanks, de-dupe case-insensitively, keep order.
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of names) {
    const t = (raw ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(t);
  }

  const priorIds = (
    db
      .prepare("SELECT artist_id FROM song_artists WHERE song_id = ?")
      .all(songId) as { artist_id: number }[]
  ).map((r) => r.artist_id);

  db.prepare("DELETE FROM song_artists WHERE song_id = ?").run(songId);

  const link = db.prepare(
    "INSERT INTO song_artists (song_id, artist_id, position) VALUES (?, ?, ?)"
  );
  clean.forEach((name, i) => {
    const artistId = findOrCreateArtist(db, userId, name);
    link.run(songId, artistId, i);
  });

  const display = clean.length ? clean.join(", ") : null;
  db.prepare("UPDATE songs SET artist = ? WHERE id = ? AND user_id = ?").run(
    display,
    songId,
    userId
  );

  pruneOrphanArtists(db, priorIds);
}

// Deletes artist rows (from the given candidate ids) that are no longer used by
// any song, image, or public share — keeps the artists table from accumulating
// dangling names after edits/deletes.
export function pruneOrphanArtists(db: Database, artistIds: number[]): void {
  if (artistIds.length === 0) return;
  const del = db.prepare(
    `DELETE FROM artists
      WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM song_artists WHERE artist_id = artists.id)
        AND NOT EXISTS (SELECT 1 FROM artist_images WHERE artist_id = artists.id)
        AND NOT EXISTS (SELECT 1 FROM artist_public_shares WHERE artist_id = artists.id)`
  );
  for (const id of new Set(artistIds)) del.run(id);
}

// Attaches the ordered artists array to each Song (one batched query). Call it
// on the owner-facing reads that feed the UI; other reads keep only the scalar
// `artist` string. No-op for an empty list.
export function attachArtists<T extends Song>(db: Database, songs: T[]): T[] {
  if (songs.length === 0) return songs;
  const byId = new Map<number, T>();
  for (const s of songs) {
    s.artists = [];
    byId.set(s.id, s);
  }
  const ids = [...byId.keys()];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT sa.song_id AS songId, a.id AS id, a.name AS name
         FROM song_artists sa
         JOIN artists a ON a.id = sa.artist_id
        WHERE sa.song_id IN (${placeholders})
        ORDER BY sa.song_id, sa.position`
    )
    .all(...ids) as { songId: number; id: number; name: string }[];
  for (const r of rows) {
    byId.get(r.songId)?.artists.push({ id: r.id, name: r.name });
  }
  return songs;
}

// Persists a manual ordering: assigns each id a sort_order matching its index
// in the given list (owner-scoped, in one transaction). Used to reorder the
// tracks within a derived grouping such as an artist.
export function setSongsOrder(
  db: Database,
  ids: number[],
  userId: string
): Result<void> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return err("validation", "No songs to order");
  }
  try {
    const stmt = db.prepare(
      "UPDATE songs SET sort_order = ? WHERE id = ? AND user_id = ?"
    );
    const run = db.transaction((list: number[]) => {
      list.forEach((id, index) => stmt.run(index, id, userId));
    });
    run(ids);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to set order: ${(e as Error).message}`);
  }
}

// Persists a manual ordering for the tracks within an album, using a separate
// album_sort_order column so it doesn't disturb the artist ordering (sort_order)
// of songs that belong to both. Owner-scoped, in one transaction.
export function setAlbumSongsOrder(
  db: Database,
  ids: number[],
  userId: string
): Result<void> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return err("validation", "No songs to order");
  }
  try {
    const stmt = db.prepare(
      "UPDATE songs SET album_sort_order = ? WHERE id = ? AND user_id = ?"
    );
    const run = db.transaction((list: number[]) => {
      list.forEach((id, index) => stmt.run(index, id, userId));
    });
    run(ids);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to set album order: ${(e as Error).message}`);
  }
}

// Records a track's measured integrated loudness (LUFS). Best-effort; used by
// the analyzer and the upload flow.
export function setSongLoudness(
  db: Database,
  id: number,
  loudness: number
): void {
  try {
    db.prepare("UPDATE songs SET loudness = ? WHERE id = ?").run(loudness, id);
  } catch {
    /* best-effort */
  }
}

// Returns the on-disk filenames of a user's songs that have not been analyzed
// for loudness yet (loudness IS NULL).
export function listSongsNeedingLoudness(
  db: Database,
  userId: string
): { id: number; filename: string }[] {
  try {
    return db
      .prepare(
        "SELECT id, filename FROM songs WHERE user_id = ? AND loudness IS NULL AND pending = 0"
      )
      .all(userId) as { id: number; filename: string }[];
  } catch {
    return [];
  }
}

// Records an already-stored audio file (plus any extracted metadata) in the
// database and returns the song.
export function recordSong(
  db: Database,
  params: {
    filename: string;
    originalFilename: string;
    userId: string;
    artist?: string | null;
    artists?: string[]; // ordered; preferred over `artist` when provided
    album?: string | null;
    artFilename?: string | null;
    duration?: number | null;
    pending?: boolean;
    suggestion?: boolean;
    sourceUrl?: string | null;
    mbRecordingId?: string | null;
    trackNo?: number | null;
    discNo?: number | null;
  }
): Result<Song> {
  const filename = params.filename.trim();
  const originalFilename = params.originalFilename.trim();
  if (!filename || !originalFilename) {
    return err("validation", "filename and originalFilename are required");
  }

  // Prefer the ordered `artists` list; fall back to the single `artist` string.
  const artistNames =
    params.artists && params.artists.length > 0
      ? params.artists
      : params.artist
        ? [params.artist]
        : [];

  try {
    const insert = db.transaction((): number => {
      const info = db
        .prepare(
          "INSERT INTO songs (filename, original_filename, artist, album, art_filename, duration, user_id, pending, suggestion, source_url, mb_recording_id, track_no, disc_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          filename,
          originalFilename,
          params.artist ?? null,
          params.album ?? null,
          params.artFilename ?? null,
          params.duration ?? null,
          params.userId,
          params.pending ? 1 : 0,
          params.suggestion ? 1 : 0,
          params.sourceUrl ?? null,
          params.mbRecordingId ?? null,
          params.trackNo ?? null,
          params.discNo ?? null
        );
      const id = info.lastInsertRowid as number;
      // Links the artists and (re)writes the denormalized songs.artist string.
      syncSongArtists(db, id, params.userId, artistNames);
      return id;
    });
    const newId = insert();

    const row = db
      .prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ?`)
      .get(newId) as SongRow | undefined;

    if (!row) {
      return err("internal", "Song was inserted but could not be read back");
    }
    return ok(attachArtists(db, [rowToSong(row)])[0]);
  } catch (e) {
    return err("internal", `Failed to record song: ${(e as Error).message}`);
  }
}

// Returns all of a user's confirmed (non-pending) songs, newest first.
export function listSongs(db: Database, userId: string): Result<Song[]> {
  try {
    const rows = db
      .prepare(
        `SELECT ${SONG_COLUMNS} FROM songs WHERE user_id = ? AND pending = 0 ORDER BY datetime(uploaded_at) DESC, id DESC`
      )
      .all(userId) as SongRow[];
    return ok(attachArtists(db, rows.map(rowToSong)));
  } catch (e) {
    return err("internal", `Failed to list songs: ${(e as Error).message}`);
  }
}

// Returns a song's source link + duration (for re-fetching video frames as art).
export function getSongSource(
  db: Database,
  id: number,
  userId: string
): { sourceUrl: string; duration: number | null } | null {
  try {
    const row = db
      .prepare("SELECT source_url, duration FROM songs WHERE id = ? AND user_id = ?")
      .get(id, userId) as
      | { source_url: string | null; duration: number | null }
      | undefined;
    if (!row || !row.source_url) return null;
    return { sourceUrl: row.source_url, duration: row.duration };
  } catch {
    return null;
  }
}

// Copies a song the user can access (e.g. from a shared playlist) into their
// own library: duplicates the audio + art files and creates a new owned song
// row, so it's a real independent copy.
export function copySongToLibrary(
  db: Database,
  userId: string,
  songId: number,
  musicDir: string,
  artDir: string
): Result<Song> {
  if (!canAccessSong(db, userId, songId)) {
    return err("not_found", `Song ${songId} not found`);
  }
  const src = db
    .prepare(
      `SELECT user_id, filename, original_filename, artist, album, art_filename,
              duration, loudness, source_url, track_no, disc_no
       FROM songs WHERE id = ?`
    )
    .get(songId) as
    | {
        user_id: string;
        filename: string;
        original_filename: string;
        artist: string | null;
        album: string | null;
        art_filename: string | null;
        duration: number | null;
        loudness: number | null;
        source_url: string | null;
        track_no: number | null;
        disc_no: number | null;
      }
    | undefined;
  if (!src) return err("not_found", `Song ${songId} not found`);
  if (src.user_id === userId) {
    return err("conflict", "This song is already in your library");
  }

  try {
    const srcAudio = join(musicDir, src.filename);
    if (!existsSync(srcAudio)) {
      return err("not_found", "Source audio file is missing");
    }
    const newFile = `${randomUUID()}${extname(src.filename) || ".mp3"}`;
    copyFileSync(srcAudio, join(musicDir, newFile));

    let newArt: string | null = null;
    if (src.art_filename) {
      const srcArt = join(artDir, src.art_filename);
      if (existsSync(srcArt)) {
        newArt = `${randomUUID()}${extname(src.art_filename) || ".jpg"}`;
        copyFileSync(srcArt, join(artDir, newArt));
      }
    }

    // Carry the source's ordered artist list so the copy keeps every artist,
    // not just the joined display string.
    const srcArtistNames = (
      db
        .prepare(
          `SELECT a.name FROM song_artists sa
             JOIN artists a ON a.id = sa.artist_id
            WHERE sa.song_id = ? ORDER BY sa.position`
        )
        .all(songId) as { name: string }[]
    ).map((r) => r.name);

    const result = recordSong(db, {
      filename: newFile,
      originalFilename: src.original_filename,
      userId,
      artist: src.artist,
      artists: srcArtistNames.length > 0 ? srcArtistNames : undefined,
      album: src.album,
      artFilename: newArt,
      duration: src.duration,
      sourceUrl: src.source_url,
      trackNo: src.track_no,
      discNo: src.disc_no,
    });
    if (result.ok && src.loudness != null) {
      setSongLoudness(db, result.value.id, src.loudness);
    }
    return result;
  } catch (e) {
    return err("internal", `Failed to copy song: ${(e as Error).message}`);
  }
}

// Returns a user's (confirmed) songs by a given artist, newest first.
export function listSongsByArtist(
  db: Database,
  userId: string,
  artist: string
): Result<Song[]> {
  try {
    // Join through song_artists so a song counts for EVERY artist it credits,
    // not just an exact match on the joined display string.
    const rows = db
      .prepare(
        `SELECT ${SONG_COLUMNS.split(", ")
          .map((c) => `s.${c}`)
          .join(", ")}
         FROM songs s
         JOIN song_artists sa ON sa.song_id = s.id
         JOIN artists a ON a.id = sa.artist_id
         WHERE s.user_id = ? AND s.pending = 0 AND a.name = ? COLLATE NOCASE
         ORDER BY datetime(s.uploaded_at) DESC, s.id DESC`
      )
      .all(userId, artist.trim()) as SongRow[];
    return ok(attachArtists(db, rows.map(rowToSong)));
  } catch (e) {
    return err("internal", `Failed to list artist songs: ${(e as Error).message}`);
  }
}

// Returns a user's pending (uploaded-but-not-yet-confirmed) songs for review.
export function listPendingSongs(db: Database, userId: string): Result<Song[]> {
  try {
    const rows = db
      .prepare(
        `SELECT ${SONG_COLUMNS} FROM songs WHERE user_id = ? AND pending = 1 AND suggestion = 0 ORDER BY id ASC`
      )
      .all(userId) as SongRow[];
    return ok(attachArtists(db, rows.map(rowToSong)));
  } catch (e) {
    return err("internal", `Failed to list pending songs: ${(e as Error).message}`);
  }
}

// Confirms pending songs into the library (clears their pending flag).
export function finalizeSongs(
  db: Database,
  ids: number[],
  userId: string
): Result<Song[]> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return err("validation", "No songs to confirm");
  }
  try {
    // Clear BOTH pending and suggestion: a confirmed track must be
    // indistinguishable from a self-imported one, so Edit/Delete and the
    // library badge (which key off isSuggestion = suggestion === 1) work and
    // persist across reloads. Leaving suggestion = 1 made kept songs revert to
    // suggestion behavior on refetch.
    const stmt = db.prepare(
      "UPDATE songs SET pending = 0, suggestion = 0 WHERE id = ? AND user_id = ?"
    );
    db.transaction((list: number[]) => {
      for (const id of list) stmt.run(id, userId);
    })(ids);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT ${SONG_COLUMNS} FROM songs WHERE user_id = ? AND id IN (${placeholders}) ORDER BY datetime(uploaded_at) DESC, id DESC`
      )
      .all(userId, ...ids) as SongRow[];
    return ok(attachArtists(db, rows.map(rowToSong)));
  } catch (e) {
    return err("internal", `Failed to confirm songs: ${(e as Error).message}`);
  }
}

// Normalized "artist|title" key for loose de-duplication of suggestion
// candidates against what the user already has. Lowercased, punctuation and
// bracketed qualifiers (feat./remaster/live/…) stripped, whitespace collapsed —
// so "Song (Remastered 2011)" and "song" collide and we don't re-suggest a
// track that's effectively already in the library.
export function trackKey(artist: string | null, title: string | null): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(artist ?? "")}|${norm(title ?? "")}`;
}

// The set of recording MBIDs, normalized artist|title keys, and YouTube video
// ids the user already has — across BOTH the confirmed library and any un-swept
// pending suggestions. Suggestion selection subtracts this so we never download
// a duplicate (and a track downloaded once stays excluded until it's swept).
export function libraryTrackKeys(
  db: Database,
  userId: string
): { mbids: Set<string>; keys: Set<string>; ytIds: Set<string> } {
  const rows = db
    .prepare(
      "SELECT artist, original_filename, mb_recording_id, source_url FROM songs WHERE user_id = ?"
    )
    .all(userId) as {
    artist: string | null;
    original_filename: string;
    mb_recording_id: string | null;
    source_url: string | null;
  }[];
  const mbids = new Set<string>();
  const keys = new Set<string>();
  const ytIds = new Set<string>();
  for (const r of rows) {
    if (r.mb_recording_id) mbids.add(r.mb_recording_id);
    keys.add(trackKey(r.artist, r.original_filename));
    const yt = parseYouTubeId(r.source_url);
    if (yt) ytIds.add(yt);
  }
  return { mbids, keys, ytIds };
}

// Removes the physical file + art for a song row (best-effort), then the row.
// Shared by the per-user discard and the global sweep.
function purgeSongRow(
  db: Database,
  row: { id: number; filename: string; art_filename: string | null },
  musicDir: string,
  artDir: string
): void {
  const removeFile = (p: string) => {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  };
  db.prepare("DELETE FROM songs WHERE id = ?").run(row.id);
  removeFile(join(musicDir, row.filename));
  if (row.art_filename) removeFile(join(artDir, row.art_filename));
}

// Discards specific suggestion tracks the user moved past without keeping.
// Deliberately conservative: only rows that are still suggestion=1, pending=1,
// not liked, and not referenced by any playlist are touched — so a track the
// user kept (finalized), liked, or added to a playlist can never be deleted
// here even if its id is passed in. Returns the ids actually removed.
export function discardSuggestions(
  db: Database,
  ids: number[],
  userId: string,
  musicDir: string,
  artDir: string
): Result<number[]> {
  const clean = (Array.isArray(ids) ? ids : []).filter(
    (x): x is number => Number.isInteger(x) && x > 0
  );
  if (clean.length === 0) return ok([]);
  try {
    const placeholders = clean.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id, filename, art_filename FROM songs
         WHERE user_id = ? AND id IN (${placeholders})
           AND suggestion = 1 AND pending = 1 AND liked = 0
           AND id NOT IN (SELECT song_id FROM playlist_songs)`
      )
      .all(userId, ...clean) as {
      id: number;
      filename: string;
      art_filename: string | null;
    }[];
    const removed: number[] = [];
    db.transaction(() => {
      for (const row of rows) {
        purgeSongRow(db, row, musicDir, artDir);
        removed.push(row.id);
      }
    })();
    return ok(removed);
  } catch (e) {
    return err("internal", `Failed to discard suggestions: ${(e as Error).message}`);
  }
}

// Safety-net sweep (runs on boot + on an interval): removes un-kept suggestion
// tracks that were played but never kept, liked, or added to a playlist.
// Catches orphans the client failed to discard (closed tab, crash, offline).
// The 10-minute age guard means it only ever touches genuinely stale rows, so
// it can't race a suggestion the listener is still hearing (the client discards
// those immediately on skip). Scoped globally since it runs off a timer, not a
// request. Returns the count removed.
export function sweepStaleSuggestions(
  db: Database,
  musicDir: string,
  artDir: string
): number {
  try {
    const rows = db
      .prepare(
        `SELECT id, filename, art_filename FROM songs
         WHERE suggestion = 1 AND pending = 1 AND liked = 0
           AND last_played_at IS NOT NULL
           AND last_played_at < datetime('now', '-10 minutes')
           AND id NOT IN (SELECT song_id FROM playlist_songs)`
      )
      .all() as {
      id: number;
      filename: string;
      art_filename: string | null;
    }[];
    db.transaction(() => {
      for (const row of rows) purgeSongRow(db, row, musicDir, artDir);
    })();
    return rows.length;
  } catch {
    return 0;
  }
}

// Information needed by the HTTP layer to stream or download a song's file.
export interface SongFile {
  path: string;
  size: number;
  contentType: string;
  originalFilename: string;
}

// Resolves a song's on-disk audio file for streaming. The storage directory is
// passed in so the core stays independent of environment configuration.
export function resolveSongFile(
  db: Database,
  id: number,
  musicDir: string,
  userId: string
): Result<SongFile> {
  const songResult = getSong(db, id, userId);
  if (!songResult.ok) return songResult;

  const path = join(musicDir, songResult.value.filename);
  if (!existsSync(path)) {
    return err("not_found", `Audio file for song ${id} is missing on disk`);
  }

  const ext = extname(path).toLowerCase();
  const contentType = ext === ".wav" ? "audio/wav" : "audio/mpeg";

  // Ensure the download name carries an extension so the OS recognises it.
  const name = songResult.value.originalFilename;
  const originalFilename = extname(name) ? name : `${name}${ext}`;

  return ok({
    path,
    size: statSync(path).size,
    contentType,
    originalFilename,
  });
}

// Resolves a song's audio file by id WITHOUT an ownership check. The caller
// must authorize access first (owner or an active share).
export function resolveSongFileById(
  db: Database,
  id: number,
  musicDir: string
): Result<SongFile> {
  const row = db
    .prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ?`)
    .get(id) as SongRow | undefined;
  if (!row) return err("not_found", `Song ${id} not found`);

  const song = rowToSong(row);
  const path = join(musicDir, song.filename);
  if (!existsSync(path)) {
    return err("not_found", `Audio file for song ${id} is missing on disk`);
  }
  const ext = extname(path).toLowerCase();
  const contentType = ext === ".wav" ? "audio/wav" : "audio/mpeg";
  const name = song.originalFilename;
  const originalFilename = extname(name) ? name : `${name}${ext}`;
  return ok({ path, size: statSync(path).size, contentType, originalFilename });
}

// Resolves a song's album art by id WITHOUT an ownership check.
export function resolveSongArtById(
  db: Database,
  id: number,
  artDir: string
): Result<{ path: string; contentType: string }> {
  const row = db
    .prepare("SELECT art_filename FROM songs WHERE id = ?")
    .get(id) as { art_filename: string | null } | undefined;
  if (!row) return err("not_found", `Song ${id} not found`);
  if (!row.art_filename) return err("not_found", "Song has no album art");
  const path = join(artDir, row.art_filename);
  if (!existsSync(path)) return err("not_found", "Art file missing on disk");
  const contentType = artContentType(path);
  return ok({ path, contentType });
}

// Records a generated canvas clip's filename for a song (owner-scoped). Returns
// the updated song plus the previous clip filename (if any) so the caller can
// delete the replaced file from disk.
export function setSongClip(
  db: Database,
  id: number,
  userId: string,
  clipFilename: string | null
): Result<{ song: Song; oldClip: string | null }> {
  const existing = getSong(db, id, userId);
  if (!existing.ok) return existing;
  try {
    const row = db
      .prepare("SELECT clip_filename FROM songs WHERE id = ? AND user_id = ?")
      .get(id, userId) as { clip_filename: string | null } | undefined;
    db.prepare(
      "UPDATE songs SET clip_filename = ? WHERE id = ? AND user_id = ?"
    ).run(clipFilename, id, userId);
    const updated = getSong(db, id, userId);
    if (!updated.ok) return updated;
    return ok({ song: updated.value, oldClip: row?.clip_filename ?? null });
  } catch (e) {
    return err("internal", `Failed to set clip: ${(e as Error).message}`);
  }
}

// Toggles whether a song's clip is shown in the expanded player (owner-scoped).
export function setSongClipDisabled(
  db: Database,
  id: number,
  userId: string,
  disabled: boolean
): Result<Song> {
  try {
    const info = db
      .prepare(
        "UPDATE songs SET clip_disabled = ? WHERE id = ? AND user_id = ?"
      )
      .run(disabled ? 1 : 0, id, userId);
    if (info.changes === 0) return err("not_found", `Song ${id} not found`);
    return getSong(db, id, userId);
  } catch (e) {
    return err("internal", `Failed to update clip setting: ${(e as Error).message}`);
  }
}

// Resolves a song's canvas clip file by id WITHOUT an ownership check (access is
// gated by canAccessSong at the route, matching the art/stream media routes).
export function resolveSongClipById(
  db: Database,
  id: number,
  clipsDir: string
): Result<{ path: string }> {
  const row = db
    .prepare("SELECT clip_filename FROM songs WHERE id = ?")
    .get(id) as { clip_filename: string | null } | undefined;
  if (!row) return err("not_found", `Song ${id} not found`);
  if (!row.clip_filename) return err("not_found", "Song has no clip");
  const path = join(clipsDir, row.clip_filename);
  if (!existsSync(path)) return err("not_found", "Clip file missing on disk");
  return ok({ path });
}

// Updates a song's editable metadata (name, artist, album). Only fields that
// are provided are changed; the stored audio file on disk is untouched.
export function updateSong(
  db: Database,
  id: number,
  fields: {
    originalFilename?: string;
    artist?: string;
    artists?: string[]; // ordered; preferred over `artist` when provided
    album?: string;
  },
  userId: string
): Result<Song> {
  const existing = getSong(db, id, userId);
  if (!existing.ok) return existing;

  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (fields.originalFilename !== undefined) {
    const name = fields.originalFilename.trim();
    if (!name) return err("validation", "Song name cannot be empty");
    sets.push("original_filename = ?");
    values.push(name);
  }
  if (fields.album !== undefined) {
    const album = fields.album.trim();
    sets.push("album = ?");
    values.push(album || null);
  }

  // The artist list is managed relationally (song_artists) with the display
  // string kept in sync by syncSongArtists — so it's handled apart from the
  // plain-column sets above. Accept the ordered `artists`, or a single legacy
  // `artist` string as a one-element list.
  const artistNames =
    fields.artists !== undefined
      ? fields.artists
      : fields.artist !== undefined
        ? fields.artist.trim()
          ? [fields.artist]
          : []
        : undefined;

  if (sets.length === 0 && artistNames === undefined) return existing; // nothing

  try {
    db.transaction(() => {
      if (sets.length > 0) {
        db.prepare(
          `UPDATE songs SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
        ).run(...values, id, userId);
      }
      if (artistNames !== undefined) {
        syncSongArtists(db, id, userId, artistNames);
      }
    })();
    return getSong(db, id, userId);
  } catch (e) {
    return err("internal", `Failed to update song: ${(e as Error).message}`);
  }
}

// Bulk-updates editable metadata (artist, album) across many songs at once.
// Only provided fields are changed; blank/omitted fields leave a song's value
// untouched. The whole batch is applied in a single transaction, so if any one
// song fails (e.g. not owned by the user) nothing is written.
export function updateSongsBulk(
  db: Database,
  ids: number[],
  fields: { artist?: string; artists?: string[]; album?: string },
  userId: string
): Result<Song[]> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return err("validation", "No songs selected");
  }
  if (
    fields.artist === undefined &&
    fields.artists === undefined &&
    fields.album === undefined
  ) {
    return err("validation", "No fields to update");
  }

  try {
    const run = db.transaction((): Song[] => {
      const updated: Song[] = [];
      for (const id of ids) {
        const r = updateSong(db, id, fields, userId);
        if (!r.ok) throw r.error; // abort & roll back the whole batch
        updated.push(r.value);
      }
      return updated;
    });
    return ok(run());
  } catch (e) {
    // A rolled-back AppError thrown from inside the transaction.
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      const appErr = e as AppError;
      return err(appErr.code, appErr.message);
    }
    return err("internal", `Failed to update songs: ${(e as Error).message}`);
  }
}

// Sets a song's liked flag.
export function setLiked(
  db: Database,
  id: number,
  liked: boolean,
  userId: string
): Result<Song> {
  const existing = getSong(db, id, userId);
  if (!existing.ok) return existing;
  try {
    db.prepare("UPDATE songs SET liked = ? WHERE id = ? AND user_id = ?").run(
      liked ? 1 : 0,
      id,
      userId
    );
    return getSong(db, id, userId);
  } catch (e) {
    return err("internal", `Failed to set liked: ${(e as Error).message}`);
  }
}

// Records a play: increments play_count and sets last_played_at to now.
export function recordPlay(
  db: Database,
  id: number,
  userId: string
): Result<Song> {
  // Anyone who can access the song (owner, collaborator, or someone it's shared
  // with) counts a play, so the play count reflects everyone with access.
  if (!canAccessSong(db, userId, id)) {
    return err("not_found", `Song ${id} not found`);
  }
  try {
    db.prepare(
      "UPDATE songs SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?"
    ).run(id);
    const row = db
      .prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ?`)
      .get(id) as SongRow | undefined;
    if (!row) return err("not_found", `Song ${id} not found`);
    return ok(attachArtists(db, [rowToSong(row)])[0]);
  } catch (e) {
    return err("internal", `Failed to record play: ${(e as Error).message}`);
  }
}

// Sets (or clears) a song's album art filename (owner-scoped). Returns the
// updated song plus the previous art filename, so the caller can delete it.
export function setSongArt(
  db: Database,
  id: number,
  userId: string,
  artFilename: string | null
): Result<{ song: Song; oldArt: string | null }> {
  const existing = getSong(db, id, userId);
  if (!existing.ok) return existing;
  try {
    const row = db
      .prepare("SELECT art_filename FROM songs WHERE id = ? AND user_id = ?")
      .get(id, userId) as { art_filename: string | null } | undefined;
    db.prepare(
      "UPDATE songs SET art_filename = ? WHERE id = ? AND user_id = ?"
    ).run(artFilename, id, userId);
    const updated = getSong(db, id, userId);
    if (!updated.ok) return updated;
    return ok({ song: updated.value, oldArt: row?.art_filename ?? null });
  } catch (e) {
    return err("internal", `Failed to set art: ${(e as Error).message}`);
  }
}

// Resolves a song's album art file for serving, if present.
export function resolveSongArt(
  db: Database,
  id: number,
  artDir: string,
  userId: string
): Result<{ path: string; contentType: string }> {
  if (!Number.isInteger(id) || id <= 0) {
    return err("validation", "Invalid song id");
  }
  const row = db
    .prepare("SELECT art_filename FROM songs WHERE id = ? AND user_id = ?")
    .get(id, userId) as { art_filename: string | null } | undefined;
  if (!row) return err("not_found", `Song ${id} not found`);
  if (!row.art_filename) return err("not_found", "Song has no album art");

  const path = join(artDir, row.art_filename);
  if (!existsSync(path)) return err("not_found", "Art file missing on disk");

  const contentType = artContentType(path);
  return ok({ path, contentType });
}

// Deletes a song: removes its database row (cascading playlist references via
// the foreign key) and its audio file from disk (best-effort).
export function deleteSong(
  db: Database,
  id: number,
  musicDir: string,
  artDir: string,
  userId: string,
  clipsDir?: string
): Result<void> {
  const songResult = getSong(db, id, userId);
  if (!songResult.ok) return songResult;

  // Capture the art + clip filenames before deleting the row.
  const fileRow = db
    .prepare(
      "SELECT art_filename, clip_filename FROM songs WHERE id = ? AND user_id = ?"
    )
    .get(id, userId) as
    | { art_filename: string | null; clip_filename: string | null }
    | undefined;

  // Artists this song credits, captured before the row (and its cascading
  // song_artists links) go away, so we can prune any left with no references.
  const priorArtistIds = (
    db
      .prepare("SELECT artist_id FROM song_artists WHERE song_id = ?")
      .all(id) as { artist_id: number }[]
  ).map((r) => r.artist_id);

  try {
    db.prepare("DELETE FROM songs WHERE id = ? AND user_id = ?").run(id, userId);
    pruneOrphanArtists(db, priorArtistIds);
    const removeFile = (p: string) => {
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* best-effort cleanup */
        }
      }
    };
    removeFile(join(musicDir, songResult.value.filename));
    if (fileRow?.art_filename) removeFile(join(artDir, fileRow.art_filename));
    if (clipsDir && fileRow?.clip_filename) {
      removeFile(join(clipsDir, fileRow.clip_filename));
    }
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to delete song: ${(e as Error).message}`);
  }
}

// Looks up a single song by id, scoped to its owner.
export function getSong(
  db: Database,
  id: number,
  userId: string
): Result<Song> {
  if (!Number.isInteger(id) || id <= 0) {
    return err("validation", "Invalid song id");
  }
  try {
    const row = db
      .prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ? AND user_id = ?`)
      .get(id, userId) as SongRow | undefined;
    if (!row) {
      return err("not_found", `Song ${id} not found`);
    }
    return ok(attachArtists(db, [rowToSong(row)])[0]);
  } catch (e) {
    return err("internal", `Failed to get song: ${(e as Error).message}`);
  }
}
