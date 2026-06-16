import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { getDb } from "./db/init.js";

// Better Auth instance. Uses our existing SQLite connection, email/password
// auth, and the bearer plugin so clients authenticate with an
// `Authorization: Bearer <token>` header (token kept in localStorage).
// Origins allowed to call the auth endpoints (CSRF protection). The frontend
// runs on a different origin than the API, so it must be trusted explicitly.
const trustedOrigins = [
  process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  "http://localhost:5173", // SvelteKit dev server
  ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean) ?? []),
];

export const auth = betterAuth({
  database: getDb(),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me-in-production",
  trustedOrigins,
  emailAndPassword: { enabled: true },
  plugins: [bearer()],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // The very first account becomes the owner and claims any existing
          // (pre-auth) songs/playlists that have no owner yet.
          const db = getDb();
          const { c } = db
            .prepare('SELECT COUNT(*) AS c FROM "user"')
            .get() as { c: number };
          if (c === 1) {
            db.prepare(
              "UPDATE songs SET user_id = ? WHERE user_id IS NULL"
            ).run(user.id);
            db.prepare(
              "UPDATE playlists SET user_id = ? WHERE user_id IS NULL"
            ).run(user.id);
          }
        },
      },
    },
  },
});
