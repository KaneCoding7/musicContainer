import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

// Isolated data dir BEFORE any module that reads DATA_DIR is imported.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sync-auth-test-"));
process.env.BETTER_AUTH_SECRET = "test-secret-for-media-tokens-0123456789";

const SECRET = process.env.BETTER_AUTH_SECRET;
const GOOD = "good-session-token-AAAA";
const GOOD2 = "good-session-token-BBBB";
let revoked = new Set<string>();
let failing = false; // simulate a transient auth backend error (DB busy)
const authenticate = async (t: string) => {
  await new Promise((r) => setTimeout(r, 20)); // simulate a DB lookup
  if (failing || t === "boom") throw new Error("db busy");
  if (revoked.has(t)) return null;
  return t === GOOD ? "user-1" : t === GOOD2 ? "user-2" : null;
};

let sync: typeof import("../src/sync.js");
let mt: typeof import("../src/media-token.js");
let mw: typeof import("../src/auth-middleware.js");
let db: import("better-sqlite3").Database;
let server: Server;
let base: string;
const logged: string[] = [];

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "));
    });
  }
  sync = await import("../src/sync.js");
  mt = await import("../src/media-token.js");
  mw = await import("../src/auth-middleware.js");
  db = (await import("../src/db/init.js")).getDb();
  server = createServer((_req, res) => res.end("ok"));
  sync.attachSync(server, { authenticate, authTimeoutMs: 300, revalidateMs: 150 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
});
afterEach(() => {
  revoked = new Set();
  failing = false;
});

// --- helpers --------------------------------------------------------------
type Conn = { ws: WebSocket; msgs: any[]; closed: Promise<{ code: number }> };
function open(path = "/api/sync"): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    const msgs: any[] = [];
    const closed = new Promise<{ code: number }>((r) => ws.on("close", (code) => r({ code })));
    ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
    ws.on("open", () => resolve({ ws, msgs, closed }));
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on("error", reject);
  });
}
const waitFor = async (cond: () => boolean, ms = 1500) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const send = (c: Conn, m: unknown) => c.ws.send(JSON.stringify(m));
async function authed(token = GOOD): Promise<Conn> {
  const c = await open();
  send(c, { type: "auth", token });
  await waitFor(() => c.msgs.some((m) => m.type === "auth_ok"));
  return c;
}

