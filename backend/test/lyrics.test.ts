import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  deleteSong,
  getSong,
  getSongLyrics,
  getSongLyricsById,
  listSongsNeedingLyrics,
  recordSong,
  setSongLyrics,
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

function seed(userId: string, name = "Track") {
  const r = recordSong(db, {
    filename: `${name}.mp3`,
    originalFilename: name,
    userId,
  });
  if (!r.ok) throw new Error("seed failed");
  return r.value;
}

describe("lyrics", () => {
  it("new songs start with no lyrics and unchecked", () => {
    const s = seed(alice);
    expect(s.hasLyrics).toBe(false);
    expect(getSongLyrics(db, s.id, alice)).toBe(null);
    // Unchecked → appears in the backfill queue.
    expect(listSongsNeedingLyrics(db, alice).map((x) => x.id)).toContain(s.id);
  });

  it("stores lyrics, flips hasLyrics, and leaves the backfill queue", () => {
    const s = seed(alice);
    setSongLyrics(db, s.id, {
      plain: "hello",
      synced: "[00:01.00] hello",
      source: "lrclib",
    });
    const fresh = getSong(db, s.id, alice);
    expect(fresh.ok && fresh.value.hasLyrics).toBe(true);
    const ly = getSongLyrics(db, s.id, alice);
    expect(ly?.plain).toBe("hello");
    expect(ly?.synced).toBe("[00:01.00] hello");
    expect(ly?.source).toBe("lrclib");
    expect(listSongsNeedingLyrics(db, alice).map((x) => x.id)).not.toContain(s.id);
  });

  it("records a confirmed miss (null) as checked without a lyrics row", () => {
    const s = seed(alice);
    setSongLyrics(db, s.id, null);
    const fresh = getSong(db, s.id, alice);
    expect(fresh.ok && fresh.value.hasLyrics).toBe(false);
    expect(getSongLyrics(db, s.id, alice)).toBe(null);
    // Checked → not retried by the backfill.
    expect(listSongsNeedingLyrics(db, alice).map((x) => x.id)).not.toContain(s.id);
  });

  it("clears lyrics when set back to empty", () => {
    const s = seed(alice);
    setSongLyrics(db, s.id, { plain: "x", synced: null, source: "manual" });
    expect(getSongLyrics(db, s.id, alice)?.plain).toBe("x");
    setSongLyrics(db, s.id, { plain: null, synced: null, source: "manual" });
    expect(getSongLyrics(db, s.id, alice)).toBe(null);
    expect(getSong(db, s.id, alice).ok && getSong(db, s.id, alice).value.hasLyrics).toBe(false);
  });

  it("getSongLyrics is owner-scoped; getSongLyricsById is not", () => {
    const s = seed(alice);
    setSongLyrics(db, s.id, { plain: "secret", synced: null, source: "manual" });
    expect(getSongLyrics(db, s.id, bob)).toBe(null); // not Bob's song
    expect(getSongLyricsById(db, s.id)?.plain).toBe("secret"); // unscoped (route-gated)
  });

  it("deleting a song cascades its lyrics row", () => {
    const s = seed(alice);
    setSongLyrics(db, s.id, { plain: "bye", synced: null, source: "manual" });
    expect(deleteSong(db, s.id, "/tmp", "/tmp", alice).ok).toBe(true);
    expect(getSongLyricsById(db, s.id)).toBe(null);
  });

  it("backfill queue is per-user and excludes pending songs", () => {
    seed(alice, "A1");
    seed(bob, "B1");
    expect(listSongsNeedingLyrics(db, alice).length).toBe(1);
    expect(listSongsNeedingLyrics(db, bob).length).toBe(1);
  });
});
