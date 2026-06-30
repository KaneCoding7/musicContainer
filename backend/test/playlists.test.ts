import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  addSongToPlaylist,
  addSongsToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  getPlaylistSongs,
  listPlaylists,
  removeSongFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
} from "../src/functional/playlists.js";
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

function song(userId: string, name: string) {
  const r = recordSong(db, { filename: `${name}.mp3`, originalFilename: name, userId });
  if (!r.ok) throw new Error("seed");
  return r.value.id;
}
function playlist(userId: string, name = "PL") {
  const r = createPlaylist(db, name, userId);
  if (!r.ok) throw new Error("seed");
  return r.value.id;
}

describe("playlists", () => {
  it("creates and lists per-user", () => {
    playlist(alice, "A");
    expect(listPlaylists(db, alice).ok && listPlaylists(db, alice).value.length).toBe(1);
    expect(listPlaylists(db, bob).ok && listPlaylists(db, bob).value.length).toBe(0);
  });

  it("rejects empty names", () => {
    expect(createPlaylist(db, "  ", alice).ok).toBe(false);
  });

  it("getPlaylist is owner-scoped", () => {
    const p = playlist(alice);
    expect(getPlaylist(db, p, alice).ok).toBe(true);
    expect(getPlaylist(db, p, bob).ok).toBe(false);
  });

  it("adds songs newest-first, rejects duplicates, returns ordered list", () => {
    const p = playlist(alice);
    const s1 = song(alice, "s1");
    const s2 = song(alice, "s2");
    expect(addSongToPlaylist(db, p, s1, alice).ok).toBe(true);
    expect(addSongToPlaylist(db, p, s2, alice).ok).toBe(true);
    const dup = addSongToPlaylist(db, p, s1, alice);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("conflict");
    const songs = getPlaylistSongs(db, p, alice);
    // Most recently added is shown at the top, so s2 comes before s1.
    expect(songs.ok && songs.value.map((s) => s.id)).toEqual([s2, s1]);
  });

  it("won't add another user's song", () => {
    const p = playlist(alice);
    const bobSong = song(bob, "b");
    const r = addSongToPlaylist(db, p, bobSong, alice);
    expect(r.ok).toBe(false);
  });

  it("bulk add skips duplicates and missing/foreign ids", () => {
    const p = playlist(alice);
    const s1 = song(alice, "s1");
    const s2 = song(alice, "s2");
    const bobSong = song(bob, "b");
    const first = addSongsToPlaylist(db, p, [s1, s2], alice);
    expect(first.ok && first.value.added).toBe(2);
    // The batch lands at the top, preserving the given order among new songs.
    const ordered = getPlaylistSongs(db, p, alice);
    expect(ordered.ok && ordered.value.map((s) => s.id)).toEqual([s1, s2]);
    const second = addSongsToPlaylist(db, p, [s1, 9999, bobSong], alice);
    expect(second.ok && second.value.added).toBe(0);
  });

  it("reorders to the given id order", () => {
    const p = playlist(alice);
    const s1 = song(alice, "s1");
    const s2 = song(alice, "s2");
    const s3 = song(alice, "s3");
    addSongsToPlaylist(db, p, [s1, s2, s3], alice);
    expect(reorderPlaylist(db, p, [s3, s1, s2], alice).ok).toBe(true);
    const songs = getPlaylistSongs(db, p, alice);
    expect(songs.ok && songs.value.map((s) => s.id)).toEqual([s3, s1, s2]);
  });

  it("removes a song", () => {
    const p = playlist(alice);
    const s1 = song(alice, "s1");
    addSongToPlaylist(db, p, s1, alice);
    expect(removeSongFromPlaylist(db, p, s1, alice).ok).toBe(true);
    expect(removeSongFromPlaylist(db, p, s1, alice).ok).toBe(false); // already gone
  });

  it("renames and deletes (owner only)", () => {
    const p = playlist(alice, "Old");
    expect(renamePlaylist(db, p, "New", bob).ok).toBe(false);
    const renamed = renamePlaylist(db, p, "New", alice);
    expect(renamed.ok && renamed.value.name).toBe("New");
    expect(deletePlaylist(db, p, alice).ok).toBe(true);
    expect(getPlaylist(db, p, alice).ok).toBe(false);
  });

  it("list includes track count and cover song id", () => {
    const p = playlist(alice);
    const s1 = song(alice, "s1");
    addSongToPlaylist(db, p, s1, alice);
    const list = listPlaylists(db, alice);
    expect(list.ok && list.value[0].trackCount).toBe(1);
  });
});
