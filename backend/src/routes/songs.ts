import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { ART_DIR, getDb, MUSIC_DIR } from "../db/init.js";
import {
  copySongToLibrary,
  deleteSong,
  finalizeSongs,
  getSongSource,
  listPendingSongs,
  listSongs,
  listSongsNeedingLoudness,
  recordPlay,
  recordSong,
  resolveSongArtById,
  resolveSongFileById,
  setLiked,
  setSongArt,
  setSongLoudness,
  setSongsOrder,
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
import { statusForError } from "../functional/result.js";
import { extractMetadata } from "../metadata.js";
import { measureLoudness } from "../loudness.js";
import { streamSongFile } from "../stream.js";
import { serveArt } from "../thumbnails.js";

export const songsRouter = Router();

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

// GET /api/artists/images — names of artists the user has a custom image for.
songsRouter.get("/artists/images", (req, res) => {
  const rows = getDb()
    .prepare("SELECT artist FROM artist_images WHERE user_id = ?")
    .all(req.userId!) as { artist: string }[];
  return res.json({ artists: rows.map((r) => r.artist) });
});

// GET /api/artists/image?name=… — serve the user's custom image, or 404.
songsRouter.get("/artists/image", (req, res) => {
  const artist = artistParam(req);
  if (!artist) return res.status(404).end();
  const row = getDb()
    .prepare(
      "SELECT filename FROM artist_images WHERE user_id = ? AND artist = ?"
    )
    .get(req.userId!, artist) as { filename: string } | undefined;
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
    const existing = db
      .prepare(
        "SELECT filename FROM artist_images WHERE user_id = ? AND artist = ?"
      )
      .get(req.userId!, artist) as { filename: string } | undefined;
    db.prepare(
      `INSERT INTO artist_images (user_id, artist, filename, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, artist) DO UPDATE SET
         filename = excluded.filename, updated_at = excluded.updated_at`
    ).run(req.userId!, artist, req.file.filename);
    if (existing?.filename) cleanupArt(existing.filename);
    return res.status(201).json({ ok: true });
  });
});

// DELETE /api/artists/image?name=… — revert to the default (track) art.
songsRouter.delete("/artists/image", (req, res) => {
  const artist = artistParam(req);
  if (!artist) return res.status(204).end();
  const db = getDb();
  const row = db
    .prepare("SELECT filename FROM artist_images WHERE user_id = ? AND artist = ?")
    .get(req.userId!, artist) as { filename: string } | undefined;
  db.prepare("DELETE FROM artist_images WHERE user_id = ? AND artist = ?").run(
    req.userId!,
    artist
  );
  if (row?.filename) cleanupArt(row.filename);
  return res.status(204).end();
});

// POST /api/upload — upload a single audio file (extracts embedded metadata).
songsRouter.post("/upload", (req, res) => {
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
      originalFilename: req.file.originalname,
      userId: req.userId!,
      artist: meta.artist,
      album: meta.album,
      artFilename: meta.artFilename,
      duration: meta.duration,
      pending: true, // awaits review before joining the library
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

// POST /api/import-link — download a link's audio (yt-dlp, or spotdl for Spotify
// links) and ingest it into the library. Streams NDJSON progress lines so the
// client can show a progress bar, ending with a {done} or {error} line.
songsRouter.post("/import-link", async (req, res) => {
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
      const result = recordSong(getDb(), {
        filename: stored,
        originalFilename: name, // the video title + .mp3
        userId: req.userId!,
        artist: meta.artist,
        album: meta.album,
        artFilename: meta.artFilename,
        duration: meta.duration,
        pending: true, // awaits review before joining the library
        // Only video links support the "pick frame as art" feature.
        sourceUrl: isSpotify ? null : url,
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
songsRouter.get("/songs/:id/frames", async (req, res) => {
  const id = Number(req.params.id);
  const src = getSongSource(getDb(), id, req.userId!);
  if (!src) {
    return res.status(404).json({
      error: { code: "not_found", message: "No source video for this track" },
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

    // The official thumbnail, offered first.
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

// POST /api/songs/analyze-loudness — measure loudness for any of the user's
// tracks not yet analyzed (backfill, used to normalize the existing library).
// Processes a bounded batch per call so a huge library can't tie up a request;
// the client calls repeatedly until `remaining` reaches 0.
songsRouter.post("/songs/analyze-loudness", async (req, res) => {
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

  const fields: { artist?: string; album?: string } = {};
  if (typeof req.body?.artist === "string") fields.artist = req.body.artist;
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
  const fields: { originalFilename?: string; artist?: string; album?: string } =
    {};
  if (typeof req.body?.originalFilename === "string")
    fields.originalFilename = req.body.originalFilename;
  if (typeof req.body?.artist === "string") fields.artist = req.body.artist;
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
songsRouter.post("/songs/:id/play", (req, res) => {
  const result = recordPlay(getDb(), Number(req.params.id), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ song: result.value });
});

// DELETE /api/songs/:id — remove a song (file + art + db + playlist refs).
songsRouter.delete("/songs/:id", (req, res) => {
  const result = deleteSong(
    getDb(),
    Number(req.params.id),
    MUSIC_DIR,
    ART_DIR,
    req.userId!
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
  if (!canAccessSong(getDb(), req.userId!, id)) {
    return res
      .status(404)
      .json({ error: { code: "not_found", message: `Song ${id} not found` } });
  }
  const result = resolveSongArtById(getDb(), id, ART_DIR);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  await serveArt(req, res, result.value.path, result.value.contentType, req.query.size);
});

// GET /api/songs/:id/download — download the original audio file.
songsRouter.get("/songs/:id/download", (req, res) => {
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
  return res.download(result.value.path, result.value.originalFilename);
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
