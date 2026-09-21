// Service layer: thin wrapper around the backend song API.
import { apiBase } from "$lib/services/apiBase";
import { artVersion } from "$lib/services/artVersion.svelte";
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

export interface YouTubeResult {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  url: string;
}

// Searches YouTube by name (server runs yt-dlp). Returns candidate tracks for
// the user to pick from; the chosen one's `url` is then fed into importLink.
export async function searchYouTube(query: string): Promise<YouTubeResult[]> {
  const res = await fetch(`${apiBase()}/api/youtube-search`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const body = await res.json();
  return body.results as YouTubeResult[];
}

export interface ImportProgress {
  stage: string; // "download" | "convert" | "art" | "ingest"
  percent?: number;
}

// Imports audio from a link (yt-dlp on the server). The server streams NDJSON
// progress lines; onProgress is called for each. Returns the created songs.
export async function importLink(
  url: string,
  onProgress?: (p: ImportProgress) => void,
  playlist = false
): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/import-link`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ url, playlist }),
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let songs: Song[] = [];
  let error: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: { type: string; stage?: string; percent?: number; songs?: Song[]; message?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "progress" && msg.stage) {
        onProgress?.({ stage: msg.stage, percent: msg.percent });
      } else if (msg.type === "done") {
        songs = msg.songs ?? [];
      } else if (msg.type === "error") {
        error = msg.message ?? "Import failed";
      }
    }
  }

  if (error) throw new Error(error);
  return songs;
}

// Copies an accessible song (e.g. from a shared playlist) into my library.
export async function copySongToLibrary(songId: number): Promise<Song> {
  const res = await fetch(
    `${apiBase()}/api/songs/${songId}/copy-to-library`,
    { method: "POST", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Uploaded/imported songs awaiting review (not yet in the library).
export async function fetchPendingSongs(): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/songs/pending`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}

export interface VideoFrame {
  t?: number; // timestamp in seconds (absent for the thumbnail option)
  label?: string; // e.g. "Thumbnail"
  dataUrl: string; // data:image/...;base64,...
}

// For a link-imported track, fetches candidate cover frames from the video.
export async function fetchVideoFrames(songId: number): Promise<VideoFrame[]> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/frames`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).frames as VideoFrame[];
}

// Confirms pending songs into the library; returns the confirmed songs.
export async function finalizeSongs(ids: number[]): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/songs/finalize`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}

// Fetches the next suggestion-radio track (server downloads it as a pending
// suggestion). `seed` is the track that just played, used to find similar
// music. Returns null when the server has nothing to suggest (HTTP 204).
export async function fetchNextSuggestion(seed?: {
  artist: string | null;
  title: string | null;
  songId?: number | null;
}): Promise<Song | null> {
  const params = new URLSearchParams();
  if (seed?.artist) params.set("seedArtist", seed.artist);
  if (seed?.title) params.set("seedTitle", seed.title);
  if (seed?.songId) params.set("seedSongId", String(seed.songId));
  const qs = params.toString();
  const res = await fetch(
    `${apiBase()}/api/suggestions/next${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() }
  );
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Discards suggestion tracks the user moved past without keeping. Best-effort:
// the server also sweeps these on a timer, so a failed call is not fatal.
export async function discardSuggestions(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await fetch(`${apiBase()}/api/suggestions/discard`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

// Editable song metadata fields.
export interface SongMetadata {
  originalFilename?: string;
  artist?: string; // legacy single-value; prefer `artists`
  artists?: string[]; // ordered list of artist names
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
  fields: { artist?: string; artists?: string[]; album?: string }
): Promise<Song[]> {
  const res = await fetch(`${apiBase()}/api/songs/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids, ...fields }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).songs as Song[];
}

