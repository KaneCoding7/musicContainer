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
  liked: boolean;
  loudness: number | null; // integrated loudness in LUFS, for normalization
  sortOrder: number | null; // manual order within a grouping (e.g. artist)
  hasSource: boolean; // imported from a video link (can offer frame artwork)
  hasClip: boolean; // has a cached looping canvas clip (from the source video)
  clipDisabled: boolean; // per-song opt-out: don't show this song's clip
  sourceUrl: string | null; // the original import link (e.g. YouTube), if any
  addedBy?: string | null; // name of who added it to a playlist (playlist views)
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string; // ISO timestamp
  trackCount?: number; // populated by list queries
  coverSongId?: number | null; // first track with album art, for the cover
}
