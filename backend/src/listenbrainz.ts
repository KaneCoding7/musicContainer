// ListenBrainz API client (https://listenbrainz.readthedocs.io/en/latest/users/api/).
//
// ListenBrainz is MetaBrainz's open scrobbling service. Each user connects with
// their own personal token; we validate it and then submit a "listen" whenever
// they finish a track. Everything here is best-effort: a failed scrobble must
// never disrupt playback, so callers fire-and-forget and we never throw.

const LB_BASE = "https://api.listenbrainz.org/1";

// Identifies this app to ListenBrainz (shown in a listen's metadata).
const CLIENT = "musicContainer";

export interface ScrobbleTrack {
  track: string; // track / recording name
  artist: string; // artist name
  release?: string | null; // album / release name
  recordingMbid?: string | null; // MusicBrainz recording MBID (best match key)
  durationSec?: number | null;
}

// Validates a personal token. Returns the ListenBrainz username on success, or
// null when the token is invalid / unreachable.
export async function validateToken(
  token: string
): Promise<{ valid: boolean; username: string | null }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${LB_BASE}/validate-token`, {
      headers: { Authorization: `Token ${token}` },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { valid: false, username: null };
    const data = (await res.json()) as { valid?: boolean; user_name?: string };
    return {
      valid: data.valid === true,
      username: data.user_name ?? null,
    };
  } catch {
    return { valid: false, username: null };
  }
}

// Builds a ListenBrainz track_metadata object from our track fields.
function trackMetadata(t: ScrobbleTrack) {
  const additional_info: Record<string, unknown> = {
    submission_client: CLIENT,
    media_player: CLIENT,
  };
  if (t.recordingMbid) additional_info.recording_mbid = t.recordingMbid;
  if (typeof t.durationSec === "number" && t.durationSec > 0)
    additional_info.duration = Math.round(t.durationSec);
  const meta: Record<string, unknown> = {
    track_name: t.track,
    artist_name: t.artist,
    additional_info,
  };
  if (t.release) meta.release_name = t.release;
  return meta;
}

// Submits a payload to ListenBrainz. Returns true on success.
async function submit(
  token: string,
  body: Record<string, unknown>
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${LB_BASE}/submit-listens`, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    return res.ok;
  } catch {
    return false;
  }
}

// Records a completed listen. `listenedAt` is the Unix epoch (seconds) the track
// finished; defaults handled by the caller.
export async function submitListen(
  token: string,
  track: ScrobbleTrack,
  listenedAt: number
): Promise<boolean> {
  return submit(token, {
    listen_type: "single",
    payload: [{ listened_at: listenedAt, track_metadata: trackMetadata(track) }],
  });
}

// Sets the user's "now playing" (no timestamp — it's the current track, not a
// completed listen). Expires on ListenBrainz after the track's duration.
export async function submitPlayingNow(
  token: string,
  track: ScrobbleTrack
): Promise<boolean> {
  return submit(token, {
    listen_type: "playing_now",
    payload: [{ track_metadata: trackMetadata(track) }],
  });
}

// --- Stats (phase 2: pull data in) -----------------------------------------

// Time ranges ListenBrainz computes stats over.
export type StatsRange = "week" | "month" | "year" | "all_time";

export interface StatEntry {
  name: string;
  subtitle?: string | null; // e.g. the artist under a track
  count: number; // listen count in the range
  mbid?: string | null;
}

export interface ActivityBucket {
  label: string; // e.g. a day, month, or year bucket
  count: number;
}

export interface UserStats {
  listenCount: number | null; // all-time total listens
  artists: StatEntry[];
  recordings: StatEntry[];
  releases: StatEntry[]; // top albums
  activity: ActivityBucket[]; // listens per time bucket in the range
}

interface LbArtistsResp {
  payload?: {
    artists?: {
      artist_name?: string;
      listen_count?: number;
      artist_mbid?: string | null;
    }[];
  };
}
interface LbRecordingsResp {
  payload?: {
    recordings?: {
      track_name?: string;
      artist_name?: string;
      listen_count?: number;
      recording_mbid?: string | null;
    }[];
  };
}
interface LbCountResp {
  payload?: { count?: number };
}
interface LbReleasesResp {
  payload?: {
    releases?: {
      release_name?: string;
      artist_name?: string;
      listen_count?: number;
      release_mbid?: string | null;
    }[];
  };
}
interface LbActivityResp {
  payload?: {
    listening_activity?: { time_range?: string; listen_count?: number }[];
  };
}

const STAT_COUNT = 10; // entries per top-list

