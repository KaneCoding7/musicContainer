// Domain types shared across the frontend (mirror of the backend API shapes).

export interface Song {
  id: number;
  filename: string;
  originalFilename: string;
  uploadedAt: string;
  artist: string | null;
  album: string | null;
  hasArt: boolean;
  duration: number | null;
  playCount: number;
  lastPlayedAt: string | null;
  liked: boolean;
  loudness: number | null; // integrated loudness (LUFS) for normalization
  sortOrder: number | null; // manual order within a grouping (e.g. artist)
  hasSource: boolean; // imported from a video link (can offer frame artwork)
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string;
  trackCount?: number;
  coverSongId?: number | null;
}

export interface ApiError {
  code: string;
  message: string;
}