// --- live-sync protocol ---------------------------------------------------
describe("live-sync authentication (first-message auth)", () => {
  it("refuses any credential in the URL (no upgrade)", async () => {
    await expect(open(`/api/sync?token=${GOOD}`)).rejects.toThrow("HTTP 400");
    await expect(open(`/api/sync?x=1`)).rejects.toThrow("HTTP 400");
  });

  it("valid auth -> auth_ok, then hello returns the private session", async () => {
    const c = await authed();
    send(c, { type: "hello", deviceId: "dev-a", name: "Laptop" });
    await waitFor(() => c.msgs.some((m) => m.type === "session"));
    const sess = c.msgs.find((m) => m.type === "session");
    expect(sess.devices).toEqual([{ id: "dev-a", name: "Laptop" }]);
    c.ws.close();
  });

  it("sends nothing and acts on nothing before authentication", async () => {
    const c = await open();
    send(c, { type: "hello", deviceId: "sneaky", name: "x" }); // not an auth message
    const { code } = await c.closed;
    expect(code).toBe(sync.SYNC_CLOSE.AUTH_REQUIRED);
    expect(c.msgs).toEqual([]); // no session data leaked
  });

  it("rejects an invalid token", async () => {
    const c = await open();
    send(c, { type: "auth", token: "not-a-real-token" });
    const { code } = await c.closed;
    expect(code).toBe(sync.SYNC_CLOSE.AUTH_REQUIRED);
    expect(c.msgs.map((m) => m.type)).toEqual(["auth_error"]);
  });

  it("rejects a missing / empty / non-string token", async () => {
    for (const bad of [{ type: "auth" }, { type: "auth", token: "" }, { type: "auth", token: 42 }, "not json"]) {
      const c = await open();
      if (typeof bad === "string") c.ws.send(bad);
      else send(c, bad);
      const { code } = await c.closed;
      expect(code).toBe(sync.SYNC_CLOSE.AUTH_REQUIRED);
      expect(c.msgs.filter((m) => m.type === "session")).toEqual([]);
    }
  });

  it("closes connections that never authenticate (timeout)", async () => {
    const c = await open();
    const { code } = await c.closed;
    expect(code).toBe(sync.SYNC_CLOSE.AUTH_TIMEOUT);
    expect(c.msgs).toEqual([]);
  });

  it("drops messages sent while the auth check is pending (no early subscription)", async () => {
    const c = await open();
    send(c, { type: "auth", token: GOOD });
    send(c, { type: "hello", deviceId: "early", name: "x" }); // arrives before auth_ok
    await waitFor(() => c.msgs.some((m) => m.type === "auth_ok"));
    await new Promise((r) => setTimeout(r, 60));
    expect(c.msgs.filter((m) => m.type === "session")).toEqual([]); // hello was not processed
    c.ws.close();
  });

  it("disconnects when the session is revoked/expired mid-connection", async () => {
    const c = await authed();
    send(c, { type: "hello", deviceId: "dev-r", name: "x" });
    await waitFor(() => c.msgs.some((m) => m.type === "session"));
    revoked.add(GOOD);
    const { code } = await c.closed;
    expect(code).toBe(sync.SYNC_CLOSE.AUTH_REQUIRED);
  });

  it("reconnects cleanly with the same device id (no duplicate device)", async () => {
    const a = await authed();
    send(a, { type: "hello", deviceId: "dev-x", name: "Phone" });
    await waitFor(() => a.msgs.some((m) => m.type === "session"));
    a.ws.close();
    await a.closed;
    const b = await authed();
    send(b, { type: "hello", deviceId: "dev-x", name: "Phone" });
    await waitFor(() => b.msgs.some((m) => m.type === "session"));
    const devs = b.msgs.filter((m) => m.type === "session").at(-1).devices;
    expect(devs.filter((d: { id: string }) => d.id === "dev-x")).toHaveLength(1);
    b.ws.close();
  });

  it("keeps users isolated: one user never receives another user's session", async () => {
    const u1 = await authed(GOOD);
    const u2 = await authed(GOOD2);
    send(u1, { type: "hello", deviceId: "u1-dev", name: "U1" });
    send(u2, { type: "hello", deviceId: "u2-dev", name: "U2" });
    await waitFor(() => u1.msgs.some((m) => m.type === "session") && u2.msgs.some((m) => m.type === "session"));
    send(u1, { type: "state", state: { currentIndex: 3, secret: "u1-private" } });
    await new Promise((r) => setTimeout(r, 80));
    const u2text = JSON.stringify(u2.msgs);
    expect(u2text).not.toContain("u1-private");
    expect(u2text).not.toContain("u1-dev");
    u1.ws.close();
    u2.ws.close();
  });

  it("live sync still works: state broadcast and command forwarding between devices", async () => {
    const tv = await authed();
    const phone = await authed();
    send(tv, { type: "hello", deviceId: "tv", name: "TV" });
    send(phone, { type: "hello", deviceId: "phone", name: "Phone" });
    await waitFor(() => tv.msgs.some((m) => m.type === "session") && phone.msgs.some((m) => m.type === "session"));
    send(tv, { type: "claim" });
    send(tv, { type: "state", state: { currentIndex: 1, position: 42 } });
    await waitFor(() => phone.msgs.some((m) => m.type === "session" && m.state?.position === 42));
    send(phone, { type: "command", command: { type: "togglePlay" } });
    await waitFor(() => tv.msgs.some((m) => m.type === "command" && m.command?.type === "togglePlay"));
    tv.ws.close();
    phone.ws.close();
  });
});

