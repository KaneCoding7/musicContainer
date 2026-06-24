// Last.fm API client (https://www.last.fm/api). Parallels the ListenBrainz
// client: validate/connect a per-user session, scrobble finished plays + set
// "now playing", and read top artists/tracks/albums + total scrobbles.
//
// Last.fm needs an APP-level API key + shared secret that the instance operator
// registers (https://www.last.fm/api/account/create) and sets as env vars. When
// unset, the whole integration reports "not configured" and the UI hides it —
// so an image without the keys behaves exactly as before. Best-effort: a failed
// scrobble never disrupts playback.
import { createHash } from "node:crypto";
import type {
  ScrobbleTrack,
  StatEntry,
  StatsRange,
  UserStats,
} from "./listenbrainz.js";

const LF_BASE = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.LASTFM_API_KEY || "";
const SECRET = process.env.LASTFM_SECRET || "";

export function isConfigured(): boolean {
  return !!(API_KEY && SECRET);
}
// The API key is public (it's exposed in the browser auth redirect anyway).
export function getApiKey(): string {
  return API_KEY;
}

// Last.fm request signature: sort params by name, concat key+value, append the
// shared secret, md5. `format` and `callback` are excluded from the signature.
function sign(params: Record<string, string>): string {
  const base =
    Object.keys(params)
      .filter((k) => k !== "format" && k !== "callback")
      .sort()
      .map((k) => k + params[k])
      .join("") + SECRET;
  return createHash("md5").update(base, "utf8").digest("hex");
}

async function call<T>(
  params: Record<string, string>,
  opts: { signed?: boolean; post?: boolean } = {}
): Promise<T | null> {
  const p: Record<string, string> = { ...params, api_key: API_KEY };
  if (opts.signed) p.api_sig = sign(p);
  p.format = "json";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = opts.post
      ? await fetch(LF_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(p),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer))
      : await fetch(`${LF_BASE}?${new URLSearchParams(p).toString()}`, {
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface LfSessionResp {
  session?: { key?: string; name?: string };
}
interface LfWriteResp {
  error?: number;
}
interface LfArtistsResp {
  topartists?: {
    artist?: { name?: string; playcount?: string; mbid?: string }[];
  };
}
interface LfTracksResp {
  toptracks?: {
    track?: {
      name?: string;
      playcount?: string;
      mbid?: string;
      artist?: { name?: string };
    }[];
  };
}
interface LfAlbumsResp {
  topalbums?: {
    album?: {
      name?: string;
      playcount?: string;
      mbid?: string;
      artist?: { name?: string };
    }[];
  };
}
interface LfInfoResp {
  user?: { playcount?: string };
}

// Exchanges a web-auth token (from the Last.fm authorize redirect) for a
// permanent per-user session key + username.
export async function getSession(
  token: string
): Promise<{ key: string; name: string } | null> {
  const d = await call<LfSessionResp>(
    { method: "auth.getSession", token },
    { signed: true }
  );
  if (d?.session?.key) return { key: d.session.key, name: d.session.name ?? "" };
  return null;
}

// Submits a completed scrobble. `timestamp` is the Unix epoch (seconds).
export async function scrobble(
  sessionKey: string,
  t: ScrobbleTrack,
  timestamp: number
): Promise<boolean> {
  const params: Record<string, string> = {
    method: "track.scrobble",
    sk: sessionKey,
    artist: t.artist,
    track: t.track,
    timestamp: String(timestamp),
  };
  if (t.release) params.album = t.release;
  if (typeof t.durationSec === "number" && t.durationSec > 0)
    params.duration = String(Math.round(t.durationSec));
  const d = await call<LfWriteResp>(params, { signed: true, post: true });
  return !!d && !d.error;
}

// Sets the user's "now playing" track.
export async function updateNowPlaying(
  sessionKey: string,
  t: ScrobbleTrack
): Promise<boolean> {
  const params: Record<string, string> = {
    method: "track.updateNowPlaying",
    sk: sessionKey,
    artist: t.artist,
    track: t.track,
  };
  if (t.release) params.album = t.release;
  if (typeof t.durationSec === "number" && t.durationSec > 0)
    params.duration = String(Math.round(t.durationSec));
  const d = await call<LfWriteResp>(params, { signed: true, post: true });
  return !!d && !d.error;
}

export type LfPeriod = "7day" | "1month" | "12month" | "overall";

export function periodFor(range: StatsRange): LfPeriod {
  switch (range) {
    case "week":
      return "7day";
    case "month":
      return "1month";
    case "year":
      return "12month";
    default:
      return "overall";
  }
}

const num = (s: string | undefined) => {
  const n = parseInt(s ?? "", 10);
  return Number.isNaN(n) ? 0 : n;
};

// Reads the user's top artists/tracks/albums + total scrobbles for a period.
// Mirrors the ListenBrainz UserStats shape (activity is empty — Last.fm has no
// equivalent endpoint in this scope) so the UI can render either source.
export async function getUserStats(
  username: string,
  period: LfPeriod
): Promise<UserStats> {
  const u = encodeURIComponent(username);
  const [ta, tt, tal, info] = await Promise.all([
    call<LfArtistsResp>({ method: "user.getTopArtists", user: u, period, limit: "10" }),
    call<LfTracksResp>({ method: "user.getTopTracks", user: u, period, limit: "10" }),
    call<LfAlbumsResp>({ method: "user.getTopAlbums", user: u, period, limit: "10" }),
    call<LfInfoResp>({ method: "user.getInfo", user: u }),
  ]);

  const artists: StatEntry[] = (ta?.topartists?.artist ?? [])
    .filter((a) => a.name)
    .map((a) => ({ name: a.name!, count: num(a.playcount), mbid: a.mbid ?? null }));
  const recordings: StatEntry[] = (tt?.toptracks?.track ?? [])
    .filter((t) => t.name)
    .map((t) => ({
      name: t.name!,
      subtitle: t.artist?.name ?? null,
      count: num(t.playcount),
      mbid: t.mbid ?? null,
    }));
  const releases: StatEntry[] = (tal?.topalbums?.album ?? [])
    .filter((a) => a.name)
    .map((a) => ({
      name: a.name!,
      subtitle: a.artist?.name ?? null,
      count: num(a.playcount),
      mbid: a.mbid ?? null,
    }));
  const listenCount = info?.user?.playcount ? num(info.user.playcount) : null;

  return { listenCount, artists, recordings, releases, activity: [] };
}
