import { Router } from "express";
import { getDb } from "../db/init.js";
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
} from "../functional/playlists.js";
import { statusForError } from "../functional/result.js";

export const playlistsRouter = Router();

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

// DELETE /api/playlists/:id — delete a playlist.
playlistsRouter.delete("/playlists/:id", (req, res) => {
  const result = deletePlaylist(getDb(), Number(req.params.id), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
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