describe("live-sync hardening (review findings)", () => {
  it("refuses an oversized frame before authentication", async () => {
    const c = await open();
    c.ws.send(JSON.stringify({ type: "auth", token: GOOD, pad: "x".repeat(20_000) }));
    const { code } = await c.closed;
    expect(code).toBe(sync.SYNC_CLOSE.AUTH_REQUIRED);
    expect(c.msgs.filter((m) => m.type !== "auth_error")).toEqual([]);
  });
  it("accepts large state snapshots after authentication (big queues)", async () => {
    const a = await authed();
    const b = await authed();
    send(a, { type: "hello", deviceId: "big-a", name: "A" });
    send(b, { type: "hello", deviceId: "big-b", name: "B" });
    await waitFor(() => a.msgs.some((m) => m.type === "session") && b.msgs.some((m) => m.type === "session"));
    send(a, { type: "claim" });
    const queue = Array.from({ length: 2000 }, (_, i) => ({ id: i, title: "t".repeat(300) })); // ~650 KB
    send(a, { type: "state", state: { currentIndex: 0, queue } });
    await waitFor(() => b.msgs.some((m) => m.type === "session" && m.state?.queue?.length === 2000), 3000);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    a.ws.close();
    b.ws.close();
  });
  it("a transient auth error is 'busy' (client retries), not 'invalid'", async () => {
    const c = await open();
    send(c, { type: "auth", token: "boom" });
    const { code } = await c.closed;
    expect(code).toBe(sync.SYNC_CLOSE.BUSY);
  });
  it("a transient error during revalidation keeps the connection", async () => {
    const c = await authed();
    failing = true;
    await new Promise((r) => setTimeout(r, 400)); // > 2 revalidation rounds
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    failing = false;
    c.ws.close();
  });
  it("caps unauthenticated sockets per client (and frees slots once authenticated)", async () => {
    const srv = createServer();
    sync.attachSync(srv, { authenticate, authTimeoutMs: 2000, maxPendingPerIp: 2 });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const url = `ws://127.0.0.1:${(srv.address() as AddressInfo).port}/api/sync`;
    const mk = () => new Promise<{ ws: WebSocket; closed: Promise<number> }>((res) => {
      const ws = new WebSocket(url); const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
      ws.on("open", () => res({ ws, closed }));
    });
    const p1 = await mk(); const p2 = await mk(); const p3 = await mk();
    expect(await p3.closed).toBe(sync.SYNC_CLOSE.BUSY);
    p1.ws.send(JSON.stringify({ type: "auth", token: GOOD }));
    await new Promise((r) => setTimeout(r, 100));
    const p4 = await mk(); // slot freed by p1's successful auth
    await new Promise((r) => setTimeout(r, 50));
    expect(p4.ws.readyState).toBe(WebSocket.OPEN);
    for (const p of [p1, p2, p4]) p.ws.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });
});

// --- scoped media tokens ----------------------------------------------------
describe("media tokens", () => {
  const NOW = 1_800_000_000_000;
  it("round-trips and binds user + session", () => {
    const { token, expiresAt } = mt.issueMediaToken(SECRET, "user-1", "sess-1", NOW);
    expect(token.startsWith("m1.")).toBe(true);
    expect(expiresAt).toBe(NOW + mt.MEDIA_TOKEN_TTL_MS);
    expect(mt.verifyMediaToken(SECRET, token, NOW + 1000)).toEqual({ userId: "user-1", sessionId: "sess-1", expiresAt });
  });
  it("rejects expired, tampered, wrong-secret, wrong-version and oversized tokens", () => {
    const { token } = mt.issueMediaToken(SECRET, "user-1", "sess-1", NOW);
    expect(mt.verifyMediaToken(SECRET, token, NOW + mt.MEDIA_TOKEN_TTL_MS + 1)).toBeNull();
    const [v, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "user-2", s: "sess-1", e: NOW + 9e9 })).toString("base64url");
    expect(mt.verifyMediaToken(SECRET, `${v}.${forged}.${s}`, NOW)).toBeNull();
    expect(mt.verifyMediaToken("another-secret-xxxxxxxxxxxxxxxxxxxxx", token, NOW)).toBeNull();
    expect(mt.verifyMediaToken(SECRET, `m0.${p}.${s}`, NOW)).toBeNull();
    expect(mt.verifyMediaToken(SECRET, "x".repeat(2000), NOW)).toBeNull();
    expect(mt.verifyMediaToken(SECRET, "garbage", NOW)).toBeNull();
  });
});

