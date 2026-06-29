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
  albumSortOrder: number | null; // manual order within an album grouping
  hasSource: boolean; // imported from a video link (can offer frame artwork)
  hasClip: boolean; // has a cached looping canvas clip (shown in expanded player)
  clipDisabled: boolean; // per-song opt-out: don't show this song's clip
  sourceUrl: string | null; // the original import link (e.g. YouTube), if any
  addedBy?: string | null; // name of who added it to a playlist (playlist views)
  addedByMe?: boolean; // viewer added this track (org/team playlists)
  ownedByMe?: boolean; // viewer owns the underlying song (shared/org playlists)
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string;
  trackCount?: number;
  coverSongId?: number | null;
  hasImage?: boolean;
  copiedFrom?: number | null; // source playlist id, if saved from a share
  copiedFromOwner?: string | null; // name of who owns the source playlist
  shared?: boolean; // owner has shared this with at least one other user
  isGlobal?: boolean; // shared with every user on the system
}

export interface ApiError {
  code: string;
  message: string;
}
