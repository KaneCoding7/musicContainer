import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { auth } from "./auth.js";
import { requireAuth } from "./auth-middleware.js";
import { getDb } from "./db/init.js";
import { playlistsRouter } from "./routes/playlists.js";
import { songsRouter } from "./routes/songs.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? true,
    credentials: true,
  })
);

// Better Auth routes must be mounted BEFORE express.json() so the handler can
// read the raw request body.
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

// Health check (public).
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Feature routes (require authentication; data is scoped per user).
app.use("/api", requireAuth, songsRouter);
app.use("/api", requireAuth, playlistsRouter);

// Initialize the database (creates schema + data dirs) before serving.
getDb();

app.listen(PORT, () => {
  console.log(`Music server backend listening on http://localhost:${PORT}`);
});
