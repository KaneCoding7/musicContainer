import type { Database } from "better-sqlite3";

// Per-user Last.fm session-key storage. We never store the user's password —
// only the permanent session key returned by the web-auth exchange.

export interface LastfmConnection {
  connected: boolean;
  username: string | null;
}

export function getLastfmConnection(
  db: Database,
  userId: string
): LastfmConnection {
  const row = db
    .prepare("SELECT username FROM lastfm_sessions WHERE user_id = ?")
    .get(userId) as { username: string | null } | undefined;
  return row
    ? { connected: true, username: row.username ?? null }
    : { connected: false, username: null };
}

export function getLastfmSessionKey(
  db: Database,
  userId: string
): string | null {
  const row = db
    .prepare("SELECT session_key FROM lastfm_sessions WHERE user_id = ?")
    .get(userId) as { session_key: string } | undefined;
  return row?.session_key ?? null;
}

export function setLastfmSession(
  db: Database,
  userId: string,
  sessionKey: string,
  username: string | null
): void {
  db.prepare(
    `INSERT INTO lastfm_sessions (user_id, session_key, username, created_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       session_key = excluded.session_key,
       username = excluded.username,
       created_at = excluded.created_at`
  ).run(userId, sessionKey, username);
}

export function deleteLastfmSession(db: Database, userId: string): void {
  db.prepare("DELETE FROM lastfm_sessions WHERE user_id = ?").run(userId);
}
