import { Router } from "express";
import { getDb } from "../db/init.js";
import {
  deleteListenBrainzToken,
  getListenBrainzConnection,
  setListenBrainzToken,
} from "../functional/listenbrainz.js";
import { validateToken } from "../listenbrainz.js";
import { rateLimit } from "../rate-limit.js";

// Per-user ListenBrainz connection. Mounted under /api with requireAuth.
export const listenBrainzRouter = Router();

// Validating a token hits an external API — throttle it lightly.
const connectLimiter = rateLimit({ windowMs: 60_000, max: 20 });

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