// GETs a ListenBrainz JSON endpoint. Returns null on 204 (stats not yet
// computed for this user/range), any error, or a network failure.
async function lbGet<T>(path: string, token?: string | null): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Token ${token}`;
    const res = await fetch(`${LB_BASE}${path}`, {
      headers,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (res.status === 204 || !res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Fetches a user's top artists, top tracks, and all-time listen count. Each
// piece degrades to empty/null independently — a user with no computed stats
// for a range just gets empty lists, never an error.
export async function getUserStats(
  username: string,
  range: StatsRange,
  token?: string | null
): Promise<UserStats> {
  const u = encodeURIComponent(username);
  const [artistsData, recData, relData, actData, countData] = await Promise.all([
    lbGet<LbArtistsResp>(`/stats/user/${u}/artists?range=${range}&count=${STAT_COUNT}`, token),
    lbGet<LbRecordingsResp>(`/stats/user/${u}/recordings?range=${range}&count=${STAT_COUNT}`, token),
    lbGet<LbReleasesResp>(`/stats/user/${u}/releases?range=${range}&count=${STAT_COUNT}`, token),
    lbGet<LbActivityResp>(`/stats/user/${u}/listening-activity?range=${range}`, token),
    lbGet<LbCountResp>(`/user/${u}/listen-count`, token),
  ]);

  const artists: StatEntry[] = (artistsData?.payload?.artists ?? [])
    .filter((a) => a.artist_name)
    .map((a) => ({
      name: a.artist_name!,
      count: a.listen_count ?? 0,
      mbid: a.artist_mbid ?? null,
    }));
  const recordings: StatEntry[] = (recData?.payload?.recordings ?? [])
    .filter((r) => r.track_name)
    .map((r) => ({
      name: r.track_name!,
      subtitle: r.artist_name ?? null,
      count: r.listen_count ?? 0,
      mbid: r.recording_mbid ?? null,
    }));
  const releases: StatEntry[] = (relData?.payload?.releases ?? [])
    .filter((r) => r.release_name)
    .map((r) => ({
      name: r.release_name!,
      subtitle: r.artist_name ?? null,
      count: r.listen_count ?? 0,
      mbid: r.release_mbid ?? null,
    }));
  const activity: ActivityBucket[] = (actData?.payload?.listening_activity ?? [])
    .filter((b) => b.time_range && typeof b.listen_count === "number")
    .map((b) => ({ label: b.time_range!, count: b.listen_count! }));
  const listenCount =
    typeof countData?.payload?.count === "number" ? countData.payload.count : null;

  return { listenCount, artists, recordings, releases, activity };
}

// --- Recommendations + fresh releases (discovery) --------------------------

export interface Recommendation {
  track: string;
  artist: string | null;
  release: string | null;
  recordingMbid: string;
}

export interface FreshRelease {
  release: string;
  artist: string | null;
  date: string | null;
  type: string | null;
  releaseMbid: string | null;
}

interface LbRecResp {
  payload?: { mbids?: { recording_mbid?: string }[] };
}
interface LbMetaEntry {
  recording?: { name?: string };
  artist?: { name?: string };
  release?: { name?: string };
}
interface LbFreshResp {
  payload?: {
    releases?: {
      release_name?: string;
      artist_credit_name?: string;
      release_date?: string;
      release_group_primary_type?: string | null;
      release_mbid?: string;
    }[];
  };
}

// Personalized track recommendations. ListenBrainz returns only MBIDs, so we
// resolve names in one batched metadata call. Empty for users without computed
// recommendations (the engine runs periodically) — handled gracefully upstream.
export async function getRecommendations(
  username: string,
  token?: string | null
): Promise<Recommendation[]> {
  const u = encodeURIComponent(username);
  const rec = await lbGet<LbRecResp>(
    `/cf/recommendation/user/${u}/recording?count=20`,
    token
  );
  const mbids = (rec?.payload?.mbids ?? [])
    .map((m) => m.recording_mbid)
    .filter((x): x is string => !!x)
    .slice(0, 20);
  if (mbids.length === 0) return [];

  const meta = await lbGet<Record<string, LbMetaEntry>>(
    `/metadata/recording/?recording_mbids=${encodeURIComponent(mbids.join(","))}&inc=artist+release`
  );
  if (!meta) return [];
  const out: Recommendation[] = [];
  for (const id of mbids) {
    const m = meta[id];
    if (!m?.recording?.name) continue;
    out.push({
      track: m.recording.name,
      artist: m.artist?.name ?? null,
      release: m.release?.name ?? null,
      recordingMbid: id,
    });
  }
  return out;
}

// New + upcoming releases from artists the user listens to, newest first.
export async function getFreshReleases(
  username: string
): Promise<FreshRelease[]> {
  const u = encodeURIComponent(username);
  const fr = await lbGet<LbFreshResp>(`/user/${u}/fresh_releases`);
  return (fr?.payload?.releases ?? [])
    .filter((r) => r.release_name)
    .map((r) => ({
      release: r.release_name!,
      artist: r.artist_credit_name ?? null,
      date: r.release_date ?? null,
      type: r.release_group_primary_type ?? null,
      releaseMbid: r.release_mbid ?? null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 20);
}
