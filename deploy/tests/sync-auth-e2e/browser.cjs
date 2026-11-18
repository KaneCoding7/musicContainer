// Real-browser check of the built frontend's live-sync + media URLs (run on the host with Playwright).
// Args: <frontend-url> <api-base> <marker-dir>  (backend restarts are done by the HOST via marker files;
// this container gets no docker socket)
const { chromium } = require("/pw/node_modules/playwright");
const fs = require("fs");
const [FE, API, MARK] = process.argv.slice(2);
// ask the host to restart the backend, wait for its acknowledgement
async function hostRestart(name) {
  fs.writeFileSync(`${MARK}/${name}.req`, "1");
  for (let i = 0; i < 240; i++) { if (fs.existsSync(`${MARK}/${name}.ack`)) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}
const results = []; const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n, x]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const email = `br${Date.now()}@test.local`, password = "correct-horse-battery-staple-9", O = { Origin: FE };
  await fetch(`${API}/api/register`, { method: "POST", headers: { "Content-Type": "application/json", ...O }, body: JSON.stringify({ email, password, name: "Browser" }) });
  const token = (await (await fetch(`${API}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", ...O }, body: JSON.stringify({ email, password }) })).json()).token;
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const sockets = []; const reqUrls = [];
  page.on("request", (r) => reqUrls.push(r.url()));
  page.on("websocket", (ws) => {
    const rec = { url: ws.url(), sent: [], recv: [], closed: false };
    sockets.push(rec);
    ws.on("framesent", (f) => { try { rec.sent.push(JSON.parse(f.payload).type); } catch {} });
    ws.on("framereceived", (f) => { try { rec.recv.push(JSON.parse(f.payload).type); } catch {} });
    ws.on("close", () => (rec.closed = true));
  });
  await page.addInitScript((t) => localStorage.setItem("music_token", t), token);
  await page.goto(FE, { waitUntil: "domcontentloaded" });
  const until = async (cond, ms) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await sleep(250); } return true; };
  ok("browser opens a live-sync socket and authenticates", await until(() => sockets.some((s) => s.recv.includes("auth_ok")), 30000));
  const s0 = sockets[0] || { url: "", sent: [] };
  ok("WebSocket URL carries no query/credential", !!s0.url && !s0.url.includes("?"), s0.url.replace(/^(wss?:\/\/)[^/]+/, "$1<host>"));
  ok("first frame sent is auth; hello only after auth_ok", s0.sent[0] === "auth" && s0.sent.indexOf("hello") > 0, s0.sent.slice(0, 3).join(","));
  ok("media-token fetched by the app", reqUrls.some((u) => u.includes("/api/media-token")));
  // temporary network failure: restart the backend under the open page
  const n0 = sockets.length;
  await hostRestart("restart1");
  ok("after a backend restart the client reconnects and re-authenticates", await until(() => sockets.length > n0 && sockets.at(-1).recv.includes("auth_ok"), 60000), `sockets=${sockets.length}`);
  // revoked session: sign out server-side, force a reconnect, expect 4401 and NO retry loop
  await fetch(`${API}/api/auth/sign-out`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...O } });
  await hostRestart("restart2");
  await sleep(20000);
  const after = sockets.slice(-1)[0];
  const recent = sockets.length;
  await sleep(12000);
  ok("revoked session: reconnect is refused and the client stops retrying", sockets.length === recent && after && !after.recv.slice(-1).includes("auth_ok"), `sockets total=${sockets.length}`);
  ok("no request URL ever contained token=", !reqUrls.some((u) => /[?&]token=/.test(u)) && !sockets.some((s) => /token=/.test(s.url)));
  await browser.close();
  console.log(JSON.stringify({ results }));
})().catch((e) => { console.log(JSON.stringify({ results: results.concat([["FAIL", "browser test crashed", String(e).slice(0, 200)]]) })); process.exit(1); });
