import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { auth } from "./auth.js";

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
  state: unknown | null; // last PlaybackState pushed by the active device
}

const sessions = new Map<string, Session>(); // keyed by userId

function getSession(userId: string): Session {
  let s = sessions.get(userId);
  if (!s) {
    s = { devices: new Map(), activeDeviceId: null, state: null };
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
        state?: { song?: unknown } | null;
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
          s.devices.set(deviceId, {
            id: deviceId,
            name: String(msg.name ?? "Device"),
            socket: ws,
          });
          ws.send(sessionMessage(s)); // current session to the newcomer
          broadcast(userId); // announce the new device to others
          break;
        }
        case "state": {
          if (!deviceId) return;
          // The first device to report a real playing track claims "active".
          if (s.activeDeviceId === null && msg.state?.song) {
            s.activeDeviceId = deviceId;
          }
          if (s.activeDeviceId !== deviceId) return; // only the active device sets state
          s.state = msg.state ?? null;
          broadcast(userId);
          break;
        }
        case "command": {
          if (!deviceId) return;
          // No active device yet → the commander becomes active.
          if (s.activeDeviceId === null) {
            s.activeDeviceId = deviceId;
            broadcast(userId);
          }
          const active = s.activeDeviceId
            ? s.devices.get(s.activeDeviceId)
            : null;
          if (active && active.socket.readyState === WebSocket.OPEN) {
            active.socket.send(
              JSON.stringify({ type: "command", command: msg.command })
            );
          }
          break;
        }
        case "claim": {
          // Transfer audio output to this device.
          if (!deviceId) return;
          s.activeDeviceId = deviceId;
          broadcast(userId);
          break;
        }
      }
    });

    const cleanup = () => {
      if (!deviceId) return;
      s.devices.delete(deviceId);
      if (s.activeDeviceId === deviceId) s.activeDeviceId = null;
      if (s.devices.size === 0) sessions.delete(userId);
      else broadcast(userId);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });
}
