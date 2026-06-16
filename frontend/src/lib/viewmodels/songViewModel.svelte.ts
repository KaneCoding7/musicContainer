// ViewModel: owns song-list state and the operations the UI triggers.
// Uses Svelte 5 runes ($state) for reactive state in a plain class.
import { deleteSong, fetchSongs, uploadSong } from "$lib/services/songService";
import type { Song } from "$lib/types";

export class SongViewModel {
  songs = $state<Song[]>([]);
  loading = $state(false);
  uploading = $state(false);
  error = $state<string | null>(null);

  // Search query for filtering the library (Cycle 5).
  query = $state("");

  // The library filtered by the current query (case-insensitive name match).
  get filteredSongs(): Song[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.songs;
    return this.songs.filter((s) =>
      s.originalFilename.toLowerCase().includes(q)
    );
  }

  // --- Player state (Cycles 2 & 3) ---
  // The player plays from a queue, which may be the whole library or a
  // playlist's songs (in order).
  queue = $state<Song[]>([]);
  currentIndex = $state<number | null>(null);
  isPlaying = $state(false);

  // The song currently loaded in the player, if any.
  get currentSong(): Song | null {
    if (this.currentIndex === null) return null;
    return this.queue[this.currentIndex] ?? null;
  }

  // Plays an arbitrary list of songs starting at the given index.
  playQueue(songs: Song[], index: number): void {
    if (index < 0 || index >= songs.length) return;
    this.queue = songs;
    this.currentIndex = index;
    this.isPlaying = true;
  }

  // Plays from the full library list (used by the song list).
  play(index: number): void {
    this.playQueue(this.songs, index);
  }

  // Deletes a song from the library and reconciles the play queue.
  async remove(id: number): Promise<void> {
    this.error = null;
    try {
      await deleteSong(id);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to delete song";
      return;
    }

    const wasCurrent = this.currentSong?.id === id;
    this.songs = this.songs.filter((s) => s.id !== id);

    const queueIdx = this.queue.findIndex((s) => s.id === id);
    if (queueIdx !== -1) {
      this.queue = this.queue.filter((s) => s.id !== id);
      if (wasCurrent) {
        // Stop playback; the loaded track no longer exists.
        this.currentIndex = null;
        this.isPlaying = false;
      } else if (this.currentIndex !== null && queueIdx < this.currentIndex) {
        // Keep pointing at the same song now that earlier entries shifted.
        this.currentIndex -= 1;
      }
    }
  }

  // Advances to the next song in the queue; false if already at the end.
  next(): boolean {
    if (this.currentIndex === null) return false;
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex += 1;
      this.isPlaying = true;
      return true;
    }
    return false;
  }

  // Goes back to the previous song; false if already at the start.
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
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Upload failed";
      return false;
    } finally {
      this.uploading = false;
    }
  }
}
