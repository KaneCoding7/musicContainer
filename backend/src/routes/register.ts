import { Router } from "express";
import { auth } from "../auth.js";
import { getDb } from "../db/init.js";
import {
  consumeInvite,
  countUsers,
  validateInvite,
} from "../functional/invites.js";
import { statusForError } from "../functional/result.js";

export const registerRouter = Router();

// When true, registration requires a valid invite code (except the first/owner
// account). Direct Better Auth sign-up is blocked separately in server.ts.
const INVITE_ONLY = process.env.INVITE_ONLY === "true";

// POST /api/register — gated wrapper around Better Auth sign-up. Validates an
// invite (when required), creates the account, and consumes the invite.
registerRouter.post("/register", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const invite = typeof req.body?.invite === "string" ? req.body.invite : "";

  if (!email || !password || !name) {
    return res
      .status(400)
      .json({ message: "Name, email and password are required" });
  }

  const db = getDb();
  const isFirstUser = countUsers(db) === 0;

  if (INVITE_ONLY && !isFirstUser) {
    if (!invite) {
      return res.status(403).json({ message: "An invite code is required" });
    }
    const valid = validateInvite(db, invite);
    if (!valid.ok) {
      return res
        .status(statusForError(valid.error.code))
        .json({ message: valid.error.message });
    }
  }

  try {
    const result = await auth.api.signUpEmail({
      body: { email, password, name },
    });
    if (invite) consumeInvite(db, invite, result.user.id);
    return res.status(201).json({ token: result.token, user: result.user });
  } catch (e) {
    const message =
      (e as { body?: { message?: string } })?.body?.message ||
      (e as Error).message ||
      "Registration failed";
    return res.status(400).json({ message });
  }
});
