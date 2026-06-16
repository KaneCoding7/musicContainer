// Shared domain types for the music server.

export interface Song {
  id: number;
  filename: string; // actual file stored on disk
  originalFilename: string; // user-facing name
  uploadedAt: string; // ISO timestamp
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string; // ISO timestamp
}
