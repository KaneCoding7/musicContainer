import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { auth } from "./auth.js";
import { getDb } from "./db/init.js";

// Cross-device playback sync (Spotify Connect style). Each account has one
// session: a set of connected devices, one "active" device (the audio output),
// and the last playback state the active device reported. Remotes send commands
// that are forwarded to the active device; everyone receives state broadcasts.

interface DeviceConn {
  id: string;
  name: string;
  socket: WebSocket;
}

interface Session {
  devices: Map<string, DeviceConn>;
  activeDeviceId: string | null;
  // Name of the active device, remembered even while its socket is briefly
  // gone (e.g. iOS suspends the WebSocket during background playback) so other
  // devices still show "Playing on <name>" rather than "another device".
  activeDeviceName: string | null;
  state: unknown | null; // last PlaybackState pushed by the active device
}

const sessions = new Map<string, Session>(); // keyed by userId

// Commands that express "start playing this here" — the only ones allowed to
// move audio output to the commanding device when no active device is currently
// connected. Everything else only controls existing playback.
const PLAY_INTENT_COMMANDS = new Set(["playQueue", "playList", "shufflePlay"]);

// The active device id is persisted per user so a refresh or server restart
// defaults playback back to the last device that had output, rather than
// letting another open device grab it.
function loadActiveDevice(userId: string): string | null {
  const row = getDb()
    .prepare("SELECT active_device_id FROM sync_active_device WHERE user_id = ?")
    .get(userId) as { active_device_id: string | null } | undefined;
  return row?.active_device_id ?? null;
}

function setActiveDevice(userId: string, s: Session, deviceId: string | null): void {
  s.activeDeviceId = deviceId;
  s.activeDeviceName = deviceId
    ? s.devices.get(deviceId)?.name ?? s.activeDeviceName
    : null;
  getDb()
    .prepare(
      `INSERT INTO sync_active_device (user_id, active_device_id, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         active_device_id = excluded.active_device_id,
         updated_at = excluded.updated_at`
    )
    .run(userId, deviceId);
}

function getSession(userId: string): Session {
  let s = sessions.get(userId);
  if (!s) {
    s = {
      devices: new Map(),
      activeDeviceId: loadActiveDevice(userId), // restore last-active device
      activeDeviceName: null, // re-learned when that device next connects
      state: null,
    };
    sessions.set(userId, s);
  }
  return s;
}

function deviceList(s: Session) {
  return [...s.devices.values()].map((d) => ({ id: d.id, name: d.name }));
}

function sessionMessage(s: Session): string {
  return JSON.stringify({
    type: "session",
    activeDeviceId: s.activeDeviceId,
    activeDeviceName: s.activeDeviceName,
    devices: deviceList(s),
    state: s.state,
  });
}

function broadcast(userId: string): void {
  const s = sessions.get(userId);
  if (!s) return;
  const msg = sessionMessage(s);
  for (const d of s.devices.values()) {
    if (d.socket.readyState === WebSocket.OPEN) d.socket.send(msg);
  }
}

// Validate a session bearer token and return the user id (null if invalid/expired).
// Throws on transient errors (DB busy, ...) so callers can tell "invalid" from "try later".
async function authUser(token: string | null): Promise<string | null> {
  if (!token) return null;
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
}

// Close codes the client understands (4000-4999 are application-defined).
export const SYNC_CLOSE = {
  AUTH_REQUIRED: 4401, // first message wasn't a valid auth message, or the session was revoked/expired
  AUTH_TIMEOUT: 4408, // no auth message within authTimeoutMs
  BUSY: 4503, // transient server error / too many pending connections: client retries
} as const;

export interface SyncOptions {
  // Resolve a session token to a user id; null = invalid/expired; THROW = transient error.
  authenticate?: (token: string) => Promise<string | null>; // injectable for tests
  authTimeoutMs?: number;
  revalidateMs?: number;
  maxPending?: number; // unauthenticated sockets, global
  maxPendingPerIp?: number;
}

const PRE_AUTH_MAX_BYTES = 8 * 1024; // an auth frame is tiny
const POST_AUTH_MAX_BYTES = 16 * 1024 * 1024; // state snapshots carry the whole queue

type SyncMsg = {
  type?: string;
  token?: unknown;
  deviceId?: string;
  name?: string;
  state?: { currentIndex?: number | null } | null;
  command?: unknown;
};

