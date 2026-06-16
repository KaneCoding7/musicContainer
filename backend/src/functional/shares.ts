import type { Database } from "better-sqlite3";
import type { Playlist, Song } from "../types.js";
import { getPlaylist, songsInPlaylist } from "./playlists.js";
import { err, ok, type Result } from "./result.js";

export interface ShareUser {
  id: string;
  name: string;
  email: string;
}

// A playlist shared with the current user, including who shared it.
export interface SharedPlaylist extends Playlist {
  ownerName: string;
}

function findUserByEmail(db: Database, email: string): ShareUser | null {
  const row = db
    .prepare('SELECT id, name, email FROM "user" WHERE email = ?')
    .get(email.trim().toLowerCase()) as ShareUser | undefined;
  return row ?? null;
}

// Shares a playlist (owned by ownerId) with the user at recipientEmail.
export function sharePlaylist(
  db: Database,
  ownerId: string,
  playlistId: number,
  recipientEmail: string
): Result<ShareUser> {
  const playlist = getPlaylist(db, playlistId, ownerId);
  if (!playlist.ok) return playlist;

  const recipient = findUserByEmail(db, recipientEmail);
  if (!recipient) return err("not_found", "No user with that email");
  if (recipient.id === ownerId) {
    return err("validation", "You can't share a playlist with yourself");
  }

  try {
    db.prepare(
      "INSERT OR IGNORE INTO playlist_shares (playlist_id, shared_with) VALUES (?, ?)"
    ).run(playlistId, recipient.id);
    return ok(recipient);
  } catch (e) {
    return err("internal", `Failed to share playlist: ${(e as Error).message}`);
  }
}

// Revokes a share (owner only).
export function unsharePlaylist(
  db: Database,
  ownerId: string,
  playlistId: number,
  recipientId: string
): Result<void> {
  const playlist = getPlaylist(db, playlistId, ownerId);
  if (!playlist.ok) return playlist;
  try {
    db.prepare(
      "DELETE FROM playlist_shares WHERE playlist_id = ? AND shared_with = ?"
    ).run(playlistId, recipientId);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to revoke share: ${(e as Error).message}`);
  }
}

// Lists the users a playlist is shared with (owner only).
export function listPlaylistShares(
  db: Database,
  ownerId: string,
  playlistId: number
): Result<ShareUser[]> {
  const playlist = getPlaylist(db, playlistId, ownerId);
  if (!playlist.ok) return playlist;
  try {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email
         FROM playlist_shares ps
         JOIN "user" u ON u.id = ps.shared_with
         WHERE ps.playlist_id = ?
         ORDER BY ps.created_at ASC`
      )
      .all(playlistId) as ShareUser[];
    return ok(rows);
  } catch (e) {
    return err("internal", `Failed to list shares: ${(e as Error).message}`);
  }
}

// Lists playlists shared with the given user (with owner name + cover/count).
export function listSharedWithMe(
  db: Database,
  userId: string
): Result<SharedPlaylist[]> {
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.created_at, u.name AS owner_name,
                (SELECT COUNT(*) FROM playlist_songs x WHERE x.playlist_id = p.id)
                  AS track_count,
                (SELECT x.song_id FROM playlist_songs x
                   JOIN songs s ON s.id = x.song_id
                   WHERE x.playlist_id = p.id AND s.art_filename IS NOT NULL
                   ORDER BY x.position ASC LIMIT 1) AS cover_song_id
         FROM playlist_shares ps
         JOIN playlists p ON p.id = ps.playlist_id
         JOIN "user" u ON u.id = p.user_id
         WHERE ps.shared_with = ?
         ORDER BY datetime(ps.created_at) DESC`
      )
      .all(userId) as {
      id: number;
      name: string;
      created_at: string;
      owner_name: string;
      track_count: number;
      cover_song_id: number | null;
    }[];
    return ok(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        ownerName: r.owner_name,
        trackCount: r.track_count,
        coverSongId: r.cover_song_id,
      }))
    );
  } catch (e) {
    return err("internal", `Failed to list shared playlists: ${(e as Error).message}`);
  }
}

// True if a playlist is shared with the user.
export function isPlaylistSharedWith(
  db: Database,
  playlistId: number,
  userId: string
): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS x FROM playlist_shares WHERE playlist_id = ? AND shared_with = ?"
    )
    .get(playlistId, userId);
  return !!row;
}

// Returns the songs of a playlist shared with the user (read-only access).
export function getSharedPlaylistSongs(
  db: Database,
  userId: string,
  playlistId: number
): Result<Song[]> {
  if (!isPlaylistSharedWith(db, playlistId, userId)) {
    return err("not_found", `Playlist ${playlistId} not found`);
  }
  try {
    return ok(songsInPlaylist(db, playlistId));
  } catch (e) {
    return err("internal", `Failed to get songs: ${(e as Error).message}`);
  }
}

// True if the user may access a song's media: they own it, OR it belongs to a
// playlist that has been shared with them.
export function canAccessSong(
  db: Database,
  userId: string,
  songId: number
): boolean {
  const owned = db
    .prepare("SELECT 1 AS x FROM songs WHERE id = ? AND user_id = ?")
    .get(songId, userId);
  if (owned) return true;
  const shared = db
    .prepare(
      `SELECT 1 AS x
       FROM playlist_songs ps
       JOIN playlist_shares sh ON sh.playlist_id = ps.playlist_id
       WHERE ps.song_id = ? AND sh.shared_with = ?
       LIMIT 1`
    )
    .get(songId, userId);
  return !!shared;
}
