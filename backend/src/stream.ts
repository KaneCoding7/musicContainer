import { createReadStream } from "node:fs";
import type { Request, Response } from "express";
import type { SongFile } from "./functional/songs.js";

// Streams an audio file with HTTP Range support (enables seeking + progressive
// playback). Shared by the authenticated and public stream routes.
export function streamSongFile(
  req: Request,
  res: Response,
  file: SongFile
): void {
  const { path, size, contentType } = file;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-cache");

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", size);
    res.status(200);
    createReadStream(path).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end =
    match && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    res.setHeader("Content-Range", `bytes */${size}`);
    res.status(416).end();
    return;
  }

  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  createReadStream(path, { start, end }).pipe(res);
}
