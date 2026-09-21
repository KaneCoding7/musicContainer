// LRCLIB client — free, keyless community lyrics (plain + time-synced LRC).
// Mirrors the outbound-HTTP idioms used by musicbrainz.ts / lastfm.ts:
// AbortController timeout, never throws (returns null on any failure), a
// User-Agent from env, and a light throttle so a batch backfill stays polite.
//
// API: GET https://lrclib.net/api/get?artist_name=&track_name=&album_name=&duration=
// Response: { instrumental, plainLyrics, syncedLyrics, ... } or 404.

const LRCLIB_BASE = "https://lrclib.net/api";
const USER_AGENT =
  process.env.LRCLIB_USER_AGENT ||
  "MusicContainer/1.0 ( https://github.com/self-hosted/music-container )";

export interface LyricsResult {
  plain: string | null;
  synced: string | null; // raw LRC, or null
}

// LRCLIB has no strict published rate limit, but be a good citizen on backfills:
// serialize requests through a chained promise enforcing a small gap.
let gate: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  const wait = gate;
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  return wait.then(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          resolve();
          setTimeout(release, 350);
        }, 0)
      )
  );
}

// Looks up lyrics for a track. Returns null when nothing usable is found
// (no match, instrumental, or any error) so callers can mark "checked, none".
export async function fetchLyricsFromLrclib(params: {
  artist: string | null | undefined;
  track: string | null | undefined;
  album?: string | null;
  durationSec?: number | null;
}): Promise<LyricsResult | null> {
  const track = (params.track ?? "").trim();
  const artist = (params.artist ?? "").trim();
  // LRCLIB matches on track + artist; without both a lookup is meaningless.
  if (!track || !artist) return null;

  const qs = new URLSearchParams({ track_name: track, artist_name: artist });
  if (params.album && params.album.trim())
    qs.set("album_name", params.album.trim());
  if (params.durationSec && params.durationSec > 0)
    qs.set("duration", String(Math.round(params.durationSec)));

  await throttle();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${LRCLIB_BASE}/get?${qs.toString()}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // 404 = no match
    const data = (await res.json()) as {
      instrumental?: boolean;
      plainLyrics?: string | null;
      syncedLyrics?: string | null;
    };
    if (data.instrumental) return null;
    const plain = data.plainLyrics?.trim() ? data.plainLyrics : null;
    const synced = data.syncedLyrics?.trim() ? data.syncedLyrics : null;
    if (!plain && !synced) return null;
    return { plain, synced };
  } catch {
    return null; // network/timeout/parse — treat as "not found"
  } finally {
    clearTimeout(timer);
  }
}
