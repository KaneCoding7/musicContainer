import type { Database } from "better-sqlite3";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import type { Song } from "../types.js";
import { err, ok, type AppError, type Result } from "./result.js";

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
}

const SONG_COLUMNS =
  "id, filename, original_filename, uploaded_at, artist, album, art_filename, duration, play_count, last_played_at, liked, loudness, sort_order";

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    uploadedAt: row.uploaded_at,
    artist: row.artist,
    album: row.album,
    hasArt: row.art_filename !== null,
    duration: row.duration,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
    liked: row.liked === 1,
    loudness: row.loudness,
    sortOrder: row.sort_order,
  };
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
        "SELECT id, filename FROM songs WHERE user_id = ? AND loudness IS NULL"
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
    album?: string | null;
    artFilename?: string | null;
    duration?: number | null;
  }
): Result<Song> {
  const filename = params.filename.trim();
  const originalFilename = params.originalFilename.trim();
  if (!filename || !originalFilename) {
    return err("validation", "filename and originalFilename are required");
  }

  try {
    const info = db
      .prepare(
        "INSERT INTO songs (filename, original_filename, artist, album, art_filename, duration, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        filename,
        originalFilename,
        params.artist ?? null,
        params.album ?? null,
        params.artFilename ?? null,
        params.duration ?? null,
        params.userId
      );

    const row = db
      .prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ?`)
      .get(info.lastInsertRowid as number) as SongRow | undefined;

    if (!row) {
      return err("internal", "Song was inserted but could not be read back");
    }
    return ok(rowToSong(row));
  } catch (e) {
    return err("internal", `Failed to record song: ${(e as Error).message}`);
  }
}

// Returns all of a user's songs, newest first.
export function listSongs(db: Database, userId: string): Result<Song[]> {
  try {
    const rows = db
      .prepare(
        `SELECT ${SONG_COLUMNS} FROM songs WHERE user_id = ? ORDER BY datetime(uploaded_at) DESC, id DESC`
      )
      .all(userId) as SongRow[];
    return ok(rows.map(rowToSong));
  } catch (e) {
    return err("internal", `Failed to list songs: ${(e as Error).message}`);
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

// Updates a song's editable metadata (name, artist, album). Only fields that
// are provided are changed; the stored audio file on disk is untouched.
export function updateSong(
  db: Database,
  id: number,
  fields: { originalFilename?: string; artist?: string; album?: string },
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
  if (fields.artist !== undefined) {
    const artist = fields.artist.trim();
    sets.push("artist = ?");
    values.push(artist || null);
  }
  if (fields.album !== undefined) {
    const album = fields.album.trim();
    sets.push("album = ?");
    values.push(album || null);
  }

  if (sets.length === 0) return existing; // nothing to change

  try {
    db.prepare(
      `UPDATE songs SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    ).run(...values, id, userId);
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
  fields: { artist?: string; album?: string },
  userId: string
): Result<Song[]> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return err("validation", "No songs selected");
  }
  if (fields.artist === undefined && fields.album === undefined) {
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
  const existing = getSong(db, id, userId);
  if (!existing.ok) return existing;
  try {
    db.prepare(
      "UPDATE songs SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).run(id, userId);
    return getSong(db, id, userId);
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
  userId: string
): Result<void> {
  const songResult = getSong(db, id, userId);
  if (!songResult.ok) return songResult;

  // Capture the art filename before deleting the row.
  const artRow = db
    .prepare("SELECT art_filename FROM songs WHERE id = ? AND user_id = ?")
    .get(id, userId) as { art_filename: string | null } | undefined;

  try {
    db.prepare("DELETE FROM songs WHERE id = ? AND user_id = ?").run(id, userId);
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
    if (artRow?.art_filename) removeFile(join(artDir, artRow.art_filename));
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
    return ok(rowToSong(row));
  } catch (e) {
    return err("internal", `Failed to get song: ${(e as Error).message}`);
  }
}
