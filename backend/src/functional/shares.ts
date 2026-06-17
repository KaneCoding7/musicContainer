import type { Database } from "better-sqlite3";
import type { Playlist, Song } from "../types.js";
import { getPlaylist, songsInPlaylist } from "./playlists.js";
import { err, ok, type Result } from "./result.js";

export interface ShareUser {
  id: string;
  name: string;
  email: string;
  canEdit: boolean;
}

// A playlist shared with the current user, including who shared it.
export interface SharedPlaylist extends Playlist {
  ownerName: string;
  canEdit: boolean;
  savedCopyId: number | null; // my saved copy's id, if I've saved this one
}

function findUserByEmail(
  db: Database,
  email: string
): { id: string; name: string; email: string } | null {
  const row = db
    .prepare('SELECT id, name, email FROM "user" WHERE email = ?')
    .get(email.trim().toLowerCase()) as
    | { id: string; name: string; email: string }
    | undefined;
  return row ?? null;
}

export interface UserMatch {
  id: string;
  name: string;
  email: string;
}

// Searches users by name or email (case-insensitive substring), excluding the
// caller. Used for the "share with" autocomplete.
export function searchUsers(
  db: Database,
  query: string,
  excludeUserId: string,
  limit = 8
): UserMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `SELECT id, name, email FROM "user"
       WHERE id != ?
         AND (lower(name) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')
       ORDER BY name LIMIT ?`
    )
    .all(excludeUserId, like, like, limit) as UserMatch[];
}

// Shares a playlist (owned by ownerId) with the user at recipientEmail. Re-
// sharing updates the edit permission.
export function sharePlaylist(
  db: Database,
  ownerId: string,
  playlistId: number,
  recipientEmail: string,
  canEdit: boolean
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
      `INSERT INTO playlist_shares (playlist_id, shared_with, can_edit)
       VALUES (?, ?, ?)
       ON CONFLICT(playlist_id, shared_with)
       DO UPDATE SET can_edit = excluded.can_edit`
    ).run(playlistId, recipient.id, canEdit ? 1 : 0);
    return ok({ ...recipient, canEdit });
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
        `SELECT u.id, u.name, u.email, ps.can_edit
         FROM playlist_shares ps
         JOIN "user" u ON u.id = ps.shared_with
         WHERE ps.playlist_id = ?
         ORDER BY ps.created_at ASC`
      )
      .all(playlistId) as (Omit<ShareUser, "canEdit"> & { can_edit: number })[];
    return ok(rows.map((r) => ({ id: r.id, name: r.name, email: r.email, canEdit: r.can_edit === 1 })));
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
        `SELECT p.id, p.name, p.created_at, u.name AS owner_name, ps.can_edit,
                (SELECT COUNT(*) FROM playlist_songs x WHERE x.playlist_id = p.id)
                  AS track_count,
                (SELECT x.song_id FROM playlist_songs x
                   JOIN songs s ON s.id = x.song_id
                   WHERE x.playlist_id = p.id AND s.art_filename IS NOT NULL
                   ORDER BY x.position ASC LIMIT 1) AS cover_song_id,
                (SELECT mp.id FROM playlists mp
                   WHERE mp.user_id = ? AND mp.copied_from = p.id LIMIT 1)
                  AS saved_copy_id
         FROM playlist_shares ps
         JOIN playlists p ON p.id = ps.playlist_id
         JOIN "user" u ON u.id = p.user_id
         WHERE ps.shared_with = ?
         ORDER BY datetime(ps.created_at) DESC`
      )
      .all(userId, userId) as {
      id: number;
      name: string;
      created_at: string;
      owner_name: string;
      can_edit: number;
      track_count: number;
      cover_song_id: number | null;
      saved_copy_id: number | null;
    }[];
    return ok(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        ownerName: r.owner_name,
        canEdit: r.can_edit === 1,
        trackCount: r.track_count,
        coverSongId: r.cover_song_id,
        savedCopyId: r.saved_copy_id,
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

// Copies a playlist shared with the user into a new playlist they own. The new
// playlist references the same (owner's) song rows; the user can play them
// because they're now in a playlist the user owns (see canAccessSong).
export function copySharedPlaylist(
  db: Database,
  userId: string,
  playlistId: number
): Result<Playlist> {
  if (!isPlaylistSharedWith(db, playlistId, userId)) {
    return err("not_found", `Playlist ${playlistId} not found`);
  }
  const src = db
    .prepare("SELECT name FROM playlists WHERE id = ?")
    .get(playlistId) as { name: string } | undefined;
  if (!src) return err("not_found", `Playlist ${playlistId} not found`);
  try {
    let newId = 0;
    db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO playlists (name, user_id, copied_from) VALUES (?, ?, ?)"
        )
        .run(src.name, userId, playlistId);
      newId = info.lastInsertRowid as number;
      db.prepare(
        `INSERT INTO playlist_songs (playlist_id, song_id, position, added_by)
         SELECT ?, song_id, position, added_by
         FROM playlist_songs WHERE playlist_id = ?`
      ).run(newId, playlistId);
    })();
    const row = db
      .prepare(
        `SELECT p.id, p.name, p.created_at,
                (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id)
                  AS track_count,
                (SELECT ps.song_id FROM playlist_songs ps
                   JOIN songs s ON s.id = ps.song_id
                   WHERE ps.playlist_id = p.id AND s.art_filename IS NOT NULL
                   ORDER BY ps.position ASC LIMIT 1) AS cover_song_id
         FROM playlists p WHERE p.id = ?`
      )
      .get(newId) as {
      id: number;
      name: string;
      created_at: string;
      track_count: number;
      cover_song_id: number | null;
    };
    return ok({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      trackCount: row.track_count,
      coverSongId: row.cover_song_id,
    });
  } catch (e) {
    return err("internal", `Failed to copy playlist: ${(e as Error).message}`);
  }
}

