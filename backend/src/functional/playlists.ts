import { existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import type { Database } from "better-sqlite3";
import type { Playlist, Song } from "../types.js";
import { err, ok, type Result } from "./result.js";
import { isOrgMemberOf } from "./orgPlaylists.js";

interface PlaylistRow {
  id: number;
  name: string;
  created_at: string;
  image_filename?: string | null;
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
  play_count: number;
  last_played_at: string | null;
  liked: number;
  loudness: number | null;
  sort_order: number | null;
  source_url: string | null;
  clip_filename: string | null;
  clip_disabled: number;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    hasImage: !!row.image_filename,
  };
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
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
    liked: row.liked === 1,
    loudness: row.loudness,
    sortOrder: row.sort_order,
    hasSource: row.source_url !== null,
    hasClip: row.clip_filename !== null,
    clipDisabled: row.clip_disabled === 1,
    sourceUrl: row.source_url,
  };
}

// Creates a new playlist with a non-empty name.
export function createPlaylist(
  db: Database,
  name: string,
  userId: string
): Result<Playlist> {
  const trimmed = name.trim();
  if (!trimmed) {
    return err("validation", "Playlist name is required");
  }
  try {
    const info = db
      .prepare("INSERT INTO playlists (name, user_id) VALUES (?, ?)")
      .run(trimmed, userId);
    const row = db
      .prepare(
        "SELECT id, name, created_at, image_filename FROM playlists WHERE id = ?"
      )
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
  copied_from: number | null;
  copied_from_owner: string | null;
  shared: number;
}

// Lists a user's playlists (with track count + cover art song), newest first.
export function listPlaylists(db: Database, userId: string): Result<Playlist[]> {
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.image_filename, p.copied_from,
                (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id)
                  AS track_count,
                (SELECT ps.song_id FROM playlist_songs ps
                   JOIN songs s ON s.id = ps.song_id
                   WHERE ps.playlist_id = p.id AND s.art_filename IS NOT NULL
                   ORDER BY ps.position ASC LIMIT 1) AS cover_song_id,
                (SELECT u.name FROM playlists op
                   JOIN "user" u ON u.id = op.user_id
                   WHERE op.id = p.copied_from) AS copied_from_owner,
                EXISTS (SELECT 1 FROM playlist_shares ps2
                          WHERE ps2.playlist_id = p.id) AS shared
         FROM playlists p
         WHERE p.user_id = ?
         ORDER BY datetime(p.created_at) DESC, p.id DESC`
      )
      .all(userId) as PlaylistListRow[];
    return ok(
      rows.map((row) => ({
        ...rowToPlaylist(row),
        trackCount: row.track_count,
        coverSongId: row.cover_song_id,
        copiedFrom: row.copied_from,
        copiedFromOwner: row.copied_from_owner,
        shared: row.shared === 1,
      }))
    );
  } catch (e) {
    return err("internal", `Failed to list playlists: ${(e as Error).message}`);
  }
}

// Verifies a playlist exists and belongs to the user, returning it.
export function getPlaylist(
  db: Database,
  id: number,
  userId: string
): Result<Playlist> {
  if (!Number.isInteger(id) || id <= 0) {
    return err("validation", "Invalid playlist id");
  }
  try {
    const row = db
      .prepare(
        "SELECT id, name, created_at, image_filename FROM playlists WHERE id = ? AND user_id = ?"
      )
      .get(id, userId) as PlaylistRow | undefined;
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
  name: string,
  userId: string
): Result<Playlist> {
  const trimmed = name.trim();
  if (!trimmed) return err("validation", "Playlist name is required");
  const existing = getPlaylist(db, id, userId);
  if (!existing.ok) return existing;
  try {
    db.prepare(
      "UPDATE playlists SET name = ? WHERE id = ? AND user_id = ?"
    ).run(trimmed, id, userId);
    return getPlaylist(db, id, userId);
  } catch (e) {
    return err("internal", `Failed to rename playlist: ${(e as Error).message}`);
  }
}

// Deletes a playlist (its song links drop via ON DELETE CASCADE).
export function deletePlaylist(
  db: Database,
  id: number,
  userId: string,
  imgDir?: string
): Result<void> {
  const existing = getPlaylist(db, id, userId);
  if (!existing.ok) return existing;
  const row = db
    .prepare("SELECT image_filename FROM playlists WHERE id = ? AND user_id = ?")
    .get(id, userId) as { image_filename: string | null } | undefined;
  try {
    db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(
      id,
      userId
    );
    if (imgDir && row?.image_filename) {
      const p = join(imgDir, row.image_filename);
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* best-effort */
        }
      }
    }
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to delete playlist: ${(e as Error).message}`);
  }
}

