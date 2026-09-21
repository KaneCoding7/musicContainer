// Minimal LRC parser. Turns a raw LRC string ("[mm:ss.xx] line") into a sorted
// list of timed lines for the synced-lyrics view. Tolerates multiple timestamps
// per line, [mm:ss] without centis, and skips metadata tags ([ar:], [ti:], …).

export interface LyricLine {
  t: number; // seconds
  text: string;
}

const TIME_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(raw)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      stamps.push(min * 60 + sec + frac);
    }
    if (stamps.length === 0) continue; // metadata tag or plain line — skip
    const text = raw.replace(TIME_TAG, "").trim();
    for (const t of stamps) out.push({ t, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Index of the active line for a given playback time (the last line whose
// timestamp is <= t), or -1 before the first line. Assumes `lines` is sorted.
export function activeLineIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
