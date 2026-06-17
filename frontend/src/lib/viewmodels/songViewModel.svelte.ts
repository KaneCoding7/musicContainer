// ViewModel: owns song-list state and the operations the UI triggers.
// Uses Svelte 5 runes ($state) for reactive state in a plain class.
import { untrack } from "svelte";
import {
  deleteSong,
  fetchSongs,
  recordPlay,
  setLiked,
  updateSongMeta,
  updateSongsMeta,
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

  // Sort order for the library list (Cycle 34).
  sortBy = $state<"added" | "name" | "plays" | "duration">("added");

  // The library filtered by the current query (case-insensitive match across
  // song name, artist, and album), then sorted by the chosen order.
  get filteredSongs(): Song[] {
    const q = this.query.trim().toLowerCase();
    const matched = q
      ? this.songs.filter(
          (s) =>
            s.originalFilename.toLowerCase().includes(q) ||
            (s.artist?.toLowerCase().includes(q) ?? false) ||
            (s.album?.toLowerCase().includes(q) ?? false)
        )
      : this.songs;
    return this.applySort(matched);
  }

  // Applies the current sort. "added" keeps the backend order (newest first).
  private applySort(list: Song[]): Song[] {
    switch (this.sortBy) {
      case "name":
        return [...list].sort((a, b) =>
          a.originalFilename.localeCompare(b.originalFilename)
        );
      case "plays":
        return [...list].sort((a, b) => b.playCount - a.playCount);
      case "duration":
        return [...list].sort(
          (a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity)
        );
      default:
        return list;
    }
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

  // Most-played songs (play count desc), for the Home view.
  get mostPlayed(): Song[] {
    return this.songs
      .filter((s) => s.playCount > 0)
      .sort((a, b) => b.playCount - a.playCount);
  }

  // Most-recently-added songs first (the library already loads newest-first).
  get recentlyAdded(): Song[] {
    return this.songs;
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

  // Volume normalization (loudness leveling) on/off. Persisted by the page.
  normalize = $state(true);

  // --- Now-playing persistence (survive a page refresh) ---
  // Live playback position in seconds (written by the player on timeupdate).
  position = $state(0);
  // Position to seek to when (re)loading a restored track; 0 = start.
  resumeAt = $state(0);
  // Set while restoring so the player doesn't log a fresh play for the track
  // it's merely resuming.
  suppressPlayRecord = false;
  private readonly NOW_PLAYING_KEY = "musicNowPlaying";

  togglePlay(): void {
    if (this.currentSong) this.isPlaying = !this.isPlaying;
  }

  // Adjusts volume by delta, clamped to [0, 1].
  adjustVolume(delta: number): void {
    this.volume = Math.min(1, Math.max(0, this.volume + delta));
  }

  // --- Sleep timer (Cycle 35) ---
  // Epoch ms when playback should pause (null = no timed sleep).
  sleepUntil = $state<number | null>(null);
  // If true, pause when the current track ends.
  sleepAtTrackEnd = $state(false);
  private sleepHandle: ReturnType<typeof setTimeout> | null = null;

  get sleepActive(): boolean {
    return this.sleepUntil !== null || this.sleepAtTrackEnd;
  }

  private clearSleepHandle(): void {
    if (this.sleepHandle !== null) {
      clearTimeout(this.sleepHandle);
      this.sleepHandle = null;
    }
  }

  // Sets a countdown sleep timer in minutes (pauses playback when it elapses).
  setSleepTimer(minutes: number): void {
    this.clearSleepHandle();
    this.sleepAtTrackEnd = false;
    this.sleepUntil = Date.now() + minutes * 60_000;
    this.sleepHandle = setTimeout(() => {
      this.isPlaying = false;
      this.sleepUntil = null;
      this.sleepHandle = null;
    }, minutes * 60_000);
  }

  // Sleeps when the current track finishes (handled by the player on "ended").
  setSleepAtTrackEnd(): void {
    this.clearSleepHandle();
    this.sleepUntil = null;
    this.sleepAtTrackEnd = true;
  }

  // Cancels any pending sleep timer.
  cancelSleep(): void {
    this.clearSleepHandle();
    this.sleepUntil = null;
    this.sleepAtTrackEnd = false;
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

  // Appends a song to the queue. If nothing is playing, starts it.
  addToQueue(song: Song): void {
    if (this.currentIndex === null) {
      this.queue = [song];
      this.currentIndex = 0;
      this.isPlaying = true;
    } else {
      this.queue = [...this.queue, song];
    }
  }

  // Inserts a song to play right after the current track.
  playNext(song: Song): void {
    if (this.currentIndex === null) {
      this.addToQueue(song);
      return;
    }
    const at = this.currentIndex + 1;
    this.queue = [
      ...this.queue.slice(0, at),
      song,
      ...this.queue.slice(at),
    ];
  }

  // Removes the queue entry at index, keeping the current track stable.
  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    const removingCurrent = index === this.currentIndex;
    this.queue = this.queue.filter((_, i) => i !== index);
    if (this.currentIndex === null) return;
    if (this.queue.length === 0) {
      this.currentIndex = null;
      this.isPlaying = false;
    } else if (removingCurrent) {
      // Stay at the same slot (now the following track) and keep playing.
      this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
    } else if (index < this.currentIndex) {
      this.currentIndex -= 1;
    }
  }

  // Moves a queue entry, keeping the current track pointer correct.
  moveInQueue(from: number, to: number): void {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= this.queue.length ||
      to >= this.queue.length
    )
      return;
    const arr = [...this.queue];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    this.queue = arr;

    let c = this.currentIndex;
    if (c === null) return;
    if (c === from) {
      c = to;
    } else {
      if (from < c) c -= 1;
      if (to <= c) c += 1;
    }
    this.currentIndex = c;
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

  // Replaces a song everywhere it appears (library + queue) with an updated copy.
  replaceSong(updated: Song): void {
    this.songs = this.songs.map((s) => (s.id === updated.id ? updated : s));
    this.queue = this.queue.map((s) => (s.id === updated.id ? updated : s));
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

  // Updates metadata on many songs at once, reflecting the changes in the
  // library list and queue. Returns the number of songs updated.
  async updateMetaBulk(
    ids: number[],
    fields: SongMetadata
  ): Promise<number> {
    this.error = null;
    try {
      const updated = await updateSongsMeta(ids, fields);
      const byId = new Map(updated.map((s) => [s.id, s]));
      this.songs = this.songs.map((s) => byId.get(s.id) ?? s);
      this.queue = this.queue.map((s) => byId.get(s.id) ?? s);
      return updated.length;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to update songs";
      return 0;
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

  // Writes a snapshot of the player to sessionStorage so playback survives a
  // refresh. The live position is read untracked so this is safe to call from a
  // reactive effect without re-running on every timeupdate.
  persist(): void {
    if (typeof sessionStorage === "undefined") return;
    if (this.currentIndex === null || this.queue.length === 0) {
      sessionStorage.removeItem(this.NOW_PLAYING_KEY);
      return;
    }
    try {
      sessionStorage.setItem(
        this.NOW_PLAYING_KEY,
        JSON.stringify({
          queue: this.queue,
          currentIndex: this.currentIndex,
          isPlaying: this.isPlaying,
          shuffle: this.shuffle,
          repeat: this.repeat,
          volume: this.volume,
          position: untrack(() => this.position),
        })
      );
    } catch {
      /* storage full/unavailable — best-effort */
    }
  }

  // Restores a persisted snapshot if present. Returns true when playback state
  // was restored. The player decides whether autoplay policy lets it resume.
  restore(): boolean {
    if (typeof sessionStorage === "undefined") return false;
    const raw = sessionStorage.getItem(this.NOW_PLAYING_KEY);
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      if (!Array.isArray(s.queue) || s.queue.length === 0) return false;
      const idx =
        typeof s.currentIndex === "number" &&
        s.currentIndex >= 0 &&
        s.currentIndex < s.queue.length
          ? s.currentIndex
          : 0;
      this.queue = s.queue;
      this.currentIndex = idx;
      this.shuffle = !!s.shuffle;
      this.repeat = s.repeat === "all" || s.repeat === "one" ? s.repeat : "off";
      if (typeof s.volume === "number") this.volume = s.volume;
      this.resumeAt = typeof s.position === "number" ? s.position : 0;
      this.suppressPlayRecord = true;
      this.isPlaying = !!s.isPlaying;
      return true;
    } catch {
      return false;
    }
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
