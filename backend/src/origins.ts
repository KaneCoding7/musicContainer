// Shared origin helpers used by CORS (server.ts) and Better Auth's trusted
// origins (auth.ts).
//
// This is a self-hosted app, so in addition to any explicitly configured public
// origin we trust localhost and private-LAN origins. That lets the app be used
// on the local network (e.g. http://192.168.0.215:3000) with no per-IP config.

// True for http(s) origins on localhost or an RFC1918 private network.
export function isPrivateOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local") ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

const split = (v: string | undefined): string[] =>
  v?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];

// Explicitly configured allowed origins: the public frontend hostname
// (FRONTEND_ORIGIN, comma-separated) plus any BETTER_AUTH_TRUSTED_ORIGINS.
export const configuredOrigins: string[] = [
  ...split(process.env.FRONTEND_ORIGIN),
  ...split(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
];

// When no public frontend origin is configured (local dev), allow any origin.
export const allowAllOrigins = (process.env.FRONTEND_ORIGIN ?? "").trim() === "";
