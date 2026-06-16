// Service layer: wrapper around the backend playlist API.
import { env } from "$env/dynamic/public";
import { authHeaders } from "$lib/services/authService";
import type { Playlist, Song } from "$lib/types";

const API_BASE = env.PUBLIC_API_BASE_URL ?? "http://localhost:3001";

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error?.message) return body.error.message;
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() });

// Lists all playlists.
export async function fetchPlaylists(): Promise<Playlist[]> {
  const res = await fetch(`${API_BASE}/api/playlists`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).playlists as Playlist[];
}

// Creates a new playlist.
export async function createPlaylist(name: string): Promise<Playlist> {
  const res = await fetch(`${API_BASE}/api/playlists`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).playlist as Playlist;
}

// Renames a playlist; returns the updated playlist.
export async function renamePlaylist(
  playlistId: number,
  name: string
): Promise<Playlist> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).playlist as Playlist;
}

// Deletes a playlist.
export async function deletePlaylist(playlistId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Returns the songs in a playlist, in order.
export async function fetchPlaylistSongs(playlistId: number): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}

// Adds a song to a playlist.
export async function addSongToPlaylist(
  playlistId: number,
  songId: number
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/songs`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ songId }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Reorders songs within a playlist to match the given id order.
export async function reorderPlaylist(
  playlistId: number,
  songIds: number[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/order`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ songIds }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Adds multiple songs to a playlist at once; returns how many were added.
export async function addSongsToPlaylist(
  playlistId: number,
  songIds: number[]
): Promise<number> {
  const res = await fetch(`${API_BASE}/api/playlists/${playlistId}/songs/bulk`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ songIds }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return ((await res.json()).added as number) ?? 0;
}

// Removes a song from a playlist.
export async function removeSongFromPlaylist(
  playlistId: number,
  songId: number
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/playlists/${playlistId}/songs/${songId}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
}
