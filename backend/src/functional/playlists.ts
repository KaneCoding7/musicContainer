import type { Database } from "better-sqlite3";
import type { Playlist, Song } from "../types.js";
import { err, ok, type Result } from "./result.js";

interface PlaylistRow {
  id: number;
  name: string;
  created_at: string;
}

interface SongRow {
  id: number;
  filename: string;
  original_filename: string;
  uploaded_at: string;
  artist: string | null;
  album: string | null;
  art_filename: string | null;
  duration: number | null;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

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
  };
}

// Creates a new playlist with a non-empty name.
export function createPlaylist(db: Database, name: string): Result<Playlist> {
  const trimmed = name.trim();
  if (!trimmed) {
    return err("validation", "Playlist name is required");
  }
  try {
    const info = db
      .prepare("INSERT INTO playlists (name) VALUES (?)")
      .run(trimmed);
    const row = db
      .prepare("SELECT id, name, created_at FROM playlists WHERE id = ?")
      .get(info.lastInsertRowid as number) as PlaylistRow | undefined;
    if (!row) {
      return err("internal", "Playlist created but could not be read back");
    }
    return ok(rowToPlaylist(row));
  } catch (e) {
    return err("internal", `Failed to create playlist: ${(e as Error).message}`);
  }
}

interface PlaylistListRow extends PlaylistRow {
  track_count: number;
  cover_song_id: number | null;
}

// Lists all playlists (with track count + cover art song), newest first.
export function listPlaylists(db: Database): Result<Playlist[]> {
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id)
                  AS track_count,
                (SELECT ps.song_id FROM playlist_songs ps
                   JOIN songs s ON s.id = ps.song_id
                   WHERE ps.playlist_id = p.id AND s.art_filename IS NOT NULL
                   ORDER BY ps.position ASC LIMIT 1) AS cover_song_id
         FROM playlists p
         ORDER BY datetime(p.created_at) DESC, p.id DESC`
      )
      .all() as PlaylistListRow[];
    return ok(
      rows.map((row) => ({
        ...rowToPlaylist(row),
        trackCount: row.track_count,
        coverSongId: row.cover_song_id,
      }))
    );
  } catch (e) {
    return err("internal", `Failed to list playlists: ${(e as Error).message}`);
  }
}

// Verifies a playlist exists, returning it.
export function getPlaylist(db: Database, id: number): Result<Playlist> {
  if (!Number.isInteger(id) || id <= 0) {
    return err("validation", "Invalid playlist id");
  }
  try {
    const row = db
      .prepare("SELECT id, name, created_at FROM playlists WHERE id = ?")
      .get(id) as PlaylistRow | undefined;
    if (!row) return err("not_found", `Playlist ${id} not found`);
    return ok(rowToPlaylist(row));
  } catch (e) {
    return err("internal", `Failed to get playlist: ${(e as Error).message}`);
  }
}

// Renames a playlist.
export function renamePlaylist(
  db: Database,
  id: number,
  name: string
): Result<Playlist> {
  const trimmed = name.trim();
  if (!trimmed) return err("validation", "Playlist name is required");
  const existing = getPlaylist(db, id);
  if (!existing.ok) return existing;
  try {
    db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(trimmed, id);
    return getPlaylist(db, id);
  } catch (e) {
    return err("internal", `Failed to rename playlist: ${(e as Error).message}`);
  }
}

// Deletes a playlist (its song links drop via ON DELETE CASCADE).
export function deletePlaylist(db: Database, id: number): Result<void> {
  const existing = getPlaylist(db, id);
  if (!existing.ok) return existing;
  try {
    db.prepare("DELETE FROM playlists WHERE id = ?").run(id);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to delete playlist: ${(e as Error).message}`);
  }
}

