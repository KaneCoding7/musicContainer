import { Router } from "express";
import { getDb } from "../db/init.js";
import {
  deleteLastfmSession,
  getLastfmConnection,
  setLastfmSession,
} from "../functional/lastfm.js";
import {
  getApiKey,
  getSession,
  getUserStats,
  isConfigured,
  periodFor,
} from "../lastfm.js";
import type { StatsRange } from "../listenbrainz.js";
import { rateLimit } from "../rate-limit.js";

// Per-user Last.fm connection. Mounted under /api with requireAuth.
export const lastfmRouter = Router();

const connectLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const statsLimiter = rateLimit({ windowMs: 60_000, max: 40 });

const RANGES = new Set<StatsRange>(["week", "month", "year", "all_time"]);

// GET /api/lastfm — whether the server has Last.fm configured + the caller's
// connection status. Exposes the (public) API key so the client can build the
// authorize redirect URL.
lastfmRouter.get("/lastfm", (req, res) => {
  const configured = isConfigured();
  const conn = getLastfmConnection(getDb(), req.userId!);
  res.json({
    configured,
    apiKey: configured ? getApiKey() : null,
    connected: conn.connected,
    username: conn.username,
  });
});

// POST /api/lastfm { token } — exchange a web-auth token for a session key and
// store it. Called by the callback page after the user authorizes on Last.fm.
lastfmRouter.post("/lastfm", connectLimiter, async (req, res) => {
  if (!isConfigured()) {
    return res.status(400).json({
      error: { code: "validation", message: "Last.fm is not configured on this server" },
    });
  }
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    return res.status(400).json({
      error: { code: "validation", message: "A Last.fm auth token is required" },
    });
  }
  const session = await getSession(token);
  if (!session) {
    return res.status(400).json({
      error: { code: "validation", message: "Last.fm didn't accept that authorization" },
    });
  }
  setLastfmSession(getDb(), req.userId!, session.key, session.name);
  res.json({ connected: true, username: session.name });
});

// DELETE /api/lastfm — disconnect (forget the session key).
lastfmRouter.delete("/lastfm", (req, res) => {
  deleteLastfmSession(getDb(), req.userId!);
  res.json({ connected: false, username: null });
});

// GET /api/lastfm/stats?range=… — top artists/tracks/albums + total scrobbles.
lastfmRouter.get("/lastfm/stats", statsLimiter, async (req, res) => {
  const conn = getLastfmConnection(getDb(), req.userId!);
  if (!isConfigured() || !conn.connected || !conn.username) {
    return res.json({ connected: false });
  }
  const r = typeof req.query.range === "string" ? (req.query.range as StatsRange) : "month";
  const range: StatsRange = RANGES.has(r) ? r : "month";
  const stats = await getUserStats(conn.username, periodFor(range));
  res.json({ connected: true, username: conn.username, range, ...stats });
});
