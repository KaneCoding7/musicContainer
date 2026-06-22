import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "music-metadata";

export interface ExtractedMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  artFilename: string | null;
  duration: number | null;
  sourceUrl: string | null;
}

// Reads ID3/Vorbis tags from an audio file. Any embedded cover art is written
// into artDir and its filename returned. Parsing failures degrade gracefully —
// a song with unreadable tags still uploads. `title` + `sourceUrl` let a song
// downloaded from one instance round-trip its name/link when re-uploaded to
// another (we stash the source link in the comment field on download).
export async function extractMetadata(
  audioPath: string,
  artDir: string
): Promise<ExtractedMetadata> {
  try {
    const { common, format, native } = await parseFile(audioPath);

    let artFilename: string | null = null;
    const picture = common.picture?.[0];
    if (picture) {
      const fmt = picture.format?.toLowerCase() ?? "";
      const ext = fmt.includes("png")
        ? "png"
        : fmt.includes("webp")
          ? "webp"
          : "jpg";
      artFilename = `${randomUUID()}.${ext}`;
      writeFileSync(join(artDir, artFilename), Buffer.from(picture.data));
    }

    // The source link is stored on download in a custom TXXX:SOURCE_URL frame
    // (with a plain comment as a fallback). Recover whichever looks like a URL.
    const asText = (v: unknown): string | null =>
      typeof v === "string"
        ? v
        : (v as { text?: string } | undefined)?.text ?? null;
    const isUrl = (s: string | null): s is string =>
      !!s && /^https?:\/\/\S+$/i.test(s.trim());

    let sourceUrl: string | null = null;
    for (const tags of Object.values(native ?? {})) {
      for (const t of tags as { id: string; value: unknown }[]) {
        if (t.id?.toUpperCase() === "TXXX:SOURCE_URL") {
          const raw = asText(t.value);
          if (!raw) continue;
          // base64url-decoded first (how we write it), else the raw value.
          let decoded: string | null = null;
          try {
            decoded = Buffer.from(raw.trim(), "base64url").toString("utf8");
          } catch {
            /* not base64 */
          }
          if (isUrl(decoded)) sourceUrl = decoded.trim();
          else if (isUrl(raw)) sourceUrl = raw.trim();
          if (sourceUrl) break;
        }
      }
      if (sourceUrl) break;
    }
    if (!sourceUrl) {
      const c = asText(common.comment?.[0] as unknown);
      if (isUrl(c)) sourceUrl = c.trim();
    }

    return {
      title: common.title ?? null,
      artist: common.artist ?? null,
      album: common.album ?? null,
      artFilename,
      duration: format.duration ?? null,
      sourceUrl,
    };
  } catch {
    return {
      title: null,
      artist: null,
      album: null,
      artFilename: null,
      duration: null,
      sourceUrl: null,
    };
  }
}
