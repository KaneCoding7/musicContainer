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

interface LrclibRecord {
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  duration?: number | null;
}

// Strips common noise from an imported track title (YouTube-style tags, feat/
// prod credits, "unreleased/leak" markers) so it matches LRCLIB's clean titles.
// Conservative: only removes bracketed noise and trailing " - Official …".
function cleanTitle(raw: string): string {
  return raw
    .replace(/\.(mp3|wav|m4a|flac|ogg)$/i, "")
    .replace(
      /[([][^)\]]*(feat|ft|prod|remix|official|video|audio|lyrics?|unreleased|leak|slowed|reverb|extended|bonus)[^)\]]*[)\]]/gi,
      ""
    )
    .replace(/\s*[-–]\s*(official.*|lyrics?.*|unreleased.*|leak.*)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The primary (first) artist — LRCLIB matches a single artist far better than a
// joined "A, B" string.
function primaryArtist(raw: string): string {
  return raw.split(/,|;|&| x | feat\.?| ft\.?/i)[0].trim();
}

async function lrclibJson(path: string): Promise<unknown | null> {
  await throttle();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${LRCLIB_BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickLyrics(rec: LrclibRecord | null | undefined): LyricsResult | null {
  if (!rec || rec.instrumental) return null;
  const plain = rec.plainLyrics?.trim() ? rec.plainLyrics : null;
  const synced = rec.syncedLyrics?.trim() ? rec.syncedLyrics : null;
  return plain || synced ? { plain, synced } : null;
}

// Looks up lyrics for a track. Tries the exact /get (track + primary artist +
// duration, NO album — a mismatched album is the main false-negative source),
// then falls back to the fuzzy /search, choosing the closest-duration candidate
// and preferring synced lyrics. Returns null when nothing usable is found (so
// callers can mark "checked, none"). Never throws.
export async function fetchLyricsFromLrclib(params: {
  artist: string | null | undefined;
  track: string | null | undefined;
  album?: string | null;
  durationSec?: number | null;
}): Promise<LyricsResult | null> {
  const track = cleanTitle((params.track ?? "").trim());
  const artist = primaryArtist((params.artist ?? "").trim());
  // LRCLIB matches on track + artist; without both a lookup is meaningless.
  if (!track || !artist) return null;
  const dur = params.durationSec && params.durationSec > 0 ? params.durationSec : null;

  // 1) Exact match (no album). Duration helps disambiguate within LRCLIB's ±2s.
  const getQs = new URLSearchParams({ track_name: track, artist_name: artist });
  if (dur) getQs.set("duration", String(Math.round(dur)));
  const exact = pickLyrics(
    (await lrclibJson(`/get?${getQs.toString()}`)) as LrclibRecord | null
  );
  if (exact) return exact;

  // 2) Fuzzy search fallback. Pick the candidate with lyrics closest in length
  // to our duration (when known), preferring ones that carry synced lyrics.
  const searchQs = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });
  const results = (await lrclibJson(`/search?${searchQs.toString()}`)) as
    | LrclibRecord[]
    | null;
  if (!Array.isArray(results) || results.length === 0) return null;

  const usable = results.filter((r) => pickLyrics(r));
  if (usable.length === 0) return null;
  usable.sort((a, b) => {
    // Prefer synced first.
    const sa = a.syncedLyrics?.trim() ? 0 : 1;
    const sb = b.syncedLyrics?.trim() ? 0 : 1;
    if (sa !== sb) return sa - sb;
    // Then closest duration (if we know ours).
    if (dur) {
      const da = Math.abs((a.duration ?? 0) - dur);
      const db = Math.abs((b.duration ?? 0) - dur);
      return da - db;
    }
    return 0;
  });
  // If we know the duration, reject a wildly-off best match (likely wrong song).
  if (dur && Math.abs((usable[0].duration ?? 0) - dur) > 15) return null;
  return pickLyrics(usable[0]);
}
