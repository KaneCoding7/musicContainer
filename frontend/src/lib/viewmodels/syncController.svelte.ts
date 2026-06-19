import { apiBase } from "$lib/services/apiBase";
import { getToken } from "$lib/services/authService";
import type {
  PlaybackSnapshot,
  SongViewModel,
} from "./songViewModel.svelte";

export interface SyncDevice {
  id: string;
  name: string;
}

// A friendly name for this device, derived from the user agent.
function deviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let os = "device";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Macintosh|Mac OS/.test(ua)) os = "Mac";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  return `${browser} · ${os}`;
}

function newId(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* not a secure context (e.g. plain-HTTP LAN) */
  }
  return `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getDeviceId(): string {
  if (typeof localStorage === "undefined") return "";
  let id = localStorage.getItem("syncDeviceId");
  if (!id) {
    id = newId();
    localStorage.setItem("syncDeviceId", id);
  }
  return id;
}

// Manages the cross-device sync WebSocket and the active/remote role. The audio
// output stays on the "active" device; other devices mirror its state and send
// transport commands.
export class SyncController {
  connected = $state(false);
  devices = $state<SyncDevice[]>([]);
  activeDeviceId = $state<string | null>(null);
  readonly deviceId: string = getDeviceId();

  private vm: SongViewModel;
  private ws: WebSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(vm: SongViewModel) {
    this.vm = vm;
    // Route transport actions through the active device when we're a remote.
    vm.remoteSink = (type, payload) => {
      if (this.isActive) return false; // act locally
      this.sendCommand({ type, payload });
      return true;
    };
  }

  // This device outputs audio when it's the active one (or none is active yet).
  get isActive(): boolean {
    return this.activeDeviceId === null || this.activeDeviceId === this.deviceId;
  }
  get isRemote(): boolean {
    return this.activeDeviceId !== null && this.activeDeviceId !== this.deviceId;
  }
  // True only when output is on a *different, currently-connected* device, so
  // the "Playing on …" bar reflects somewhere you can actually reach. A
  // remembered-but-offline active device (a closed tab/sleeping laptop) doesn't
  // count: we hide that bar and let a transport command transfer output here
  // (the server promotes the commanding device when the active one is gone).
  get hasOnlineRemote(): boolean {
    return (
      this.isRemote && this.devices.some((d) => d.id === this.activeDeviceId)
    );
  }
  get activeDeviceName(): string {
    return (
      this.devices.find((d) => d.id === this.activeDeviceId)?.name ??
      "another device"
    );
  }

  connect(): void {
    if (typeof window === "undefined" || !this.deviceId) return;
    const token = getToken();
    if (!token) return;
    this.closed = false;
    const base = apiBase().replace(/^http/, "ws");
    try {
      this.ws = new WebSocket(
        `${base}/api/sync?token=${encodeURIComponent(token)}`
      );
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ type: "hello", deviceId: this.deviceId, name: deviceName() });
      // If we're already playing, claim the session by pushing our state.
      if (this.vm.currentSong) this.sendState();
    };
    this.ws.onmessage = (e) => this.onMessage(e);
    this.ws.onclose = () => {
      this.connected = false;
      if (!this.closed) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      /* onclose handles reconnect */
    };
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnect || this.closed) return;
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      this.connect();
    }, 3000);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // The active device broadcasts its playback state.
  sendState(): void {
    if (!this.isActive) return;
    this.send({ type: "state", state: this.vm.playbackSnapshot() });
  }

  sendCommand(command: { type: string; payload?: unknown }): void {
    this.send({ type: "command", command });
  }

  // Move audio output to this device.
  claim(): void {
    this.send({ type: "claim" });
  }

  private onMessage(e: MessageEvent): void {
    let msg: {
      type?: string;
      activeDeviceId?: string | null;
      devices?: SyncDevice[];
      state?: PlaybackSnapshot | null;
      command?: { type: string; payload?: unknown };
    };
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    if (msg.type === "session") {
      const wasActive = this.isActive;
      this.devices = msg.devices ?? [];
      this.activeDeviceId = msg.activeDeviceId ?? null;

      if (this.isRemote && msg.state) {
        // Mirror the active device's playback (no local audio).
        this.vm.applyRemoteState(msg.state);
      } else if (!wasActive && this.isActive && msg.state) {
        // We just took over: load the synced track at the synced position.
        this.vm.applyRemoteState(msg.state);
        this.vm.resumeAt = msg.state.position ?? 0;
        this.vm.suppressPlayRecord = true;
      }
    } else if (msg.type === "command" && msg.command) {
      // We're the active device; execute the forwarded command locally.
      this.applyCommand(msg.command);
    }
  }

  private applyCommand(cmd: { type: string; payload?: unknown }): void {
    const vm = this.vm;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (cmd.payload ?? {}) as any;
    switch (cmd.type) {
      case "togglePlay":
        vm.togglePlay();
        break;
      case "next":
        vm.next();
        break;
      case "prev":
        vm.prev();
        break;
      case "seek":
        vm.seek(p.position);
        break;
      case "playQueue":
        vm.playQueue(p.songs, p.index);
        break;
      case "playList":
        vm.playList(p.songs);
        break;
      case "shufflePlay":
        vm.shufflePlay(p.songs);
        break;
      case "addToQueue":
        vm.addToQueue(p.song);
        break;
      case "playNext":
        vm.playNext(p.song);
        break;
      case "removeFromQueue":
        vm.removeFromQueue(p.index);
        break;
      case "moveInQueue":
        vm.moveInQueue(p.from, p.to);
        break;
      case "toggleShuffle":
        vm.toggleShuffle();
        break;
      case "cycleRepeat":
        vm.cycleRepeat();
        break;
    }
  }
}
