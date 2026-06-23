import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
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
  workDir: string
): Promise<{ path: string; name: string } | null> {
  const row = db
    .prepare(
      "SELECT filename, original_filename, artist, album, source_url, art_filename FROM songs WHERE id = ?"
    )
    .get(songId) as DownloadRow | undefined;
  if (!row) return null;

  const src = join(musicDir, row.filename);
  if (!existsSync(src)) return null;

  // Keep the original name, ensuring it carries an extension.
  const srcExt = extname(row.filename);
  const name = extname(row.original_filename)
    ? row.original_filename
    : `${row.original_filename}${srcExt}`;

  // Only MP3 has clean ID3 + cover support; other formats go as-is.
  if (srcExt.toLowerCase() !== ".mp3") {
    return { path: src, name };
  }

  try {
    const title = (row.original_filename || row.filename).replace(/\.[^.]+$/, "");
    const artPath = row.art_filename ? join(artDir, row.art_filename) : null;
    const hasArt = !!artPath && existsSync(artPath);
    const out = join(workDir, `${songId}.mp3`);
    const args = ["-y", "-i", src];
    if (hasArt) args.push("-i", artPath!);
    args.push("-map", "0:a");
    if (hasArt) args.push("-map", "1:0");
    args.push("-c:a", "copy");
    if (hasArt) args.push("-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    args.push("-id3v2_version", "3", "-metadata", `title=${title}`);
    if (row.artist) args.push("-metadata", `artist=${row.artist}`);
    if (row.album) args.push("-metadata", `album=${row.album}`);
    if (row.source_url) {
      const enc = Buffer.from(row.source_url, "utf8").toString("base64url");
      args.push("-metadata", `SOURCE_URL=${enc}`);
    }
    args.push(out);
    await run("ffmpeg", args);
    if (!existsSync(out)) throw new Error("tagging produced no file");
    return { path: out, name };
  } catch {
    return { path: src, name };
  }
}
