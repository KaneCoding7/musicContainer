import type { Database } from "better-sqlite3";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import type { Song } from "../types.js";
import { err, ok, type Result } from "./result.js";

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
}

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    uploadedAt: row.uploaded_at,
  };
}

// Records an already-stored audio file in the database and returns the song.
export function recordSong(
  db: Database,
  params: { filename: string; originalFilename: string }
): Result<Song> {
  const filename = params.filename.trim();
  const originalFilename = params.originalFilename.trim();
  if (!filename || !originalFilename) {
    return err("validation", "filename and originalFilename are required");
  }

  try {
    const info = db
      .prepare(
        "INSERT INTO songs (filename, original_filename) VALUES (?, ?)"
      )
      .run(filename, originalFilename);

    const row = db
      .prepare(
        "SELECT id, filename, original_filename, uploaded_at FROM songs WHERE id = ?"
      )
      .get(info.lastInsertRowid as number) as SongRow | undefined;

    if (!row) {
      return err("internal", "Song was inserted but could not be read back");
    }
    return ok(rowToSong(row));
  } catch (e) {
    return err("internal", `Failed to record song: ${(e as Error).message}`);
  }
}

// Returns all songs, newest first.
export function listSongs(db: Database): Result<Song[]> {
  try {
    const rows = db
      .prepare(
        "SELECT id, filename, original_filename, uploaded_at FROM songs ORDER BY datetime(uploaded_at) DESC, id DESC"
      )
      .all() as SongRow[];
    return ok(rows.map(rowToSong));
  } catch (e) {
    return err("internal", `Failed to list songs: ${(e as Error).message}`);
  }
}

// Information needed by the HTTP layer to stream a song's audio file.
export interface SongFile {
  path: string;
  size: number;
  contentType: string;
}

// Resolves a song's on-disk audio file for streaming. The storage directory is
// passed in so the core stays independent of environment configuration.
export function resolveSongFile(
  db: Database,
  id: number,
  musicDir: string
): Result<SongFile> {
  const songResult = getSong(db, id);
  if (!songResult.ok) return songResult;

  const path = join(musicDir, songResult.value.filename);
  if (!existsSync(path)) {
    return err("not_found", `Audio file for song ${id} is missing on disk`);
  }

  const ext = extname(path).toLowerCase();
  const contentType = ext === ".wav" ? "audio/wav" : "audio/mpeg";
  return ok({ path, size: statSync(path).size, contentType });
}

// Renames a song's user-facing name (its original_filename). The stored file
// on disk is untouched.
export function renameSong(
  db: Database,
  id: number,
  newName: string
): Result<Song> {
  const trimmed = newName.trim();
  if (!trimmed) {
    return err("validation", "Song name is required");
  }

  const existing = getSong(db, id);
  if (!existing.ok) return existing;

  try {
    db.prepare("UPDATE songs SET original_filename = ? WHERE id = ?").run(
      trimmed,
      id
    );
    return getSong(db, id);
  } catch (e) {
    return err("internal", `Failed to rename song: ${(e as Error).message}`);
  }
}

// Deletes a song: removes its database row (cascading playlist references via
// the foreign key) and its audio file from disk (best-effort).
export function deleteSong(
  db: Database,
  id: number,
  musicDir: string
): Result<void> {
  const songResult = getSong(db, id);
  if (!songResult.ok) return songResult;

  try {
    db.prepare("DELETE FROM songs WHERE id = ?").run(id);
    const path = join(musicDir, songResult.value.filename);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        /* row already gone; orphaned file is harmless */
      }
    }
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to delete song: ${(e as Error).message}`);
  }
}

// Looks up a single song by id.
export function getSong(db: Database, id: number): Result<Song> {
  if (!Number.isInteger(id) || id <= 0) {
    return err("validation", "Invalid song id");
  }
  try {
    const row = db
      .prepare(
        "SELECT id, filename, original_filename, uploaded_at FROM songs WHERE id = ?"
      )
      .get(id) as SongRow | undefined;
    if (!row) {
      return err("not_found", `Song ${id} not found`);
    }
    return ok(rowToSong(row));
  } catch (e) {
    return err("internal", `Failed to get song: ${(e as Error).message}`);
  }
}
