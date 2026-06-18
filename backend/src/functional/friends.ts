import type { Database } from "better-sqlite3";
import { err, ok, type Result } from "./result.js";

// Mutual friendships (request -> accept). A friendship is a single row keyed by
// the ordered (requester, addressee) pair: 'pending' until the addressee
// accepts, then 'accepted'. Once accepted the relationship is undirected, so
// reads look at both sides of the pair.

// An accepted friend, from the caller's point of view (the *other* user).
export interface Friend {
  id: string;
  name: string;
  email: string;
  since: string;
}

// A pending request, from the caller's point of view (the *other* user).
export interface FriendRequest {
  id: string;
  name: string;
  email: string;
  requestedAt: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
}

// Case-insensitive lookup of a user by email (mirrors functional/shares.ts).
function findUserByEmail(db: Database, email: string): UserRow | null {
  const row = db
    .prepare('SELECT id, name, email FROM "user" WHERE email = ?')
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

interface FriendshipRow {
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
}

// The friendship row connecting two users in either direction, if any.
function findFriendship(
  db: Database,
  a: string,
  b: string
): FriendshipRow | null {
  const row = db
    .prepare(
      `SELECT requester_id, addressee_id, status FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(a, b, b, a) as FriendshipRow | undefined;
  return row ?? null;
}

// Sends a friend request from userId to the user at the given email. Sending to
// someone who has already requested you accepts their request instead (avoids a
// duplicate and is the friendlier behavior).
export function sendRequest(
  db: Database,
  userId: string,
  email: string
): Result<{ status: "pending" | "accepted" }> {
  const target = findUserByEmail(db, email);
  if (!target) return err("not_found", "No user with that email");
  if (target.id === userId) {
    return err("validation", "You can't add yourself as a friend");
  }

  const existing = findFriendship(db, userId, target.id);
  if (existing) {
    if (existing.status === "accepted") {
      return err("conflict", "You're already friends");
    }
    // A pending row exists. If they requested us, accept it; if we requested
    // them, it's a duplicate.
    if (existing.requester_id === userId) {
      return err("conflict", "Friend request already sent");
    }
    db.prepare(
      `UPDATE friendships SET status = 'accepted', updated_at = datetime('now')
       WHERE requester_id = ? AND addressee_id = ?`
    ).run(target.id, userId);
    return ok({ status: "accepted" });
  }

  try {
    db.prepare(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES (?, ?, 'pending')`
    ).run(userId, target.id);
    return ok({ status: "pending" });
  } catch (e) {
    return err("internal", `Failed to send request: ${(e as Error).message}`);
  }
}

// Accepts a pending request that otherId sent to userId.
export function acceptRequest(
  db: Database,
  userId: string,
  otherId: string
): Result<Friend> {
  const info = db
    .prepare(
      `UPDATE friendships SET status = 'accepted', updated_at = datetime('now')
       WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`
    )
    .run(otherId, userId);
  if (info.changes === 0) {
    return err("not_found", "No pending request from that user");
  }
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, f.updated_at AS since
       FROM friendships f JOIN "user" u ON u.id = f.requester_id
       WHERE f.requester_id = ? AND f.addressee_id = ?`
    )
    .get(otherId, userId) as Friend;
  return ok(row);
}

// Removes any friendship/request between userId and otherId (covers cancelling
// an outgoing request, declining an incoming one, and unfriending).
export function removeFriendship(
  db: Database,
  userId: string,
  otherId: string
): Result<void> {
  const info = db
    .prepare(
      `DELETE FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)`
    )
    .run(userId, otherId, otherId, userId);
  if (info.changes === 0) return err("not_found", "No such friend or request");
  return ok(undefined);
}

// Accepted friends of userId (the other party in each pair), ordered by name.
export function listFriends(db: Database, userId: string): Friend[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, f.updated_at AS since
       FROM friendships f
       JOIN "user" u
         ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id
                        ELSE f.requester_id END
       WHERE f.status = 'accepted'
         AND (f.requester_id = ? OR f.addressee_id = ?)
       ORDER BY u.name`
    )
    .all(userId, userId, userId) as Friend[];
}

// Pending requests sent *to* userId (incoming), newest first.
export function listIncoming(db: Database, userId: string): FriendRequest[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, f.created_at AS requestedAt
       FROM friendships f JOIN "user" u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'
       ORDER BY datetime(f.created_at) DESC`
    )
    .all(userId) as FriendRequest[];
}

// Pending requests sent *by* userId (outgoing), newest first.
export function listOutgoing(db: Database, userId: string): FriendRequest[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, f.created_at AS requestedAt
       FROM friendships f JOIN "user" u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending'
       ORDER BY datetime(f.created_at) DESC`
    )
    .all(userId) as FriendRequest[];
}
