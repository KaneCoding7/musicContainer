import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { ART_DIR, CLIPS_DIR, getDb, MUSIC_DIR } from "../db/init.js";
import { preparedDownload, streamSongsZip } from "../functional/download.js";
import {
  copySongToLibrary,
  deleteSong,
  discardSuggestions,
  finalizeSongs,
  getSong,
  getSongSource,
  listPendingSongs,
  listSongs,
  listSongsNeedingLoudness,
  recordPlay,
  findOrCreateArtist,
  getSongLyricsById,
  listSongsNeedingLyrics,
  pruneOrphanArtists,
  recordSong,
  setSongLyrics,
  resolveSongArtById,
  resolveSongClipById,
  resolveSongFileById,
  setLiked,
  setSongArt,
  setSongClip,
  setSongClipDisabled,
  setSongLoudness,
  setSongsOrder,
  setAlbumSongsOrder,
  trackKey,
  updateSong,
  updateSongsBulk,
  validateUpload,
} from "../functional/songs.js";
import { canAccessSong } from "../functional/shares.js";
import {
  disableSongPublicLink,
  enableSongPublicLink,
  getSongPublicToken,
} from "../functional/publicShares.js";
import {
  getPlaybackState,
  setPlaybackState,
  clearPlaybackState,
} from "../functional/playbackState.js";
import { statusForError } from "../functional/result.js";
import { extractMetadata } from "../metadata.js";
import {
  enrichTrackInfo,
  fetchCoverArt,
  fetchCoverArtDataUrl,
} from "../musicbrainz.js";
import {
  getListenBrainzToken,
  getScrobbleTrack,
} from "../functional/listenbrainz.js";
import { submitListen, submitPlayingNow } from "../listenbrainz.js";
import { getLastfmSessionKey } from "../functional/lastfm.js";
import {
  scrobble as lastfmScrobble,
  updateNowPlaying as lastfmNowPlaying,
} from "../lastfm.js";
import { measureLoudness } from "../loudness.js";
import { enrichLyrics, resolveLyrics } from "../lyrics-enrich.js";
import { streamSongFile } from "../stream.js";
import { serveArt } from "../thumbnails.js";
import { rateLimit } from "../rate-limit.js";
import { assertSafeRemoteUrl } from "../url-safety.js";
import {
  buildCandidates,
  type SuggestionCandidate,
} from "../functional/suggestions.js";
import { parseYouTubeId, ytRelated } from "../youtube.js";

export const songsRouter = Router();

// Per-IP throttles on the expensive endpoints (each spawns yt-dlp/spotdl/ffmpeg
// or accepts large uploads), so they can't be hammered into a resource-DoS.
const importLimiter = rateLimit({ windowMs: 60_000, max: 12 });
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 120 });
const heavyLimiter = rateLimit({ windowMs: 60_000, max: 20 });

// GET /api/playback-state — the caller's last now-playing snapshot for
// cross-device resume (or null).
songsRouter.get("/playback-state", (req, res) => {
  const row = getPlaybackState(getDb(), req.userId!);
  if (!row) return res.json({ state: null });
  try {
    return res.json({
      state: JSON.parse(row.snapshot),
      updatedAt: row.updatedAt,
    });
  } catch {
    return res.json({ state: null });
  }
});

// PUT /api/playback-state — save (or clear) the caller's now-playing snapshot.
songsRouter.put("/playback-state", (req, res) => {
  const state = req.body?.state;
  if (state === null || state === undefined) {
    clearPlaybackState(getDb(), req.userId!);
    return res.json({ ok: true });
  }
  const updatedAt = Number(req.body?.updatedAt);
  if (typeof state !== "object" || !Number.isFinite(updatedAt)) {
    return res
      .status(400)
      .json({ error: { code: "validation", message: "Invalid state" } });
  }
  setPlaybackState(getDb(), req.userId!, JSON.stringify(state), updatedAt);
  return res.json({ ok: true });
});

// Store uploads on disk with a generated, collision-free filename while
// preserving the original extension.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MUSIC_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB cap
  fileFilter: (_req, file, cb) => {
    const result = validateUpload(file.originalname, file.mimetype);
    if (result.ok) {
      cb(null, true);
    } else {
      // Reject with a descriptive error; handled below.
      cb(new Error(result.error.message));
    }
  },
});

// Album art uploads (Cycle 32): JPEG/PNG/WebP into the art directory.
const ART_MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const artUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ART_DIR),
    filename: (_req, file, cb) => {
      const ext =
        extname(file.originalname).toLowerCase() ||
        ART_MIME_EXT[file.mimetype] ||
        ".jpg";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
  fileFilter: (_req, file, cb) => {
    if (file.mimetype in ART_MIME_EXT) {
      cb(null, true);
    } else {
      cb(new Error("Album art must be a JPEG, PNG, or WebP image"));
    }
  },
});

const cleanupArt = (filename: string) => {
  const p = join(ART_DIR, filename);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
};

// GET /api/songs/:id/public — current public token for a song (or null).
songsRouter.get("/songs/:id/public", (req, res) => {
  const result = getSongPublicToken(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ token: result.value });
});

// POST /api/songs/:id/public — enable a public link for a song.
songsRouter.post("/songs/:id/public", (req, res) => {
  const result = enableSongPublicLink(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ token: result.value });
});

