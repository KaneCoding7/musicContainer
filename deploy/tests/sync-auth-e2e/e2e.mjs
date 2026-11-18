// End-to-end: real backend + real Better Auth behind a real Caddy proxy (JSON access log).
import WebSocket from "/repo/backend/node_modules/ws/index.js";
const BASE = process.env.E2E_BASE || "http://caddy:8080";
import { createHash, randomBytes } from "node:crypto";
const results = []; const ok = (n, c, extra = "") => { results.push([c ? "PASS" : "FAIL", n, extra]); };
const j = async (r) => { try { return await r.json(); } catch { return null; } };
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
const email = `e2e${Date.now()}@test.local`, password = "correct-horse-battery-staple-9";
let r = await fetch(`${BASE}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, name: "E2E" }) });
ok("register", r.ok, r.status);
r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ email, password }) });
const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const sat = r.headers.get("set-auth-token");
const token = (await j(r))?.token; ok("sign-in returns session token", r.ok && !!token, r.status);
ok("sign-in response carries NO set-auth-token header (proxies log response headers)", sat === null);
const H = { Authorization: `Bearer ${token}` };
ok("API with Authorization header -> 200", (await fetch(`${BASE}/api/songs`, { headers: H })).status === 200);
ok("API with session token in URL -> 401", (await fetch(`${BASE}/api/songs?token=${encodeURIComponent(token)}`)).status === 401);
ok("media route with session token in URL -> 401", (await fetch(`${BASE}/api/songs/1/art?token=${encodeURIComponent(token)}`)).status === 401);
r = await fetch(`${BASE}/api/media-token`, { headers: H }); const m = await j(r);
ok("media-token issued (no-store)", r.ok && typeof m?.token === "string" && r.headers.get("cache-control") === "no-store");
ok("media-token endpoint without header -> 401", (await fetch(`${BASE}/api/media-token`)).status === 401);
const art = await fetch(`${BASE}/api/songs/999999/art?mt=${encodeURIComponent(m.token)}`);
ok("media route with mt -> authorized (404 for missing song, not 401)", art.status !== 401, art.status);
ok("non-media API with mt -> 401", (await fetch(`${BASE}/api/songs?mt=${encodeURIComponent(m.token)}`)).status === 401);
// --- a media token must never work as an account credential ---
const M = m.token;
await fetch(`${BASE}/api/songs/999999/art?mt=${encodeURIComponent(M)}`); // warm the media cache
for (const [label, hdr] of [["Bearer <mt>", `Bearer ${M}`], ["mt:<mt>", `mt:${M}`], ["raw <mt>", M]]) {
  ok(`mt as Authorization (${label}) on API -> 401`, (await fetch(`${BASE}/api/songs`, { headers: { Authorization: hdr } })).status === 401);
  ok(`mt as Authorization (${label}) cannot mint media tokens`, (await fetch(`${BASE}/api/media-token`, { headers: { Authorization: hdr } })).status === 401);
}
for (const method of ["DELETE", "PUT", "POST", "PATCH"]) {
  const st = (await fetch(`${BASE}/api/songs/1/art?mt=${encodeURIComponent(M)}`, { method })).status;
  ok(`mt on ${method} media route -> refused`, st === 401 || st === 404 || st === 405, st);
}
ok("mt on /api/media-token -> 401", (await fetch(`${BASE}/api/media-token?mt=${encodeURIComponent(M)}`)).status === 401);
ok("mt on playlist image upload -> 401", (await fetch(`${BASE}/api/playlists/1/image?mt=${encodeURIComponent(M)}`, { method: "PUT" })).status === 401);
const wsMt = await new Promise((res) => { const w = new WebSocket(BASE.replace("http", "ws") + "/api/sync"); w.on("open", () => w.send(JSON.stringify({ type: "auth", token: M }))); w.on("close", (c) => res(c)); setTimeout(() => res("timeout"), 8000); });
ok("mt as live-sync auth token -> 4401", wsMt === 4401, wsMt);
ok("session cookie alone is not accepted by the API (bearer header only)", !cookies || (await fetch(`${BASE}/api/songs`, { headers: { Cookie: cookies } })).status === 401, cookies ? "cookie tested" : "no cookie issued");
ok("tampered mt -> 401", (await fetch(`${BASE}/api/songs/1/art?mt=${encodeURIComponent(m.token.slice(0, -2) + "xx")}`)).status === 401);
// WebSocket through the proxy
const wsUrl = BASE.replace("http", "ws") + "/api/sync";
const legacy = await new Promise((res) => { const w = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`); w.on("unexpected-response", (_q, s) => res(s.statusCode)); w.on("open", () => res("opened")); w.on("error", () => res("error")); });
ok("legacy WS URL token refused through Caddy", legacy === 400, legacy);
const flow = await new Promise((res) => {
  const w = new WebSocket(wsUrl); const got = [];
  w.on("open", () => w.send(JSON.stringify({ type: "auth", token })));
  w.on("message", (d) => { const x = JSON.parse(d.toString()); got.push(x.type); if (x.type === "auth_ok") w.send(JSON.stringify({ type: "hello", deviceId: "e2e-dev", name: "E2E" })); if (x.type === "session") { w.close(); res(got); } });
  w.on("close", (c) => res(got.concat("close:" + c))); setTimeout(() => res(got.concat("timeout")), 8000);
});
ok("WS first-message auth through Caddy -> auth_ok then session", flow[0] === "auth_ok" && flow.includes("session"), flow.join(","));
const bad = await new Promise((res) => { const w = new WebSocket(wsUrl); w.on("open", () => w.send(JSON.stringify({ type: "auth", token: "nope" }))); w.on("close", (c) => res(c)); setTimeout(() => res("timeout"), 8000); });
ok("WS invalid token -> close 4401", bad === 4401, bad);
// --- compatibility: Subsonic clients and public share links are untouched ---
r = await fetch(`${BASE}/api/subsonic-credential`, { method: "POST", headers: H }); const sub = await j(r);
ok("subsonic credential issued (Bearer header)", r.ok && !!sub?.password);
const salt = randomBytes(6).toString("hex"), tt = createHash("md5").update(sub.password + salt).digest("hex");
const ping = await j(await fetch(`${BASE}/rest/ping.view?u=${encodeURIComponent(sub.username)}&t=${tt}&s=${salt}&v=1.16.1&c=e2e&f=json`));
ok("Subsonic client auth (u/t/s) still works", ping?.["subsonic-response"]?.status === "ok");
const pingP = await j(await fetch(`${BASE}/rest/ping.view?u=${encodeURIComponent(sub.username)}&p=${encodeURIComponent(sub.password)}&v=1.16.1&c=e2e&f=json`));
ok("Subsonic client auth (p=) still works", pingP?.["subsonic-response"]?.status === "ok");
const pingBad = await j(await fetch(`${BASE}/rest/ping.view?u=${encodeURIComponent(sub.username)}&t=${tt}&s=x${salt}&v=1.16.1&c=e2e&f=json`));
ok("Subsonic wrong credentials rejected", pingBad?.["subsonic-response"]?.status === "failed");
r = await fetch(`${BASE}/api/playlists`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ name: "e2e-share" }) }); const pl = await j(r);
const plId = pl?.id ?? pl?.playlist?.id;
r = await fetch(`${BASE}/api/playlists/${plId}/public`, { method: "POST", headers: H }); const shareBody = await j(r);
const shareTok = shareBody?.token ?? shareBody?.publicToken ?? shareBody?.share?.token;
ok("public share link created", r.ok && !!shareTok, `${r.status}`);
const pub = await fetch(`${BASE}/api/public/${encodeURIComponent(shareTok)}`);
ok("public share link readable WITHOUT auth", pub.status === 200, pub.status);
// sign out: session gone -> new media lookups fail once the 60 s cache entry expires
await fetch(`${BASE}/api/auth/sign-out`, { method: "POST", headers: { ...H, Origin: "http://localhost:3000" } });
await new Promise((r) => setTimeout(r, 61_000)); // the 60 s auth cache (pre-existing, documented) must expire
ok("61 s after sign-out: API with old session -> 401", (await fetch(`${BASE}/api/songs`, { headers: H })).status === 401);
ok("61 s after sign-out: old media token -> 401 (dies with the session)", (await fetch(`${BASE}/api/songs/1/art?mt=${encodeURIComponent(m.token)}`)).status === 401);
const after = await new Promise((res) => { const w = new WebSocket(wsUrl); w.on("open", () => w.send(JSON.stringify({ type: "auth", token }))); w.on("close", (c) => res(c)); setTimeout(() => res("timeout"), 8000); });
ok("after sign-out: WS auth with old session -> 4401", after === 4401, after);
// Credentials of the throwaway test user go to a file the runner scans, never to stdout.
(await import("node:fs")).writeFileSync("/e2e/out/secrets.json", JSON.stringify({ token, mt: m.token }));
console.log(JSON.stringify({ results }));
