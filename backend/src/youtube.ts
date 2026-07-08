// Thin yt-dlp helpers for YouTube-sourced suggestions. Kept separate from the
// song routes so the suggestion layer can pull "what plays next on YouTube"
// without depending on the HTTP layer. Anonymous — no API key needed.
import { spawn } from "node:child_process";

export interface YtEntry {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  url: string;
}

// Extracts an 11-char YouTube video id from a watch/short/embed/youtu.be URL.
// Returns null for non-YouTube links (e.g. Spotify sources) or unparseable ids.
export function parseYouTubeId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

// Fetches YouTube's autoplay "Mix" (radio) for a seed video — the same related
// stream that plays next on youtube.com — as lightweight metadata, no download.
// `--flat-playlist` reads only the mix listing; `--playlist-end` caps the
// (effectively infinite) mix. The seed itself is dropped from the results. All
// args are argv (no shell), so `videoId` can't inject flags. Best-effort:
// returns [] on any error or an unparseable/empty mix.
export function ytRelated(videoId: string, limit = 15): Promise<YtEntry[]> {
  return new Promise((resolve) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return resolve([]);
    const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    const child = spawn(
      "yt-dlp",
      [
        mixUrl,
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--playlist-end",
        String(limit + 1), // +1 because the seed is usually the first entry
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", () => {});

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve([]);
    }, 30_000);

    child.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const results: YtEntry[] = [];
      for (const line of out.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
          const o = JSON.parse(s);
          const id = typeof o.id === "string" ? o.id : null;
          if (!id || id === videoId) continue; // skip the seed track itself
          results.push({
            id,
            title: typeof o.title === "string" ? o.title : id,
            uploader:
              (typeof o.uploader === "string" && o.uploader) ||
              (typeof o.channel === "string" && o.channel) ||
              null,
            duration: typeof o.duration === "number" ? o.duration : null,
            url: `https://www.youtube.com/watch?v=${id}`,
          });
        } catch {
          /* skip malformed line */
        }
      }
      resolve(results.slice(0, limit));
    });
  });
}