// DELETE /api/songs/:id/public — disable a song's public link.
songsRouter.delete("/songs/:id/public", (req, res) => {
  const result = disableSongPublicLink(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});

// PUT /api/songs/:id/art — upload/replace a song's album art (field "art").
songsRouter.put("/songs/:id/art", (req, res) => {
  artUpload.single("art")(req, res, (uploadErr: unknown) => {
    if (uploadErr) {
      const message =
        uploadErr instanceof Error ? uploadErr.message : "Upload failed";
      return res.status(400).json({ error: { code: "validation", message } });
    }
    if (!req.file) {
      return res.status(400).json({
        error: { code: "validation", message: "No image provided (field: art)" },
      });
    }
    const result = setSongArt(
      getDb(),
      Number(req.params.id),
      req.userId!,
      req.file.filename
    );
    if (!result.ok) {
      cleanupArt(req.file.filename);
      return res
        .status(statusForError(result.error.code))
        .json({ error: result.error });
    }
    if (result.value.oldArt) cleanupArt(result.value.oldArt);
    return res.json({ song: result.value.song });
  });
});

// DELETE /api/songs/:id/art — remove a song's album art.
songsRouter.delete("/songs/:id/art", (req, res) => {
  const result = setSongArt(getDb(), Number(req.params.id), req.userId!, null);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  if (result.value.oldArt) cleanupArt(result.value.oldArt);
  return res.json({ song: result.value.song });
});

// --- Custom artist avatar images ---
// A per-user override for an artist's picture; the UI falls back to the top
// track's embedded art when none is set.

// The artist name travels as a `?name=` query param, never a path segment, so
// names with slashes or other special characters (e.g. "AC/DC") work.
function artistParam(req: { query: Record<string, unknown> }): string {
  return typeof req.query.name === "string" ? req.query.name : "";
}

// Looks up an existing artist id by name for a user (no creation). Used by the
// read/delete image routes, which shouldn't materialize an artist row.
function lookupArtistId(
  db: ReturnType<typeof getDb>,
  userId: string,
  name: string
): number | undefined {
  const row = db
    .prepare(
      "SELECT id FROM artists WHERE user_id = ? AND name = ? COLLATE NOCASE"
    )
    .get(userId, name.trim()) as { id: number } | undefined;
  return row?.id;
}

// GET /api/artists/images — names of artists the user has a custom image for.
songsRouter.get("/artists/images", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT a.name FROM artist_images ai
         JOIN artists a ON a.id = ai.artist_id
        WHERE ai.user_id = ?`
    )
    .all(req.userId!) as { name: string }[];
  return res.json({ artists: rows.map((r) => r.name) });
});

// GET /api/artists/image?name=… — serve the user's custom image, or 404.
songsRouter.get("/artists/image", (req, res) => {
  const artist = artistParam(req);
  if (!artist) return res.status(404).end();
  const db = getDb();
  const artistId = lookupArtistId(db, req.userId!, artist);
  if (artistId === undefined) return res.status(404).end();
  const row = db
    .prepare(
      "SELECT filename FROM artist_images WHERE user_id = ? AND artist_id = ?"
    )
    .get(req.userId!, artistId) as { filename: string } | undefined;
  if (!row) return res.status(404).end();
  const path = join(ART_DIR, row.filename);
  if (!existsSync(path)) return res.status(404).end();
  // Filename is unique per upload, but the URL is stable, so revalidate.
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path);
});

// PUT /api/artists/image?name=… — upload/replace the image (field "art").
songsRouter.put("/artists/image", (req, res) => {
  artUpload.single("art")(req, res, (uploadErr: unknown) => {
    if (uploadErr) {
      const message =
        uploadErr instanceof Error ? uploadErr.message : "Upload failed";
      return res.status(400).json({ error: { code: "validation", message } });
    }
    const artist = artistParam(req);
    if (!artist) {
      if (req.file) cleanupArt(req.file.filename);
      return res
        .status(400)
        .json({ error: { code: "validation", message: "Missing artist name" } });
    }
    if (!req.file) {
      return res.status(400).json({
        error: { code: "validation", message: "No image provided (field: art)" },
      });
    }
    const db = getDb();
    const artistId = findOrCreateArtist(db, req.userId!, artist);
    const existing = db
      .prepare(
        "SELECT filename FROM artist_images WHERE user_id = ? AND artist_id = ?"
      )
      .get(req.userId!, artistId) as { filename: string } | undefined;
    db.prepare(
      `INSERT INTO artist_images (user_id, artist_id, filename, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, artist_id) DO UPDATE SET
         filename = excluded.filename, updated_at = excluded.updated_at`
    ).run(req.userId!, artistId, req.file.filename);
    if (existing?.filename) cleanupArt(existing.filename);
    return res.status(201).json({ ok: true });
  });
});

// DELETE /api/artists/image?name=… — revert to the default (track) art.
songsRouter.delete("/artists/image", (req, res) => {
  const artist = artistParam(req);
  if (!artist) return res.status(204).end();
  const db = getDb();
  const artistId = lookupArtistId(db, req.userId!, artist);
  if (artistId === undefined) return res.status(204).end();
  const row = db
    .prepare(
      "SELECT filename FROM artist_images WHERE user_id = ? AND artist_id = ?"
    )
    .get(req.userId!, artistId) as { filename: string } | undefined;
  db.prepare(
    "DELETE FROM artist_images WHERE user_id = ? AND artist_id = ?"
  ).run(req.userId!, artistId);
  if (row?.filename) cleanupArt(row.filename);
  // The artist row may now be unreferenced (e.g. an image for a name with no
  // songs); prune it so stray artists don't accumulate.
  pruneOrphanArtists(db, [artistId]);
  return res.status(204).end();
});

// POST /api/upload — upload a single audio file (extracts embedded metadata).
songsRouter.post("/upload", uploadLimiter, (req, res) => {
  upload.single("file")(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      const message =
        uploadErr instanceof Error ? uploadErr.message : "Upload failed";
      return res.status(400).json({ error: { code: "validation", message } });
    }
    if (!req.file) {
      return res.status(400).json({
        error: { code: "validation", message: "No file provided (field: file)" },
      });
    }

    const audioPath = join(MUSIC_DIR, req.file.filename);
    const meta = await extractMetadata(audioPath, ART_DIR);

    const result = recordSong(getDb(), {
      filename: req.file.filename,
      // Prefer an embedded title (so a song downloaded from another instance
      // keeps its name) but fall back to the uploaded filename.
      originalFilename: meta.title?.trim() || req.file.originalname,
      userId: req.userId!,
      artist: meta.artist,
      artists: meta.artists, // individual artists from the embedded tags
      album: meta.album,
      artFilename: meta.artFilename,
      duration: meta.duration,
      pending: true, // awaits review before joining the library
      sourceUrl: meta.sourceUrl, // recovered from the comment tag, if present
      trackNo: meta.trackNo, // from embedded ID3 tags (e.g. a round-tripped download)
      discNo: meta.discNo,
    });

    if (!result.ok) {
      // Roll back stored files if we couldn't persist the metadata.
      const cleanup = (p: string) => {
        if (existsSync(p)) {
          try {
            unlinkSync(p);
          } catch {
            /* best-effort cleanup */
          }
        }
      };
      cleanup(audioPath);
      if (meta.artFilename) cleanup(join(ART_DIR, meta.artFilename));
      return res
        .status(statusForError(result.error.code))
        .json({ error: result.error });
    }

    // Measure loudness in the background so the upload response isn't delayed;
    // the value lands on the next library load.
    const songId = result.value.id;
    measureLoudness(audioPath)
      .then((lufs) => {
        if (lufs !== null) setSongLoudness(getDb(), songId, lufs);
      })
      .catch(() => {});
    // Fetch lyrics in the background (LRCLIB, falling back to embedded tags).
    enrichLyrics(getDb(), songId, {
      artist: result.value.artist,
      track: result.value.originalFilename,
      album: result.value.album,
      durationSec: result.value.duration,
      embedded: meta.lyrics,
    }).catch(() => {});

    return res.status(201).json({ song: result.value });
  });
});

// Runs yt-dlp to extract a link's audio as MP3 (with embedded thumbnail) into
// `cwd`, reporting progress via onProgress. URL is passed as argv (no shell),
// so it can't inject commands.
const PLAYLIST_CAP = 50; // most tracks to pull from one playlist

function runYtDlp(
  url: string,
  cwd: string,
  onProgress: (stage: string, percent?: number) => void,
  playlist = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "yt-dlp",
      [
        "-x",
        "--audio-format",
        "mp3",
        "--embed-thumbnail",
        // Write a per-item .info.json so we can record each track's OWN video
        // URL (webpage_url) — otherwise a playlist import would store the same
        // pasted playlist URL for every track.
        "--write-info-json",
        // Cap per-item download size so one huge link can't fill the disk.
        "--max-filesize",
        "600M",
        ...(playlist
          ? [
              "--yes-playlist",
              "--playlist-end",
              String(PLAYLIST_CAP),
              // Skip individual unavailable/private/region-locked items and keep
              // going instead of aborting the whole playlist on the first one.
              "--ignore-errors",
            ]
          : ["--no-playlist"]),
        "--newline",
        "--progress-template",
        "download:DLPCT %(progress._percent_str)s",
        "-o",
        "%(title)s.%(ext)s",
        url,
      ],
      { cwd }
    );

    let stderrTail = "";
    let stdoutBuf = "";
    const handleLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      const pct = line.match(/DLPCT\s+([\d.]+)%/);
      if (pct) onProgress("download", parseFloat(pct[1]));
      else if (line.includes("[ExtractAudio]")) onProgress("convert");
      else if (line.includes("[EmbedThumbnail]") || line.includes("[Metadata]"))
        onProgress("art");
    };
    child.stdout.on("data", (d: Buffer) => {
      stdoutBuf += d.toString();
      let i: number;
      while ((i = stdoutBuf.indexOf("\n")) >= 0) {
        handleLine(stdoutBuf.slice(0, i));
        stdoutBuf = stdoutBuf.slice(i + 1);
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-600);
    });

    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(new Error("Timed out"));
      },
      (playlist ? 15 : 5) * 60 * 1000
    );

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // In playlist mode yt-dlp exits non-zero if ANY item was unavailable
      // (private/region-locked/deleted), even when the rest downloaded fine.
      // Don't treat that as a total failure — resolve and let the ingest step
      // decide based on what actually landed on disk (it reports "no audio
      // could be extracted" when the dir is truly empty).
      if (playlist) return resolve();
      const last = stderrTail
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      reject(new Error(last || "Download failed"));
    });
  });
}

// Runs spotdl for a Spotify link: it reads the track/album/playlist metadata
// from Spotify, finds the matching audio on YouTube, and downloads it as MP3
// (with cover art). Spotify itself is DRM-protected, so this is the YouTube
// match, not Spotify's own file.
function runSpotdl(
  url: string,
  cwd: string,
  onProgress: (stage: string) => void,
  playlist = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "download",
      url,
      "--output",
      "{title}.{output-ext}",
      "--format",
      "mp3",
    ];
    // Optional Spotify API credentials improve reliability (avoid shared rate
    // limits); falls back to spotdl's bundled defaults when unset.
    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      args.push(
        "--client-id",
        process.env.SPOTIFY_CLIENT_ID,
        "--client-secret",
        process.env.SPOTIFY_CLIENT_SECRET
      );
    }
    const child = spawn("spotdl", args, { cwd });
    onProgress("download"); // spotdl doesn't report a clean %, so stay indeterminate
    let tail = "";
    const onData = (d: Buffer) => {
      const s = d.toString();
      tail = (tail + s).slice(-1500);
      if (s.includes("Downloaded ")) onProgress("convert");
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(new Error("Timed out"));
      },
      (playlist ? 15 : 8) * 60 * 1000
    );
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const last = tail.split("\n").map((l) => l.trim()).filter(Boolean).pop();
      reject(new Error(last || "Spotify import failed"));
    });
  });
}

// Searches YouTube via yt-dlp (no download) and returns lightweight result
// metadata for the user to pick from. `--flat-playlist` keeps it fast — it only
// reads the search results page, never touching each video. The query is passed
// as a single argv after a fixed "ytsearchN:" prefix (no shell), so it can't
// inject yt-dlp flags or shell commands.
const SEARCH_COUNT = 8; // results to show per search

interface YtSearchResult {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  url: string;
}

function runYtSearch(query: string): Promise<YtSearchResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "yt-dlp",
      [
        `ytsearch${SEARCH_COUNT}:${query}`,
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--no-playlist",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let out = "";
    let errTail = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      errTail = (errTail + d.toString()).slice(-600);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Search timed out"));
    }, 30_000);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        const last = errTail
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .pop();
        return reject(new Error(last || "Search failed"));
      }
      const results: YtSearchResult[] = [];
      for (const line of out.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
          const o = JSON.parse(s);
          const id = typeof o.id === "string" ? o.id : null;
          if (!id) continue;
          results.push({
            id,
            title: typeof o.title === "string" ? o.title : id,
            uploader:
              (typeof o.uploader === "string" && o.uploader) ||
              (typeof o.channel === "string" && o.channel) ||
              null,
            duration: typeof o.duration === "number" ? o.duration : null,
            // Canonical watch URL — fed straight into the existing import flow.
            url: `https://www.youtube.com/watch?v=${id}`,
          });
        } catch {
          /* skip malformed line */
        }
      }
      resolve(results);
    });
  });
}

