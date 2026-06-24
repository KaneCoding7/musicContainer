// Best-effort track-info guessing for imported audio.
//
// YouTube downloads arrive with a messy video title ("Artist - Song (Official
// Video) [HD]") and usually no real artist/album tags. We improve this in two
// steps: (1) a purely-local heuristic that splits the title into artist + title
// and strips noise, then (2) a MusicBrainz lookup that canonicalizes those and
// fills in the album (which YouTube almost never provides).
//
// Everything here is defensive: any failure (network, parse, no match) falls
// back to the heuristic guess, so an import is never blocked by enrichment.

export interface TrackInfo {
  title: string;
  artist: string | null;
  album: string | null;
}

// Parenth/bracket segments that are noise, not part of the song name.
const NOISE =
  /\b(official\s*(music\s*)?(video|audio|lyric[s]?\s*video|visuali[sz]er|version)?|music\s*video|lyric[s]?\s*video|lyric[s]?|audio|visuali[sz]er|hd|hq|4k|8k|mv|m\/v|full\s*(audio|song)|with\s*lyrics|color\s*coded)\b/i;

// Strip () or [] segments that are pure noise; keep meaningful ones like
// "(feat. X)", "(Remix)", "(Acoustic)", "(Live)" so matching stays accurate.
function stripNoiseSegments(s: string): string {
  return s
    .replace(/[([{]([^)\]}]*)[)\]}]/g, (m, inner) =>
      NOISE.test(inner) && !/feat\.?|ft\.?|remix|acoustic|live|cover/i.test(inner)
        ? " "
        : m
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Channel names → a plausible artist: drop "- Topic", "VEVO", trailing
// "Official". Returns null if nothing usable remains.
function cleanUploader(uploader: string | null | undefined): string | null {
  if (!uploader) return null;
  const a = uploader
    .replace(/\s*-\s*topic\s*$/i, "")
    .replace(/vevo$/i, "")
    .replace(/\s*official\s*$/i, "")
    .trim();
  return a || null;
}

// Heuristic split of a raw video title into { artist, title }. Handles the
// common "Artist - Title" / "Artist – Title" / "Artist | Title" shapes; falls
// back to the (cleaned) channel name as the artist when there's no separator.
export function guessFromTitle(
  rawTitle: string,
  uploader?: string | null
): TrackInfo {
  const cleaned = stripNoiseSegments(rawTitle.replace(/\.[a-z0-9]{2,4}$/i, ""));
  const sep = cleaned.match(/\s+[-–—~|]\s+/);
  let artist: string | null = null;
  let title = cleaned;
  if (sep && sep.index !== undefined) {
    artist = cleaned.slice(0, sep.index).trim() || null;
    title = cleaned.slice(sep.index + sep[0].length).trim() || cleaned;
  } else {
    artist = cleanUploader(uploader);
  }
  // Drop a trailing "feat./ft./featuring …" clause — the featured artist
  // belongs in the artist credit, not the recording title, and keeping it
  // throws off the MusicBrainz match. Handles "(feat. X)" and bare "ft. X".
  title = title
    .replace(/\s*[([]?\s*(feat\.?|ft\.?|featuring)\b[^)\]]*[)\]]?\s*$/i, "")
    .trim();
  // Drop wrapping quotes around the title.
  title = title.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return { title: title || cleaned, artist, album: null };
}

// --- MusicBrainz -----------------------------------------------------------

const MB_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT ||
  "MusicContainer/1.0 ( https://github.com/self-hosted/music-container )";

// MusicBrainz asks for <=1 request/sec. Serialize calls through a chained
// promise that enforces a ~1.1s gap, so even a 50-track playlist stays polite.
let mbGate: Promise<void> = Promise.resolve();
function mbThrottle(): Promise<void> {
  const wait = mbGate;
  let release!: () => void;
  mbGate = new Promise<void>((r) => (release = r));
  return wait.then(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          resolve();
          setTimeout(release, 1100);
        }, 0)
      )
  );
}

const lucene = (s: string) => `"${s.replace(/["\\]/g, " ").trim()}"`;

interface MbReleaseGroup {
  "primary-type"?: string;
  "secondary-types"?: string[];
}
interface MbRelease {
  title?: string;
  date?: string;
  "release-group"?: MbReleaseGroup;
}
interface MbRecording {
  score?: number | string;
  title?: string;
  length?: number;
  "artist-credit"?: { name?: string }[];
  releases?: MbRelease[];
}

// Rank a release as an album source: prefer studio albums, penalize
// compilations / live / DJ-mixes, then prefer the earliest (original) release.
// Release titles that look like various-artist compilations / playlists which
// MusicBrainz often leaves untagged (so the secondary-type check misses them).
const COMPILATION_NAME =
  /\b(hits?|top\s*\d+|vol\.?\s*\d+|volume\s*\d+|best\s*of|now\s*that|compilation|sampler|tanzalbum|party|workout|running|chart|charts|nominees|essentials?|collection|anthology|greatest|mega\s*mix|megamix|club\s*hits)\b/i;

