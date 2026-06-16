// Domain types shared across the frontend (mirror of the backend API shapes).

export interface Song {
  id: number;
  filename: string;
  originalFilename: string;
  uploadedAt: string;
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: string;
}

export interface ApiError {
  code: string;
  message: string;
}