// POST /api/youtube-search — { query } -> { results: [...] }. Searches YouTube
// by name so the user can pick a track to import without finding a link first.
songsRouter.post("/youtube-search", importLimiter, async (req, res) => {
  const query =
    typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    return res.status(400).json({
      error: { code: "validation", message: "A search term is required" },
    });
  }
  if (query.length > 200) {
    return res.status(400).json({
      error: { code: "validation", message: "Search term is too long" },
    });
  }
  try {
    const results = await runYtSearch(query);
    return res.json({ results });
  } catch (e) {
    return res.status(502).json({
      error: {
        code: "import_failed",
        message: e instanceof Error ? e.message : "Search failed",
      },
    });
  }
});

// POST /api/import-link — download a link's audio (yt-dlp, or spotdl for Spotify
// links) and ingest it into the library. Streams NDJSON progress lines so the
// client can show a progress bar, ending with a {done} or {error} line.
songsRouter.post("/import-link", importLimiter, async (req, res) => {
  const url =
    typeof req.body?.url === "string" ? (req.body.url as string).trim() : "";
  const playlist = req.body?.playlist === true;
  const isSpotify =
    /open\.spotify\.com\//i.test(url) || /^spotify:/i.test(url);
  if (!/^https?:\/\/\S+$/i.test(url) && !/^spotify:/i.test(url)) {
    return res.status(400).json({
      error: { code: "validation", message: "A valid link is required" },
    });
  }
  // SSRF guard: don't let the importer reach internal/private addresses. The
  // spotify: scheme has no host (resolved by spotdl via Spotify's API), so it
  // only applies to http(s) links.
  if (/^https?:\/\//i.test(url)) {
    try {
      await assertSafeRemoteUrl(url);
    } catch (e) {
      return res.status(400).json({
        error: {
          code: "validation",
          message: e instanceof Error ? e.message : "That link is not allowed",
        },
      });
    }
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy buffer it
  const send = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);

  // Download into a temp dir on the same volume as the music dir.
  const work = mkdtempSync(join(dirname(MUSIC_DIR), "import-"));
  try {
    let lastPct = -1;
    const onProg = (stage: string, percent?: number) => {
      // Throttle download updates to whole-percent changes.
      if (stage === "download" && percent !== undefined) {
        const p = Math.floor(percent);
        if (p === lastPct) return;
        lastPct = p;
      }
      send({ type: "progress", stage, percent });
    };
    if (isSpotify) {
      await runSpotdl(url, work, onProg, playlist);
    } else {
      await runYtDlp(url, work, onProg, playlist);
    }

    send({ type: "progress", stage: "ingest" });
    const produced = readdirSync(work).filter((f) =>
      f.toLowerCase().endsWith(".mp3")
    );

    const songs = [];
    for (const name of produced) {
      const stored = `${randomUUID()}.mp3`;
      const dest = join(MUSIC_DIR, stored);
      copyFileSync(join(work, name), dest);
      const meta = await extractMetadata(dest, ART_DIR);
      // Each track's own video URL + any music fields yt-dlp parsed, from its
      // sidecar .info.json (yt-dlp writes "<title>.info.json" alongside the
      // mp3). Falls back to the pasted URL for a single-video import.
      let trackUrl: string | null = url;
      let infoUploader: string | null = null;
      let infoTrack: string | null = null;
      let infoArtist: string | null = null;
      let infoAlbum: string | null = null;
      if (!isSpotify) {
        const infoPath = join(work, name.replace(/\.mp3$/i, ".info.json"));
        if (existsSync(infoPath)) {
          try {
            const info = JSON.parse(readFileSync(infoPath, "utf8"));
            if (typeof info.webpage_url === "string") trackUrl = info.webpage_url;
            else if (typeof info.original_url === "string") trackUrl = info.original_url;
            // YouTube Music entries carry clean track/artist/album fields.
            if (typeof info.track === "string") infoTrack = info.track;
            if (typeof info.artist === "string") infoArtist = info.artist;
            else if (typeof info.creator === "string") infoArtist = info.creator;
            if (typeof info.album === "string") infoAlbum = info.album;
            if (typeof info.uploader === "string") infoUploader = info.uploader;
            else if (typeof info.channel === "string") infoUploader = info.channel;
          } catch {
            /* keep the fallback URL */
          }
        }
      }

      // Guess a clean title/artist/album. Spotify (spotdl) already wrote good
      // ID3 tags, so trust those and skip the network lookup; YouTube imports
      // get the heuristic + MusicBrainz treatment.
      const rawTitle = name.replace(/\.mp3$/i, "");
      const info = await enrichTrackInfo({
        rawTitle,
        uploader: infoUploader,
        durationSec: meta.duration,
        tagTitle: isSpotify ? meta.title : infoTrack,
        tagArtist: isSpotify ? meta.artist : infoArtist,
        tagAlbum: isSpotify ? meta.album : infoAlbum,
        useMusicBrainz: !isSpotify,
      });
      // Use the clean track title as the display name (no file extension — the
      // download endpoint re-appends ".mp3" when the name lacks one).
      const cleanName = info.title.trim() || rawTitle.replace(/\.mp3$/i, "");

      // Default cover: the real album art from the Cover Art Archive, falling
      // back to the embedded YouTube thumbnail extractMetadata pulled. (Spotify
      // imports already carry good cover art, so leave those alone.)
      let artFilename = meta.artFilename;
      if (!isSpotify && info.artist && info.album) {
        const cover = await fetchCoverArt({
          artist: info.artist,
          album: info.album,
        });
        if (cover) {
          const fn = `${randomUUID()}.${cover.ext}`;
          try {
            writeFileSync(join(ART_DIR, fn), cover.buffer);
            // Remove the now-unused thumbnail file so it doesn't orphan on disk.
            if (meta.artFilename) {
              try {
                unlinkSync(join(ART_DIR, meta.artFilename));
              } catch {
                /* best-effort */
              }
            }
            artFilename = fn;
          } catch {
            /* keep the thumbnail on any write failure */
          }
        }
      }

      const result = recordSong(getDb(), {
        filename: stored,
        originalFilename: cleanName,
        userId: req.userId!,
        artist: info.artist ?? meta.artist,
        // Keep multiple artists only when the embedded tags actually list them;
        // otherwise let the (often enriched) single `artist` string stand.
        artists: meta.artists.length > 1 ? meta.artists : undefined,
        album: info.album ?? meta.album,
        artFilename,
        duration: meta.duration,
        pending: true, // awaits review before joining the library
        // Only video links support the "pick frame as art" feature.
        sourceUrl: isSpotify ? null : trackUrl,
        mbRecordingId: info.recordingMbid ?? null,
        // Prefer the recognized release position; fall back to embedded tags.
        trackNo: info.trackNo ?? meta.trackNo,
        discNo: info.discNo ?? meta.discNo,
      });
      if (!result.ok) {
        if (existsSync(dest)) {
          try {
            unlinkSync(dest);
          } catch {
            /* best-effort */
          }
        }
        continue;
      }
      const songId = result.value.id;
      measureLoudness(dest)
        .then((lufs) => {
          if (lufs !== null) setSongLoudness(getDb(), songId, lufs);
        })
        .catch(() => {});
      enrichLyrics(getDb(), songId, {
        artist: result.value.artist,
        track: result.value.originalFilename,
        album: result.value.album,
        durationSec: result.value.duration,
        embedded: meta.lyrics,
      }).catch(() => {});
      songs.push(result.value);
    }

    if (songs.length === 0) {
      send({ type: "error", message: "No audio could be extracted from that link" });
    } else {
      send({ type: "done", songs });
    }
  } catch (e) {
    send({ type: "error", message: e instanceof Error ? e.message : "Import failed" });
  } finally {
    rmSync(work, { recursive: true, force: true });
    res.end();
  }
});

