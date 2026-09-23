import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fetch time-synced (LRC) lyrics from the `syncedlyrics` multi-provider tool
// (Musixmatch, NetEase, Megalobiz, …) — the fallback for tracks LRCLIB has no
// synced version of. Returns raw LRC (with timestamps) or null. Never throws.
export function fetchSyncedFromProviders(
  artist: string | null | undefined,
  track: string | null | undefined
): Promise<string | null> {
  const a = (artist ?? "").trim();
  const t = (track ?? "").trim();
  if (!a || !t) return Promise.resolve(null);

  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "lrc-"));
    const out = join(dir, "out.lrc");
    const done = (val: string | null) => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    const child = execFile(
      "syncedlyrics",
      ["--synced-only", "-o", out, `${a} ${t}`],
      { timeout: 25000 },
      () => {
        try {
          if (existsSync(out)) {
            const lrc = readFileSync(out, "utf8").trim();
            // Only accept genuine LRC (has [mm:ss] timestamps).
            if (lrc && /\[\d{1,2}:\d{2}/.test(lrc)) return done(lrc);
          }
        } catch {
          /* ignore */
        }
        done(null);
      }
    );
    child.on("error", () => done(null)); // e.g. binary missing
  });
}
