import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { ART_DIR, getDb, MUSIC_DIR } from "../db/init.js";
import {
  deleteSong,
  listSongs,
  recordPlay,
  recordSong,
  resolveSongArt,
  resolveSongFile,
  setLiked,
  updateSong,
  validateUpload,
} from "../functional/songs.js";
import { statusForError } from "../functional/result.js";
import { extractMetadata } from "../metadata.js";

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

    return res.status(201).json({ song: result.value });
  });
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

// GET /api/songs/:id/art — serve the song's embedded album art, if any.
songsRouter.get("/songs/:id/art", (req, res) => {
  const result = resolveSongArt(
    getDb(),
    Number(req.params.id),
    ART_DIR,
    req.userId!
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  res.setHeader("Content-Type", result.value.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  return createReadStream(result.value.path).pipe(res);
});

// GET /api/songs/:id/download — download the original audio file.
songsRouter.get("/songs/:id/download", (req, res) => {
  const result = resolveSongFile(
    getDb(),
    Number(req.params.id),
    MUSIC_DIR,
    req.userId!
  );
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
  const result = resolveSongFile(getDb(), id, MUSIC_DIR, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }

  const { path, size, contentType } = result.value;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-cache");

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", size);
    res.status(200);
    return createReadStream(path).pipe(res);
  }

  // Parse "bytes=start-end" (either bound may be omitted).
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end =
    match && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    res.setHeader("Content-Range", `bytes */${size}`);
    return res.status(416).end();
  }

  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  return createReadStream(path, { start, end }).pipe(res);
});
