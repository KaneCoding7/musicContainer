import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Resolve data locations from the environment so the same code runs locally
// and inside Docker (where DATA_DIR=/data).
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "..", "data");
export const MUSIC_DIR = join(DATA_DIR, "music");
export const ART_DIR = join(DATA_DIR, "art");
const DB_PATH = join(DATA_DIR, "app.db");

let db: Database.Database | null = null;

// Returns a singleton database connection, creating the schema and required
// directories on first use.
export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(MUSIC_DIR, { recursive: true });
  mkdirSync(ART_DIR, { recursive: true });
  mkdirSync(dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      filename          TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      uploaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist
      ON playlist_songs(playlist_id, position);
  `);

  // Metadata columns added post-MVP (Cycle 9). Added conditionally so existing
  // databases upgrade in place.
  const columns = (
    database.prepare("PRAGMA table_info(songs)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!columns.includes("artist")) {
    database.exec("ALTER TABLE songs ADD COLUMN artist TEXT");
  }
  if (!columns.includes("album")) {
    database.exec("ALTER TABLE songs ADD COLUMN album TEXT");
  }
  if (!columns.includes("art_filename")) {
    database.exec("ALTER TABLE songs ADD COLUMN art_filename TEXT");
  }
  if (!columns.includes("duration")) {
    database.exec("ALTER TABLE songs ADD COLUMN duration REAL");
  }
  if (!columns.includes("play_count")) {
    database.exec(
      "ALTER TABLE songs ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!columns.includes("last_played_at")) {
    database.exec("ALTER TABLE songs ADD COLUMN last_played_at TEXT");
  }
  if (!columns.includes("liked")) {
    database.exec("ALTER TABLE songs ADD COLUMN liked INTEGER NOT NULL DEFAULT 0");
  }
}