function releaseScore(rel: MbRelease): number {
  const rg = rel["release-group"] ?? {};
  const primary = (rg["primary-type"] ?? "").toLowerCase();
  const secondary = (rg["secondary-types"] ?? []).map((s) => s.toLowerCase());
  let score = 0;
  if (primary === "album") score += 100;
  else if (primary === "ep") score += 50;
  else if (primary === "single") score += 30;
  if (secondary.length) score -= 120; // compilation/live/dj-mix/soundtrack/remix
  if (COMPILATION_NAME.test(rel.title ?? "")) score -= 80; // untagged compilation
  const year = parseInt((rel.date ?? "").slice(0, 4), 10);
  // Tiny earliest-release tiebreak — enough to prefer the original studio album
  // over a later reissue, but not enough to let an obscure early bootleg win.
  if (!Number.isNaN(year)) score += Math.max(0, (2100 - year) / 1000);
  return score;
}

// Looks up canonical artist/title/album on MusicBrainz. `durationSec` (when
// known) disambiguates radio edits vs album versions. Returns null on any
// failure or when nothing scores high enough to trust.
export async function lookupMusicBrainz(
  guess: TrackInfo,
  durationSec: number | null
): Promise<TrackInfo | null> {
  const q = guess.artist
    ? `recording:${lucene(guess.title)} AND artist:${lucene(guess.artist)}`
    : `recording:${lucene(guess.title)}`;
  const url = `${MB_BASE}/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=25`;

  try {
    await mbThrottle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;

    const data = (await res.json()) as { recordings?: MbRecording[] };
    const recs = (data.recordings ?? []).map((r) => ({
      ...r,
      score: typeof r.score === "string" ? parseInt(r.score, 10) : r.score ?? 0,
    }));
    const candidates = recs.filter((r) => (r.score as number) >= 85);
    if (candidates.length === 0) return null;

    // For the canonical title/artist, prefer a recording whose core title (sans
    // parentheticals) matches our guess — so we don't inherit a "(… remix)" or
    // "(live)" variant's name — then break ties by duration (±10s) to land on
    // the album cut rather than a radio edit. Falls back to top-scoring.
    const core = (s: string | undefined) =>
      (s ?? "")
        .toLowerCase()
        .replace(/[([{][^)\]}]*[)\]}]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const guessCore = core(guess.title);
    const ms = durationSec != null ? durationSec * 1000 : null;
    const durOk = (r: MbRecording) =>
      ms != null && typeof r.length === "number" && Math.abs(r.length - ms) <= 10_000;
    const titleOk = (r: MbRecording) => core(r.title) === guessCore;

    let best =
      candidates.find((r) => titleOk(r) && durOk(r)) ??
      candidates.find((r) => titleOk(r)) ??
      candidates.find((r) => durOk(r)) ??
      candidates[0];
    const artist =
      (best["artist-credit"] ?? [])
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ") ||
      guess.artist;
    // Keep MB's canonical capitalization, but if it core-matches our guess,
    // strip any trailing "(… remix)" / "(live)" qualifier the chosen recording
    // carried, so the saved title is the clean song name.
    let title = best.title || guess.title;
    if (core(title) === guessCore) {
      const stripped = title.replace(/\s*[([{][^)\]}]*[)\]}]\s*$/g, "").trim();
      if (stripped) title = stripped;
    }

    // Best album across ALL candidates' releases (not just the duration match —
    // the studio-album release often lives under a sibling recording entry).
    // Studio albums beat compilations/live/singles via releaseScore.
    const releases = candidates.flatMap((r) => r.releases ?? []);
    let album: string | null = null;
    if (releases.length) {
      const top = releases
        .filter((rel) => rel.title)
        .sort((a, b) => releaseScore(b) - releaseScore(a))[0];
      album = top?.title ?? null;
    }

    return { title, artist: artist || null, album };
  } catch {
    return null; // network/abort/parse — fall back to the heuristic guess
  }
}

// Full pipeline: start from any tags yt-dlp already extracted, fall back to a
// heuristic parse of the title, then canonicalize via MusicBrainz. Never
// throws; returns the best info it can assemble.
export async function enrichTrackInfo(input: {
  rawTitle: string;
  uploader?: string | null;
  durationSec?: number | null;
  // Tags yt-dlp/spotdl may have already pulled (trusted when present).
  tagTitle?: string | null;
  tagArtist?: string | null;
  tagAlbum?: string | null;
  useMusicBrainz?: boolean;
}): Promise<TrackInfo> {
  const heuristic = guessFromTitle(input.rawTitle, input.uploader);

  // Trust embedded tags when they look complete (spotdl, YouTube Music).
  const base: TrackInfo = {
    title: input.tagTitle?.trim() || heuristic.title,
    artist: input.tagArtist?.trim() || heuristic.artist,
    album: input.tagAlbum?.trim() || heuristic.album,
  };

  // If we already have artist + album from real tags, no need to hit the net.
  if (input.useMusicBrainz === false || (base.artist && base.album)) return base;

  const mb = await lookupMusicBrainz(
    { title: base.title, artist: base.artist, album: base.album },
    input.durationSec ?? null
  );
  if (!mb) return base;

  // Prefer MB's canonical values, but never blank out something we already had.
  return {
    title: mb.title || base.title,
    artist: mb.artist || base.artist,
    album: mb.album || base.album,
  };
}
