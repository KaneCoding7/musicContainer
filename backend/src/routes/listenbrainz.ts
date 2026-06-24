import { Router } from "express";
import { getDb } from "../db/init.js";
import {
  deleteListenBrainzToken,
  getListenBrainzConnection,
  getListenBrainzToken,
  setListenBrainzToken,
} from "../functional/listenbrainz.js";
import {
  getFreshReleases,
  getRecommendations,
  getUserStats,
  validateToken,
  type StatsRange,
} from "../listenbrainz.js";
import { rateLimit } from "../rate-limit.js";

// Per-user ListenBrainz connection. Mounted under /api with requireAuth.
export const listenBrainzRouter = Router();

// These endpoints hit an external API — throttle them lightly.
const connectLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const statsLimiter = rateLimit({ windowMs: 60_000, max: 40 });

const RANGES = new Set<StatsRange>(["week", "month", "year", "all_time"]);

// GET /api/listenbrainz — current connection status (never returns the token).
listenBrainzRouter.get("/listenbrainz", (req, res) => {
  res.json(getListenBrainzConnection(getDb(), req.userId!));
});

// POST /api/listenbrainz { token } — validate against ListenBrainz, then store.
listenBrainzRouter.post("/listenbrainz", connectLimiter, async (req, res) => {
  const token =
    typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    return res.status(400).json({
      error: { code: "validation", message: "A ListenBrainz token is required" },
    });
  }
  const { valid, username } = await validateToken(token);
  if (!valid) {
    return res.status(400).json({
      error: {
        code: "validation",
        message: "That token wasn't accepted by ListenBrainz",
      },
    });
  }
  setListenBrainzToken(getDb(), req.userId!, token, username);
  res.json({ connected: true, username });
});

// DELETE /api/listenbrainz — disconnect (forget the token).
listenBrainzRouter.delete("/listenbrainz", (req, res) => {
  deleteListenBrainzToken(getDb(), req.userId!);
  res.json({ connected: false, username: null });
});

// GET /api/listenbrainz/stats?range=week|month|year|all_time — the user's top
// artists, top tracks, and listen count. Returns { connected: false } when no
// account is linked (the UI shows a connect prompt instead).
listenBrainzRouter.get("/listenbrainz/stats", statsLimiter, async (req, res) => {
  const db = getDb();
  const conn = getListenBrainzConnection(db, req.userId!);
  if (!conn.connected || !conn.username) {
    return res.json({ connected: false });
  }
  const r = typeof req.query.range === "string" ? (req.query.range as StatsRange) : "month";
  const range: StatsRange = RANGES.has(r) ? r : "month";
  const token = getListenBrainzToken(db, req.userId!);
  const stats = await getUserStats(conn.username, range, token);
  res.json({ connected: true, username: conn.username, range, ...stats });
});

// GET /api/listenbrainz/recommendations — personalized track recommendations.
listenBrainzRouter.get("/listenbrainz/recommendations", statsLimiter, async (req, res) => {
  const db = getDb();
  const conn = getListenBrainzConnection(db, req.userId!);
  if (!conn.connected || !conn.username) return res.json({ connected: false, items: [] });
  const token = getListenBrainzToken(db, req.userId!);
  const items = await getRecommendations(conn.username, token);
  res.json({ connected: true, items });
});

// GET /api/listenbrainz/fresh-releases — new releases from followed artists.
listenBrainzRouter.get("/listenbrainz/fresh-releases", statsLimiter, async (req, res) => {
  const db = getDb();
  const conn = getListenBrainzConnection(db, req.userId!);
  if (!conn.connected || !conn.username) return res.json({ connected: false, items: [] });
  const items = await getFreshReleases(conn.username);
  res.json({ connected: true, items });
});
