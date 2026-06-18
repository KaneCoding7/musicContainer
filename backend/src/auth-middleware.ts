import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "./auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Short-lived cache of validated bearer tokens → user id. A media element makes
// many requests per track (initial load + Range requests + seeks), and each
// would otherwise re-run a full Better Auth session lookup against the DB —
// noticeable on a slow server. The TTL is small so a revoked/expired session
// stops working within a few seconds.
const SESSION_TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const sessionCache = new Map<string, { userId: string; expiresAt: number }>();

// Requires a valid Better Auth session. The bearer token normally arrives in
// the Authorization header, but media elements (<audio>, <img>, download links)
// can't set headers, so a `?token=` query param is accepted as a fallback.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const headers = fromNodeHeaders(req.headers);
  const queryToken =
    typeof req.query.token === "string" ? req.query.token : null;
  if (queryToken && !headers.get("authorization")) {
    headers.set("authorization", `Bearer ${queryToken}`);
  }

  const bearer = headers.get("authorization");
  if (bearer) {
    const hit = sessionCache.get(bearer);
    if (hit && hit.expiresAt > Date.now()) {
      req.userId = hit.userId;
      next();
      return;
    }
  }

  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      if (bearer) sessionCache.delete(bearer);
      res
        .status(401)
        .json({ error: { code: "unauthorized", message: "Authentication required" } });
      return;
    }
    req.userId = session.user.id;
    if (bearer) {
      if (sessionCache.size >= MAX_ENTRIES) sessionCache.clear();
      sessionCache.set(bearer, {
        userId: session.user.id,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
    }
    next();
  } catch {
    res
      .status(401)
      .json({ error: { code: "unauthorized", message: "Authentication required" } });
  }
}
