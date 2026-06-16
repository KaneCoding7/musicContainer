// Shared domain types for the music server.

export interface Song {
  id: number;
  filename: string; // actual file stored on disk
  originalFilename: string; // user-facing name
  uploadedAt: string; // ISO timestamp
  artist: string | null;
  album: string | null;
  hasArt: boolean; // whether embedded album art was extracted
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string; // ISO timestamp
}
