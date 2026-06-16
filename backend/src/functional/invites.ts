import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { err, ok, type Result } from "./result.js";

export interface Invite {
  code: string;
  createdAt: string;
  used: boolean;
  usedAt: string | null;
}

interface InviteRow {
  code: string;
  created_at: string;
  used_by: string | null;
  used_at: string | null;
}

function rowToInvite(row: InviteRow): Invite {
  return {
    code: row.code,
    createdAt: row.created_at,
    used: row.used_by !== null,
    usedAt: row.used_at,
  };
}

// Generates a new, unused invite code owned by the given user.
export function createInvite(db: Database, userId: string): Result<Invite> {
  try {
    const code = randomBytes(9).toString("base64url"); // 12 url-safe chars
    db.prepare("INSERT INTO invites (code, created_by) VALUES (?, ?)").run(
      code,
      userId
    );
    const row = db
      .prepare(
        "SELECT code, created_at, used_by, used_at FROM invites WHERE code = ?"
      )
      .get(code) as InviteRow;
    return ok(rowToInvite(row));
  } catch (e) {
    return err("internal", `Failed to create invite: ${(e as Error).message}`);
  }
}

// Lists invites created by the user, newest first.
export function listInvites(db: Database, userId: string): Result<Invite[]> {
  try {
    const rows = db
      .prepare(
        `SELECT code, created_at, used_by, used_at FROM invites
         WHERE created_by = ? ORDER BY datetime(created_at) DESC`
      )
      .all(userId) as InviteRow[];
    return ok(rows.map(rowToInvite));
  } catch (e) {
    return err("internal", `Failed to list invites: ${(e as Error).message}`);
  }
}

// Number of registered users (0 means the next signup is the owner).
export function countUsers(db: Database): number {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM "user"').get() as {
    c: number;
  };
  return c;
}

// Validates that a code exists and is unused.
export function validateInvite(db: Database, code: string): Result<void> {
  const row = db
    .prepare("SELECT used_by FROM invites WHERE code = ?")
    .get(code) as { used_by: string | null } | undefined;
  if (!row) return err("validation", "Invalid invite code");
  if (row.used_by !== null) return err("conflict", "Invite code already used");
  return ok(undefined);
}

// Marks an invite as used by the given user (no-op if already used).
export function consumeInvite(
  db: Database,
  code: string,
  userId: string
): void {
  db.prepare(
    "UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL"
  ).run(userId, code);
}
