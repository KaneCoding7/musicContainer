import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { getPlaylist, songsInPlaylist } from "./playlists.js";
import { err, ok, type Result } from "./result.js";
import type { Song } from "../types.js";

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

export interface PublicPlaylist {
  name: string;
  ownerName: string;
  songs: Song[];
}

// Resolves a public token to its playlist + songs (no auth). Public-safe.
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
  if (!row) return err("not_found", "Share link not found");
  return ok({
    name: row.name,
    ownerName: row.owner_name,
    songs: songsInPlaylist(db, row.id),
  });
}

// True if a song belongs to the playlist behind a public token.
export function publicTokenAllowsSong(
  db: Database,
  token: string,
  songId: number
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS x
       FROM public_shares ps
       JOIN playlist_songs pls ON pls.playlist_id = ps.playlist_id
       WHERE ps.token = ? AND pls.song_id = ?
       LIMIT 1`
    )
    .get(token, songId);
  return !!row;
}
