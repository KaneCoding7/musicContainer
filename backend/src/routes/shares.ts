import { Router } from "express";
import { getDb } from "../db/init.js";
import { statusForError } from "../functional/result.js";
import {
  getSharedPlaylistSongs,
  listPlaylistShares,
  listSharedWithMe,
  sharePlaylist,
  unsharePlaylist,
} from "../functional/shares.js";

export const sharesRouter = Router();

// POST /api/playlists/:id/share — share a playlist with a user by email.
sharesRouter.post("/playlists/:id/share", (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (!email) {
    return res
      .status(400)
      .json({ error: { code: "validation", message: "email is required" } });
  }
  const result = sharePlaylist(
    getDb(),
    req.userId!,
    Number(req.params.id),
    email
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ sharedWith: result.value });
});

// GET /api/playlists/:id/shares — who a playlist is shared with (owner only).
sharesRouter.get("/playlists/:id/shares", (req, res) => {
  const result = listPlaylistShares(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ shares: result.value });
});

// DELETE /api/playlists/:id/share/:userId — revoke a share (owner only).
sharesRouter.delete("/playlists/:id/share/:userId", (req, res) => {
  const result = unsharePlaylist(
    getDb(),
    req.userId!,
    Number(req.params.id),
    req.params.userId
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});

// GET /api/shared — playlists shared with me.
sharesRouter.get("/shared", (req, res) => {
  const result = listSharedWithMe(getDb(), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ playlists: result.value });
});

// GET /api/shared/:id — songs of a playlist shared with me (read-only).
sharesRouter.get("/shared/:id", (req, res) => {
  const result = getSharedPlaylistSongs(
    getDb(),
    req.userId!,
    Number(req.params.id)
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ songs: result.value });
});
