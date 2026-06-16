import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import {
  addSongToPlaylist,
  canEditPlaylist,
  createPlaylist,
} from "../src/functional/playlists.js";
import { recordSong } from "../src/functional/songs.js";
import {
  canAccessSong,
  getSharedPlaylistSongs,
  listSharedWithMe,
  sharePlaylist,
  unsharePlaylist,
} from "../src/functional/shares.js";
import { addUser, emailFor, testDb } from "./helpers.js";

let db: Database;
let alice: string;
let bob: string;

beforeEach(() => {
  db = testDb();
  alice = addUser(db, "Alice");
  bob = addUser(db, "Bob");
});

function setupSharedPlaylist() {
  const s1 = recordSong(db, { filename: "s1.mp3", originalFilename: "s1", userId: alice });
  const s2 = recordSong(db, { filename: "s2.mp3", originalFilename: "s2", userId: alice });
  if (!s1.ok || !s2.ok) throw new Error("seed");
  const p = createPlaylist(db, "Shared", alice);
  if (!p.ok) throw new Error("seed");
  addSongToPlaylist(db, p.value.id, s1.value.id, alice);
  return { playlistId: p.value.id, shared: s1.value.id, private: s2.value.id };
}

describe("shares", () => {
  it("shares a playlist with a user by email", () => {
    const { playlistId } = setupSharedPlaylist();
    const r = sharePlaylist(db, alice, playlistId, emailFor(bob), false);
    expect(r.ok && r.value.id).toBe(bob);
    const mine = listSharedWithMe(db, bob);
    expect(mine.ok && mine.value.length).toBe(1);
    expect(mine.ok && mine.value[0].ownerName).toBe("Alice");
  });

  it("rejects sharing with self or unknown email", () => {
    const { playlistId } = setupSharedPlaylist();
    expect(sharePlaylist(db, alice, playlistId, emailFor(alice), false).ok).toBe(false);
    expect(sharePlaylist(db, alice, playlistId, "nobody@x.com", false).ok).toBe(false);
  });

  it("canAccessSong: owner yes, shared yes, private no", () => {
    const ids = setupSharedPlaylist();
    sharePlaylist(db, alice, ids.playlistId, emailFor(bob), false);
    expect(canAccessSong(db, alice, ids.shared)).toBe(true); // owner
    expect(canAccessSong(db, bob, ids.shared)).toBe(true); // shared
    expect(canAccessSong(db, bob, ids.private)).toBe(false); // not shared
  });

  it("recipient reads shared songs; revoke removes access", () => {
    const ids = setupSharedPlaylist();
    sharePlaylist(db, alice, ids.playlistId, emailFor(bob), false);
    const songs = getSharedPlaylistSongs(db, bob, ids.playlistId);
    expect(songs.ok && songs.value.map((s) => s.id)).toEqual([ids.shared]);

    unsharePlaylist(db, alice, ids.playlistId, bob);
    expect(getSharedPlaylistSongs(db, bob, ids.playlistId).ok).toBe(false);
    expect(canAccessSong(db, bob, ids.shared)).toBe(false);
  });

  it("non-recipient cannot read a shared playlist", () => {
    const ids = setupSharedPlaylist();
    const carol = addUser(db, "Carol");
    expect(getSharedPlaylistSongs(db, carol, ids.playlistId).ok).toBe(false);
  });

  it("view-only can't edit; editor can add own songs; owner can access them", () => {
    const ids = setupSharedPlaylist();
    const bobSong = recordSong(db, {
      filename: "b.mp3",
      originalFilename: "b",
      userId: bob,
    });
    if (!bobSong.ok) throw new Error("seed");

    // View-only: Bob cannot edit.
    sharePlaylist(db, alice, ids.playlistId, emailFor(bob), false);
    expect(canEditPlaylist(db, ids.playlistId, bob)).toBe(false);
    expect(addSongToPlaylist(db, ids.playlistId, bobSong.value.id, bob).ok).toBe(
      false
    );

    // Upgrade to editor: Bob can add his own song.
    sharePlaylist(db, alice, ids.playlistId, emailFor(bob), true);
    expect(canEditPlaylist(db, ids.playlistId, bob)).toBe(true);
    expect(addSongToPlaylist(db, ids.playlistId, bobSong.value.id, bob).ok).toBe(
      true
    );

    // Owner can now access the collaborator's added track.
    expect(canAccessSong(db, alice, bobSong.value.id)).toBe(true);
    // Bob still can't add Alice's songs (only his own library).
    expect(addSongToPlaylist(db, ids.playlistId, ids.private, bob).ok).toBe(
      false
    );
  });
});
