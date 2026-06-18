import { Router } from "express";
import { getDb } from "../db/init.js";
import {
  acceptRequest,
  listFriends,
  listIncoming,
  listOutgoing,
  removeFriendship,
  sendRequest,
} from "../functional/friends.js";
import { statusForError } from "../functional/result.js";

export const friendsRouter = Router();

// GET /api/friends — my friends plus incoming and outgoing pending requests.
friendsRouter.get("/friends", (req, res) => {
  const db = getDb();
  const userId = req.userId!;
  return res.json({
    friends: listFriends(db, userId),
    incoming: listIncoming(db, userId),
    outgoing: listOutgoing(db, userId),
  });
});

// POST /api/friends { email } — send a friend request (auto-accepts a reverse
// pending request).
friendsRouter.post("/friends", (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const result = sendRequest(getDb(), req.userId!, email);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(201).json(result.value);
});

// POST /api/friends/:userId/accept — accept an incoming request.
friendsRouter.post("/friends/:userId/accept", (req, res) => {
  const result = acceptRequest(getDb(), req.userId!, req.params.userId);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.json({ friend: result.value });
});

// DELETE /api/friends/:userId — cancel an outgoing request, decline an incoming
// one, or remove an existing friend.
friendsRouter.delete("/friends/:userId", (req, res) => {
  const result = removeFriendship(getDb(), req.userId!, req.params.userId);
  if (!result.ok) {
    return res
      .status(statusForError(result.error.code))
      .json({ error: result.error });
  }
  return res.status(204).end();
});