// Downloads a single YouTube watch URL and ingests it as a pending SUGGESTION
// track (mirrors the single-video path of /import-link, minus the NDJSON
// progress stream). Returns the created Song, or null if nothing usable landed.
// Kept self-contained so suggestion radio can't disturb the import route.
async function ingestSuggestion(
  watchUrl: string,
  userId: string,
  hint: {
    artist: string | null;
    title: string;
    recordingMbid: string | null;
    source: SuggestionCandidate["source"];
    uploader: string | null;
  }
): Promise<import("../types.js").Song | null> {
  const work = mkdtempSync(join(dirname(MUSIC_DIR), "suggest-"));
  try {
    await runYtDlp(watchUrl, work, () => {}, false);
    const produced = readdirSync(work).filter((f) =>
      f.toLowerCase().endsWith(".mp3")
    );
    if (produced.length === 0) return null;
    const name = produced[0];
    const stored = `${randomUUID()}.mp3`;
    const dest = join(MUSIC_DIR, stored);
    copyFileSync(join(work, name), dest);
    const meta = await extractMetadata(dest, ART_DIR);

    // Prefer each track's own webpage_url (sidecar .info.json) as the source.
    let trackUrl: string | null = watchUrl;
    const infoPath = join(work, name.replace(/\.mp3$/i, ".info.json"));
    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8"));
        if (typeof info.webpage_url === "string") trackUrl = info.webpage_url;
        else if (typeof info.original_url === "string") trackUrl = info.original_url;
      } catch {
        /* keep the search URL */
      }
    }

    // Feed enrichTrackInfo per source. ListenBrainz recs / Last.fm similar carry
    // a clean artist+title, so trust those as tags. YouTube picks (Mix) only have
    // the raw video title ("… (Official Music Video) [HD]" + channel cruft), so
    // treat it exactly like a manual YouTube import: pass it as rawTitle for the
    // heuristic to clean and hand over the channel as `uploader` so it can
    // recover the artist — never trust the raw title as a tag. (Issue #91.)
    const isYouTube = hint.source === "youtube";
    const info = await enrichTrackInfo({
      rawTitle: isYouTube ? hint.title : name.replace(/\.mp3$/i, ""),
      uploader: isYouTube ? hint.uploader : null,
      durationSec: meta.duration,
      tagTitle: isYouTube ? null : hint.title,
      tagArtist: isYouTube ? null : hint.artist,
      tagAlbum: null,
      useMusicBrainz: true,
    });
    const cleanName = info.title.trim() || hint.title;

    let artFilename = meta.artFilename;
    if (info.artist && info.album) {
      const cover = await fetchCoverArt({ artist: info.artist, album: info.album });
      if (cover) {
        const fn = `${randomUUID()}.${cover.ext}`;
        try {
          writeFileSync(join(ART_DIR, fn), cover.buffer);
          if (meta.artFilename) {
            try {
              unlinkSync(join(ART_DIR, meta.artFilename));
            } catch {
              /* best-effort */
            }
          }
          artFilename = fn;
        } catch {
          /* keep the thumbnail */
        }
      }
    }

    const result = recordSong(getDb(), {
      filename: stored,
      originalFilename: cleanName,
      userId,
      artist: info.artist ?? meta.artist ?? hint.artist,
      artists: meta.artists.length > 1 ? meta.artists : undefined,
      album: info.album ?? meta.album,
      artFilename,
      duration: meta.duration,
      pending: true,
      suggestion: true,
      sourceUrl: trackUrl,
      mbRecordingId: info.recordingMbid ?? hint.recordingMbid,
      trackNo: info.trackNo ?? meta.trackNo,
      discNo: info.discNo ?? meta.discNo,
    });
    if (!result.ok) {
      if (existsSync(dest)) {
        try {
          unlinkSync(dest);
        } catch {
          /* best-effort */
        }
      }
      return null;
    }
    const songId = result.value.id;
    measureLoudness(dest)
      .then((lufs) => {
        if (lufs !== null) setSongLoudness(getDb(), songId, lufs);
      })
      .catch(() => {});
    return result.value;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Per-user memory of recently suggested tracks (tokens: artist|title key and
// "yt:<videoId>"), so the radio doesn't keep offering the same one or two picks
// — a discarded suggestion leaves the library, so without this it could be
// re-picked as the mix's top related track immediately. In-memory only; resets
// on restart, which is fine (a fresh session can re-suggest old tracks).
const recentSuggestionsByUser = new Map<string, Set<string>>();
const RECENT_CAP = 40;

function candidateTokens(c: {
  artist: string | null;
  title: string;
  watchUrl?: string | null;
}): string[] {
  const tokens = [trackKey(c.artist, c.title)];
  const yt = parseYouTubeId(c.watchUrl ?? null);
  if (yt) tokens.push(`yt:${yt}`);
  return tokens;
}

function rememberSuggestion(userId: string, tokens: string[]): void {
  let set = recentSuggestionsByUser.get(userId);
  if (!set) {
    set = new Set();
    recentSuggestionsByUser.set(userId, set);
  }
  for (const t of tokens) set.add(t);
  // Trim to the most-recent RECENT_CAP tokens (Set preserves insertion order).
  if (set.size > RECENT_CAP) {
    const trimmed = new Set([...set].slice(-RECENT_CAP));
    recentSuggestionsByUser.set(userId, trimmed);
  }
}

// Fisher–Yates shuffle so we don't always take the mix's #1 pick — gives variety
// across rounds even when the seed (and thus the mix) is similar.
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// GET /api/suggestions/next?seedArtist=&seedTitle=&seedSongId= — pick a blended
// candidate (ListenBrainz recs + Last.fm similar + YouTube's autoplay Mix for
// the seed, minus what's already owned or recently suggested), download it as a
// pending suggestion, and return the Song. The client appends it to the queue
// when repeat is off and the queue runs dry. Tries a few candidates so one
// dead/unfindable pick doesn't fail the whole request. 204 when there's nothing
// to suggest.
songsRouter.get("/suggestions/next", importLimiter, async (req, res) => {
  const seedArtist =
    typeof req.query.seedArtist === "string" ? req.query.seedArtist.trim() : "";
  const seedTitle =
    typeof req.query.seedTitle === "string" ? req.query.seedTitle.trim() : "";
  const seedSongId = Number(req.query.seedSongId);
  try {
    // Find a YouTube video id to seed the Mix (YouTube's own "up next"). Prefer
    // the seed track's own source link when it was a YouTube import (exact);
    // otherwise search YouTube by name to anchor the mix.
    let seedVideoId: string | null = null;
    if (Number.isInteger(seedSongId) && seedSongId > 0) {
      const s = getSong(getDb(), seedSongId, req.userId!);
      if (s.ok) seedVideoId = parseYouTubeId(s.value.sourceUrl);
    }
    if (!seedVideoId && (seedArtist || seedTitle)) {
      try {
        const hits = await runYtSearch(`${seedArtist} ${seedTitle}`.trim());
        if (hits.length > 0) seedVideoId = hits[0].id;
      } catch {
        /* no seed video — YouTube source just stays empty */
      }
    }
    const youtube: SuggestionCandidate[] = seedVideoId
      ? (await ytRelated(seedVideoId)).map((e) => ({
          artist: e.uploader,
          title: e.title,
          recordingMbid: null,
          source: "youtube" as const,
          watchUrl: e.url,
          uploader: e.uploader,
        }))
      : [];

    const recent = recentSuggestionsByUser.get(req.userId!) ?? new Set();
    const candidates = await buildCandidates(
      getDb(),
      req.userId!,
      { artist: seedArtist || null, title: seedTitle || null },
      youtube,
      recent
    );
    if (candidates.length === 0) return res.status(204).end();

    // Shuffle so we don't always take the mix's #1, then try a few until one
    // resolves + downloads. Cap the attempts so a request can't spawn an
    // unbounded run of yt-dlp processes. YouTube picks already carry their video
    // URL (no search needed); scrobbler picks are resolved to a video by name.
    for (const c of shuffled(candidates).slice(0, 4)) {
      let watchUrl = c.watchUrl ?? null;
      if (!watchUrl) {
        const query = `${c.artist ? `${c.artist} - ` : ""}${c.title}`;
        try {
          const hits = await runYtSearch(query);
          if (hits.length > 0) watchUrl = hits[0].url;
        } catch {
          continue;
        }
      }
      if (!watchUrl) continue;
      const song = await ingestSuggestion(watchUrl, req.userId!, {
        artist: c.artist,
        title: c.title,
        recordingMbid: c.recordingMbid,
        source: c.source,
        uploader: c.uploader ?? null,
      });
      if (song) {
        // Record BOTH the intended pick and the actually-downloaded video so
        // neither recurs next round.
        rememberSuggestion(req.userId!, [
          ...candidateTokens(c),
          ...candidateTokens({ artist: song.artist, title: song.originalFilename, watchUrl: song.sourceUrl }),
        ]);
        return res.json({ song });
      }
    }
    return res.status(204).end();
  } catch (e) {
    return res.status(502).json({
      error: {
        code: "import_failed",
        message: e instanceof Error ? e.message : "Could not fetch a suggestion",
      },
    });
  }
});

// POST /api/suggestions/discard — { ids } — drop suggestion tracks the user
// moved past without keeping. Safe by construction: only un-kept, un-liked,
// not-in-a-playlist suggestion rows are removed (see discardSuggestions).
songsRouter.post("/suggestions/discard", (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).filter((x): x is number => typeof x === "number")
    : [];
  const result = discardSuggestions(getDb(), ids, req.userId!, MUSIC_DIR, ART_DIR);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ discarded: result.value });
});

