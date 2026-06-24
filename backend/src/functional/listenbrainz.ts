import type { Database } from "better-sqlite3";
import type { ScrobbleTrack } from "../listenbrainz.js";

// Per-user ListenBrainz token storage + the metadata needed to scrobble a song.

export interface ListenBrainzConnection {
  connected: boolean;
  username: string | null;
}

// The user's connection status (without exposing the token itself).
export function getListenBrainzConnection(
  db: Database,
  userId: string
): ListenBrainzConnection {
  const row = db
    .prepare("SELECT username FROM listenbrainz_tokens WHERE user_id = ?")
    .get(userId) as { username: string | null } | undefined;
  return row
    ? { connected: true, username: row.username ?? null }
    : { connected: false, username: null };
}

// The raw token, used server-side to submit listens. Null when not connected.
export function getListenBrainzToken(
  db: Database,
  userId: string
): string | null {
  const row = db
    .prepare("SELECT token FROM listenbrainz_tokens WHERE user_id = ?")
    .get(userId) as { token: string } | undefined;
  return row?.token ?? null;
}

export function setListenBrainzToken(
  db: Database,
  userId: string,
  token: string,
  username: string | null
): void {
  db.prepare(
    `INSERT INTO listenbrainz_tokens (user_id, token, username, created_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       token = excluded.token,
       username = excluded.username,
       created_at = excluded.created_at`
  ).run(userId, token, username);
}

export function deleteListenBrainzToken(db: Database, userId: string): void {
  db.prepare("DELETE FROM listenbrainz_tokens WHERE user_id = ?").run(userId);
}

// Assembles the scrobble metadata for one of the user's songs. Returns null if
// the song isn't found or has no usable title/artist to submit.
export function getScrobbleTrack(
  db: Database,
  songId: number,
  userId: string
): ScrobbleTrack | null {
  const row = db
    .prepare(
      `SELECT original_filename, artist, album, mb_recording_id, duration
         FROM songs WHERE id = ? AND user_id = ?`
    )
    .get(songId, userId) as
    | {
        original_filename: string;
        artist: string | null;
        album: string | null;
        mb_recording_id: string | null;
        duration: number | null;
      }
    | undefined;
  if (!row) return null;
  // ListenBrainz requires a track + artist name; drop a stray file extension.
  const track = (row.original_filename || "").replace(/\.[a-z0-9]{2,4}$/i, "").trim();
  const artist = (row.artist ?? "").trim();
  if (!track || !artist) return null;
  return {
    track,
    artist,
    release: row.album?.trim() || null,
    recordingMbid: row.mb_recording_id ?? null,
    durationSec: row.duration ?? null,
  };
}
