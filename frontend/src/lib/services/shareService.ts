// Service layer: playlist sharing.
import { apiBase } from "$lib/services/apiBase";
import { authHeaders } from "$lib/services/authService";
import type { Playlist, Song } from "$lib/types";


export interface ShareUser {
  id: string;
  name: string;
  email: string;
  canEdit: boolean;
}
export interface SharedPlaylist extends Playlist {
  ownerName: string;
  canEdit: boolean;
}
export interface UserMatch {
  id: string;
  name: string;
  email: string;
}

// Looks up users by name/email for the share autocomplete.
export async function searchUsers(query: string): Promise<UserMatch[]> {
  const res = await fetch(
    `${apiBase()}/api/users/search?q=${encodeURIComponent(query)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()).users as UserMatch[];
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
  email: string,
  canEdit = false
): Promise<ShareUser> {
  const res = await fetch(`${apiBase()}/api/playlists/${playlistId}/share`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, canEdit }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).sharedWith as ShareUser;
}

// Lists who a playlist is shared with (owner only).
export async function fetchPlaylistShares(
  playlistId: number
): Promise<ShareUser[]> {
  const res = await fetch(`${apiBase()}/api/playlists/${playlistId}/shares`, {
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
    `${apiBase()}/api/playlists/${playlistId}/share/${userId}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Playlists shared with me.
export async function fetchSharedWithMe(): Promise<SharedPlaylist[]> {
  const res = await fetch(`${apiBase()}/api/shared`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).playlists as SharedPlaylist[];
}

// --- Public links ---

// Current public token for a playlist (null if disabled).
export async function getPublicToken(
  playlistId: number
): Promise<string | null> {
  const res = await fetch(`${apiBase()}/api/playlists/${playlistId}/public`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).token as string | null;
}

// Enables a public link and returns its token.
export async function enablePublicLink(playlistId: number): Promise<string> {
  const res = await fetch(`${apiBase()}/api/playlists/${playlistId}/public`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).token as string;
}

// Disables the public link.
export async function disablePublicLink(playlistId: number): Promise<void> {
  const res = await fetch(`${apiBase()}/api/playlists/${playlistId}/public`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Builds the public listen URL for a token.
export function publicLink(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/${token}`;
}

// --- Single-song public links ---
export async function getSongPublicToken(
  songId: number
): Promise<string | null> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/public`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).token as string | null;
}

export async function enableSongPublicLink(songId: number): Promise<string> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/public`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).token as string;
}

export async function disableSongPublicLink(songId: number): Promise<void> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/public`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Songs of a playlist shared with me.
export async function fetchSharedPlaylistSongs(
  playlistId: number
): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/shared/${playlistId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}
