// Service layer: per-user now-playing state, persisted server-side so playback
// resumes across devices (the browser-local copy only covers the same device).
import { apiBase } from "$lib/services/apiBase";
import { authHeaders, getToken } from "$lib/services/authService";

export interface RemotePlaybackState {
  state: Record<string, unknown>;
  updatedAt: number;
}

// Fetches the saved snapshot, or null when there's none / not signed in.
export async function fetchPlaybackState(): Promise<RemotePlaybackState | null> {
  if (!getToken()) return null;
  try {
    const res = await fetch(`${apiBase()}/api/playback-state`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.state
      ? { state: body.state, updatedAt: Number(body.updatedAt) || 0 }
      : null;
  } catch {
    return null;
  }
}

// Saves (state) or clears (null) the snapshot. Fire-and-forget; `keepalive`
// lets it complete during page unload.
export function savePlaybackState(
  state: unknown,
  updatedAt: number,
  keepalive = false
): void {
  if (!getToken()) return;
  try {
    void fetch(`${apiBase()}/api/playback-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ state, updatedAt }),
      keepalive,
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}
