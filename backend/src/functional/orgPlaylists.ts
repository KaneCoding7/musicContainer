import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { ART_DIR } from "../db/init.js";
import { err, ok, type Result } from "./result.js";
import type { SharedPlaylist } from "./shares.js";

// Detects a real raster image from its magic bytes, returning the file
// extension. Rejects .ico (favicons) and anything else so we only keep proper
// PNG/JPEG/WebP logos that browsers render well as covers.
function imageExt(buf: Buffer): ".png" | ".jpg" | ".webp" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP")
    return ".webp";
  return null;
}

// Fetch a domain's logo from fixed-host logo/icon services (SSRF-safe: the
// request always goes to the service; the domain is only a parameter, so it
// can't be pointed at internal hosts). Tries higher-quality logo sources first,
// accepts the first real PNG/JPEG/WebP above a min size, and skips .ico and
// tiny placeholders. Returns the bytes + extension, or null if none found.
async function fetchDomainLogo(
  domain: string
): Promise<{ buf: Buffer; ext: string } | null> {
  const d = encodeURIComponent(domain);
  const sources = [
    `https://unavatar.io/${d}?fallback=false`,
    `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=256`,
    `https://www.google.com/s2/favicons?domain=${d}&sz=256`,
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
  ];
  for (const url of sources) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(t);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length <= 1000) continue; // tiny/generic placeholder
      const ext = imageExt(buf);
      if (ext) return { buf, ext };
    } catch {
      // try the next source
    }
  }
  return null;
}

// The email domain (lowercased part after "@") for a user, or null if unknown.
export function domainOf(db: Database, userId: string): string | null {
  const row = db
    .prepare('SELECT email FROM "user" WHERE id = ?')
    .get(userId) as { email: string } | undefined;
  if (!row?.email) return null;
  const at = row.email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = row.email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

// "omnitech-inc.com" -> "Omnitech-inc Team". Uses the second-level label.
export function orgPlaylistName(domain: string): string {
  const label = domain.split(".")[0] || domain;
  const titled = label.charAt(0).toUpperCase() + label.slice(1);
  return `${titled} Team`;
}

// Fetches the domain's logo and saves it into ART_DIR, returning the stored
// filename (or null if no logo was found / the write failed).
async function saveDomainLogo(domain: string): Promise<string | null> {
  const logo = await fetchDomainLogo(domain);
  if (!logo) return null;
  const filename = `${randomUUID()}${logo.ext}`;
  try {
    writeFileSync(join(ART_DIR, filename), logo.buf);
    return filename;
  } catch {
    return null;
  }
}

// Returns the id of the domain's Team playlist, creating it if missing. On
// first creation we best-effort brand it with the company's logo (from the
// domain). The unique index on org_domain guarantees one per domain.
export async function ensureOrgPlaylist(
  db: Database,
  domain: string
): Promise<number> {
  const existing = db
    .prepare(
      "SELECT id, image_filename, org_logo_tried FROM playlists WHERE org_domain = ?"
    )
    .get(domain) as
    | { id: number; image_filename: string | null; org_logo_tried: number }
    | undefined;
  if (existing) {
    // Backfill the logo once for playlists that don't have a cover yet.
    if (!existing.image_filename && existing.org_logo_tried === 0) {
      const saved = await saveDomainLogo(domain);
      db.prepare(
        "UPDATE playlists SET image_filename = ?, org_logo_tried = 1 WHERE id = ?"
      ).run(saved, existing.id);
    }
    return existing.id;
  }

  // New playlist — best-effort logo as the cover (falls back to track art).
  const imageFilename = await saveDomainLogo(domain);

  try {
    const info = db
      .prepare(
        "INSERT INTO playlists (name, org_domain, user_id, image_filename, org_logo_tried) VALUES (?, ?, NULL, ?, 1)"
      )
      .run(orgPlaylistName(domain), domain, imageFilename);
    return Number(info.lastInsertRowid);
  } catch {
    // Lost a creation race — the row now exists; fetch it.
    const row = db
      .prepare("SELECT id FROM playlists WHERE org_domain = ?")
      .get(domain) as { id: number } | undefined;
    if (row) return row.id;
    throw new Error("Failed to create org playlist");
  }
}

// True if the playlist is an org playlist whose domain matches the user's.
export function isOrgMemberOf(
  db: Database,
  playlistId: number,
  userId: string
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS x
         FROM playlists p
         JOIN "user" u ON u.id = ?
        WHERE p.id = ?
          AND p.org_domain IS NOT NULL
          AND lower(substr(u.email, instr(u.email, '@') + 1)) = p.org_domain
        LIMIT 1`
    )
    .get(userId, playlistId);
  return !!row;
}

// True if the song sits in an org playlist the user belongs to (lets members
// play tracks others added).
export function songInUserOrgPlaylist(
  db: Database,
  userId: string,
  songId: number
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS x
         FROM playlist_songs ps
         JOIN playlists p ON p.id = ps.playlist_id
         JOIN "user" u ON u.id = ?
        WHERE ps.song_id = ?
          AND p.org_domain IS NOT NULL
          AND lower(substr(u.email, instr(u.email, '@') + 1)) = p.org_domain
        LIMIT 1`
    )
    .get(userId, songId);
  return !!row;
}

// The user's org (Team) playlist as a SharedPlaylist, auto-creating it. Returns
// an empty list if the user has no resolvable domain.
export async function listOrgPlaylistsForUser(
  db: Database,
  userId: string
): Promise<Result<SharedPlaylist[]>> {
  try {
    const domain = domainOf(db, userId);
    if (!domain) return ok([]);
    await ensureOrgPlaylist(db, domain);
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.image_filename,
                (SELECT COUNT(*) FROM playlist_songs x WHERE x.playlist_id = p.id)
                  AS track_count,
                (SELECT x.song_id FROM playlist_songs x
                   JOIN songs s ON s.id = x.song_id
                   WHERE x.playlist_id = p.id AND s.art_filename IS NOT NULL
                   ORDER BY x.position ASC LIMIT 1) AS cover_song_id
           FROM playlists p
          WHERE p.org_domain = ?`
      )
      .all(domain) as {
      id: number;
      name: string;
      created_at: string;
      image_filename: string | null;
      track_count: number;
      cover_song_id: number | null;
    }[];
    return ok(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        ownerName: domain,
        canEdit: true, // any member may add tracks
        savedCopyId: null,
        trackCount: r.track_count,
        coverSongId: r.cover_song_id,
        hasImage: !!r.image_filename,
        isOrg: true,
      }))
    );
  } catch (e) {
    return err("internal", `Failed to list org playlists: ${(e as Error).message}`);
  }
}