// Analyzes one batch of not-yet-measured tracks for loudness. Returns how many
// were analyzed this call and how many remain (call repeatedly until 0).
export async function analyzeLoudness(): Promise<{
  analyzed: number;
  remaining: number;
}> {
  const res = await fetch(`${apiBase()}/api/songs/analyze-loudness`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as { analyzed: number; remaining: number };
}

export interface Lyrics {
  plain: string | null;
  synced: string | null; // raw LRC
  source: string | null;
}

// Fetches a song's stored lyrics, or null if it has none (404).
export async function fetchLyrics(songId: number): Promise<Lyrics | null> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/lyrics`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).lyrics as Lyrics;
}

// Forces a fresh LRCLIB lookup for a song; returns the updated song.
export async function refetchLyrics(songId: number): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/lyrics/refetch`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Manually sets (or clears) a song's lyrics; returns the updated song.
export async function setLyrics(
  songId: number,
  fields: { plain?: string | null; synced?: string | null }
): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/lyrics`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Fetches lyrics for one batch of not-yet-checked tracks (library backfill).
// Returns how many were found this call and how many remain (call until 0).
export async function fetchLyricsBatch(): Promise<{
  fetched: number;
  remaining: number;
}> {
  const res = await fetch(`${apiBase()}/api/songs/fetch-lyrics`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as { fetched: number; remaining: number };
}

// Persists a manual ordering (sort_order) for the given song ids, in order.
export async function reorderSongs(ids: number[]): Promise<void> {
  const res = await fetch(`${apiBase()}/api/songs/order`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Persists a manual ordering for an album's tracks (album_sort_order), in order.
// Separate from reorderSongs so album order doesn't disturb artist order.
export async function reorderAlbumSongs(ids: number[]): Promise<void> {
  const res = await fetch(`${apiBase()}/api/songs/album-order`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Downloads a set of songs (e.g. a whole album) as a zip, saved client-side.
// `name` becomes the .zip filename. Mirrors downloadPlaylistZip.
export async function downloadSongsZip(
  ids: number[],
  name: string
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/songs/download-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids, name }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(name || "album").replace(/[^\w.\- ]+/g, "_")}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  return `${withToken(`${apiBase()}/api/songs/${songId}/art`)}&v=${artVersion(songId)}`;
}

// Returns a resized square-thumbnail URL for a song's art. `size` is the target
// edge in px; the server snaps it up to the nearest cached variant. Use this in
// list/grid/mini-player views so the browser isn't downscaling the full image.
export function thumbUrl(songId: number, size: number): string {
  return `${withToken(
    `${apiBase()}/api/songs/${songId}/art?size=${size}`
  )}&v=${artVersion(songId)}`;
}

// --- Custom artist avatar images ---

// The artist name is passed as a query param (not a path segment) so names with
// slashes or other special characters work.
function artistImageEndpoint(artist: string): string {
  return `${apiBase()}/api/artists/image?name=${encodeURIComponent(artist)}`;
}

// URL for an artist's custom image. `version` busts the cache after a change.
export function artistImageUrl(artist: string, version = 0): string {
  return `${withToken(artistImageEndpoint(artist))}&v=${version}`;
}

// Artist names the current user has set a custom image for.
export async function fetchArtistImages(): Promise<string[]> {
  const res = await fetch(`${apiBase()}/api/artists/images`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  return ((await res.json()).artists ?? []) as string[];
}

// Uploads/replaces an artist's custom image.
export async function uploadArtistImage(
  artist: string,
  file: File
): Promise<void> {
  const formData = new FormData();
  formData.append("art", file);
  const res = await fetch(artistImageEndpoint(artist), {
    method: "PUT",
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// Removes an artist's custom image (reverts to the top-track art).
export async function removeArtistImage(artist: string): Promise<void> {
  const res = await fetch(artistImageEndpoint(artist), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
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

// URL for a song's looping canvas clip (only meaningful when song.hasClip).
export function clipUrl(songId: number): string {
  return withToken(`${apiBase()}/api/songs/${songId}/clip`);
}

// Enables/disables showing a song's canvas clip; returns the updated song.
export async function setClipEnabled(
  songId: number,
  enabled: boolean
): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/clip-enabled`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Generates (and caches server-side) the canvas clip for a link-imported song,
// returning the updated song (now with hasClip=true). Idempotent.
export async function generateClip(songId: number): Promise<Song> {
  const res = await fetch(`${apiBase()}/api/songs/${songId}/clip`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).song as Song;
}

// Returns the download URL for a song (sets Content-Disposition: attachment).
export function downloadUrl(songId: number): string {
  return withToken(`${apiBase()}/api/songs/${songId}/download`);
}
