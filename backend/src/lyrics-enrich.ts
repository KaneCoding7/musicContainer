import type { Database } from "better-sqlite3";
import { fetchLyricsFromLrclib } from "./lyrics.js";
import { setSongLyrics } from "./functional/songs.js";

// Resolves and stores lyrics for one song: LRCLIB first (gives synced + plain),
// then embedded file lyrics as a fallback, else records "checked, none found"
// so it isn't retried. Fire-and-forget from the ingest flow; never throws.
export async function enrichLyrics(
  db: Database,
  songId: number,
  opts: {
    artist: string | null | undefined;
    track: string | null | undefined;
    album?: string | null;
    durationSec?: number | null;
    embedded?: string | null; // embedded file lyrics (fallback)
  }
): Promise<void> {
  try {
    const found = await fetchLyricsFromLrclib({
      artist: opts.artist,
      track: opts.track,
      album: opts.album,
      durationSec: opts.durationSec,
    });
    if (found && (found.plain || found.synced)) {
      setSongLyrics(db, songId, {
        plain: found.plain,
        synced: found.synced,
        source: "lrclib",
      });
      return;
    }
    if (opts.embedded && opts.embedded.trim()) {
      setSongLyrics(db, songId, {
        plain: opts.embedded,
        synced: null,
        source: "embedded",
      });
      return;
    }
    setSongLyrics(db, songId, null); // checked, nothing found
  } catch {
    /* leave unchecked so a later backfill can retry */
  }
}
