import { existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { ZipArchive } from "archiver";
import { Router } from "express";
import multer from "multer";
import { ART_DIR, getDb, MUSIC_DIR } from "../db/init.js";
import {
  addSongToPlaylist,
  addSongsToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylistSongs,
  listPlaylists,
  removeSongFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
  resolvePlaylistImage,
  setPlaylistImage,
} from "../functional/playlists.js";
import { statusForError } from "../functional/result.js";
import { getSharedPlaylistSongs } from "../functional/shares.js";
import { serveArt } from "../thumbnails.js";
import type { Song } from "../types.js";

// Playlist cover-image uploads — JPEG/PNG/WebP into the shared art dir.
const PL_IMG_MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const plImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ART_DIR),
    filename: (_req, file, cb) => {
      const ext =
        extname(file.originalname).toLowerCase() ||
        PL_IMG_MIME_EXT[file.mimetype] ||
        ".jpg";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    file.mimetype in PL_IMG_MIME_EXT
      ? cb(null, true)
      : cb(new Error("Image must be a JPEG, PNG, or WebP")),
});

export const playlistsRouter = Router();

// GET /api/playlists/:id/download — download a playlist's tracks as a zip.
playlistsRouter.get("/playlists/:id/download", (req, res) => {
  const id = Number(req.params.id);
  const userId = req.userId!;
  const db = getDb();

  // Owner first, then a shared-with viewer.
  let songsResult = getPlaylistSongs(db, id, userId);
  if (!songsResult.ok && songsResult.error.code === "not_found") {
    songsResult = getSharedPlaylistSongs(db, userId, id);
  }
  if (!songsResult.ok) {
    return res
      .status(statusForError(songsResult.error.code))
      .json({ error: songsResult.error });
  }
  const songs: Song[] = songsResult.value;

  const nameRow = db
    .prepare("SELECT name FROM playlists WHERE id = ?")
    .get(id) as { name: string } | undefined;
  const zipName = (nameRow?.name ?? "playlist").replace(/[^\w.\- ]+/g, "_");

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${zipName}.zip"`
  );

  const archive = new ZipArchive({ zlib: { level: 0 } }); // store; audio is already compressed
  archive.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.pipe(res);

  const used = new Set<string>();
  for (const song of songs) {
    const path = join(MUSIC_DIR, song.filename);
    if (!existsSync(path)) continue;
    const ext = extname(song.filename);
    let entry = extname(song.originalFilename)
      ? song.originalFilename
      : `${song.originalFilename}${ext}`;
    // De-duplicate identical entry names within the zip.
    if (used.has(entry)) {
      const base = entry.slice(0, entry.length - extname(entry).length);
      let i = 2;
      while (used.has(`${base} (${i})${extname(entry)}`)) i++;
      entry = `${base} (${i})${extname(entry)}`;
    }
    used.add(entry);
    archive.file(path, { name: entry });
  }
  archive.finalize();
});

// POST /api/playlists — create a playlist.
playlistsRouter.post("/playlists", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const result = createPlaylist(getDb(), name, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ playlist: result.value });
});

// GET /api/playlists — list playlists.
playlistsRouter.get("/playlists", (req, res) => {
  const result = listPlaylists(getDb(), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ playlists: result.value });
});

// GET /api/playlists/:id — songs in a playlist, in order.
playlistsRouter.get("/playlists/:id", (req, res) => {
  const result = getPlaylistSongs(getDb(), Number(req.params.id), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});

// PATCH /api/playlists/:id — rename a playlist.
playlistsRouter.patch("/playlists/:id", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const result = renamePlaylist(getDb(), Number(req.params.id), name, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ playlist: result.value });
});

// DELETE /api/playlists/:id — delete a playlist (and its cover image).
playlistsRouter.delete("/playlists/:id", (req, res) => {
  const result = deletePlaylist(
    getDb(),
    Number(req.params.id),
    req.userId!,
    ART_DIR
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});

// PUT /api/playlists/:id/image — upload/replace a playlist's cover image.
playlistsRouter.put("/playlists/:id/image", (req, res) => {
  plImageUpload.single("image")(req, res, (uploadErr: unknown) => {
    if (uploadErr) {
      const message =
        uploadErr instanceof Error ? uploadErr.message : "Upload failed";
      return res.status(400).json({ error: { code: "validation", message } });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ error: { code: "validation", message: "No image (field: image)" } });
    }
    const result = setPlaylistImage(
      getDb(),
      Number(req.params.id),
      req.userId!,
      req.file.filename
    );
    if (!result.ok) {
      const p = join(ART_DIR, req.file.filename);
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* best-effort */
        }
      }
      return res
        .status(statusForError(result.error.code))
        .json({ error: result.error });
    }
    if (result.value.oldImage) {
      const old = join(ART_DIR, result.value.oldImage);
      if (existsSync(old)) {
        try {
          unlinkSync(old);
        } catch {
          /* best-effort */
        }
      }
    }
    return res.json({ playlist: result.value.playlist });
  });
});

// GET /api/playlists/:id/image — serve a playlist's custom cover (?size=N for a
// thumbnail). 204 (not 404) when absent, so a stale reference can't trip the
// scanner heuristic at the edge.
playlistsRouter.get("/playlists/:id/image", async (req, res) => {
  const result = resolvePlaylistImage(
    getDb(),
    Number(req.params.id),
    req.userId!,
    ART_DIR
  );
  if (!result.ok) {
    if (result.error.code === "not_found") return res.status(204).end();
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  await serveArt(req, res, result.value.path, result.value.contentType, req.query.size);
});

// PUT /api/playlists/:id/order — reorder songs within a playlist.
playlistsRouter.put("/playlists/:id/order", (req, res) => {
  const songIds = Array.isArray(req.body?.songIds)
    ? req.body.songIds.map(Number)
    : null;
  if (!songIds) {
    return res.status(400).json({
      error: { code: "validation", message: "songIds array is required" },
    });
  }
  const result = reorderPlaylist(
    getDb(),
    Number(req.params.id),
    songIds,
    req.userId!
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ ok: true });
});

// POST /api/playlists/:id/songs/bulk — add multiple songs at once.
playlistsRouter.post("/playlists/:id/songs/bulk", (req, res) => {
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds : null;
  if (!songIds) {
    return res.status(400).json({
      error: { code: "validation", message: "songIds array is required" },
    });
  }
  const result = addSongsToPlaylist(
    getDb(),
    Number(req.params.id),
    songIds,
    req.userId!
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json(result.value);
});

// POST /api/playlists/:id/songs — add a song to a playlist.
playlistsRouter.post("/playlists/:id/songs", (req, res) => {
  const songId = Number(req.body?.songId);
  const result = addSongToPlaylist(
    getDb(),
    Number(req.params.id),
    songId,
    req.userId!
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ ok: true });
});

// DELETE /api/playlists/:id/songs/:songId — remove a song from a playlist.
playlistsRouter.delete("/playlists/:id/songs/:songId", (req, res) => {
  const result = removeSongFromPlaylist(
    getDb(),
    Number(req.params.id),
    Number(req.params.songId),
    req.userId!
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});
