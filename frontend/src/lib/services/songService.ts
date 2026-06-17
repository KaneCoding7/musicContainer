// Service layer: thin wrapper around the backend song API.
import { apiBase } from "$lib/services/apiBase";
import { authHeaders, withToken } from "$lib/services/authService";
import type { Song } from "$lib/types";


// Extracts a human-readable error message from a failed API response.
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error?.message) return body.error.message;
  } catch {
    /* fall through */
  }
  return `Request failed (${res.status})`;
}

// Fetches all songs from the backend.
export async function fetchSongs(): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/songs`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = await res.json();
  return body.songs as Song[];
}

// Uploads a single audio file and returns the created song.
export async function uploadSong(file: File): Promise<Song> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${apiBase()}/api/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = await res.json();
  return body.song as Song;
}

// Editable song metadata fields.
export interface SongMetadata {
  originalFilename?: string;
  artist?: string;
  album?: string;
}

// Updates a song's metadata (name/artist/album); returns the updated song.
export async function updateSongMeta(
  songId: number,
  fields: SongMetadata
): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Updates metadata (artist/album) on many songs at once; returns the updated
// songs. Only the fields present in `fields` are changed — omit a field to
// leave it untouched across the selection.
export async function updateSongsMeta(
  ids: number[],
  fields: { artist?: string; album?: string }
): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/songs/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids, ...fields }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}

// Sets a song's liked flag; returns the updated song.
export async function setLiked(songId: number, liked: boolean): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/like`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ liked }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Records a play for a song; returns the updated song.
export async function recordPlay(songId: number): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/play`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Uploads/replaces a song's album art; returns the updated song.
export async function uploadArt(songId: number, file: File): Promise<Song> {
  const formData = new FormData();
  formData.append("art", file);
  const res = await fetch(`${apiBase()}/api/songs/${songId}/art`, {
    method: "PUT",
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Removes a song's album art; returns the updated song.
export async function removeArt(songId: number): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/art`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Returns the album-art URL for a song (only meaningful when song.hasArt).
export function artUrl(songId: number): string {
  return withToken(`${apiBase()}/api/songs/${songId}/art`);
}

// Returns a resized square-thumbnail URL for a song's art. `size` is the target
// edge in px; the server snaps it up to the nearest cached variant. Use this in
// list/grid/mini-player views so the browser isn't downscaling the full image.
export function thumbUrl(songId: number, size: number): string {
  return withToken(`${apiBase()}/api/songs/${songId}/art?size=${size}`);
}

// Deletes a song from the library.
export async function deleteSong(songId: number): Promise<void> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Returns the streaming URL for a song (used in Cycle 2).
export function streamUrl(songId: number): string {
  return withToken(`${apiBase()}/api/songs/${songId}/stream`);
}

// Returns the download URL for a song (sets Content-Disposition: attachment).
export function downloadUrl(songId: number): string {
  return withToken(`${apiBase()}/api/songs/${songId}/download`);
}
