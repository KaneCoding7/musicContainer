import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth, DEV_AUTH_SECRET } from "./auth.js";
import { getDb } from "./db/init.js";
import { sessionIsLive, verifyMediaToken } from "./media-token.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
    }
  }
}

export const authSecret = (): string => process.env.BETTER_AUTH_SECRET ?? DEV_AUTH_SECRET;

// GET endpoints that media elements (<audio>, <img>, download links) load directly
// and therefore can't send an Authorization header. Only these accept a scoped
// media token (?mt=). Paths are relative to the "/api" mount point.
export const MEDIA_PATH =
  /^\/(songs\/\d+\/(stream|clip|art|download)|artists\/image|playlists\/\d+\/(image|download))$/;

// Short-lived cache of validated credentials → identity. A media element makes
// many requests per track (initial load + Range requests + seeks), and each
// would otherwise re-run a session lookup against the DB. The TTL is small so a
// revoked/expired session stops working within a minute.
const SESSION_TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
// Two SEPARATE caches: a media token must never be usable as a bearer credential
// (a shared map once let "Authorization: mt:<token>" hit a cached media entry).
type Ident = { userId: string; sessionId: string; expiresAt: number };
const bearerCache = new Map<string, Ident>();
const mediaCache = new Map<string, Ident>();

function remember(cache: Map<string, Ident>, k: string, userId: string, sessionId: string): void {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(k, { userId, sessionId, expiresAt: Date.now() + SESSION_TTL_MS });
}

// Only "Bearer <opaque token>" is accepted; anything else in the header is refused.
const BEARER = /^Bearer [A-Za-z0-9._~+/=-]{16,4096}$/;

function unauthorized(res: Response): void {
  res.status(401).json({ error: { code: "unauthorized", message: "Authentication required" } });
}

// Requires a valid Better Auth session, sent ONLY in the Authorization header.
// Session tokens are never accepted from the URL: URLs end up in proxy/tunnel
// access logs and browser history. Media endpoints (MEDIA_PATH, GET only) also
// accept a scoped, short-lived media token as ?mt= (see media-token.ts).
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const headers = fromNodeHeaders(req.headers);
  const bearer = headers.get("authorization");

  if (!bearer) {
    const mt = typeof req.query.mt === "string" ? req.query.mt : null;
    // HEAD is routed to GET handlers by Express (download managers/players probe with it).
    if (mt && (req.method === "GET" || req.method === "HEAD") && MEDIA_PATH.test(req.path)) {
      const hit = mediaCache.get(mt);
      if (hit && hit.expiresAt > Date.now()) {
        req.userId = hit.userId;
        req.sessionId = hit.sessionId;
        next();
        return;
      }
      const claims = verifyMediaToken(authSecret(), mt);
      if (claims && sessionIsLive(getDb(), claims.sessionId, claims.userId)) {
        remember(mediaCache, mt, claims.userId, claims.sessionId);
        req.userId = claims.userId;
        req.sessionId = claims.sessionId;
        next();
        return;
      }
    }
    unauthorized(res);
    return;
  }

  if (!BEARER.test(bearer)) {
    unauthorized(res);
    return;
  }
  const hit = bearerCache.get(bearer);
  if (hit && hit.expiresAt > Date.now()) {
    req.userId = hit.userId;
    req.sessionId = hit.sessionId;
    next();
    return;
  }
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      bearerCache.delete(bearer);
      unauthorized(res);
      return;
    }
    req.userId = session.user.id;
    req.sessionId = session.session.id;
    remember(bearerCache, bearer, session.user.id, session.session.id);
    next();
  } catch {
    unauthorized(res);
  }
}