// Returns the songs in a playlist, ordered by their position.
export function getPlaylistSongs(
  db: Database,
  playlistId: number
): Result<Song[]> {
  const exists = getPlaylist(db, playlistId);
  if (!exists.ok) return exists;
  try {
    const rows = db
      .prepare(
        `SELECT s.id, s.filename, s.original_filename, s.uploaded_at,
                s.artist, s.album, s.art_filename, s.duration
         FROM playlist_songs ps
         JOIN songs s ON s.id = ps.song_id
         WHERE ps.playlist_id = ?
         ORDER BY ps.position ASC`
      )
      .all(playlistId) as SongRow[];
    return ok(rows.map(rowToSong));
  } catch (e) {
    return err("internal", `Failed to get playlist songs: ${(e as Error).message}`);
  }
}

// Appends a song to the end of a playlist. Songs are unique within a playlist.
export function addSongToPlaylist(
  db: Database,
  playlistId: number,
  songId: number
): Result<void> {
  const playlist = getPlaylist(db, playlistId);
  if (!playlist.ok) return playlist;
  if (!Number.isInteger(songId) || songId <= 0) {
    return err("validation", "Invalid song id");
  }

  try {
    const song = db
      .prepare("SELECT id FROM songs WHERE id = ?")
      .get(songId) as { id: number } | undefined;
    if (!song) return err("not_found", `Song ${songId} not found`);

    const already = db
      .prepare(
        "SELECT id FROM playlist_songs WHERE playlist_id = ? AND song_id = ?"
      )
      .get(playlistId, songId);
    if (already) {
      return err("conflict", "Song is already in this playlist");
    }

    const { next } = db
      .prepare(
        "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM playlist_songs WHERE playlist_id = ?"
      )
      .get(playlistId) as { next: number };

    db.prepare(
      "INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)"
    ).run(playlistId, songId, next);

    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to add song: ${(e as Error).message}`);
  }
}

// Reorders a playlist's songs to match the given id order (positions become
// 1..n). Ids not in the playlist are ignored; applied in a transaction.
export function reorderPlaylist(
  db: Database,
  playlistId: number,
  songIds: number[]
): Result<void> {
  const playlist = getPlaylist(db, playlistId);
  if (!playlist.ok) return playlist;
  if (!Array.isArray(songIds)) {
    return err("validation", "songIds must be an array");
  }

  try {
    const update = db.prepare(
      "UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?"
    );
    const apply = db.transaction((ids: number[]) => {
      ids.forEach((songId, index) => update.run(index + 1, playlistId, songId));
    });
    apply(songIds);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to reorder playlist: ${(e as Error).message}`);
  }
}

// Adds multiple songs to a playlist in one transaction, appending in order and
// skipping ids that don't exist or are already present. Returns how many were
// actually added.
export function addSongsToPlaylist(
  db: Database,
  playlistId: number,
  songIds: number[]
): Result<{ added: number }> {
  const playlist = getPlaylist(db, playlistId);
  if (!playlist.ok) return playlist;
  if (!Array.isArray(songIds)) {
    return err("validation", "songIds must be an array");
  }

  try {
    let added = 0;
    const apply = db.transaction((ids: number[]) => {
      let { next } = db
        .prepare(
          "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM playlist_songs WHERE playlist_id = ?"
        )
        .get(playlistId) as { next: number };
      const songExists = db.prepare("SELECT id FROM songs WHERE id = ?");
      const already = db.prepare(
        "SELECT id FROM playlist_songs WHERE playlist_id = ? AND song_id = ?"
      );
      const insert = db.prepare(
        "INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)"
      );
      for (const songId of ids) {
        if (!Number.isInteger(songId)) continue;
        if (!songExists.get(songId)) continue;
        if (already.get(playlistId, songId)) continue;
        insert.run(playlistId, songId, next++);
        added++;
      }
    });
    apply(songIds.map(Number));
    return ok({ added });
  } catch (e) {
    return err("internal", `Failed to add songs: ${(e as Error).message}`);
  }
}

// Removes a song from a playlist.
export function removeSongFromPlaylist(
  db: Database,
  playlistId: number,
  songId: number
): Result<void> {
  const playlist = getPlaylist(db, playlistId);
  if (!playlist.ok) return playlist;

  try {
    const info = db
      .prepare(
        "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?"
      )
      .run(playlistId, songId);
    if (info.changes === 0) {
      return err("not_found", "Song is not in this playlist");
    }
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to remove song: ${(e as Error).message}`);
  }
}
