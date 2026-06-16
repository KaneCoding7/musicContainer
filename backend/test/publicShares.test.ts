import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  addSongToPlaylist,
  createPlaylist,
} from "../src/functional/playlists.js";
import {
  disablePublicLink,
  enablePublicLink,
  getPublicToken,
  publicTokenAllowsSong,
  resolvePublicShare,
} from "../src/functional/publicShares.js";
import { recordSong } from "../src/functional/songs.js";
import { addUser, testDb } from "./helpers.js";

let db: Database;
let alice: string;
let bob: string;

beforeEach(() => {
  db = testDb();
  alice = addUser(db, "Alice");
  bob = addUser(db, "Bob");
});

function setup() {
  const s1 = recordSong(db, { filename: "s1.mp3", originalFilename: "s1", userId: alice });
  const s2 = recordSong(db, { filename: "s2.mp3", originalFilename: "s2", userId: alice });
  if (!s1.ok || !s2.ok) throw new Error("seed");
  const p = createPlaylist(db, "Public", alice);
  if (!p.ok) throw new Error("seed");
  addSongToPlaylist(db, p.value.id, s1.value.id, alice);
  return { playlistId: p.value.id, listed: s1.value.id, unlisted: s2.value.id };
}

describe("public shares", () => {
  it("enable is owner-only and idempotent", () => {
    const { playlistId } = setup();
    expect(enablePublicLink(db, bob, playlistId).ok).toBe(false); // not owner
    const a = enablePublicLink(db, alice, playlistId);
    const b = enablePublicLink(db, alice, playlistId);
    expect(a.ok && b.ok && a.value).toBe(b.ok ? b.value : "");
  });

  it("resolves a token to playlist + songs and gates song access", () => {
    const ids = setup();
    const t = enablePublicLink(db, alice, ids.playlistId);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const token = t.value;

    const resolved = resolvePublicShare(db, token);
    expect(resolved.ok && resolved.value.name).toBe("Public");
    expect(resolved.ok && resolved.value.ownerName).toBe("Alice");
    expect(resolved.ok && resolved.value.songs.map((s) => s.id)).toEqual([ids.listed]);

    expect(publicTokenAllowsSong(db, token, ids.listed)).toBe(true);
    expect(publicTokenAllowsSong(db, token, ids.unlisted)).toBe(false);
  });

  it("disabling revokes the token", () => {
    const ids = setup();
    const t = enablePublicLink(db, alice, ids.playlistId);
    if (!t.ok) throw new Error("enable");
    expect(disablePublicLink(db, alice, ids.playlistId).ok).toBe(true);
    expect(resolvePublicShare(db, t.value).ok).toBe(false);
    expect(getPublicToken(db, alice, ids.playlistId).ok && getPublicToken(db, alice, ids.playlistId).value).toBe(null);
  });

  it("unknown token resolves to not_found", () => {
    expect(resolvePublicShare(db, "bogus").ok).toBe(false);
  });
});
