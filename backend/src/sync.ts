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

// Validate a bearer token (sent in the WS URL query) and return the user id.
async function authUser(token: string | null): Promise<string | null> {
  if (!token) return null;
  try {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${token}`);
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export function attachSync(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on(
    "upgrade",
    async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "", "http://localhost");
      if (url.pathname !== "/api/sync") {
        socket.destroy();
        return;
      }
      const userId = await authUser(url.searchParams.get("token"));
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, userId);
      });
    }
  );

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, userId: string) => {
    let deviceId: string | null = null;
    const s = getSession(userId);

    ws.on("message", (raw) => {
      let msg: {
        type?: string;
        deviceId?: string;
        name?: string;
        state?: { currentIndex?: number | null } | null;
        command?: unknown;
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

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
    });

    const cleanup = () => {
      if (!deviceId) return;
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
}
