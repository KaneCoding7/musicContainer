import type { NextFunction, Request, Response } from "express";

export interface RateState {
  count: number;
  resetAt: number;
}

// Pure core: records a hit for `key` and reports whether it's over the limit.
// Resets the window once `now` passes `resetAt`.
export function hitLimit(
  store: Map<string, RateState>,
  key: string,
  now: number,
  windowMs: number,
  max: number
): { limited: boolean; retryAfterMs: number } {
  const state = store.get(key);
  if (!state || now >= state.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterMs: 0 };
  }
  state.count += 1;
  if (state.count > max) {
    return { limited: true, retryAfterMs: state.resetAt - now };
  }
  return { limited: false, retryAfterMs: 0 };
}

// Express middleware factory: in-memory, per-IP fixed-window rate limiting.
export function rateLimit(opts: { windowMs: number; max: number }) {
  const store = new Map<string, RateState>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? "unknown";
    const { limited, retryAfterMs } = hitLimit(
      store,
      key,
      Date.now(),
      opts.windowMs,
      opts.max
    );
    if (limited) {
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: "Too many requests, please try again later.",
        },
      });
      return;
    }
    next();
  };
}
