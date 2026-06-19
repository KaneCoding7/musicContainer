import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { ART_DIR, getDb, MUSIC_DIR } from "../db/init.js";
import {
  listSongs,
  recordPlay,
  resolveSongArtById,
  resolveSongFileById,
  setLiked,
} from "../functional/songs.js";
import { listPlaylists, getPlaylistSongs } from "../functional/playlists.js";
import {
  aggregateAlbums,
  aggregateArtists,
  albumId as encAlbumId,
  artistId as encArtistId,
  decodeAlbumId,
  decodeArtistId,
  decodePlaylistId,
  findUserByEmail,
  generateSubsonicPassword,
  getSubsonicPassword,
  getUserEmail,
  playlistSubId,
  songsForAlbum,
  songsForArtist,
  songTitle,
  songToChild,
  verifySubsonic,
  type AlbumAgg,
} from "../functional/subsonic.js";
import type { Song } from "../types.js";
import { streamSongFile } from "../stream.js";
import { serveArt } from "../thumbnails.js";

export const subsonicRouter = Router();

// Authed (Better Auth) endpoints for the web UI to view/rotate the user's
// Subsonic password. Mounted under /api with requireAuth.
export const subsonicCredentialRouter = Router();

subsonicCredentialRouter.get("/subsonic-credential", (req, res) => {
  const db = getDb();
  res.json({
    username: getUserEmail(db, req.userId!),
    password: getSubsonicPassword(db, req.userId!),
  });
});

subsonicCredentialRouter.post("/subsonic-credential", (req, res) => {
  const db = getDb();
  res.json({
    username: getUserEmail(db, req.userId!),
    password: generateSubsonicPassword(db, req.userId!),
  });
});

const API_VERSION = "1.16.1";
const SERVER_TYPE = "musicContainer";
const SERVER_VERSION = "1.0.0";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// --- Serialization (Subsonic XML + JSON are isomorphic: scalars -> XML attrs,
// objects/arrays -> child elements) ---------------------------------------

function escapeXml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXml(tag: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => toXml(tag, v)).join("");
  if (typeof value !== "object")
    return `<${tag}>${escapeXml(String(value))}</${tag}>`;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null
  );
  const attrs = entries.filter(([, v]) => typeof v !== "object");
  const kids = entries.filter(([, v]) => typeof v === "object");
  const attrStr = attrs
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
  if (kids.length === 0) return `<${tag}${attrStr}/>`;
  return `<${tag}${attrStr}>${kids
    .map(([k, v]) => toXml(k, v))
    .join("")}</${tag}>`;
}

function send(req: Request, res: Response, payload: Record<string, unknown>) {
  const f = str(req.query.f).toLowerCase();
  if (f === "json") {
    res
      .type("application/json")
      .send(JSON.stringify({ "subsonic-response": payload }));
  } else if (f === "jsonp") {
    const cb = str(req.query.callback) || "callback";
    res
      .type("application/javascript")
      .send(`${cb}(${JSON.stringify({ "subsonic-response": payload })});`);
  } else {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      toXml("subsonic-response", {
        xmlns: "http://subsonic.org/restapi",
        ...payload,
      });
    res.type("application/xml").send(xml);
  }
}

function ok(req: Request, res: Response, body: Record<string, unknown> = {}) {
  send(req, res, {
    status: "ok",
    version: API_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true,
    ...body,
  });
}

function fail(req: Request, res: Response, code: number, message: string) {
  // Subsonic returns HTTP 200 with an error body.
  send(req, res, {
    status: "failed",
    version: API_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true,
    error: { code, message },
  });
}

// --- Auth ------------------------------------------------------------------

subsonicRouter.use((req: Request, res: Response, next: NextFunction) => {
  const u = str(req.query.u);
  const p = str(req.query.p);
  const t = str(req.query.t);
  const s = str(req.query.s);
  if (!u || (!p && !(t && s)))
    return fail(req, res, 10, "Required parameter is missing.");
  const db = getDb();
  const user = findUserByEmail(db, u);
  const stored = user ? getSubsonicPassword(db, user.id) : null;
  if (!user || !stored || !verifySubsonic(stored, { t, s, p }))
    return fail(req, res, 40, "Wrong username or password.");
  req.userId = user.id;
  next();
});

// Register a handler for both `/name` and `/name.view` (clients use either).
function route(
  name: string,
  handler: (req: Request, res: Response) => void
): void {
  subsonicRouter.get([`/${name}`, `/${name}.view`], handler);
}

const songs = (userId: string): Song[] => {
  const r = listSongs(getDb(), userId);
  return r.ok ? r.value : [];
};

function albumObj(a: AlbumAgg): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    title: a.name,
    artist: a.artist,
    artistId: a.artistId,
    songCount: a.songCount,
    duration: a.duration,
    coverArt: a.coverArt ?? undefined,
    created: a.created,
  };
}

