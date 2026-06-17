import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { serveArt, thumbSize } from "../src/thumbnails.js";

// Minimal stand-in for an Express Response: a writable stream that also records
// the headers serveArt sets.
function fakeRes() {
  const res = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
    setHeader: (k: string, v: string) => void;
  };
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

describe("thumbSize", () => {
  it("returns null when no/invalid size is requested (serve full image)", () => {
    expect(thumbSize(undefined)).toBe(null);
    expect(thumbSize("")).toBe(null);
    expect(thumbSize("abc")).toBe(null);
    expect(thumbSize("0")).toBe(null);
    expect(thumbSize("-50")).toBe(null);
  });

  it("snaps a requested size up to the nearest allowed variant", () => {
    expect(thumbSize(40)).toBe(128);
    expect(thumbSize(128)).toBe(128);
    expect(thumbSize(129)).toBe(256);
    expect(thumbSize(256)).toBe(256);
    expect(thumbSize(300)).toBe(512);
  });

  it("caps oversized requests at the largest variant", () => {
    expect(thumbSize(9999)).toBe(512);
  });
});

describe("serveArt", () => {
  it("resizes a large source into a cached webp thumbnail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    const art = join(dir, "cover.png");
    // A 1280x720 source, mirroring the real grainy-when-small case.
    await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: { r: 80, g: 20, b: 120 },
      },
    })
      .png()
      .toFile(art);

    const res = fakeRes();
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    const ended = new Promise((r) => res.on("end", r));

    await serveArt(res, art, "image/png", "128");
    await ended;

    const body = Buffer.concat(chunks);
    expect(res.headers["Content-Type"]).toBe("image/webp");
    expect(existsSync(join(dir, "thumbs"))).toBe(true);
    // The thumbnail is a real, non-empty 128px WebP, far smaller than the source.
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(128);
  });

  it("serves the original image when no size is requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    const art = join(dir, "cover.png");
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toFile(art);

    const res = fakeRes();
    const ended = new Promise((r) => res.on("end", r));
    res.resume();
    await serveArt(res, art, "image/png", undefined);
    await ended;

    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(existsSync(join(dir, "thumbs"))).toBe(false);
  });
});
