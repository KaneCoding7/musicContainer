import { createHmac, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

// Scoped, short-lived media tokens.
//
// <audio>, <img> and download links can't send an Authorization header, so media
// URLs need *something* in the query string. That used to be the full Better Auth
// session token, which then landed in reverse-proxy access logs, tunnel logs and
// browser history, and could drive the whole account API. A media token instead:
//   * only authorizes GETs of media endpoints (see MEDIA_PATH in auth-middleware),
//   * expires after MEDIA_TOKEN_TTL_MS,
//   * is bound to a session: revoking/signing out the session kills it,
//   * is an HMAC over (user, session, expiry), so it can't be forged or extended.
// Format: "m1.<base64url(json{u,s,e})>.<base64url(hmac-sha256)>"

export const MEDIA_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const VERSION = "m1";

function key(secret: string): Buffer {
  // Domain-separated from Better Auth's own use of the secret.
  return createHmac("sha256", secret).update("music-media-token-v1").digest();
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", key(secret)).update(`${VERSION}.${payload}`).digest("base64url");
}

export function issueMediaToken(
  secret: string,
  userId: string,
  sessionId: string,
  now: number = Date.now(),
  ttlMs: number = MEDIA_TOKEN_TTL_MS
): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ u: userId, s: sessionId, e: expiresAt })).toString("base64url");
  return { token: `${VERSION}.${payload}.${sign(secret, payload)}`, expiresAt };
}

// Verifies signature + expiry only (no DB). Returns the claims or null.
export function verifyMediaToken(
  secret: string,
  token: string,
  now: number = Date.now()
): { userId: string; sessionId: string; expiresAt: number } | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, mac] = parts;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: { u?: unknown; s?: unknown; e?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.u !== "string" || typeof claims.s !== "string" || typeof claims.e !== "number") return null;
  if (claims.e <= now) return null;
  return { userId: claims.u, sessionId: claims.s, expiresAt: claims.e };
}

// True if the session still exists, belongs to the user and hasn't expired.
export function sessionIsLive(
  db: Database.Database,
  sessionId: string,
  userId: string,
  now: number = Date.now()
): boolean {
  const row = db
    .prepare(`SELECT "expiresAt" AS exp FROM "session" WHERE "id" = ? AND "userId" = ?`)
    .get(sessionId, userId) as { exp: string | number } | undefined;
  if (!row) return false;
  const exp = typeof row.exp === "number" ? row.exp : Date.parse(String(row.exp));
  return Number.isFinite(exp) && exp > now;
}