export interface PlaylistMember {
  id: string;
  name: string;
  isOwner: boolean;
  canEdit: boolean;
}

// Lists everyone with access to a playlist — the owner first, then the users
// it's shared with. Accessible to the owner and to anyone it's shared with.
export function listPlaylistMembers(
  db: Database,
  playlistId: number,
  userId: string
): Result<PlaylistMember[]> {
  const owner = db
    .prepare(
      `SELECT p.user_id AS id, u.name AS name
       FROM playlists p JOIN "user" u ON u.id = p.user_id
       WHERE p.id = ?`
    )
    .get(playlistId) as { id: string; name: string } | undefined;
  if (!owner) return err("not_found", `Playlist ${playlistId} not found`);

  if (owner.id !== userId && !isPlaylistSharedWith(db, playlistId, userId)) {
    return err("not_found", `Playlist ${playlistId} not found`);
  }

  const shared = db
    .prepare(
      `SELECT u.id, u.name, ps.can_edit
       FROM playlist_shares ps
       JOIN "user" u ON u.id = ps.shared_with
       WHERE ps.playlist_id = ?
       ORDER BY ps.created_at ASC`
    )
    .all(playlistId) as { id: string; name: string; can_edit: number }[];

  return ok([
    { id: owner.id, name: owner.name, isOwner: true, canEdit: true },
    ...shared.map((s) => ({
      id: s.id,
      name: s.name,
      isOwner: false,
      canEdit: s.can_edit === 1,
    })),
  ]);
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
  // In a playlist the user owns (covers tracks a collaborator added).
  const inOwnPlaylist = db
    .prepare(
      `SELECT 1 AS x
       FROM playlist_songs ps
       JOIN playlists p ON p.id = ps.playlist_id
       WHERE ps.song_id = ? AND p.user_id = ?
       LIMIT 1`
    )
    .get(songId, userId);
  if (inOwnPlaylist) return true;
  // In a playlist shared with the user.
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