// GET /api/songs — list all songs.
songsRouter.get("/songs", (req, res) => {
  const result = listSongs(getDb(), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});

// GET /api/songs/pending — uploaded/imported songs awaiting review.
songsRouter.get("/songs/pending", (req, res) => {
  const result = listPendingSongs(getDb(), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});

// POST /api/songs/finalize — confirm pending songs into the library.
songsRouter.post("/songs/finalize", (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).filter((x): x is number => typeof x === "number")
    : [];
  const result = finalizeSongs(getDb(), ids, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});

// POST /api/songs/:id/copy-to-library — copy an accessible song (e.g. from a
// shared playlist) into the caller's own library.
songsRouter.post("/songs/:id/copy-to-library", (req, res) => {
  const result = copySongToLibrary(
    getDb(),
    req.userId!,
    Number(req.params.id),
    MUSIC_DIR,
    ART_DIR
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ song: result.value });
});

// Spawns a process, resolving on exit 0 (rejecting otherwise). Kills on timeout.
function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, cwd ? { cwd } : {});
    let tail = "";
    child.stderr.on("data", (d: Buffer) => {
      tail = (tail + d.toString()).slice(-500);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out"));
    }, 4 * 60 * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const last = tail.split("\n").map((l) => l.trim()).filter(Boolean).pop();
      reject(new Error(last || `${cmd} failed`));
    });
  });
}

