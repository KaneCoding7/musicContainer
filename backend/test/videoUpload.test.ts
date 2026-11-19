import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateVideoUpload, videoSongTitle } from "../src/functional/songs.js";
import {
  describeFfmpegFailure,
  extractArgs,
  extractAudioFromVideo,
  freeBytes,
} from "../src/video.js";

describe("validateVideoUpload", () => {
  it("accepts iPhone MOV and MP4 with their usual MIME types", () => {
    expect(validateVideoUpload("IMG_1234.MOV", "video/quicktime").ok).toBe(true);
    expect(validateVideoUpload("clip.mp4", "video/mp4").ok).toBe(true);
    expect(validateVideoUpload("clip.m4v", "video/x-m4v").ok).toBe(true);
    expect(validateVideoUpload("clip.webm", "video/webm").ok).toBe(true);
    expect(validateVideoUpload("clip.mkv", "video/x-matroska").ok).toBe(true);
  });

  it("tolerates a missing or generic MIME type when the extension is a video", () => {
    expect(validateVideoUpload("clip.mov", "").ok).toBe(true);
    expect(validateVideoUpload("clip.mkv", "application/octet-stream").ok).toBe(true);
  });

  it("rejects non-video extensions", () => {
    for (const name of ["song.mp3", "photo.jpg", "script.sh", "noext"]) {
      const r = validateVideoUpload(name, "video/mp4");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("validation");
    }
  });

  it("rejects a video extension with a clearly non-video MIME type", () => {
    expect(validateVideoUpload("clip.mp4", "text/html").ok).toBe(false);
    expect(validateVideoUpload("clip.mov", "image/png").ok).toBe(false);
  });
});

describe("videoSongTitle", () => {
  it("prefers an explicit title, trimmed", () => {
    expect(videoSongTitle("IMG_1.MOV", "  Guitar take  ")).toBe("Guitar take");
  });
  it("falls back to the filename without its extension", () => {
    expect(videoSongTitle("IMG_1234.MOV")).toBe("IMG_1234");
    expect(videoSongTitle("my.song.take.mp4", "   ")).toBe("my.song.take");
  });
  it("never returns an empty title", () => {
    expect(videoSongTitle(".mov")).toBe("Untitled video");
  });
  it("caps very long titles", () => {
    expect(videoSongTitle("a.mov", "x".repeat(1000)).length).toBe(300);
  });
});

describe("ffmpeg helpers", () => {
  it("maps only the first audio stream and strips container metadata", () => {
    const a = extractArgs("/in/source.mov", "/out/audio.mp3");
    expect(a.slice(a.indexOf("-map"), a.indexOf("-map") + 2)).toEqual(["-map", "0:a:0"]);
    expect(a).toContain("-vn");
    expect(a.slice(a.indexOf("-map_metadata"), a.indexOf("-map_metadata") + 2)).toEqual([
      "-map_metadata",
      "-1",
    ]);
    expect(a.at(-1)).toBe("/out/audio.mp3");
    expect(a[a.indexOf("-i") + 1]).toBe("/in/source.mov");
  });

  it("describes common failures in plain language", () => {
    expect(describeFfmpegFailure("Stream map '0:a:0' matches no streams.")).toMatch(
      /no audio track/
    );
    expect(describeFfmpegFailure("moov atom not found")).toMatch(/corrupt/);
    expect(describeFfmpegFailure("source.mov: Invalid data found when processing input")).toMatch(
      /corrupt/
    );
    expect(describeFfmpegFailure("something else")).toMatch(/Couldn't extract/);
  });

  it("reports free disk space for an existing dir and null for a missing one", () => {
    expect(freeBytes(tmpdir())).toBeGreaterThan(0);
    expect(freeBytes("/definitely/not/a/real/dir")).toBeNull();
  });
});

// Real conversions — only where ffmpeg is installed (the backend image has it).
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("extractAudioFromVideo (real ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "video-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const make = (name: string, args: string[]) => {
    const p = join(dir, name);
    const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args, p]);
    expect(r.status).toBe(0);
    return p;
  };

  it("extracts the audio of a MOV with video + AAC audio", async () => {
    const src = make("withaudio.mov", [
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-metadata", "location=+40.0000-074.0000/",
      "-c:v", "mpeg4", "-c:a", "aac", "-shortest",
    ]);
    const out = join(dir, "withaudio.mp3");
    expect(await extractAudioFromVideo(src, out)).toEqual({ ok: true });
    expect(statSync(out).size).toBeGreaterThan(10_000);
    const probe = spawnSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name:format_tags",
      "-of", "json", out,
    ]);
    const info = JSON.parse(probe.stdout.toString());
    expect(info.streams.map((s: { codec_type: string }) => s.codec_type)).toEqual(["audio"]);
    expect(info.streams[0].codec_name).toBe("mp3");
    expect(JSON.stringify(info.format?.tags ?? {})).not.toMatch(/location|40\.0000/);
  });

  it("extracts the audio of an MP4", async () => {
    const src = make("clip.mp4", [
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=220:duration=2",
      "-c:v", "mpeg4", "-c:a", "aac", "-shortest",
    ]);
    const out = join(dir, "clip.mp3");
    expect(await extractAudioFromVideo(src, out)).toEqual({ ok: true });
    expect(existsSync(out)).toBe(true);
  });

  it("fails cleanly on a video with no audio track", async () => {
    const src = make("silent.mp4", [
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1", "-c:v", "mpeg4",
    ]);
    const r = await extractAudioFromVideo(src, join(dir, "silent.mp3"));
    expect(r).toEqual({ ok: false, message: "That video has no audio track" });
  });

  it("fails cleanly on a corrupt file", async () => {
    const src = join(dir, "corrupt.mov");
    writeFileSync(src, Buffer.from("this is not a video at all".repeat(100)));
    const r = await extractAudioFromVideo(src, join(dir, "corrupt.mp3"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/corrupt|Couldn't extract/);
  });
});
