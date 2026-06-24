// Service layer: the user's Last.fm scrobbling connection + stats.
import { apiBase } from "$lib/services/apiBase";
import { authHeaders } from "$lib/services/authService";
import type {
  ListenBrainzStats,
  StatsRange,
} from "$lib/services/listenBrainzService";

export interface LastfmStatus {
  configured: boolean; // whether the server has Last.fm API keys set
  apiKey: string | null; // public key, for building the authorize URL
  connected: boolean;
  username: string | null;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error?.message) return body.error.message;
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

export async function getLastfmStatus(): Promise<LastfmStatus> {
  const res = await fetch(`${apiBase()}/api/lastfm`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

// Exchanges the web-auth token (from the Last.fm redirect) for a stored session.
export async function connectLastfm(token: string): Promise<LastfmStatus> {
  const res = await fetch(`${apiBase()}/api/lastfm`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function disconnectLastfm(): Promise<LastfmStatus> {
  const res = await fetch(`${apiBase()}/api/lastfm`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

// Last.fm stats share the ListenBrainz stats shape, so the view renders either.
export async function getLastfmStats(
  range: StatsRange
): Promise<ListenBrainzStats> {
  const res = await fetch(
    `${apiBase()}/api/lastfm/stats?range=${encodeURIComponent(range)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

// Builds the Last.fm authorize redirect. Last.fm sends the user back to
// <origin>/lastfm/callback?token=… after they approve.
export function lastfmAuthUrl(apiKey: string): string {
  const cb = `${window.location.origin}/lastfm/callback`;
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(cb)}`;
}
