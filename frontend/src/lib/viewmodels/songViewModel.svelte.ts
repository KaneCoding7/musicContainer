// ViewModel: owns song-list state and the operations the UI triggers.
// Uses Svelte 5 runes ($state) for reactive state in a plain class.
import {
  deleteSong,
  fetchSongs,
  recordPlay,
  setLiked,
  updateSongMeta,
  uploadSong,
  type SongMetadata,
} from "$lib/services/songService";
import type { Song } from "$lib/types";

export class SongViewModel {
  songs = $state<Song[]>([]);
  loading = $state(false);
  uploading = $state(false);
  // Batch upload progress (Cycle 28).
  uploadDone = $state(0);
  uploadTotal = $state(0);
  error = $state<string | null>(null);

  // Search query for filtering the library (Cycle 5).
  query = $state("");

  // The library filtered by the current query (case-insensitive match across
  // song name, artist, and album).
  get filteredSongs(): Song[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.songs;
    return this.songs.filter(
      (s) =>
        s.originalFilename.toLowerCase().includes(q) ||
        (s.artist?.toLowerCase().includes(q) ?? false) ||
        (s.album?.toLowerCase().includes(q) ?? false)
    );
  }

  // Songs that have been played, most-recently-played first.
  get recentlyPlayed(): Song[] {
    return this.songs
      .filter((s) => s.lastPlayedAt !== null)
      .sort((a, b) => (a.lastPlayedAt! < b.lastPlayedAt! ? 1 : -1));
  }

  // Liked songs.
  get likedSongs(): Song[] {
    return this.songs.filter((s) => s.liked);
  }

  // --- Player state (Cycles 2 & 3) ---
  // The player plays from a queue, which may be the whole library or a
  // playlist's songs (in order).
  queue = $state<Song[]>([]);
  currentIndex = $state<number | null>(null);
  isPlaying = $state(false);

  // Playback modes (Cycle 7).
  shuffle = $state(false);
  repeat = $state<"off" | "all" | "one">("off");

  // Volume 0..1 (Cycle 11; lives here so keyboard shortcuts can adjust it).
  volume = $state(1);

  togglePlay(): void {
    if (this.currentSong) this.isPlaying = !this.isPlaying;
  }

  // Adjusts volume by delta, clamped to [0, 1].
  adjustVolume(delta: number): void {
    this.volume = Math.min(1, Math.max(0, this.volume + delta));
  }

  toggleShuffle(): void {
    this.shuffle = !this.shuffle;
  }

  // Cycles repeat off -> all -> one -> off.
  cycleRepeat(): void {
    this.repeat =
      this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
  }

  // Picks the next index honoring shuffle + repeat; null means "stop".
  private nextIndex(): number | null {
    if (this.currentIndex === null || this.queue.length === 0) return null;
    if (this.shuffle && this.queue.length > 1) {
      let r = this.currentIndex;
      while (r === this.currentIndex) {
        r = Math.floor(Math.random() * this.queue.length);
      }
      return r;
    }
    const n = this.currentIndex + 1;
    if (n < this.queue.length) return n;
    return this.repeat === "all" ? 0 : null;
  }

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

  // Toggles a song's liked flag (optimistic; reverts on failure).
  async toggleLike(id: number): Promise<void> {
    const target = this.songs.find((s) => s.id === id);
    if (!target) return;
    const next = !target.liked;
    const apply = (liked: boolean) => {
      this.songs = this.songs.map((s) => (s.id === id ? { ...s, liked } : s));
      this.queue = this.queue.map((s) => (s.id === id ? { ...s, liked } : s));
    };
    apply(next); // optimistic
    try {
      await setLiked(id, next);
    } catch {
      apply(!next); // revert
    }
  }

  // Records a play (fire-and-forget); updates counts/last-played locally.
  async recordPlay(id: number): Promise<void> {
    try {
      const updated = await recordPlay(id);
      this.songs = this.songs.map((s) => (s.id === id ? updated : s));
      this.queue = this.queue.map((s) => (s.id === id ? updated : s));
    } catch {
      /* play tracking is best-effort */
    }
  }

  // Updates a song's metadata, reflecting it in the library list and queue.
  async updateMeta(id: number, fields: SongMetadata): Promise<void> {
    this.error = null;
    try {
      const updated = await updateSongMeta(id, fields);
      this.songs = this.songs.map((s) => (s.id === id ? updated : s));
      this.queue = this.queue.map((s) => (s.id === id ? updated : s));
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to update song";
    }
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

  // Advances to the next song (honoring shuffle/repeat); false if it stops.
  next(): boolean {
    const n = this.nextIndex();
    if (n === null) {
      this.isPlaying = false;
      return false;
    }
    this.currentIndex = n;
    this.isPlaying = true;
    return true;
  }

  // Goes back to the previous song; false if already at the start.
  prev(): boolean {
    if (this.currentIndex === null) return false;
    if (this.shuffle && this.queue.length > 1) {
      return this.next(); // shuffle: just jump to another track
    }
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.isPlaying = true;
      return true;
    }
    if (this.repeat === "all") {
      this.currentIndex = this.queue.length - 1;
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

  // Uploads multiple files sequentially, tracking progress. Successful uploads
  // are prepended as they complete; failures are summarized in `error`.
  async uploadMany(files: File[]): Promise<void> {
    if (files.length === 0) return;
    this.uploading = true;
    this.error = null;
    this.uploadTotal = files.length;
    this.uploadDone = 0;
    const failed: string[] = [];
    for (const file of files) {
      try {
        const song = await uploadSong(file);
        this.songs = [song, ...this.songs];
      } catch {
        failed.push(file.name);
      }
      this.uploadDone += 1;
    }
    if (failed.length > 0) {
      this.error = `Failed to upload ${failed.length} file${
        failed.length === 1 ? "" : "s"
      }: ${failed.join(", ")}`;
    }
    this.uploading = false;
    this.uploadTotal = 0;
    this.uploadDone = 0;
  }
}
