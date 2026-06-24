// Service layer: the user's ListenBrainz scrobbling connection.
import { apiBase } from "$lib/services/apiBase";
import { authHeaders } from "$lib/services/authService";

export interface ListenBrainzStatus {
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

export async function getListenBrainzStatus(): Promise<ListenBrainzStatus> {
  const res = await fetch(`${apiBase()}/api/listenbrainz`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

// Connects an account with a personal ListenBrainz token (validated server-side).
export async function connectListenBrainz(
  token: string
): Promise<ListenBrainzStatus> {
  const res = await fetch(`${apiBase()}/api/listenbrainz`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function disconnectListenBrainz(): Promise<ListenBrainzStatus> {
  const res = await fetch(`${apiBase()}/api/listenbrainz`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

// Sets the user's "now playing" for a track. Best-effort — failures are ignored.
export function setNowPlaying(songId: number): void {
  fetch(`${apiBase()}/api/songs/${songId}/now-playing`, {
    method: "POST",
    headers: authHeaders(),
  }).catch(() => {});
}
