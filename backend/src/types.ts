// Shared domain types for the music server.

export interface Song {
  id: number;
  filename: string; // actual file stored on disk
  originalFilename: string; // user-facing name
  uploadedAt: string; // ISO timestamp
  artist: string | null;
  album: string | null;
  hasArt: boolean; // whether embedded album art was extracted
  duration: number | null; // seconds, if known
  playCount: number;
  lastPlayedAt: string | null; // ISO timestamp of last play
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string; // ISO timestamp
  trackCount?: number; // populated by list queries
  coverSongId?: number | null; // first track with album art, for the cover
}
