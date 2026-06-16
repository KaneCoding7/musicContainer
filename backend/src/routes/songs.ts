import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { getDb, MUSIC_DIR } from "../db/init.js";
import { listSongs, recordSong, validateUpload } from "../functional/songs.js";
import { statusForError } from "../functional/result.js";

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

// POST /api/upload — upload a single audio file.
songsRouter.post("/upload", (req, res) => {
  upload.single("file")(req, res, (uploadErr: unknown) => {
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

    const result = recordSong(getDb(), {
      filename: req.file.filename,
      originalFilename: req.file.originalname,
    });

    if (!result.ok) {
      // Roll back the stored file if we couldn't persist its metadata.
      const path = join(MUSIC_DIR, req.file.filename);
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch {
          /* best-effort cleanup */
        }
      }
      return res
        .status(statusForError(result.error.code))
        .json({ error: result.error });
    }

    return res.status(201).json({ song: result.value });
  });
});

// GET /api/songs — list all songs.
songsRouter.get("/songs", (_req, res) => {
  const result = listSongs(getDb());
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});
