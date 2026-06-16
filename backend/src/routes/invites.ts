import { Router } from "express";
import { getDb } from "../db/init.js";
import { createInvite, listInvites } from "../functional/invites.js";
import { statusForError } from "../functional/result.js";

export const invitesRouter = Router();

// POST /api/invites — generate a new invite code.
invitesRouter.post("/invites", (req, res) => {
  const result = createInvite(getDb(), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json({ invite: result.value });
});

// GET /api/invites — list invites I created.
invitesRouter.get("/invites", (req, res) => {
  const result = listInvites(getDb(), req.userId!);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ invites: result.value });
});
