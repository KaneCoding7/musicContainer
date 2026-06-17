// Service layer: unauthenticated public share access.
import { apiBase } from "$lib/services/apiBase";
import type { Song } from "$lib/types";


export interface PublicShare {
  name: string;
  ownerName: string;
  songs: Song[];
}

// Fetches a public share's playlist + songs by token (no auth).
export async function fetchPublicShare(token: string): Promise<PublicShare> {
  const res = await fetch(`${apiBase()}/api/public/${token}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error("This share link is invalid or was removed.");
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.json()) as PublicShare;
}

export function publicStreamUrl(token: string, songId: number): string {
  return `${apiBase()}/api/public/${token}/songs/${songId}/stream`;
}

export function publicArtUrl(token: string, songId: number): string {
  return `${apiBase()}/api/public/${token}/songs/${songId}/art`;
}
