import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "music-metadata";

export interface ExtractedMetadata {
  artist: string | null;
  album: string | null;
  artFilename: string | null;
  duration: number | null;
}

// Reads ID3/Vorbis tags from an audio file. Any embedded cover art is written
// into artDir and its filename returned. Parsing failures degrade gracefully —
// a song with unreadable tags still uploads.
export async function extractMetadata(
  audioPath: string,
  artDir: string
): Promise<ExtractedMetadata> {
  try {
    const { common, format } = await parseFile(audioPath);

    let artFilename: string | null = null;
    const picture = common.picture?.[0];
    if (picture) {
      const ext = picture.format?.toLowerCase().includes("png") ? "png" : "jpg";
      artFilename = `${randomUUID()}.${ext}`;
      writeFileSync(join(artDir, artFilename), Buffer.from(picture.data));
    }

    return {
      artist: common.artist ?? null,
      album: common.album ?? null,
      artFilename,
      duration: format.duration ?? null,
    };
  } catch {
    return { artist: null, album: null, artFilename: null, duration: null };
  }
}