// GET /api/songs/:id/frames — for a link-imported track, download a low-res copy
// of the source video and return evenly-spaced frames (as data URLs) to offer as
// alternative cover art.
songsRouter.get("/songs/:id/frames", heavyLimiter, async (req, res) => {
  const id = Number(req.params.id);
  const src = getSongSource(getDb(), id, req.userId!);
  if (!src) {
    return res.status(404).json({
      error: { code: "not_found", message: "No source video for this track" },
    });
  }
  try {
    await assertSafeRemoteUrl(src.sourceUrl);
  } catch {
    return res.status(400).json({
      error: { code: "validation", message: "Source link is not allowed" },
    });
  }

  const work = mkdtempSync(join(dirname(MUSIC_DIR), "frames-"));
  try {
    await run(
      "yt-dlp",
      [
        "-f",
        "worst[ext=mp4]/worstvideo[ext=mp4]/worst",
        "--no-playlist",
        "--write-thumbnail",
        "-o",
        "vid.%(ext)s",
        src.sourceUrl,
      ],
      work
    );
    const files = readdirSync(work);
    const vid = files.find((f) => /^vid\.(mp4|mkv|webm|m4v|flv)$/i.test(f));
    const thumb = files.find((f) => /^vid\.(webp|jpg|jpeg|png)$/i.test(f));

    const frames: { t?: number; label?: string; dataUrl: string }[] = [];

    // The real album cover from the Cover Art Archive, offered first.
    const songRes = getSong(getDb(), id, req.userId!);
    const songMeta = songRes.ok ? songRes.value : null;
    if (songMeta?.artist && songMeta?.album) {
      const cover = await fetchCoverArtDataUrl({
        artist: songMeta.artist,
        album: songMeta.album,
      });
      if (cover) frames.push({ label: "Album cover", dataUrl: cover });
    }

    // The video's official thumbnail, offered next.
    if (thumb) {
      const ext = extname(thumb).toLowerCase();
      const mime =
        ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      frames.push({
        label: "Thumbnail",
        dataUrl: `data:${mime};base64,${readFileSync(join(work, thumb)).toString("base64")}`,
      });
    }

    if (!vid) {
      if (frames.length > 0) return res.json({ frames });
      return res.status(422).json({
        error: { code: "validation", message: "Couldn't fetch the video" },
      });
    }
    const vidPath = join(work, vid);

    const duration = src.duration && src.duration > 1 ? src.duration : 60;
    const COUNT = 9;
    for (let i = 1; i <= COUNT; i++) {
      const t = (duration * i) / (COUNT + 1); // evenly spaced, excluding the ends
      const out = join(work, `f${i}.jpg`);
      try {
        await run("ffmpeg", [
          "-y",
          "-ss",
          t.toFixed(2),
          "-i",
          vidPath,
          "-frames:v",
          "1",
          "-vf",
          "scale=512:-1",
          "-q:v",
          "3",
          out,
        ]);
      } catch {
        continue;
      }
      if (existsSync(out)) {
        frames.push({
          t: Math.round(t),
          dataUrl: `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`,
        });
      }
    }

    if (frames.length === 0) {
      return res.status(422).json({
        error: { code: "validation", message: "Couldn't extract any frames" },
      });
    }
    return res.json({ frames });
  } catch (e) {
    return res.status(422).json({
      error: {
        code: "validation",
        message: e instanceof Error ? e.message : "Failed to get frames",
      },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// POST /api/songs/:id/clip — generate (and cache) a looping "canvas" clip from
// the track's source video, shown in the expanded player. Downloads only a
// CLIP_LEN window of low-res video (yt-dlp --download-sections) starting ~25%
// in, then re-encodes it to a small, muted, web-friendly mp4. Idempotent: if a
// clip already exists it's returned as-is.
//
// The player loops this clip for the whole track, so a short window repeats
// dozens of times over a typical song and reads as repetitive. Override with
// CLIP_SECONDS (clamped to 3..60); longer clips cost proportionally more
// download time, encode time, and disk (~35 KB/s at these settings).
const CLIP_LEN = (() => {
  // Treat empty/whitespace as unset: compose commonly passes optional vars as
  // `${CLIP_SECONDS:-}`, and Number("") is 0, which would clamp to the 3s floor
  // and make clips SHORTER than the default. Non-numeric must not yield NaN
  // either -- NaN survives both clamps and reaches fmt() as an Invalid Date,
  // breaking every clip generation.
  const env = process.env.CLIP_SECONDS?.trim();
  const raw = Number(env ? env : 15);
  const secs = Number.isFinite(raw) ? Math.round(raw) : 15;
  return Math.min(60, Math.max(3, secs));
})(); // seconds
songsRouter.post("/songs/:id/clip", heavyLimiter, async (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();

  // Already generated? Return the current song unchanged.
  const current = getSong(db, id, req.userId!);
  if (current.ok && current.value.hasClip) {
    return res.json({ song: current.value });
  }

  const src = getSongSource(db, id, req.userId!);
  if (!src) {
    return res.status(404).json({
      error: { code: "not_found", message: "No source video for this track" },
    });
  }
  try {
    await assertSafeRemoteUrl(src.sourceUrl);
  } catch {
    return res.status(400).json({
      error: { code: "validation", message: "Source link is not allowed" },
    });
  }

  // Start ~25% in (a representative-but-not-intro moment), clamped so the window
  // fits within a known duration. Unknown duration → a small fixed offset.
  const dur = src.duration ?? 0;
  const start =
    dur > CLIP_LEN + 2
      ? Math.min(dur * 0.25, dur - CLIP_LEN - 1)
      : Math.min(5, Math.max(0, dur - 1));
  const fmt = (s: number) => new Date(s * 1000).toISOString().substr(11, 8);

  const work = mkdtempSync(join(dirname(MUSIC_DIR), "clip-"));
  try {
    // Download just the needed section as low-res video (no audio needed).
    await run(
      "yt-dlp",
      [
        // Prefer a ~540p rendition (nice as a backdrop, still small once we only
        // pull a ~7s section); fall back through best available.
        "-f",
        "bv*[ext=mp4]/bv*/b[ext=mp4]/b",
        "-S",
        "res:540",
        "--no-playlist",
        "--force-keyframes-at-cuts",
        "--download-sections",
        `*${fmt(start)}-${fmt(start + CLIP_LEN)}`,
        "-o",
        "vid.%(ext)s",
        src.sourceUrl,
      ],
      work
    );
    const files = readdirSync(work);
    const vid = files.find((f) => /^vid\.(mp4|mkv|webm|m4v|flv)$/i.test(f));
    if (!vid) {
      return res.status(422).json({
        error: { code: "validation", message: "Couldn't fetch the video" },
      });
    }

    // Re-encode: strip audio, downscale to 720px wide (even dims), cap length,
    // loop-friendly faststart. yuv420p for broad browser support.
    const outName = `${randomUUID()}.mp4`;
    const outPath = join(work, outName);
    await run("ffmpeg", [
      "-y",
      "-i",
      join(work, vid),
      "-t",
      String(CLIP_LEN),
      "-an",
      "-vf",
      "scale='min(720,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    if (!existsSync(outPath)) {
      return res.status(422).json({
        error: { code: "validation", message: "Couldn't build the clip" },
      });
    }

    // Persist into the clips dir, record it, and clean up any replaced file.
    renameSync(outPath, join(CLIPS_DIR, outName));
    const result = setSongClip(db, id, req.userId!, outName);
    if (!result.ok) {
      unlinkSync(join(CLIPS_DIR, outName));
      return res
        .status(statusForError(result.error.code))
        .json({ error: result.error });
    }
    if (result.value.oldClip) {
      const old = join(CLIPS_DIR, result.value.oldClip);
      if (existsSync(old)) {
        try {
          unlinkSync(old);
        } catch {
          /* best-effort */
        }
      }
    }
    return res.json({ song: result.value.song });
  } catch (e) {
    return res.status(422).json({
      error: {
        code: "validation",
        message: e instanceof Error ? e.message : "Failed to build the clip",
      },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// POST /api/songs/analyze-loudness — measure loudness for any of the user's
// tracks not yet analyzed (backfill, used to normalize the existing library).
// Processes a bounded batch per call so a huge library can't tie up a request;
// the client calls repeatedly until `remaining` reaches 0.
songsRouter.post("/songs/analyze-loudness", heavyLimiter, async (req, res) => {
  const pending = listSongsNeedingLoudness(getDb(), req.userId!);
  const batch = pending.slice(0, 10);
  let analyzed = 0;
  for (const song of batch) {
    const lufs = await measureLoudness(join(MUSIC_DIR, song.filename));
    if (lufs !== null) {
      setSongLoudness(getDb(), song.id, lufs);
      analyzed += 1;
    } else {
      // Mark unmeasurable tracks as analyzed-at-target so we don't retry them
      // forever (e.g. a missing/corrupt file).
      setSongLoudness(getDb(), song.id, -14);
    }
  }
  return res.json({ analyzed, remaining: pending.length - batch.length });
});

// POST /api/songs/fetch-lyrics — fetch lyrics for any of the user's tracks not
// yet checked (backfill over the existing library). Bounded batch per call; the
// client calls repeatedly until `remaining` reaches 0. Mirrors analyze-loudness.
songsRouter.post("/songs/fetch-lyrics", heavyLimiter, async (req, res) => {
  const pending = listSongsNeedingLyrics(getDb(), req.userId!);
  const batch = pending.slice(0, 10);
  let fetched = 0;
  for (const song of batch) {
    const found = await resolveLyrics({
      artist: song.artist,
      track: song.track,
      album: song.album,
      durationSec: song.duration,
    });
    if (found) {
      setSongLyrics(getDb(), song.id, found);
      fetched += 1;
    } else {
      // Stamp "checked, none" so it isn't retried on the next pass.
      setSongLyrics(getDb(), song.id, null);
    }
  }
  return res.json({ fetched, remaining: pending.length - batch.length });
});

// PATCH /api/songs/order — persist a manual ordering for a set of songs
// (e.g. the tracks within an artist). Body: { ids: number[] } in desired order.
songsRouter.patch("/songs/order", (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n))
    : null;
  if (!ids) {
    return res.status(400).json({
      error: { code: "validation", message: "ids array is required" },
    });
  }
  const result = setSongsOrder(getDb(), ids, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ ok: true });
});

// PATCH /api/songs/album-order — persist a manual ordering for an album's tracks
// (separate from /songs/order so it doesn't clobber the artist order). Body:
// { ids: number[] } in desired order.
songsRouter.patch("/songs/album-order", (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n))
    : null;
  if (!ids) {
    return res.status(400).json({
      error: { code: "validation", message: "ids array is required" },
    });
  }
  const result = setAlbumSongsOrder(getDb(), ids, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ ok: true });
});

// POST /api/songs/download-zip — download a set of the caller's own songs as a
// zip, in the given order. Albums have no server-side id (they're a client-side
// grouping by name), so the frontend sends the album's song ids + a name for the
// file. Body: { ids: number[], name?: string }.
songsRouter.post("/songs/download-zip", async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n))
    : null;
  if (!ids || ids.length === 0) {
    return res.status(400).json({
      error: { code: "validation", message: "ids array is required" },
    });
  }
  const db = getDb();
  // Restrict to the caller's own songs, and keep the requested order.
  const placeholders = ids.map(() => "?").join(",");
  const owned = db
    .prepare(
      `SELECT id FROM songs WHERE id IN (${placeholders}) AND user_id = ? AND pending = 0`
    )
    .all(...ids, req.userId!) as { id: number }[];
  const ownedSet = new Set(owned.map((r) => r.id));
  const orderedIds = ids.filter((id: number) => ownedSet.has(id));
  if (orderedIds.length === 0) {
    return res.status(404).json({
      error: { code: "not_found", message: "No downloadable songs" },
    });
  }
  const rawName = typeof req.body?.name === "string" ? req.body.name : "album";
  const zipName = (rawName || "album").replace(/[^\w.\- ]+/g, "_");
  await streamSongsZip(db, res, orderedIds, zipName, MUSIC_DIR, ART_DIR, {
    numberTracks: true,
  });
});

// PATCH /api/songs/bulk — edit metadata (artist, album) on many songs at once.
// Must be registered before "/songs/:id" so "bulk" isn't matched as an id.
songsRouter.patch("/songs/bulk", (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n))
    : null;
  if (!ids) {
    return res.status(400).json({
      error: { code: "validation", message: "ids array is required" },
    });
  }

  const fields: { artist?: string; artists?: string[]; album?: string } = {};
  if (typeof req.body?.artist === "string") fields.artist = req.body.artist;
  if (Array.isArray(req.body?.artists)) {
    fields.artists = req.body.artists.filter(
      (x: unknown): x is string => typeof x === "string"
    );
  }
  if (typeof req.body?.album === "string") fields.album = req.body.album;

  const result = updateSongsBulk(getDb(), ids, fields, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});

// PATCH /api/songs/:id — edit a song's metadata (name, artist, album).
songsRouter.patch("/songs/:id", (req, res) => {
  const fields: {
    originalFilename?: string;
    artist?: string;
    artists?: string[];
    album?: string;
  } = {};
  if (typeof req.body?.originalFilename === "string")
    fields.originalFilename = req.body.originalFilename;
  if (typeof req.body?.artist === "string") fields.artist = req.body.artist;
  if (Array.isArray(req.body?.artists)) {
    fields.artists = req.body.artists.filter(
      (x: unknown): x is string => typeof x === "string"
    );
  }
  if (typeof req.body?.album === "string") fields.album = req.body.album;

  const result = updateSong(getDb(), Number(req.params.id), fields, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ song: result.value });
});