// --- requireAuth: credentials never from the URL ------------------------------
describe("requireAuth", () => {
  const exp = new Date(Date.now() + 3600_000).toISOString();
  beforeAll(() => {
    db.prepare(`INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user-1','U','u1@test.com',0,datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT OR REPLACE INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('sess-live', ?, 'tok-live', datetime('now'), datetime('now'), 'user-1')`).run(exp);
  });
  function call(opts: { path: string; method?: string; query?: Record<string, string>; headers?: Record<string, string> }) {
    const req: any = { path: opts.path, method: opts.method ?? "GET", query: opts.query ?? {}, headers: opts.headers ?? {} };
    let status = 200;
    let nextCalled = false;
    const res: any = { status(c: number) { status = c; return res; }, json() { return res; } };
    return mw.requireAuth(req, res, () => { nextCalled = true; }).then(() => ({ status, nextCalled, req }));
  }
  const media = () => mt.issueMediaToken(SECRET, "user-1", "sess-live").token;

  it("ignores ?token= (session tokens are never accepted from the URL)", async () => {
    const r = await call({ path: "/songs/1/art", query: { token: "tok-live" } });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(401);
  });
  it("accepts a valid media token on media GET endpoints", async () => {
    for (const path of ["/songs/7/art", "/songs/7/stream", "/songs/7/clip", "/songs/7/download", "/artists/image", "/playlists/3/image", "/playlists/3/download"]) {
      const r = await call({ path, query: { mt: media() } });
      expect(r.nextCalled, path).toBe(true);
      expect(r.req.userId).toBe("user-1");
    }
  });
  it("refuses a media token on non-media endpoints and on non-GET methods", async () => {
    for (const path of ["/songs", "/songs/7", "/playlists", "/media-token", "/songs/7/lyrics", "/artists/images"]) {
      const r = await call({ path, query: { mt: media() } });
      expect(r.nextCalled, path).toBe(false);
    }
    const del = await call({ path: "/songs/7/art", method: "DELETE", query: { mt: media() } });
    expect(del.nextCalled).toBe(false);
  });
  it("a media token can NEVER be used as an Authorization credential (cache-collision regression)", async () => {
    const m = media();
    expect((await call({ path: "/songs/1/art", query: { mt: m } })).nextCalled).toBe(true); // warm the media cache
    for (const h of [`mt:${m}`, m, `Bearer ${m}`, `bearer mt:${m}`]) {
      const r = await call({ path: "/songs", method: "DELETE", headers: { authorization: h } });
      expect(r.nextCalled, h.slice(0, 12)).toBe(false);
      const r2 = await call({ path: "/media-token", headers: { authorization: h } });
      expect(r2.nextCalled).toBe(false);
    }
  });
  it("rejects malformed Authorization headers", async () => {
    for (const h of ["Basic dXNlcjpwYXNz", "Bearer", "Bearer short", "tok-live", "Bearer tok-live extra"]) {
      expect((await call({ path: "/songs", headers: { authorization: h } })).nextCalled, h).toBe(false);
    }
  });
  it("allows HEAD on media endpoints with a media token", async () => {
    expect((await call({ path: "/songs/7/stream", method: "HEAD", query: { mt: media() } })).nextCalled).toBe(true);
  });
  it("refuses media tokens whose session was revoked or expired", async () => {
    const t = mt.issueMediaToken(SECRET, "user-1", "sess-gone").token;
    expect((await call({ path: "/songs/1/art", query: { mt: t } })).nextCalled).toBe(false);
    const expired = mt.issueMediaToken(SECRET, "user-1", "sess-live", Date.now() - 13 * 3600_000).token;
    expect((await call({ path: "/songs/1/art", query: { mt: expired } })).nextCalled).toBe(false);
  });
});

// --- leakage regressions ------------------------------------------------------
describe("credential leakage", () => {
  it("never logs session tokens or media tokens", () => {
    const all = logged.join("\n");
    for (const secret of [GOOD, GOOD2, "tok-live", "m1."]) expect(all).not.toContain(secret);
  });
  it("no frontend code puts a session token in a URL", () => {
    const root = join(__dirname, "..", "..", "frontend", "src");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|svelte|js)$/.test(f)) {
          readFileSync(p, "utf8").split("\n").forEach((line, i) => {
            if (/[?&]token=/.test(line) && !/lastfm|Last\.fm/i.test(line + p)) hits.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
