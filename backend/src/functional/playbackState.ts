import type { Database } from "better-sqlite3";

// Per-user "resume where you left off" snapshot, stored so playback state
// follows the user across devices (unlike the browser-local copy). The snapshot
// is an opaque JSON string owned by the client; `updatedAt` is epoch ms.

export function getPlaybackState(
  db: Database,
  userId: string
): { snapshot: string; updatedAt: number } | null {
  const row = db
    .prepare("SELECT snapshot, updated_at FROM playback_state WHERE user_id = ?")
    .get(userId) as { snapshot: string; updated_at: number } | undefined;
  return row ? { snapshot: row.snapshot, updatedAt: row.updated_at } : null;
}

export function setPlaybackState(
  db: Database,
  userId: string,
  snapshot: string,
  updatedAt: number
): void {
  db.prepare(
    `INSERT INTO playback_state (user_id, snapshot, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       snapshot = excluded.snapshot, updated_at = excluded.updated_at`
  ).run(userId, snapshot, updatedAt);
}

export function clearPlaybackState(db: Database, userId: string): void {
  db.prepare("DELETE FROM playback_state WHERE user_id = ?").run(userId);
}