// PUT /api/songs/:id/like — set the liked flag.
songsRouter.put("/songs/:id/like", (req, res) => {
  const liked = Boolean(req.body?.liked);
  const result = setLiked(getDb(), Number(req.params.id), liked, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ song: result.value });
});

// POST /api/songs/:id/play — record a play (increments count, sets timestamp).
// The client fires this once a track is ~75% through, i.e. a real listen — so
// it's also where we scrobble to ListenBrainz (best-effort, fire-and-forget).
songsRouter.post("/songs/:id/play", (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const result = recordPlay(db, id, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  scrobble(db, id, req.userId!);
  return res.json({ song: result.value });
});

// POST /api/songs/:id/now-playing — set the user's "now playing" on every
// connected scrobble service (fired when a track starts). No-op when nothing's
// connected.
songsRouter.post("/songs/:id/now-playing", (req, res) => {
  const db = getDb();
  const track = getScrobbleTrack(db, Number(req.params.id), req.userId!);
  if (track) {
    const lbToken = getListenBrainzToken(db, req.userId!);
    if (lbToken) submitPlayingNow(lbToken, track).catch(() => {});
    const lfKey = getLastfmSessionKey(db, req.userId!);
    if (lfKey) lastfmNowPlaying(lfKey, track).catch(() => {});
  }
  return res.status(204).end();
});

// Submits a completed listen to every connected scrobble service (ListenBrainz
// and/or Last.fm). Fire-and-forget: never blocks or fails the play request.
function scrobble(db: ReturnType<typeof getDb>, songId: number, userId: string) {
  const track = getScrobbleTrack(db, songId, userId);
  if (!track) return;
  const listenedAt = Math.floor(Date.now() / 1000);
  const lbToken = getListenBrainzToken(db, userId);
  if (lbToken) submitListen(lbToken, track, listenedAt).catch(() => {});
  const lfKey = getLastfmSessionKey(db, userId);
  if (lfKey) lastfmScrobble(lfKey, track, listenedAt).catch(() => {});
}

// DELETE /api/songs/:id — remove a song (file + art + db + playlist refs).
songsRouter.delete("/songs/:id", (req, res) => {
  const result = deleteSong(
    getDb(),
    Number(req.params.id),
    MUSIC_DIR,
    ART_DIR,
    req.userId!,
    CLIPS_DIR
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});

// GET /api/songs/:id/art — serve the song's album art. Pass ?size=N for a
// cached square thumbnail (used by list/mini-player views).
songsRouter.get("/songs/:id/art", async (req, res) => {
  const id = Number(req.params.id);
  // Missing/deleted art returns 204 (No Content), not 404. A stale play queue or
  // a cached page can request art for songs that no longer exist; a flood of
  // those 404s gets the client's IP flagged as a scanner (http-probing) and
  // banned by the edge. 204 is harmless to the <img> and never trips that.
  if (!canAccessSong(getDb(), req.userId!, id)) {
    return res.status(204).end();
  }
  const result = resolveSongArtById(getDb(), id, ART_DIR);
  if (!result.ok) {
    if (result.error.code === "not_found") return res.status(204).end();
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  await serveArt(req, res, result.value.path, result.value.contentType, req.query.size);
});

// GET /api/songs/:id/lyrics — the song's stored lyrics ({plain, synced, source})
// or 404. Gated by canAccessSong so shared/collaborative songs work too, like art.
songsRouter.get("/songs/:id/lyrics", (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSong(getDb(), req.userId!, id)) {
    return res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  }
  const lyrics = getSongLyricsById(getDb(), id);
  if (!lyrics || (!lyrics.plain && !lyrics.synced)) {
    return res.status(404).json({ error: { code: "not_found", message: "No lyrics" } });
  }
  return res.json({ lyrics });
});

// POST /api/songs/:id/lyrics/refetch — force a fresh lookup (all sources, owner only).
songsRouter.post("/songs/:id/lyrics/refetch", heavyLimiter, async (req, res) => {
  const id = Number(req.params.id);
  const song = getSong(getDb(), id, req.userId!);
  if (!song.ok) {
    return res.status(statusForError(song.error.code)).json({ error: song.error });
  }
  const found = await resolveLyrics({
    artist: song.value.artist,
    track: song.value.originalFilename,
    album: song.value.album,
    durationSec: song.value.duration,
  });
  setSongLyrics(getDb(), id, found);
  const updated = getSong(getDb(), id, req.userId!);
  return res.json({ song: updated.ok ? updated.value : song.value });
});

// PUT /api/songs/:id/lyrics — manually set lyrics (owner only). Body: { plain?,
// synced? }. Empty both clears them. For tracks LRCLIB doesn't have (e.g. Marcus's
// unreleased beats).
songsRouter.put("/songs/:id/lyrics", (req, res) => {
  const id = Number(req.params.id);
  const song = getSong(getDb(), id, req.userId!);
  if (!song.ok) {
    return res.status(statusForError(song.error.code)).json({ error: song.error });
  }
  const plain =
    typeof req.body?.plain === "string" && req.body.plain.trim()
      ? req.body.plain
      : null;
  const synced =
    typeof req.body?.synced === "string" && req.body.synced.trim()
      ? req.body.synced
      : null;
  setSongLyrics(getDb(), id, plain || synced ? { plain, synced, source: "manual" } : null);
  const updated = getSong(getDb(), id, req.userId!);
  return res.json({ song: updated.ok ? updated.value : song.value });
});

// PUT /api/songs/:id/clip-enabled — toggle whether this song's clip is shown.
songsRouter.put("/songs/:id/clip-enabled", (req, res) => {
  const enabled = req.body?.enabled !== false; // default true
  const result = setSongClipDisabled(
    getDb(),
    Number(req.params.id),
    req.userId!,
    !enabled
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ song: result.value });
});

// GET /api/songs/:id/clip — serve the cached looping canvas clip (mp4). Access
// is gated like the other media routes; sendFile handles Range requests so the
// <video> element can buffer/loop smoothly.
songsRouter.get("/songs/:id/clip", (req, res) => {
  const id = Number(req.params.id);
  // 204 (not 404) for missing/deleted clips — same reasoning as the art route:
  // stale references shouldn't generate 404s that get the IP flagged/banned.
  if (!canAccessSong(getDb(), req.userId!, id)) {
    return res.status(204).end();
  }
  const result = resolveSongClipById(getDb(), id, CLIPS_DIR);
  if (!result.ok) {
    if (result.error.code === "not_found") return res.status(204).end();
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.sendFile(result.value.path, {
    headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=86400" },
  });
});

// GET /api/songs/:id/download — download the audio with the current library
// metadata embedded (title, artist, album, cover art, and the source link in
// the comment tag) so it round-trips: download here, upload to another instance
// of this app, and the name/artist/album/art/link come along. MP3 only (clean
// ID3 + cover support); other formats download as-is. Falls back to the raw
// file if tagging fails so downloads never break.
songsRouter.get("/songs/:id/download", async (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSong(getDb(), req.userId!, id)) {
    return res
      .status(404)
      .json({ error: { code: "not_found", message: `Song ${id} not found` } });
  }
  const work = mkdtempSync(join(dirname(MUSIC_DIR), "dl-"));
  const cleanup = () => {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
  const prepared = await preparedDownload(getDb(), id, MUSIC_DIR, ART_DIR, work);
  if (!prepared) {
    cleanup();
    return res
      .status(404)
      .json({ error: { code: "not_found", message: `Song ${id} not found` } });
  }
  return res.download(prepared.path, prepared.name, () => cleanup());
});

// GET /api/songs/:id/stream — stream an audio file with HTTP Range support
// (enables seeking and progressive playback in the browser).
songsRouter.get("/songs/:id/stream", (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSong(getDb(), req.userId!, id)) {
    return res
      .status(404)
      .json({ error: { code: "not_found", message: `Song ${id} not found` } });
  }
  const result = resolveSongFileById(getDb(), id, MUSIC_DIR);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return streamSongFile(req, res, result.value);
});