// Protocol (v2): the session token is NEVER put in the WebSocket URL (URLs end up
// in reverse-proxy / tunnel access logs). The client opens /api/sync with no query
// string and its FIRST frame must be {"type":"auth","token":"<session token>"}.
// Until the server answers {"type":"auth_ok"}, nothing is sent to the client and
// no other message is acted on. The session is re-validated periodically, so a
// signed-out or expired session is disconnected (close code 4401).
export function attachSync(server: Server, opts: SyncOptions = {}): WebSocketServer {
  const authenticate = opts.authenticate ?? authUser;
  const authTimeoutMs = opts.authTimeoutMs ?? 5_000;
  const revalidateMs = opts.revalidateMs ?? 5 * 60_000;
  const maxPending = opts.maxPending ?? 200;
  const maxPendingPerIp = opts.maxPendingPerIp ?? 20;
  const wss = new WebSocketServer({ noServer: true, maxPayload: POST_AUTH_MAX_BYTES });
  let pending = 0;
  const pendingByIp = new Map<string, number>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/api/sync") {
      socket.destroy();
      return;
    }
    // Credentials (or anything else) in the URL are refused outright, so a token
    // can never be logged by an upstream proxy for this endpoint.
    if (url.search) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // Cap unauthenticated sockets (global + per client IP) so they can't be hoarded.
    const ip = String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
    if (pending >= maxPending || (pendingByIp.get(ip) ?? 0) >= maxPendingPerIp) {
      ws.close(SYNC_CLOSE.BUSY, "too many pending connections");
      return;
    }
    pending++;
    pendingByIp.set(ip, (pendingByIp.get(ip) ?? 0) + 1);
    let counted = true;
    const release = () => {
      if (!counted) return;
      counted = false;
      pending--;
      const n = (pendingByIp.get(ip) ?? 1) - 1;
      if (n <= 0) pendingByIp.delete(ip);
      else pendingByIp.set(ip, n);
    };
    let userId: string | null = null;
    let token: string | null = null;
    let authPending = false;
    let deviceId: string | null = null;
    let s: Session | null = null;
    let revalidate: ReturnType<typeof setInterval> | null = null;

    const authTimer = setTimeout(() => {
      if (!userId) ws.close(SYNC_CLOSE.AUTH_TIMEOUT, "authentication timeout");
    }, authTimeoutMs);

    // "error" = transient failure (retry later), distinct from an invalid token (null).
    const safeAuth = async (t: string): Promise<string | null | "error"> => {
      try {
        return await authenticate(t);
      } catch {
        return "error";
      }
    };

    ws.on("message", async (raw) => {
      if (!userId) {
        const size = Array.isArray(raw) ? raw.reduce((n, b) => n + b.length, 0) : (raw as Buffer).byteLength;
        if (size > PRE_AUTH_MAX_BYTES) {
          ws.close(SYNC_CLOSE.AUTH_REQUIRED, "authentication required");
          return;
        }
      }
      let msg: SyncMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        if (!userId) ws.close(SYNC_CLOSE.AUTH_REQUIRED, "authentication required");
        return;
      }

      if (!userId) {
        if (authPending) return; // the single auth attempt is being checked; drop anything else
        if (msg?.type !== "auth" || typeof msg.token !== "string" || !msg.token || msg.token.length > 4096) {
          ws.close(SYNC_CLOSE.AUTH_REQUIRED, "authentication required");
          return;
        }
        authPending = true;
        const uid = await safeAuth(msg.token);
        if (ws.readyState !== WebSocket.OPEN) return;
        if (uid === "error") {
          ws.close(SYNC_CLOSE.BUSY, "try again"); // transient: the client reconnects
          return;
        }
        if (!uid) {
          ws.send(JSON.stringify({ type: "auth_error" }));
          ws.close(SYNC_CLOSE.AUTH_REQUIRED, "invalid or expired session");
          return;
        }
        clearTimeout(authTimer);
        release();
        userId = uid;
        token = msg.token;
        s = getSession(uid);
        ws.send(JSON.stringify({ type: "auth_ok" }));
        revalidate = setInterval(async () => {
          const still = token ? await safeAuth(token) : null;
          if (still === "error") return; // transient: keep the connection, check again next time
          if (still !== userId && ws.readyState === WebSocket.OPEN) {
            ws.close(SYNC_CLOSE.AUTH_REQUIRED, "session expired");
          }
        }, revalidateMs);
        revalidate.unref?.();
        return;
      }

      if (msg?.type === "auth") return; // already authenticated
      const uidNow: string = userId;
      const sess: Session = s as Session;
      handle(uidNow, sess, msg);
    });

    const handle = (userId: string, s: Session, msg: SyncMsg): void => {
      switch (msg.type) {
        case "hello": {
          deviceId = String(msg.deviceId ?? "");
          if (!deviceId) return;
          const name = String(msg.name ?? "Device");
          s.devices.set(deviceId, { id: deviceId, name, socket: ws });
          // Refresh the remembered active-device name when it reconnects.
          if (deviceId === s.activeDeviceId) s.activeDeviceName = name;
          ws.send(sessionMessage(s)); // current session to the newcomer
          broadcast(userId); // announce the new device to others
          break;
        }
        case "state": {
          if (!deviceId) return;
          const activeConn = s.activeDeviceId
            ? s.devices.get(s.activeDeviceId)
            : null;
          const activeOnline =
            !!activeConn && activeConn.socket.readyState === WebSocket.OPEN;
          // A client only reports state when it believes it's the audio output.
          // If no active device is currently connected — none yet, or the
          // remembered one is a stale/ghost pointer or has gone offline — adopt
          // the reporting device as active so "who's playing" tracks reality
          // (and other devices mirror it / show "Playing on <it>"). We do NOT
          // steal from a live active device; moving output between connected
          // devices is what claim ("Play here") is for.
          if (!activeOnline && msg.state?.currentIndex != null) {
            setActiveDevice(userId, s, deviceId);
          }
          if (s.activeDeviceId !== deviceId) return; // only the active device sets state
          s.state = msg.state ?? null;
          broadcast(userId);
          break;
        }
        case "command": {
          if (!deviceId) return;
          const active = s.activeDeviceId
            ? s.devices.get(s.activeDeviceId)
            : null;
          // If the active device is connected, forward the command to it.
          if (active && active.socket.readyState === WebSocket.OPEN) {
            active.socket.send(
              JSON.stringify({ type: "command", command: msg.command })
            );
            break;
          }
          // The active device isn't reachable right now. Only an explicit
          // "play this" intent may move output to the commanding device — so a
          // freshly opened device can start playing when the remembered device
          // is truly gone. Transport tweaks (next/prev/seek/pause/queue edits)
          // must NOT hijack playback away from a device that's merely
          // temporarily disconnected (e.g. an iOS PWA whose WebSocket the OS
          // suspended while backgrounded); those are dropped until it
          // reconnects, so output stays put instead of silently jumping here.
          const cmdType =
            typeof (msg.command as { type?: unknown } | undefined)?.type ===
            "string"
              ? (msg.command as { type: string }).type
              : "";
          if (!PLAY_INTENT_COMMANDS.has(cmdType)) break;
          setActiveDevice(userId, s, deviceId);
          broadcast(userId);
          const self = s.devices.get(deviceId);
          self?.socket.send(
            JSON.stringify({ type: "command", command: msg.command })
          );
          break;
        }
        case "claim": {
          // Transfer audio output to this device ("listen here").
          if (!deviceId) return;
          setActiveDevice(userId, s, deviceId);
          broadcast(userId);
          break;
        }
      }
    };

    const cleanup = () => {
      release();
      clearTimeout(authTimer);
      if (revalidate) clearInterval(revalidate);
      if (!deviceId || !s || !userId) return;
      // iOS reopens the socket constantly; a reconnect registers a new socket
      // under the same deviceId. Only tear down if WE are still the registered
      // socket — otherwise an old socket's close would wipe the live device and
      // clear activeDeviceId, making the active device "flap".
      const current = s.devices.get(deviceId);
      if (current && current.socket !== ws) return;
      s.devices.delete(deviceId);
      // Keep activeDeviceId pointing at this device even though it's gone, so a
      // refresh defaults back to it (and other devices don't auto-grab output).
      // It's persisted, so a server restart restores it too. Use "listen here"
      // on another device to move output deliberately.
      if (s.devices.size === 0) sessions.delete(userId);
      else broadcast(userId);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  return wss;
}
