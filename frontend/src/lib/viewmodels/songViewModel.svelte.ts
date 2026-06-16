// ViewModel: owns song-list state and the operations the UI triggers.
// Uses Svelte 5 runes ($state) for reactive state in a plain class.
import { fetchSongs, uploadSong } from "$lib/services/songService";
import type { Song } from "$lib/types";

export class SongViewModel {
  songs = $state<Song[]>([]);
  loading = $state(false);
  uploading = $state(false);
  error = $state<string | null>(null);

  // --- Player state (Cycle 2) ---
  currentIndex = $state<number | null>(null);
  isPlaying = $state(false);

  // The song currently loaded in the player, if any.
  get currentSong(): Song | null {
    if (this.currentIndex === null) return null;
    return this.songs[this.currentIndex] ?? null;
  }

  // Selects a song to play by its list index.
  play(index: number): void {
    if (index < 0 || index >= this.songs.length) return;
    this.currentIndex = index;
    this.isPlaying = true;
  }

  // Advances to the next song; returns false if already at the end.
  next(): boolean {
    if (this.currentIndex === null) return false;
    if (this.currentIndex < this.songs.length - 1) {
      this.currentIndex += 1;
      this.isPlaying = true;
      return true;
    }
    return false;
  }

  // Goes back to the previous song; returns false if already at the start.
  prev(): boolean {
    if (this.currentIndex === null) return false;
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.isPlaying = true;
      return true;
    }
    return false;
  }

  // Loads the song list from the backend.
  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.songs = await fetchSongs();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load songs";
    } finally {
      this.loading = false;
    }
  }

  // Uploads a file, then refreshes the list. Returns true on success.
  async upload(file: File): Promise<boolean> {
    this.uploading = true;
    this.error = null;
    try {
      const song = await uploadSong(file);
      this.songs = [song, ...this.songs];
      // Keep the player pointed at the same song now that indices shifted.
      if (this.currentIndex !== null) this.currentIndex += 1;
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Upload failed";
      return false;
    } finally {
      this.uploading = false;
    }
  }
}
