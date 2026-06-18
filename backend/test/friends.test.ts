import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  acceptRequest,
  listFriends,
  listIncoming,
  listOutgoing,
  removeFriendship,
  sendRequest,
} from "../src/functional/friends.js";
import { addUser, emailFor, testDb } from "./helpers.js";

let db: Database;
let alice: string;
let bob: string;

beforeEach(() => {
  db = testDb();
  alice = addUser(db, "Alice");
  bob = addUser(db, "Bob");
});

describe("friends", () => {
  it("sends a request that shows as outgoing/incoming pending", () => {
    const r = sendRequest(db, alice, emailFor(bob));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("pending");

    expect(listOutgoing(db, alice).map((u) => u.id)).toEqual([bob]);
    expect(listIncoming(db, bob).map((u) => u.id)).toEqual([alice]);
    // Not friends yet.
    expect(listFriends(db, alice)).toEqual([]);
    expect(listFriends(db, bob)).toEqual([]);
  });

  it("rejects unknown email, self, and duplicate requests", () => {
    const unknown = sendRequest(db, alice, "nobody@test.com");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("not_found");

    const self = sendRequest(db, alice, emailFor(alice));
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe("validation");

    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);
    const dup = sendRequest(db, alice, emailFor(bob));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("conflict");
  });

  it("auto-accepts when the recipient sends back a request", () => {
    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);
    const back = sendRequest(db, bob, emailFor(alice));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.status).toBe("accepted");

    // Both now see each other as friends; no lingering pending rows.
    expect(listFriends(db, alice).map((u) => u.id)).toEqual([bob]);
    expect(listFriends(db, bob).map((u) => u.id)).toEqual([alice]);
    expect(listIncoming(db, alice)).toEqual([]);
    expect(listOutgoing(db, bob)).toEqual([]);
  });

  it("accepts an incoming request, making both users friends", () => {
    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);

    // Only the addressee can accept.
    const wrong = acceptRequest(db, alice, bob);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("not_found");

    const accepted = acceptRequest(db, bob, alice);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.id).toBe(alice);

    expect(listFriends(db, alice).map((u) => u.id)).toEqual([bob]);
    expect(listFriends(db, bob).map((u) => u.id)).toEqual([alice]);
    expect(listIncoming(db, bob)).toEqual([]);
    expect(listOutgoing(db, alice)).toEqual([]);
  });

  it("removes a friendship from either side", () => {
    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);
    expect(acceptRequest(db, bob, alice).ok).toBe(true);

    const removed = removeFriendship(db, bob, alice);
    expect(removed.ok).toBe(true);
    expect(listFriends(db, alice)).toEqual([]);
    expect(listFriends(db, bob)).toEqual([]);

    const again = removeFriendship(db, bob, alice);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("not_found");
  });

  it("cancels an outgoing and declines an incoming pending request", () => {
    // Cancel (requester removes).
    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);
    expect(removeFriendship(db, alice, bob).ok).toBe(true);
    expect(listIncoming(db, bob)).toEqual([]);

    // Decline (addressee removes).
    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);
    expect(removeFriendship(db, bob, alice).ok).toBe(true);
    expect(listOutgoing(db, alice)).toEqual([]);
    // After declining, a fresh request can be sent again.
    expect(sendRequest(db, alice, emailFor(bob)).ok).toBe(true);
  });
});
