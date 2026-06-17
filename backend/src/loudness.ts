import { spawn } from "node:child_process";

// Measures a track's integrated loudness in LUFS using ffmpeg's EBU R128 meter.
// Returns null if ffmpeg is unavailable or the file can't be analyzed, so a
// failure never blocks upload — the track just won't be normalized.
//
// We run: ffmpeg -nostats -i <file> -af ebur128 -f null -
// and parse the "Integrated loudness: I: -14.2 LUFS" summary from stderr.
export function measureLoudness(audioPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let stderr = "";
    let proc;
    try {
      proc = spawn("ffmpeg", [
        "-nostats",
        "-hide_banner",
        "-i",
        audioPath,
        "-af",
        "ebur128",
        "-f",
        "null",
        "-",
      ]);
    } catch {
      return resolve(null);
    }

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // Keep only the tail; the meter prints continuously.
      if (stderr.length > 100_000) stderr = stderr.slice(-50_000);
    });
    proc.on("error", () => resolve(null)); // e.g. ffmpeg not installed
    proc.on("close", () => {
      // The summary block at the end contains: "I:  -14.2 LUFS".
      const matches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
      const last = matches.at(-1);
      if (!last) return resolve(null);
      const lufs = Number(last[1]);
      // ffmpeg reports -70 (or lower) for silence/failure; treat as unusable.
      if (!Number.isFinite(lufs) || lufs <= -70) return resolve(null);
      resolve(lufs);
    });
  });
}
