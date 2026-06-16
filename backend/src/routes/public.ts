import { createReadStream } from "node:fs";
import { Router } from "express";
import { ART_DIR, getDb, MUSIC_DIR } from "../db/init.js";
import { statusForError } from "../functional/result.js";
import {
  publicTokenAllowsSong,
  resolvePublicShare,
} from "../functional/publicShares.js";
import { resolveSongArtById, resolveSongFileById } from "../functional/songs.js";
import { streamSongFile } from "../stream.js";

// Public, UNAUTHENTICATED routes for listening via a share link. Access is
// gated entirely by possession of the opaque token.
export const publicRouter = Router();

// GET /api/public/:token — playlist name, owner, and songs.
publicRouter.get("/public/:token", (req, res) => {
  const result = resolvePublicShare(getDb(), req.params.token);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json(result.value);
});

// GET /api/public/:token/songs/:id/stream — stream a song from the shared list.
publicRouter.get("/public/:token/songs/:id/stream", (req, res) => {
  const id = Number(req.params.id);
  if (!publicTokenAllowsSong(getDb(), req.params.token, id)) {
    return res
      .status(404)
      .json({ error: { code: "not_found", message: "Not found" } });
  }
  const result = resolveSongFileById(getDb(), id, MUSIC_DIR);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return streamSongFile(req, res, result.value);
});

// GET /api/public/:token/songs/:id/art — album art for a song in the list.
publicRouter.get("/public/:token/songs/:id/art", (req, res) => {
  const id = Number(req.params.id);
  if (!publicTokenAllowsSong(getDb(), req.params.token, id)) {
    return res
      .status(404)
      .json({ error: { code: "not_found", message: "Not found" } });
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
