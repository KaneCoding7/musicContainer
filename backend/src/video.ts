// "Upload video as song": turns an uploaded video file into an MP3 by
// extracting its first audio track with ffmpeg. The whole video is converted
// (no trimming), the same as a YouTube link import.
import { spawn } from "node:child_process";
import { statfsSync } from "node:fs";

export type ExtractResult = { ok: true } | { ok: false; message: string };

// Maps ffmpeg's stderr to a user-facing reason. Exported for tests.
export function describeFfmpegFailure(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("matches no streams") || s.includes("does not contain any stream"))
    return "That video has no audio track";
  if (
    s.includes("invalid data found") ||
    s.includes("moov atom not found") ||
    s.includes("could not find codec parameters") ||
    s.includes("end of file") ||
    s.includes("error while decoding")
  )
    return "That file couldn't be read as a video (it may be corrupt or incomplete)";
  return "Couldn't extract audio from that video";
}

// ffmpeg argv for the extraction. `-map 0:a:0` takes the first audio stream
// only and fails cleanly when there is none. `-map_metadata -1` drops the
// container metadata: iPhone recordings embed GPS location and device info,
// which shouldn't leak into a song file that can be shared or downloaded.
// Exported for tests.
export function extractArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2", // VBR ~190 kbps, the same as yt-dlp's default MP3 import quality
    "-f",
    "mp3",
    "-y",
    output,
  ];
}

// Extracts the audio of `input` into an MP3 at `output`. Never rejects: the
// failure reason comes back as a message. The input path is argv (no shell).
export function extractAudioFromVideo(
  input: string,
  output: string,
  timeoutMs = 10 * 60 * 1000
): Promise<ExtractResult> {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const done = (r: ExtractResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn("ffmpeg", extractArgs(input, output), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ ok: false, message: "Converting that video took too long" });
    }, timeoutMs);
    child.on("error", () =>
      done({ ok: false, message: "Video conversion is unavailable on this server" })
    );
    child.on("close", (code) => {
      if (code === 0) return done({ ok: true });
      done({ ok: false, message: describeFfmpegFailure(stderr) });
    });
  });
}

// Free bytes on the filesystem holding `dir`, or null if it can't be read.
export function freeBytes(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
