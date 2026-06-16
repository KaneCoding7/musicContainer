import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  deleteSong,
  getSong,
  listSongs,
  recordPlay,
  recordSong,
  setLiked,
  updateSong,
} from "../src/functional/songs.js";
import { addUser, testDb } from "./helpers.js";

let db: Database;
let alice: string;
let bob: string;

beforeEach(() => {
  db = testDb();
  alice = addUser(db, "Alice");
  bob = addUser(db, "Bob");
});

function seedSong(userId: string, name = "Track") {
  const r = recordSong(db, {
    filename: `${name}.mp3`,
    originalFilename: name,
    userId,
  });
  if (!r.ok) throw new Error("seed failed");
  return r.value;
}

describe("songs", () => {
  it("records and lists a user's songs", () => {
    seedSong(alice, "A1");
    seedSong(alice, "A2");
    const r = listSongs(db, alice);
    expect(r.ok && r.value.length).toBe(2);
  });

  it("isolates libraries between users", () => {
    seedSong(alice, "A1");
    const bobList = listSongs(db, bob);
    expect(bobList.ok && bobList.value.length).toBe(0);
  });

  it("getSong is owner-scoped (cross-user is not_found)", () => {
    const s = seedSong(alice);
    expect(getSong(db, s.id, alice).ok).toBe(true);
    const cross = getSong(db, s.id, bob);
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe("not_found");
  });

  it("rejects empty rename, applies valid metadata, clears with empty string", () => {
    const s = seedSong(alice);
    expect(updateSong(db, s.id, { originalFilename: "  " }, alice).ok).toBe(false);
    const ok = updateSong(db, s.id, { artist: "DJ", album: "Vol 1" }, alice);
    expect(ok.ok && ok.value.artist).toBe("DJ");
    const cleared = updateSong(db, s.id, { artist: "" }, alice);
    expect(cleared.ok && cleared.value.artist).toBe(null);
  });

  it("does not let another user update a song", () => {
    const s = seedSong(alice);
    const r = updateSong(db, s.id, { originalFilename: "hacked" }, bob);
    expect(r.ok).toBe(false);
  });

  it("toggles liked and records plays (owner only)", () => {
    const s = seedSong(alice);
    expect(setLiked(db, s.id, true, alice).ok && getSong(db, s.id, alice)).toBeTruthy();
    const played = recordPlay(db, s.id, alice);
    expect(played.ok && played.value.playCount).toBe(1);
    expect(recordPlay(db, s.id, bob).ok).toBe(false);
  });

  it("deletes a song (owner only)", () => {
    const s = seedSong(alice);
    expect(deleteSong(db, s.id, "/tmp", "/tmp", bob).ok).toBe(false);
    expect(deleteSong(db, s.id, "/tmp", "/tmp", alice).ok).toBe(true);
    expect(listSongs(db, alice).ok && listSongs(db, alice).value.length).toBe(0);
  });
});
