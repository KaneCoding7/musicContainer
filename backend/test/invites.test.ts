import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  consumeInvite,
  countUsers,
  createInvite,
  listInvites,
  validateInvite,
} from "../src/functional/invites.js";
import { addUser, testDb } from "./helpers.js";

let db: Database;
let owner: string;

beforeEach(() => {
  db = testDb();
  owner = addUser(db, "Owner");
});

describe("invites", () => {
  it("counts users", () => {
    expect(countUsers(db)).toBe(1);
    addUser(db, "Two");
    expect(countUsers(db)).toBe(2);
  });

  it("creates, lists, validates and consumes an invite", () => {
    const inv = createInvite(db, owner);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const code = inv.value.code;

    expect(validateInvite(db, code).ok).toBe(true);
    expect(listInvites(db, owner).ok && listInvites(db, owner).value.length).toBe(1);

    const friend = addUser(db, "Friend");
    consumeInvite(db, code, friend);

    const after = validateInvite(db, code);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("conflict");
  });

  it("rejects unknown codes", () => {
    const r = validateInvite(db, "nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation");
  });
});
