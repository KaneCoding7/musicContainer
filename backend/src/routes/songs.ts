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
  resolveSongArtById,
  resolveSongFileById,
  setLiked,
  setSongArt,
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
import { streamSongFile } from "../stream.js";

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

// GET /api/songs/:id/art — serve the song's embedded album art, if any.
songsRouter.get("/songs/:id/art", (req, res) => {
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
  res.setHeader("Content-Type", result.value.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  return createReadStream(result.value.path).pipe(res);
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