// Sets (or clears) a playlist's custom cover image filename (owner-scoped).
// Returns the updated playlist plus the previous image filename for cleanup.
export function setPlaylistImage(
  db: Database,
  id: number,
  userId: string,
  filename: string | null
): Result<{ playlist: Playlist; oldImage: string | null }> {
  const existing = getPlaylist(db, id, userId);
  if (!existing.ok) return existing;
  try {
    const row = db
      .prepare(
        "SELECT image_filename FROM playlists WHERE id = ? AND user_id = ?"
      )
      .get(id, userId) as { image_filename: string | null } | undefined;
    db.prepare(
      "UPDATE playlists SET image_filename = ? WHERE id = ? AND user_id = ?"
    ).run(filename, id, userId);
    const updated = getPlaylist(db, id, userId);
    if (!updated.ok) return updated;
    return ok({ playlist: updated.value, oldImage: row?.image_filename ?? null });
  } catch (e) {
    return err("internal", `Failed to set playlist image: ${(e as Error).message}`);
  }
}

// Resolves a playlist's custom image file for serving (owner-scoped).
export function resolvePlaylistImage(
  db: Database,
  id: number,
  userId: string,
  imgDir: string
): Result<{ path: string; contentType: string }> {
  const row = db
    .prepare("SELECT image_filename, user_id FROM playlists WHERE id = ?")
    .get(id) as { image_filename: string | null; user_id: string } | undefined;
  if (!row) return err("not_found", `Playlist ${id} not found`);
  // Owner, anyone the playlist is shared with, or an org member may view the cover.
  if (row.user_id !== userId) {
    const shared = db
      .prepare(
        "SELECT 1 AS x FROM playlist_shares WHERE playlist_id = ? AND shared_with = ?"
      )
      .get(id, userId);
    if (!shared && !isOrgMemberOf(db, id, userId)) {
      return err("not_found", `Playlist ${id} not found`);
    }
  }
  if (!row.image_filename) return err("not_found", "Playlist has no image");
  const path = join(imgDir, row.image_filename);
  if (!existsSync(path)) return err("not_found", "Image file missing on disk");
  const ext = extname(path).toLowerCase();
  const contentType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return ok({ path, contentType });
}

// True if the user may edit a playlist: they own it, or hold an editor share.
export function canEditPlaylist(
  db: Database,
  playlistId: number,
  userId: string
): boolean {
  const owned = db
    .prepare("SELECT 1 AS x FROM playlists WHERE id = ? AND user_id = ?")
    .get(playlistId, userId);
  if (owned) return true;
  const editor = db
    .prepare(
      "SELECT 1 AS x FROM playlist_shares WHERE playlist_id = ? AND shared_with = ? AND can_edit = 1"
    )
    .get(playlistId, userId);
  if (editor) return true;
  // Any member of an org/team playlist (same email domain) may add tracks.
  return isOrgMemberOf(db, playlistId, userId);
}

// Ensures the user can edit the playlist (owner or editor); not_found otherwise.
function requireEditAccess(
  db: Database,
  playlistId: number,
  userId: string
): Result<void> {
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    return err("validation", "Invalid playlist id");
  }
  if (canEditPlaylist(db, playlistId, userId)) return ok(undefined);
  return err("not_found", `Playlist ${playlistId} not found`);
}

