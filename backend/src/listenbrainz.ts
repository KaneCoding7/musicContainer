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
