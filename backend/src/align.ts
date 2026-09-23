import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { franc } from "franc";

// aeneas runs in its own venv (isolated numpy<2) — see the Dockerfile.
const AENEAS_PY = "/opt/aeneas/bin/python";

// espeak/aeneas languages we trust franc to pick (ISO 639-3, matches aeneas's
// task_language codes). Anything else falls back to English.
const SUPPORTED = new Set([
  "eng", "spa", "por", "fra", "deu", "ita", "nld", "cat",
  "pol", "rus", "cmn", "jpn", "kor", "swe", "nor", "dan",
]);

function detectLang(text: string): string {
  const code = franc(text, { minLength: 10 });
  return SUPPORTED.has(code) ? code : "eng";
}

function toLrcTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `[${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}]`;
}

interface AeneasFragment {
  begin?: string;
  lines?: string[];
}

// Force-aligns plain lyrics to the song's audio and returns a synced LRC string,
// or null if it can't. CPU-based (aeneas + espeak); ~a few seconds per track.
// Never throws.
export function alignLyrics(
  audioPath: string,
  plainText: string
): Promise<{ synced: string } | null> {
  const lines = plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return Promise.resolve(null); // nothing to align
  const lang = detectLang(plainText);

  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "align-"));
    const txt = join(dir, "lyrics.txt");
    const out = join(dir, "out.json");
    const done = (v: { synced: string } | null) => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    try {
      writeFileSync(txt, lines.join("\n"));
    } catch {
      return done(null);
    }
    const child = execFile(
      AENEAS_PY,
      [
        "-m",
        "aeneas.tools.execute_task",
        audioPath,
        txt,
        `task_language=${lang}|is_text_type=plain|os_task_file_format=json`,
        out,
      ],
      { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      () => {
        try {
          const data = JSON.parse(readFileSync(out, "utf8")) as {
            fragments?: AeneasFragment[];
          };
          const lrc = (data.fragments ?? [])
            .filter((f) => f.lines && f.lines[0] && f.lines[0].trim())
            .map((f) => `${toLrcTime(parseFloat(f.begin ?? "0"))}${f.lines![0]}`)
            .join("\n");
          if (lrc && /\[\d/.test(lrc)) return done({ synced: lrc });
        } catch {
          /* parse/read failure */
        }
        done(null);
      }
    );
    child.on("error", () => done(null)); // aeneas missing / spawn error
  });
}
