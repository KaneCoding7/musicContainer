import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { getPlaylist, songsInPlaylist } from "./playlists.js";
import { err, ok, type Result } from "./result.js";
import { getSong, listSongsByArtist } from "./songs.js";
import type { Song } from "../types.js";

// --- Artist public links (all of a user's songs by an artist) ---

export function getArtistPublicToken(
  db: Database,
  ownerId: string,
  artist: string
): Result<string | null> {
  const row = db
    .prepare(
      "SELECT token FROM artist_public_shares WHERE user_id = ? AND artist = ?"
    )
    .get(ownerId, artist.trim()) as { token: string } | undefined;
  return ok(row?.token ?? null);
}

export function enableArtistPublicLink(
  db: Database,
  ownerId: string,
  artist: string
): Result<string> {
  const a = artist.trim();
  if (!a) return err("validation", "Artist is required");
  try {
    const existing = db
      .prepare(
        "SELECT token FROM artist_public_shares WHERE user_id = ? AND artist = ?"
      )
      .get(ownerId, a) as { token: string } | undefined;
    if (existing) return ok(existing.token);
    const token = randomBytes(12).toString("base64url");
    db.prepare(
      "INSERT INTO artist_public_shares (token, user_id, artist, created_by) VALUES (?, ?, ?, ?)"
    ).run(token, ownerId, a, ownerId);
    return ok(token);
  } catch (e) {
    return err("internal", `Failed to create public link: ${(e as Error).message}`);
  }
}

export function disableArtistPublicLink(
  db: Database,
  ownerId: string,
  artist: string
): Result<void> {
  try {
    db.prepare(
      "DELETE FROM artist_public_shares WHERE user_id = ? AND artist = ?"
    ).run(ownerId, artist.trim());
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to disable public link: ${(e as Error).message}`);
  }
}

// Returns the public token for a playlist (owner only), or null if none.
export function getPublicToken(
  db: Database,
  ownerId: string,
  playlistId: number
): Result<string | null> {
  const playlist = getPlaylist(db, playlistId, ownerId);
  if (!playlist.ok) return playlist;
  const row = db
    .prepare("SELECT token FROM public_shares WHERE playlist_id = ?")
    .get(playlistId) as { token: string } | undefined;
  return ok(row?.token ?? null);
}

// Enables a public link for a playlist (owner only); idempotent.
export function enablePublicLink(
  db: Database,
  ownerId: string,
  playlistId: number
): Result<string> {
  const playlist = getPlaylist(db, playlistId, ownerId);
  if (!playlist.ok) return playlist;
  try {
    const existing = db
      .prepare("SELECT token FROM public_shares WHERE playlist_id = ?")
      .get(playlistId) as { token: string } | undefined;
    if (existing) return ok(existing.token);

    const token = randomBytes(12).toString("base64url");
    db.prepare(
      "INSERT INTO public_shares (token, playlist_id, created_by) VALUES (?, ?, ?)"
    ).run(token, playlistId, ownerId);
    return ok(token);
  } catch (e) {
    return err("internal", `Failed to create public link: ${(e as Error).message}`);
  }
}

// Disables (deletes) a playlist's public link (owner only).
export function disablePublicLink(
  db: Database,
  ownerId: string,
  playlistId: number
): Result<void> {
  const playlist = getPlaylist(db, playlistId, ownerId);
  if (!playlist.ok) return playlist;
  try {
    db.prepare("DELETE FROM public_shares WHERE playlist_id = ?").run(playlistId);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to disable public link: ${(e as Error).message}`);
  }
}

// --- Single-song public links (Cycle 39) ---

// Returns the public token for a song (owner only), or null if none.
export function getSongPublicToken(
  db: Database,
  ownerId: string,
  songId: number
): Result<string | null> {
  const song = getSong(db, songId, ownerId);
  if (!song.ok) return song;
  const row = db
    .prepare("SELECT token FROM song_public_shares WHERE song_id = ?")
    .get(songId) as { token: string } | undefined;
  return ok(row?.token ?? null);
}

// Enables a public link for a song (owner only); idempotent.
export function enableSongPublicLink(
  db: Database,
  ownerId: string,
  songId: number
): Result<string> {
  const song = getSong(db, songId, ownerId);
  if (!song.ok) return song;
  try {
    const existing = db
      .prepare("SELECT token FROM song_public_shares WHERE song_id = ?")
      .get(songId) as { token: string } | undefined;
    if (existing) return ok(existing.token);
    const token = randomBytes(12).toString("base64url");
    db.prepare(
      "INSERT INTO song_public_shares (token, song_id, created_by) VALUES (?, ?, ?)"
    ).run(token, songId, ownerId);
    return ok(token);
  } catch (e) {
    return err("internal", `Failed to create song link: ${(e as Error).message}`);
  }
}

