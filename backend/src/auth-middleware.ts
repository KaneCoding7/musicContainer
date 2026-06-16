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

  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      res
        .status(401)
        .json({ error: { code: "unauthorized", message: "Authentication required" } });
      return;
    }
    req.userId = session.user.id;
    next();
  } catch {
    res
      .status(401)
      .json({ error: { code: "unauthorized", message: "Authentication required" } });
  }
}