// Returns a playlist's songs in order, WITHOUT an ownership check. Callers must
// have already authorized access (owner or an active share).
export function songsInPlaylist(
  db: Database,
  playlistId: number,
  viewerId?: string
): Song[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.filename, s.original_filename, s.uploaded_at,
              s.artist, s.album, s.art_filename, s.duration,
              s.play_count, s.last_played_at, s.liked, s.loudness, s.sort_order,
              s.source_url, s.clip_filename, s.clip_disabled, au.name AS added_by_name,
              ps.added_by AS added_by_id, s.user_id AS song_user_id
       FROM playlist_songs ps
       JOIN songs s ON s.id = ps.song_id
       LEFT JOIN "user" au ON au.id = ps.added_by
       WHERE ps.playlist_id = ?
       ORDER BY ps.position ASC`
    )
    .all(playlistId) as (SongRow & {
    added_by_name: string | null;
    added_by_id: string | null;
    song_user_id: string | null;
  })[];
  return rows.map((row) => ({
    ...rowToSong(row),
    addedBy: row.added_by_name,
    // Per-song ownership flags (used by org/team playlists). Only meaningful
    // when a viewer is supplied.
    addedByMe: viewerId != null && row.added_by_id === viewerId,
    ownedByMe: viewerId != null && row.song_user_id === viewerId,
  }));
}

// Returns the songs in a playlist (owner-scoped), ordered by their position.
export function getPlaylistSongs(
  db: Database,
  playlistId: number,
  userId: string
): Result<Song[]> {
  const exists = getPlaylist(db, playlistId, userId);
  if (!exists.ok) return exists;
  try {
    return ok(songsInPlaylist(db, playlistId));
  } catch (e) {
    return err("internal", `Failed to get playlist songs: ${(e as Error).message}`);
  }
}

// Appends a song to the end of a playlist. Songs are unique within a playlist.
export function addSongToPlaylist(
  db: Database,
  playlistId: number,
  songId: number,
  userId: string
): Result<void> {
  const access = requireEditAccess(db, playlistId, userId);
  if (!access.ok) return access;
  if (!Number.isInteger(songId) || songId <= 0) {
    return err("validation", "Invalid song id");
  }

  try {
    // Users may only add songs from their own library.
    const song = db
      .prepare("SELECT id FROM songs WHERE id = ? AND user_id = ?")
      .get(songId, userId) as { id: number } | undefined;
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
      "INSERT INTO playlist_songs (playlist_id, song_id, position, added_by) VALUES (?, ?, ?, ?)"
    ).run(playlistId, songId, next, userId);

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
  songIds: number[],
  userId: string
): Result<void> {
  const access = requireEditAccess(db, playlistId, userId);
  if (!access.ok) return access;
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
  songIds: number[],
  userId: string
): Result<{ added: number }> {
  const access = requireEditAccess(db, playlistId, userId);
  if (!access.ok) return access;
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
      const songExists = db.prepare(
        "SELECT id FROM songs WHERE id = ? AND user_id = ?"
      );
      const already = db.prepare(
        "SELECT id FROM playlist_songs WHERE playlist_id = ? AND song_id = ?"
      );
      const insert = db.prepare(
        "INSERT INTO playlist_songs (playlist_id, song_id, position, added_by) VALUES (?, ?, ?, ?)"
      );
      for (const songId of ids) {
        if (!Number.isInteger(songId)) continue;
        if (!songExists.get(songId, userId)) continue;
        if (already.get(playlistId, songId)) continue;
        insert.run(playlistId, songId, next++, userId);
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
  songId: number,
  userId: string
): Result<void> {
  const access = requireEditAccess(db, playlistId, userId);
  if (!access.ok) return access;

  // On org/team playlists, members may only remove tracks they themselves added.
  const isOrg = !!db
    .prepare("SELECT 1 AS x FROM playlists WHERE id = ? AND org_domain IS NOT NULL")
    .get(playlistId);

  try {
    const info = isOrg
      ? db
          .prepare(
            "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ? AND added_by = ?"
          )
          .run(playlistId, songId, userId)
      : db
          .prepare(
            "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?"
          )
          .run(playlistId, songId);
    if (info.changes === 0) {
      if (isOrg) {
        return err("validation", "You can only remove tracks you added.");
      }
      return err("not_found", "Song is not in this playlist");
    }
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to remove song: ${(e as Error).message}`);
  }
}