// Disables a song's public link (owner only).
export function disableSongPublicLink(
  db: Database,
  ownerId: string,
  songId: number
): Result<void> {
  const song = getSong(db, songId, ownerId);
  if (!song.ok) return song;
  try {
    db.prepare("DELETE FROM song_public_shares WHERE song_id = ?").run(songId);
    return ok(undefined);
  } catch (e) {
    return err("internal", `Failed to disable song link: ${(e as Error).message}`);
  }
}

export interface PublicPlaylist {
  name: string;
  ownerName: string;
  songs: Song[];
}

// Resolves a public token to a playlist OR a single song (no auth). Public-safe.
export function resolvePublicShare(
  db: Database,
  token: string
): Result<PublicPlaylist> {
  const row = db
    .prepare(
      `SELECT p.id, p.name, u.name AS owner_name
       FROM public_shares ps
       JOIN playlists p ON p.id = ps.playlist_id
       JOIN "user" u ON u.id = p.user_id
       WHERE ps.token = ?`
    )
    .get(token) as
    | { id: number; name: string; owner_name: string }
    | undefined;
  if (row) {
    return ok({
      name: row.name,
      ownerName: row.owner_name,
      songs: songsInPlaylist(db, row.id),
    });
  }

  // Fall back to a single-song link.
  const songRow = resolvePublicSong(db, token);
  if (songRow) {
    return ok({
      name: songRow.song.originalFilename,
      ownerName: songRow.ownerName,
      songs: [songRow.song],
    });
  }

  // Fall back to an artist link (all the owner's songs by that artist).
  const artistRow = db
    .prepare(
      `SELECT aps.user_id, aps.artist, u.name AS owner_name
       FROM artist_public_shares aps
       JOIN "user" u ON u.id = aps.user_id
       WHERE aps.token = ?`
    )
    .get(token) as
    | { user_id: string; artist: string; owner_name: string }
    | undefined;
  if (artistRow) {
    const songs = listSongsByArtist(db, artistRow.user_id, artistRow.artist);
    return ok({
      name: artistRow.artist,
      ownerName: artistRow.owner_name,
      songs: songs.ok ? songs.value : [],
    });
  }
  return err("not_found", "Share link not found");
}

// Resolves a single-song public token to the song + owner name.
function resolvePublicSong(
  db: Database,
  token: string
): { song: Song; ownerName: string } | null {
  const row = db
    .prepare(
      `SELECT s.id, u.name AS owner_name
       FROM song_public_shares sps
       JOIN songs s ON s.id = sps.song_id
       JOIN "user" u ON u.id = s.user_id
       WHERE sps.token = ?`
    )
    .get(token) as { id: number; owner_name: string } | undefined;
  if (!row) return null;
  // Read the song unscoped (public access); reuse the owner to satisfy getSong.
  const ownerId = db
    .prepare("SELECT user_id FROM songs WHERE id = ?")
    .get(row.id) as { user_id: string } | undefined;
  if (!ownerId) return null;
  const song = getSong(db, row.id, ownerId.user_id);
  if (!song.ok) return null;
  return { song: song.value, ownerName: row.owner_name };
}

// True if the public token grants access to the given song (playlist or song).
export function publicTokenAllowsSong(
  db: Database,
  token: string,
  songId: number
): boolean {
  const viaPlaylist = db
    .prepare(
      `SELECT 1 AS x
       FROM public_shares ps
       JOIN playlist_songs pls ON pls.playlist_id = ps.playlist_id
       WHERE ps.token = ? AND pls.song_id = ?
       LIMIT 1`
    )
    .get(token, songId);
  if (viaPlaylist) return true;
  const viaSong = db
    .prepare(
      "SELECT 1 AS x FROM song_public_shares WHERE token = ? AND song_id = ? LIMIT 1"
    )
    .get(token, songId);
  if (viaSong) return true;
  const viaArtist = db
    .prepare(
      `SELECT 1 AS x
       FROM artist_public_shares aps
       JOIN songs s ON s.user_id = aps.user_id
         AND TRIM(COALESCE(s.artist, '')) = aps.artist
       WHERE aps.token = ? AND s.id = ? AND s.pending = 0
       LIMIT 1`
    )
    .get(token, songId);
  return !!viaArtist;
}