function firstLetter(name: string): string {
  const c = (name.trim()[0] || "#").toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

function buildIndex(
  artists: { id: string; name: string; albumCount: number; coverArt: string | null }[]
) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const a of artists) {
    const letter = firstLetter(a.name);
    const arr = groups.get(letter) ?? [];
    arr.push({
      id: a.id,
      name: a.name,
      albumCount: a.albumCount,
      coverArt: a.coverArt ?? undefined,
    });
    groups.set(letter, arr);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([name, artist]) => ({ name, artist }));
}

// --- Endpoints -------------------------------------------------------------

route("ping", (req, res) => ok(req, res));

route("getLicense", (req, res) =>
  ok(req, res, { license: { valid: true } })
);

route("getOpenSubsonicExtensions", (req, res) =>
  ok(req, res, { openSubsonicExtensions: [] })
);

route("getMusicFolders", (req, res) =>
  ok(req, res, {
    musicFolders: { musicFolder: [{ id: 1, name: "Music" }] },
  })
);

route("getGenres", (req, res) => ok(req, res, { genres: {} }));

route("getUser", (req, res) => {
  const u = str(req.query.username) || str(req.query.u);
  ok(req, res, {
    user: {
      username: u,
      scrobblingEnabled: true,
      adminRole: false,
      streamRole: true,
      downloadRole: true,
      playlistRole: true,
      coverArtRole: true,
    },
  });
});

function getArtistsBody(userId: string) {
  const artists = aggregateArtists(songs(userId));
  return { ignoredArticles: "", index: buildIndex(artists) };
}

route("getArtists", (req, res) =>
  ok(req, res, { artists: getArtistsBody(req.userId!) })
);

route("getIndexes", (req, res) => {
  const body = getArtistsBody(req.userId!);
  ok(req, res, { indexes: { lastModified: 0, ...body } });
});

route("getArtist", (req, res) => {
  const name = decodeArtistId(str(req.query.id));
  if (name === null) return fail(req, res, 70, "Artist not found.");
  const lib = songs(req.userId!);
  const albums = aggregateAlbums(songsForArtist(lib, name));
  if (albums.length === 0) return fail(req, res, 70, "Artist not found.");
  ok(req, res, {
    artist: {
      id: encArtistId(name),
      name,
      albumCount: albums.length,
      coverArt: albums[0].coverArt ?? undefined,
      album: albums.map(albumObj),
    },
  });
});

route("getAlbum", (req, res) => {
  const dec = decodeAlbumId(str(req.query.id));
  if (!dec) return fail(req, res, 70, "Album not found.");
  const lib = songs(req.userId!);
  const tracks = songsForAlbum(lib, dec.artist, dec.album);
  if (tracks.length === 0) return fail(req, res, 70, "Album not found.");
  const agg = aggregateAlbums(tracks)[0];
  ok(req, res, {
    album: { ...albumObj(agg), song: tracks.map(songToChild) },
  });
});

route("getAlbumList2", (req, res) => handleAlbumList(req, res, "albumList2"));
route("getAlbumList", (req, res) => handleAlbumList(req, res, "albumList"));

