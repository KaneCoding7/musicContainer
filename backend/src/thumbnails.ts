// Album-art thumbnails. The stored art can be large (e.g. 1280x720), which
// looks grainy when the browser downscales it into a 40px list thumbnail and
// wastes bandwidth. We generate small square WebP thumbnails on demand and
// cache them on disk next to the originals (in <artDir>/thumbs).
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Response } from "express";
import sharp from "sharp";

// Allowed thumbnail edge sizes (px). A requested size snaps up to the nearest
// so we only ever cache a small, fixed set of variants per image.
const THUMB_SIZES = [128, 256, 512] as const;

// Resolves a requested ?size value to an allowed thumbnail size, or null when
// no (or an invalid) size was requested — in which case the full image is served.
export function thumbSize(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return THUMB_SIZES.find((s) => s >= n) ?? THUMB_SIZES[THUMB_SIZES.length - 1];
}

// Returns the path to a cached square WebP thumbnail of `artPath`, generating
// it on first request. Writes to a temp file then renames so a concurrent
// request never reads a half-written thumbnail.
async function ensureThumbnail(artPath: string, size: number): Promise<string> {
  const thumbDir = join(dirname(artPath), "thumbs");
  if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true });
  const thumbPath = join(thumbDir, `${basename(artPath)}@${size}.webp`);
  if (existsSync(thumbPath)) return thumbPath;

  const tmp = `${thumbPath}.${randomUUID()}.tmp`;
  await sharp(artPath)
    .resize(size, size, { fit: "cover", position: "centre" })
    .webp({ quality: 80 })
    .toFile(tmp);
  renameSync(tmp, thumbPath);
  return thumbPath;
}

// Streams album art to the response, resized to a cached thumbnail when a valid
// `sizeRaw` is given. Falls back to the original on any resize failure.
export async function serveArt(
  res: Response,
  artPath: string,
  fullContentType: string,
  sizeRaw: unknown
): Promise<void> {
  res.setHeader("Cache-Control", "public, max-age=86400");
  const size = thumbSize(sizeRaw);
  if (size !== null) {
    try {
      const thumbPath = await ensureThumbnail(artPath, size);
      res.setHeader("Content-Type", "image/webp");
      createReadStream(thumbPath).pipe(res);
      return;
    } catch {
      // Fall through and serve the original image.
    }
  }
  res.setHeader("Content-Type", fullContentType);
  createReadStream(artPath).pipe(res);
}
