import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { auth, DEV_AUTH_SECRET } from "./auth.js";
import { authSecret, requireAuth } from "./auth-middleware.js";
import { issueMediaToken } from "./media-token.js";
import { ART_DIR, getDb, MUSIC_DIR } from "./db/init.js";
import { sweepStaleSuggestions } from "./functional/songs.js";
import { allowAllOrigins, configuredOrigins, isPrivateOrigin } from "./origins.js";
import { rateLimit } from "./rate-limit.js";
import { attachSync } from "./sync.js";
import { friendsRouter } from "./routes/friends.js";
import { invitesRouter } from "./routes/invites.js";
import { lastfmRouter } from "./routes/lastfm.js";
import { listenBrainzRouter } from "./routes/listenbrainz.js";
import { playlistsRouter } from "./routes/playlists.js";
import { publicRouter } from "./routes/public.js";
import { registerRouter } from "./routes/register.js";
import { sharesRouter } from "./routes/shares.js";
import { songsRouter } from "./routes/songs.js";
import {
  subsonicRouter,
  subsonicCredentialRouter,
} from "./routes/subsonic.js";

const INVITE_ONLY = process.env.INVITE_ONLY === "true";

const PORT = Number(process.env.PORT ?? 3001);

// Refuse to start in production without a strong, non-default auth secret.
if (process.env.NODE_ENV === "production") {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret === DEV_AUTH_SECRET || secret.length < 32) {
    console.error(
      "FATAL: BETTER_AUTH_SECRET must be set to a strong (>=32 char) value in production."
    );
    process.exit(1);
  }
}

const app = express();

// Behind Cloudflare Tunnel / a reverse proxy, trust forwarded headers so
// req.ip reflects the real client (used by rate limiting).
app.set("trust proxy", true);

// Baseline security headers. The API returns JSON/audio (never HTML), so the
// key ones are nosniff (don't let a reflected response be sniffed as HTML) and
// denying framing/referrer leakage.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(
  cors({
    // Allow the configured public origin(s) plus localhost / private-LAN so the
    // app works on the local network. (Bearer-token auth is the real access
    // control; CORS just governs which browser origins may read responses.)
    origin: (origin, cb) => {
      if (!origin || allowAllOrigins) return cb(null, true);
      if (configuredOrigins.includes(origin) || isPrivateOrigin(origin))
        return cb(null, true);
      return cb(null, false);
    },
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

// Never emit the session token in a response header. Better Auth's bearer plugin
// adds "set-auth-token" to auth responses, and reverse proxies that log response
// headers (Caddy's JSON log does) would record a live session token. The client
// reads the token from the sign-in JSON body, so the header is dropped here.
const HIDDEN_RESPONSE_HEADERS = new Set(["set-auth-token"]);
app.use("/api/auth", (_req, res, next) => {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    HIDDEN_RESPONSE_HEADERS.has(String(name).toLowerCase()) ? res : setHeader(name, value)) as typeof res.setHeader;
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => typeof res;
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    for (const h of HIDDEN_RESPONSE_HEADERS) res.removeHeader(h);
    const args = rest.map((a) => {
      if (Array.isArray(a)) {
        // flat [k, v, k, v] or nested [[k, v]] header arrays
        if (a.length && Array.isArray(a[0])) return (a as [string, unknown][]).filter(([k]) => !HIDDEN_RESPONSE_HEADERS.has(String(k).toLowerCase()));
        const out: unknown[] = [];
        for (let i = 0; i < a.length; i += 2) if (!HIDDEN_RESPONSE_HEADERS.has(String(a[i]).toLowerCase())) out.push(a[i], a[i + 1]);
        return out;
      }
      if (a && typeof a === "object") {
        return Object.fromEntries(Object.entries(a as Record<string, unknown>).filter(([k]) => !HIDDEN_RESPONSE_HEADERS.has(k.toLowerCase())));
      }
      return a;
    });
    return writeHead(status, ...args);
  }) as typeof res.writeHead;
  next();
});

// Better Auth routes must be mounted BEFORE express.json() so the handler can
// read the raw request body.
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

// Health check (public).
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public client config — lets the sign-in screen reflect server settings (e.g.
// whether an invite code is required to register) without hardcoding them.
app.get("/api/config", (_req, res) => {
  res.json({ inviteOnly: INVITE_ONLY });
});

// Registration wrapper (public; enforces invites when enabled). Rate-limited
// since it isn't behind Better Auth's own throttling.
app.use("/api/register", rateLimit({ windowMs: 60_000, max: 5 }));
app.use("/api", registerRouter);

// Public share-link routes (no auth; gated by the opaque token).
app.use("/api", publicRouter);

// Subsonic / OpenSubsonic API for third-party clients (DSub, Symfonium, ...).
// Has its own credential scheme (username + generated Subsonic password), so
// it's mounted outside Better Auth.
app.use("/rest", subsonicRouter);

// Scoped media token for <audio>/<img>/download URLs (never the session token).
// Requires the session in the Authorization header.
app.get("/api/media-token", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(issueMediaToken(authSecret(), req.userId!, req.sessionId!));
});

// Feature routes (require authentication; data is scoped per user).
app.use("/api", requireAuth, songsRouter);
app.use("/api", requireAuth, subsonicCredentialRouter);
app.use("/api", requireAuth, listenBrainzRouter);
app.use("/api", requireAuth, lastfmRouter);
app.use("/api", requireAuth, playlistsRouter);
app.use("/api", requireAuth, invitesRouter);
app.use("/api", requireAuth, sharesRouter);
app.use("/api", requireAuth, friendsRouter);

// Initialize the database (creates schema + data dirs) before serving.
getDb();

// Suggestion-radio safety net: purge un-kept suggestion tracks (played, never
// kept/liked/added to a playlist) that the client failed to discard — closed
// tab, crash, or went offline mid-listen. Runs once on boot and hourly so
// nothing accumulates on disk. Best-effort; a failure never stops the server.
const sweepSuggestions = () => {
  try {
    const n = sweepStaleSuggestions(getDb(), MUSIC_DIR, ART_DIR);
    if (n > 0) console.log(`Swept ${n} stale suggestion track(s)`);
  } catch {
    /* best-effort */
  }
};
sweepSuggestions();
setInterval(sweepSuggestions, 60 * 60 * 1000).unref();

// Use an explicit HTTP server so the cross-device sync WebSocket can attach.
const server = createServer(app);
attachSync(server);

server.listen(PORT, () => {
  console.log(`Music server backend listening on http://localhost:${PORT}`);
});
