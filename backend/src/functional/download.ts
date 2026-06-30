import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { ZipArchive } from "archiver";
import type { Response } from "express";
import type { Database } from "better-sqlite3";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

interface DownloadRow {
  filename: string;
  original_filename: string;
  artist: string | null;
  album: string | null;
  source_url: string | null;
  art_filename: string | null;
}

// Prepares the file to hand back for a song download. MP3s get the current
// library metadata embedded — title, artist, album, cover art, and the source
// link (base64url in a TXXX:SOURCE_URL frame) — written into `workDir`, so the
// track round-trips when re-uploaded to another instance. Non-MP3s, and any
// tagging failure, fall back to the raw stored file so downloads never break.
// Returns the path to send + the suggested download filename, or null if the
// underlying file is missing. This is the single source of truth shared by the
// single-track download and the playlist-zip download.
export async function preparedDownload(
  db: Database,
  songId: number,
  musicDir: string,
  artDir: string,
  workDir: string,
  // When set (album downloads), embed this 1-based track number so the album
  // keeps its order when re-imported. Omitted for playlists (position isn't a
  // real track number there).
  track?: number
): Promise<{ path: string; name: string } | null> {
  const row = db
    .prepare(
      "SELECT filename, original_filename, artist, album, source_url, art_filename FROM songs WHERE id = ?"
    )
    .get(songId) as DownloadRow | undefined;
  if (!row) return null;

  const src = join(musicDir, row.filename);
  if (!existsSync(src)) return null;

  const srcExt = extname(row.filename);
  const isMp3 = srcExt.toLowerCase() === ".mp3";
  // Always hand back an MP3 so artist/album/cover/track embed cleanly via ID3 —
  // most of the library is imported (opus/m4a/webm), which can't carry ID3, so
  // we transcode on download. The download name always ends in .mp3.
  const titleBase = (row.original_filename || row.filename).replace(/\.[^.]+$/, "");
  const mp3Name = `${titleBase}.mp3`;
  // Fallback name keeps the real extension if the conversion ever fails, so the
  // download is never broken (and never mislabels a non-MP3 as .mp3).
  const rawName = extname(row.original_filename)
    ? row.original_filename
    : `${row.original_filename}${srcExt}`;

  try {
    const artPath = row.art_filename ? join(artDir, row.art_filename) : null;
    const hasArt = !!artPath && existsSync(artPath);
    const out = join(workDir, `${songId}.mp3`);
    const args = ["-y", "-i", src];
    if (hasArt) args.push("-i", artPath!);
    args.push("-map", "0:a");
    if (hasArt) args.push("-map", "1:0");
    // Copy when already MP3 (lossless, fast); otherwise transcode with LAME at
    // a high-quality VBR setting (~190 kbps).
    if (isMp3) args.push("-c:a", "copy");
    else args.push("-c:a", "libmp3lame", "-q:a", "2");
    if (hasArt) args.push("-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    args.push("-id3v2_version", "3", "-metadata", `title=${titleBase}`);
    if (row.artist) args.push("-metadata", `artist=${row.artist}`);
    if (row.album) args.push("-metadata", `album=${row.album}`);
    if (track) args.push("-metadata", `track=${track}`);
    if (row.source_url) {
      const enc = Buffer.from(row.source_url, "utf8").toString("base64url");
      args.push("-metadata", `SOURCE_URL=${enc}`);
    }
    args.push(out);
    await run("ffmpeg", args);
    if (!existsSync(out)) throw new Error("conversion produced no file");
    return { path: out, name: mp3Name };
  } catch {
    // Conversion failed — hand back the original file under its real name.
    return { path: src, name: rawName };
  }
}

// Streams a set of songs (by id, in the given order) to the response as a zip,
// re-tagging each track via preparedDownload first. Shared by the playlist-zip
// and album-zip downloads so they behave identically. `zipName` is used for the
// attachment filename and is sanitized by the caller.
export async function streamSongsZip(
  db: Database,
  res: Response,
  songIds: number[],
  zipName: string,
  musicDir: string,
  artDir: string,
  // Album downloads: embed a track number per song and prefix each file with a
  // zero-padded index, so the song order is preserved both in music players
  // (track tag) and file browsers (filename sort). Off for playlists.
  opts: { numberTracks?: boolean } = {}
): Promise<void> {
  // Tagged temp files live in workDir until the archive finishes streaming.
  const work = mkdtempSync(join(dirname(musicDir), "zip-"));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  const pad = String(songIds.length).length; // width for zero-padded prefixes
  const used = new Set<string>();
  const files: { path: string; entry: string }[] = [];
  for (let i = 0; i < songIds.length; i++) {
    const track = i + 1;
    const prepared = await preparedDownload(
      db,
      songIds[i],
      musicDir,
      artDir,
      work,
      opts.numberTracks ? track : undefined
    );
    if (!prepared) continue;
    // preparedDownload already ensures the name carries an extension.
    let entry = opts.numberTracks
      ? `${String(track).padStart(pad, "0")} - ${prepared.name}`
      : prepared.name;
    // De-duplicate identical entry names within the zip.
    if (used.has(entry)) {
      const base = entry.slice(0, entry.length - extname(entry).length);
      let n = 2;
      while (used.has(`${base} (${n})${extname(entry)}`)) n++;
      entry = `${base} (${n})${extname(entry)}`;
    }
    used.add(entry);
    files.push({ path: prepared.path, entry });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 0 } }); // store; audio is already compressed
  archive.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.on("end", cleanup);
  res.on("close", cleanup);
  archive.pipe(res);

  for (const f of files) archive.file(f.path, { name: f.entry });
  archive.finalize();
}
