// Suggestion-radio candidate selection. Prefers seed-based sources that hold
// the current track's mood — YouTube's autoplay "Mix" for the seed (fetched by
// the route and passed in) and Last.fm "similar tracks" — and only falls back
// to personalized ListenBrainz recommendations (drawn from the user's whole
// history, so mood-agnostic) when those come up empty. Anything the user
// already has, or was recently suggested, is subtracted. Every source is
// best-effort: any can be empty (not connected, unknown seed, no Mix).
import type { Database } from "better-sqlite3";
import { getSimilar } from "../lastfm.js";
import { getRecommendations } from "../listenbrainz.js";
import { parseYouTubeId } from "../youtube.js";
import { getListenBrainzConnection, getListenBrainzToken } from "./listenbrainz.js";
import { libraryTrackKeys, trackKey } from "./songs.js";

export interface SuggestionCandidate {
  artist: string | null;
  title: string;
  recordingMbid: string | null;
  source: "recs" | "similar" | "youtube";
  // Present for YouTube-sourced picks: the video is already known, so the route
  // downloads it directly instead of searching by name first.
  watchUrl?: string | null;
  // YouTube channel/uploader for youtube-sourced picks. Fed to the smart-lookup
  // heuristic at ingest (like a manual import) so it can recover the real artist
  // from raw video-title junk — see ingestSuggestion.
  uploader?: string | null;
}

// Round-robin merge across any number of lists so a session interleaves the
// sources rather than draining one before the next (with only one source
// active, you'd otherwise get a long uniform run).
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const n = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < n; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

// Builds the ranked, de-duplicated candidate list for a user. `seed` is the
// track that just finished (drives Last.fm similar). `youtube` is the YouTube
// Mix for that seed, already fetched by the caller (which owns yt-dlp).
// `recent` holds tokens for tracks suggested earlier this session — a normalized
// artist|title key and/or a "yt:<videoId>" token — so a track that was already
// offered (even one since discarded) isn't immediately suggested again, which is
// what caused the radio to ping-pong between the same one or two picks.
export async function buildCandidates(
  db: Database,
  userId: string,
  seed?: { artist: string | null; title: string | null },
  youtube: SuggestionCandidate[] = [],
  recent: Set<string> = new Set()
): Promise<SuggestionCandidate[]> {
  const recsPromise = (async (): Promise<SuggestionCandidate[]> => {
    const conn = getListenBrainzConnection(db, userId);
    if (!conn.connected || !conn.username) return [];
    const token = getListenBrainzToken(db, userId);
    const recs = await getRecommendations(conn.username, token);
    return recs.map((r) => ({
      artist: r.artist,
      title: r.track,
      recordingMbid: r.recordingMbid,
      source: "recs" as const,
    }));
  })();

  const similarPromise = (async (): Promise<SuggestionCandidate[]> => {
    if (!seed?.artist || !seed?.title) return [];
    const sim = await getSimilar(seed.artist, seed.title);
    return sim.map((s) => ({
      artist: s.artist,
      title: s.track,
      recordingMbid: s.recordingMbid,
      source: "similar" as const,
    }));
  })();

  const [recs, similar] = await Promise.all([recsPromise, similarPromise]);

  // Excludes what the user already has, was recently suggested, or is a dup
  // within this pass. `seen` is shared so a fallback pool can't re-add a pick.
  const { mbids, keys, ytIds } = libraryTrackKeys(db, userId);
  const seen = new Set<string>();
  const filter = (list: SuggestionCandidate[]): SuggestionCandidate[] => {
    const out: SuggestionCandidate[] = [];
    for (const c of list) {
      if (!c.title) continue;
      if (c.recordingMbid && mbids.has(c.recordingMbid)) continue;
      // For YouTube picks, exclude by video id too (title dedup is unreliable
      // against messy "Artist - Title (Official Video)" names).
      const ytId = parseYouTubeId(c.watchUrl ?? null);
      if (ytId && ytIds.has(ytId)) continue;
      if (ytId && recent.has(`yt:${ytId}`)) continue;
      const key = trackKey(c.artist, c.title);
      if (keys.has(key) || seen.has(key) || recent.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  };

  // Seed-based sources (YouTube Mix + Last.fm "similar") stay close to the
  // current track's mood/genre, so they're the PRIMARY pool. ListenBrainz recs
  // are drawn from the user's whole history and can jump mood ("slow sad song"
  // -> "hard trap"), which breaks the vibe — so they're only a FALLBACK, used
  // when the seed-based pool comes up empty (e.g. an obscure seed with no Mix
  // and Last.fm not configured).
  const primary = filter(interleave([similar, youtube]));
  if (primary.length > 0) return primary;
  return filter(recs);
}
