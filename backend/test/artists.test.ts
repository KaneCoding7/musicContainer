import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  deleteSong,
  findOrCreateArtist,
  getSong,
  listSongsByArtist,
  recordSong,
  updateSong,
  updateSongsBulk,
} from "../src/functional/songs.js";
import { backfillArtists, migrate } from "../src/db/init.js";
import {
  enableArtistPublicLink,
  getArtistPublicToken,
  publicTokenAllowsSong,
  resolvePublicShare,
} from "../src/functional/publicShares.js";
import { addUser, testDb } from "./helpers.js";

let db: Database;
let alice: string;
let bob: string;

beforeEach(() => {
  db = testDb();
  alice = addUser(db, "Alice");
  bob = addUser(db, "Bob");
});

function seed(userId: string, name: string, artists?: string[]) {
  const r = recordSong(db, {
    filename: `${name}.mp3`,
    originalFilename: name,
    userId,
    artists,
  });
  if (!r.ok) throw new Error("seed failed");
  return r.value;
}

function artistCount(userId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM artists WHERE user_id = ?")
      .get(userId) as { n: number }
  ).n;
}

describe("artists (relational)", () => {
  it("records a song with an ordered artist list and denormalized string", () => {
    const s = seed(alice, "Song", ["A", "B", "C"]);
    expect(s.artists.map((a) => a.name)).toEqual(["A", "B", "C"]);
    expect(s.artist).toBe("A, B, C");
  });

  it("findOrCreateArtist dedupes case-insensitively and is per-user", () => {
    const a1 = findOrCreateArtist(db, alice, "Drake");
    const a2 = findOrCreateArtist(db, alice, "drake");
    expect(a2).toBe(a1); // same artist regardless of casing
    const bobsDrake = findOrCreateArtist(db, bob, "Drake");
    expect(bobsDrake).not.toBe(a1); // a different user's library is separate
  });

  it("a multi-artist song appears under EACH of its artists", () => {
    const s = seed(alice, "Collab", ["A", "B"]);
    const byA = listSongsByArtist(db, alice, "A");
    const byB = listSongsByArtist(db, alice, "B");
    expect(byA.ok && byA.value.map((x) => x.id)).toEqual([s.id]);
    expect(byB.ok && byB.value.map((x) => x.id)).toEqual([s.id]);
  });

  it("listSongsByArtist matches case-insensitively and is owner-scoped", () => {
    seed(alice, "Song", ["Kaytranada"]);
    const hit = listSongsByArtist(db, alice, "kaytranada");
    expect(hit.ok && hit.value.length).toBe(1);
    const cross = listSongsByArtist(db, bob, "Kaytranada");
    expect(cross.ok && cross.value.length).toBe(0);
  });

  it("updateSong reconciles the artist list (add/remove/reorder) and string", () => {
    const s = seed(alice, "Song", ["A", "B"]);
    const r = updateSong(db, s.id, { artists: ["B", "C"] }, alice);
    expect(r.ok && r.value.artists.map((a) => a.name)).toEqual(["B", "C"]);
    expect(r.ok && r.value.artist).toBe("B, C");
    // A is now unused → pruned; B and C remain.
    expect(listSongsByArtist(db, alice, "A").ok && listSongsByArtist(db, alice, "A").value.length).toBe(0);
    expect(artistCount(alice)).toBe(2);
  });

  it("clearing artists empties the list and nulls the display string", () => {
    const s = seed(alice, "Song", ["Solo"]);
    const r = updateSong(db, s.id, { artists: [] }, alice);
    expect(r.ok && r.value.artists.length).toBe(0);
    expect(r.ok && r.value.artist).toBe(null);
    expect(artistCount(alice)).toBe(0); // Solo pruned
  });

  it("a legacy single `artist` string still works and links one artist", () => {
    const s = seed(alice, "Song");
    const r = updateSong(db, s.id, { artist: "DJ" }, alice);
    expect(r.ok && r.value.artists.map((a) => a.name)).toEqual(["DJ"]);
    expect(r.ok && r.value.artist).toBe("DJ");
  });

  it("ignores blank and duplicate names, preserving order", () => {
    const s = seed(alice, "Song", ["A", " ", "a", "B"]);
    expect(s.artists.map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("deleting a song cascades its links and prunes orphaned artists", () => {
    const shared = seed(alice, "S1", ["Shared", "Only1"]);
    seed(alice, "S2", ["Shared"]);
    const del = deleteSong(db, shared.id, "/tmp", "/tmp", alice);
    expect(del.ok).toBe(true);
    // "Only1" had just the deleted song → gone; "Shared" still has S2 → kept.
    expect(artistCount(alice)).toBe(1);
    const keep = listSongsByArtist(db, alice, "Shared");
    expect(keep.ok && keep.value.length).toBe(1);
  });

  it("bulk update sets the same artist list across songs", () => {
    const a = seed(alice, "A1");
    const b = seed(alice, "A2");
    const r = updateSongsBulk(db, [a.id, b.id], { artists: ["VA", "Feat"] }, alice);
    expect(r.ok && r.value.length).toBe(2);
    expect(getSong(db, a.id, alice).ok && getSong(db, a.id, alice).value.artists.map((x) => x.name)).toEqual(["VA", "Feat"]);
  });

  it("does not prune an artist still referenced by a public share", () => {
    const s = seed(alice, "Song", ["Keep"]);
    expect(enableArtistPublicLink(db, alice, "Keep").ok).toBe(true);
    // Remove the artist from its only song — the share still references it.
    updateSong(db, s.id, { artists: [] }, alice);
    expect(artistCount(alice)).toBe(1);
    expect(getArtistPublicToken(db, alice, "Keep").ok).toBe(true);
  });

  it("an artist public link resolves and gates the right songs", () => {
    const s1 = seed(alice, "S1", ["Star", "Other"]);
    const s2 = seed(alice, "S2", ["Star"]);
    const strangerSong = seed(bob, "B1", ["Star"]);
    const link = enableArtistPublicLink(db, alice, "Star");
    expect(link.ok).toBe(true);
    const token = link.ok ? link.value : "";

    const resolved = resolvePublicShare(db, token);
    expect(resolved.ok && resolved.value.name).toBe("Star");
    expect(resolved.ok && resolved.value.songs.map((x) => x.id).sort()).toEqual(
      [s1.id, s2.id].sort()
    );

    expect(publicTokenAllowsSong(db, token, s1.id)).toBe(true);
    expect(publicTokenAllowsSong(db, token, s2.id)).toBe(true);
    // Bob's song, even though also by "Star", is a different owner → denied.
    expect(publicTokenAllowsSong(db, token, strangerSong.id)).toBe(false);
  });

  it("re-keys old name-addressed artist_images / artist_public_shares to artist_id", () => {
    // Rebuild the two tables in their pre-migration (name-keyed) shape and put
    // rows in them, then run migrate() to exercise the one-time re-key path.
    db.exec("DROP TABLE artist_images");
    db.exec("DROP TABLE artist_public_shares");
    db.exec(`
      CREATE TABLE artist_images (
        user_id TEXT NOT NULL, artist TEXT NOT NULL, filename TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, artist)
      );
      CREATE TABLE artist_public_shares (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL, artist TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, artist)
      );
    `);
    db.prepare(
      "INSERT INTO artist_images (user_id, artist, filename) VALUES (?, ?, ?)"
    ).run(alice, "Imaged", "pic.jpg");
    db.prepare(
      "INSERT INTO artist_public_shares (token, user_id, artist, created_by) VALUES (?, ?, ?, ?)"
    ).run("tok1", alice, "Shared", alice);

    migrate(db);

    // Both tables now key on artist_id, mapping to artists rows by name.
    const img = db
      .prepare(
        `SELECT a.name FROM artist_images ai JOIN artists a ON a.id = ai.artist_id
          WHERE ai.user_id = ?`
      )
      .get(alice) as { name: string } | undefined;
    expect(img?.name).toBe("Imaged");
    expect(getArtistPublicToken(db, alice, "Shared").ok && getArtistPublicToken(db, alice, "Shared").value).toBe("tok1");
  });

  it("backfillArtists seeds artists/links from legacy songs.artist once", () => {
    // Simulate a pre-migration row: a song with only the string column set.
    db.prepare(
      "INSERT INTO songs (filename, original_filename, artist, user_id, pending) VALUES (?, ?, ?, ?, 0)"
    ).run("legacy.mp3", "Legacy", "Legacy Artist", alice);

    backfillArtists(db);
    const byArtist = listSongsByArtist(db, alice, "Legacy Artist");
    expect(byArtist.ok && byArtist.value.length).toBe(1);

    // Idempotent: a second run doesn't duplicate links.
    backfillArtists(db);
    const links = (
      db.prepare("SELECT COUNT(*) AS n FROM song_artists").get() as { n: number }
    ).n;
    expect(links).toBe(1);
  });
});
