// Service layer: playlist sharing.
import { env } from "$env/dynamic/public";
import { authHeaders } from "$lib/services/authService";
import type { Playlist, Song } from "$lib/types";

const API_BASE = env.PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export interface ShareUser {
  id: string;
  name: string;
  email: string;
}
export interface SharedPlaylist extends Playlist {
  ownerName: string;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || body?.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

// Shares a playlist with a user by email.
export async function sharePlaylist(
  playlistId: number,
  email: string
): Promise<ShareUser> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/share`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).sharedWith as ShareUser;
}

// Lists who a playlist is shared with (owner only).
export async function fetchPlaylistShares(
  playlistId: number
): Promise<ShareUser[]> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/shares`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).shares as ShareUser[];
}

// Revokes a share.
export async function unsharePlaylist(
  playlistId: number,
  userId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/playlists/${playlistId}/share/${userId}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Playlists shared with me.
export async function fetchSharedWithMe(): Promise<SharedPlaylist[]> {
  const res = await fetch(`${API_BASE}/api/shared`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).playlists as SharedPlaylist[];
}

// Songs of a playlist shared with me.
export async function fetchSharedPlaylistSongs(
  playlistId: number
): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/api/shared/${playlistId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}
