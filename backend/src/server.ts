import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { auth } from "./auth.js";
import { requireAuth } from "./auth-middleware.js";
import { getDb } from "./db/init.js";
import { invitesRouter } from "./routes/invites.js";
import { playlistsRouter } from "./routes/playlists.js";
import { registerRouter } from "./routes/register.js";
import { songsRouter } from "./routes/songs.js";

const INVITE_ONLY = process.env.INVITE_ONLY === "true";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? true,
    credentials: true,
  })
);

// In invite-only mode, block Better Auth's direct sign-up so registration must
// go through /api/register (which enforces the invite). Must precede the auth
// handler below.
if (INVITE_ONLY) {
  app.post("/api/auth/sign-up/email", (_req, res) => {
    res
      .status(403)
      .json({ message: "Registration is invite-only. Use an invite link." });
  });
}

// Better Auth routes must be mounted BEFORE express.json() so the handler can
// read the raw request body.
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

// Health check (public).
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Registration wrapper (public; enforces invites when enabled).
app.use("/api", registerRouter);

// Feature routes (require authentication; data is scoped per user).
app.use("/api", requireAuth, songsRouter);
app.use("/api", requireAuth, playlistsRouter);
app.use("/api", requireAuth, invitesRouter);

// Initialize the database (creates schema + data dirs) before serving.
getDb();

app.listen(PORT, () => {
  console.log(`Music server backend listening on http://localhost:${PORT}`);
});