function handleAlbumList(req: Request, res: Response, key: string) {
  const type = str(req.query.type) || "alphabeticalByName";
  const size = Math.min(Math.max(Number(req.query.size) || 10, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  let albums = aggregateAlbums(songs(req.userId!));
  switch (type) {
    case "newest":
    case "recent":
      albums = albums.sort((a, b) => b.created.localeCompare(a.created));
      break;
    case "random":
      albums = shuffle(albums);
      break;
    case "alphabeticalByArtist":
      albums = albums.sort((a, b) => a.artist.localeCompare(b.artist));
      break;
    default:
      albums = albums.sort((a, b) => a.name.localeCompare(b.name));
  }
  const page = albums.slice(offset, offset + size).map(albumObj);
  ok(req, res, { [key]: { album: page } });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    // Not crypto-grade; ordering only.
    const j = Math.floor((i + 1) * fract(i * 0.6180339887));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const fract = (n: number): number => n - Math.floor(n);

route("getSong", (req, res) => {
  const id = Number(str(req.query.id));
  const song = songs(req.userId!).find((s) => s.id === id);
  if (!song) return fail(req, res, 70, "Song not found.");
  ok(req, res, { song: songToChild(song) });
});

function handleSearch(req: Request, res: Response, key: string) {
  const q = str(req.query.query).toLowerCase().trim();
  const lib = songs(req.userId!);
  const matchSongs = q
    ? lib.filter(
        (s) =>
          songTitle(s).toLowerCase().includes(q) ||
          (s.artist ?? "").toLowerCase().includes(q) ||
          (s.album ?? "").toLowerCase().includes(q)
      )
    : [];
  const artists = aggregateArtists(lib).filter((a) =>
    q ? a.name.toLowerCase().includes(q) : false
  );
  const albums = aggregateAlbums(lib).filter((a) =>
    q ? a.name.toLowerCase().includes(q) : false
  );
  ok(req, res, {
    [key]: {
      artist: artists.map((a) => ({
        id: a.id,
        name: a.name,
        albumCount: a.albumCount,
        coverArt: a.coverArt ?? undefined,
      })),
      album: albums.map(albumObj),
      song: matchSongs.map(songToChild),
    },
  });
}
route("search3", (req, res) => handleSearch(req, res, "searchResult3"));
route("search2", (req, res) => handleSearch(req, res, "searchResult2"));

route("getPlaylists", (req, res) => {
  const r = listPlaylists(getDb(), req.userId!);
  const lists = r.ok ? r.value : [];
  ok(req, res, {
    playlists: {
      playlist: lists.map((p) => ({
        id: playlistSubId(p.id),
        name: p.name,
        songCount: p.trackCount ?? 0,
        duration: 0,
        owner: "",
        public: false,
        created: p.createdAt ?? undefined,
      })),
    },
  });
});

route("getPlaylist", (req, res) => {
  const pid = decodePlaylistId(str(req.query.id));
  if (pid === null) return fail(req, res, 70, "Playlist not found.");
  const r = getPlaylistSongs(getDb(), pid, req.userId!);
  if (!r.ok) return fail(req, res, 70, "Playlist not found.");
  const tracks = r.value;
  ok(req, res, {
    playlist: {
      id: playlistSubId(pid),
      name: String(pid),
      songCount: tracks.length,
      duration: tracks.reduce((n, s) => n + Math.round(s.duration ?? 0), 0),
      public: false,
      entry: tracks.map(songToChild),
    },
  });
});

route("getStarred2", (req, res) => handleStarred(req, res, "starred2"));
route("getStarred", (req, res) => handleStarred(req, res, "starred"));
function handleStarred(req: Request, res: Response, key: string) {
  const liked = songs(req.userId!).filter((s) => s.liked);
  ok(req, res, { [key]: { song: liked.map(songToChild) } });
}

route("star", (req, res) => toggleStar(req, res, true));
route("unstar", (req, res) => toggleStar(req, res, false));
function toggleStar(req: Request, res: Response, liked: boolean) {
  const id = Number(str(req.query.id));
  if (Number.isInteger(id)) setLiked(getDb(), id, liked, req.userId!);
  ok(req, res);
}

route("scrobble", (req, res) => {
  const id = Number(str(req.query.id));
  if (Number.isInteger(id)) recordPlay(getDb(), id, req.userId!);
  ok(req, res);
});

// Resolve a coverArt id (song numeric, or album/artist/playlist) to a song id
// whose embedded art we can serve.
function coverSongId(userId: string, id: string): number | null {
  if (/^\d+$/.test(id)) return Number(id);
  const lib = songs(userId);
  const ar = decodeArtistId(id);
  if (ar) return songsForArtist(lib, ar).find((s) => s.hasArt)?.id ?? null;
  const al = decodeAlbumId(id);
  if (al)
    return songsForAlbum(lib, al.artist, al.album).find((s) => s.hasArt)?.id ?? null;
  if (id.startsWith("pl-")) {
    const pid = decodePlaylistId(id);
    if (pid !== null) {
      const r = getPlaylistSongs(getDb(), pid, userId);
      if (r.ok) return r.value.find((s) => s.hasArt)?.id ?? null;
    }
  }
  return null;
}

route("getCoverArt", async (req, res) => {
  const sid = coverSongId(req.userId!, str(req.query.id));
  if (sid === null) return fail(req, res, 70, "Cover art not found.");
  const art = resolveSongArtById(getDb(), sid, ART_DIR);
  if (!art.ok) return fail(req, res, 70, "Cover art not found.");
  await serveArt(req, res, art.value.path, art.value.contentType, req.query.size);
});

route("stream", (req, res) => {
  const id = Number(str(req.query.id));
  const file = resolveSongFileById(getDb(), id, MUSIC_DIR);
  if (!file.ok) return fail(req, res, 70, "Song not found.");
  // Ownership: the song must be in the caller's library.
  if (!songs(req.userId!).some((s) => s.id === id))
    return fail(req, res, 70, "Song not found.");
  streamSongFile(req, res, file.value);
});

route("download", (req, res) => {
  const id = Number(str(req.query.id));
  if (!songs(req.userId!).some((s) => s.id === id))
    return fail(req, res, 70, "Song not found.");
  const file = resolveSongFileById(getDb(), id, MUSIC_DIR);
  if (!file.ok) return fail(req, res, 70, "Song not found.");
  res.download(file.value.path, file.value.originalFilename);
});
