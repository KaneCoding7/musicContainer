import { Router } from "express";
import { getDb } from "../db/init.js";
import { statusForError } from "../functional/result.js";
import {
  disableArtistPublicLink,
  disablePublicLink,
  enableArtistPublicLink,
  enablePublicLink,
  getArtistPublicToken,
  getPublicToken,
} from "../functional/publicShares.js";
import {
  copySharedPlaylist,
  getSharedPlaylistSongs,
  listGlobalPlaylists,
  listPlaylistMembers,
  listPlaylistShares,
  listSharedWithMe,
  searchUsers,
  sharePlaylist,
  unsharePlaylist,
} from "../functional/shares.js";
import { listOrgPlaylistsForUser } from "../functional/orgPlaylists.js";

export const sharesRouter = Router();

// --- Artist public links (listen to all of a user's songs by an artist) ---
// GET /api/artist-public?artist=NAME — current token (or null).
sharesRouter.get("/artist-public", (req, res) => {
  const artist = typeof req.query.artist === "string" ? req.query.artist : "";
  const result = getArtistPublicToken(getDb(), req.userId!, artist);
  if (!result.ok) {
    return res.status(statusForError(result.error.code)).json({ error: result.error });
  }
  return res.json({ token: result.value });
});
// POST /api/artist-public { artist } — enable + return the token.
sharesRouter.post("/artist-public", (req, res) => {
  const artist = typeof req.body?.artist === "string" ? req.body.artist : "";
  const result = enableArtistPublicLink(getDb(), req.userId!, artist);
  if (!result.ok) {
    return res.status(statusForError(result.error.code)).json({ error: result.error });
  }
  return res.status(201).json({ token: result.value });
});
// DELETE /api/artist-public?artist=NAME — disable the link.
sharesRouter.delete("/artist-public", (req, res) => {
  const artist = typeof req.query.artist === "string" ? req.query.artist : "";
  const result = disableArtistPublicLink(getDb(), req.userId!, artist);
  if (!result.ok) {
    return res.status(statusForError(result.error.code)).json({ error: result.error });
  }
  return res.status(204).end();
});

// GET /api/users/search?q= — look up users by name/email (for share autocomplete).
sharesRouter.get("/users/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const users = searchUsers(getDb(), q, req.userId!);
  return res.json({ users });
});

// GET /api/playlists/:id/members — everyone with access (owner + shared users).
// Available to the owner and to anyone the playlist is shared with.
sharesRouter.get("/playlists/:id/members", (req, res) => {
  const result = listPlaylistMembers(
    getDb(),
    Number(req.params.id),
    req.userId!
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ members: result.value });
});

// GET /api/playlists/:id/public — current public token (or null).
sharesRouter.get("/playlists/:id/public", (req, res) => {
  const result = getPublicToken(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ token: result.value });
});

// POST /api/playlists/:id/public — enable a public link.
sharesRouter.post("/playlists/:id/public", (req, res) => {
  const result = enablePublicLink(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ token: result.value });
});

// DELETE /api/playlists/:id/public — disable the public link.
sharesRouter.delete("/playlists/:id/public", (req, res) => {
  const result = disablePublicLink(getDb(), req.userId!, Number(req.params.id));
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});

// POST /api/playlists/:id/share — share a playlist with a user by email.
sharesRouter.post("/playlists/:id/share", (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (!email) {
    return res
      .status(400)
      .json({ error: { code: "validation", message: "email is required" } });
  }
  const canEdit = Boolean(req.body?.canEdit);
  const result = sharePlaylist(
    getDb(),
    req.userId!,
    Number(req.params.id),
    email,
    canEdit
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

// GET /api/shared — playlists shared with me + my org/team playlist.
sharesRouter.get("/shared", async (req, res) => {
  const db = getDb();
  const result = listSharedWithMe(db, req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  const org = await listOrgPlaylistsForUser(db, req.userId!);
  if (!org.ok) {
    return res
      .status(statusForError(org.error.code))
      .json({ error: org.error });
  }
  const global = listGlobalPlaylists(db, req.userId!);
  if (!global.ok) {
    return res
      .status(statusForError(global.error.code))
      .json({ error: global.error });
  }
  // Team, then global, then explicitly-shared playlists.
  return res.json({
    playlists: [...org.value, ...global.value, ...result.value],
  });
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

// POST /api/shared/:id/copy — save a shared playlist into my own playlists.
sharesRouter.post("/shared/:id/copy", (req, res) => {
  const result = copySharedPlaylist(
    getDb(),
    req.userId!,
    Number(req.params.id)
  );
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ playlist: result.value });
});
