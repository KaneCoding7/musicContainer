import type { Database } from "better-sqlite3";
import { fetchLyricsFromLrclib } from "./lyrics.js";
import { fetchSyncedFromProviders } from "./syncedlyrics.js";
import {
  markLyricsChecked,
  setSongLyrics,
  type StoredLyrics,
} from "./functional/songs.js";

// Resolves the best available lyrics for a track:
//   1. LRCLIB (plain + synced when it has them)
//   2. if no synced yet → syncedlyrics providers (Musixmatch/NetEase/…) for LRC,
//      so plain-only tracks still get the line-by-line highlight when possible
//   3. embedded file lyrics as a last resort (plain)
// Prefers synced from ANY source. Returns null when nothing is found. Never throws.
export async function resolveLyrics(opts: {
  artist: string | null | undefined;
  track: string | null | undefined;
  album?: string | null;
  durationSec?: number | null;
  embedded?: string | null;
}): Promise<StoredLyrics | null> {
  let plain: string | null = null;
  let synced: string | null = null;
  let source: string | null = null;

  try {
    const lrclib = await fetchLyricsFromLrclib({
      artist: opts.artist,
      track: opts.track,
      album: opts.album,
      durationSec: opts.durationSec,
    });
    if (lrclib) {
      plain = lrclib.plain;
      synced = lrclib.synced;
      if (synced || plain) source = "lrclib";
    }
  } catch {
    /* ignore */
  }

  // No synced from LRCLIB → try the other providers for a synced LRC.
  if (!synced) {
    try {
      const prov = await fetchSyncedFromProviders(opts.artist, opts.track);
      if (prov) {
        synced = prov;
        source = plain ? "lrclib+provider" : "provider";
      }
    } catch {
      /* ignore */
    }
  }

  if (!synced && !plain && opts.embedded && opts.embedded.trim()) {
    plain = opts.embedded;
    source = "embedded";
  }

  if (!synced && !plain) return null;
  return { plain, synced, source };
}

// Fire-and-forget enrichment used on ingest: resolve + store (or mark checked).
export async function enrichLyrics(
  db: Database,
  songId: number,
  opts: {
    artist: string | null | undefined;
    track: string | null | undefined;
    album?: string | null;
    durationSec?: number | null;
    embedded?: string | null;
  }
): Promise<void> {
  try {
    const lyrics = await resolveLyrics(opts);
    if (lyrics) setSongLyrics(db, songId, lyrics);
    else markLyricsChecked(db, songId); // mark checked, don't clear
  } catch {
    /* leave unchecked so a later backfill can retry */
  }
}
