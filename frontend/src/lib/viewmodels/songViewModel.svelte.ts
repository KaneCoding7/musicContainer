// ViewModel: owns song-list state and the operations the UI triggers.
// Uses Svelte 5 runes ($state) for reactive state in a plain class.
import { untrack } from "svelte";
import {
  deleteSong,
  fetchPendingSongs,
  fetchSongs,
  finalizeSongs,
  importLink,
  recordPlay,
  reorderSongs as reorderSongsApi,
  searchYouTube as searchYouTubeApi,
  setLiked,
  updateSongMeta,
  updateSongsMeta,
  uploadSong,
  type SongMetadata,
  type YouTubeResult,
} from "$lib/services/songService";
import {
  fetchPlaybackState,
  savePlaybackState,
} from "$lib/services/playbackStateService";
import type { Song } from "$lib/types";

// The playback state synced across devices (Spotify-Connect style).
export interface PlaybackSnapshot {
  queue: Song[];
  currentIndex: number | null;
  queuedCount: number;
  position: number;
  duration: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
}

export class SongViewModel {
  songs = $state<Song[]>([]);
  loading = $state(false);
  uploading = $state(false);
  // Batch upload progress (Cycle 28).
  uploadDone = $state(0);
  uploadTotal = $state(0);
  // Importing audio from a link (yt-dlp on the server).
  importing = $state(false);
  importStage = $state<string>("");
  importPercent = $state<number | null>(null);
  // Searching YouTube by name (yt-dlp on the server) before importing a pick.
  searching = $state(false);
  // Uploaded/imported tracks awaiting the user's review before joining the
  // library (hidden from the library until confirmed).
  staged = $state<Song[]>([]);
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
  // Spotify-style manual queue: the number of hand-queued tracks sitting
  // immediately after the current one. "Play next" inserts at the front of this
  // block, "Add to queue" appends to its end; both play before the rest of the
  // original context resumes. Kept in sync as tracks advance / the queue is
  // edited; clampQueued() guards the invariant.
  queuedCount = $state(0);

  // Index one past the manual-queue block (where "Add to queue" inserts).
  private get manualEnd(): number {
    return this.currentIndex === null ? 0 : this.currentIndex + 1 + this.queuedCount;
  }
  // Keep queuedCount within the tracks that actually follow the current one.
  private clampQueued(): void {
    const after =
      this.currentIndex === null ? 0 : this.queue.length - 1 - this.currentIndex;
    this.queuedCount = Math.max(0, Math.min(this.queuedCount, after));
  }
  isPlaying = $state(false);

  // Playback modes (Cycle 7).
  shuffle = $state(false);
  repeat = $state<"off" | "all" | "one">("off");

  // Cross-device sync. When set, transport actions are forwarded to the active
  // device as commands rather than changing local playback. The sink returns
  // true when it handled the action (this is a remote device); false to act
  // locally (this device is the active one).
  remoteSink: ((type: string, payload?: unknown) => boolean) | null = null;

  // Volume 0..1 (Cycle 11; lives here so keyboard shortcuts can adjust it).
  volume = $state(1);

  // Volume normalization (loudness leveling) on/off. Persisted by the page.
  normalize = $state(true);

  // Global toggle for the expanded-player canvas clips. Persisted by the page.
  showClips = $state(true);

  // --- Now-playing persistence (survive a page refresh) ---
  // Live playback position in seconds (written by the player on timeupdate).
  position = $state(0);
  // Current track duration (seconds) and a one-shot seek request — set by the
  // pop-out mini player, applied by the main player's audio element.
  duration = $state(0);
  seekRequest = $state<number | null>(null);
  // Position to seek to when (re)loading a restored track; 0 = start. Tied to a
  // specific song id so the saved position is only ever applied to its own
  // track — never leaked onto the next song that happens to load.
  resumeAt = $state(0);
  resumeSongId = $state<number | null>(null);
  // Set while restoring so the player doesn't log a fresh play for the track
  // it's merely resuming.
  suppressPlayRecord = false;
  private readonly NOW_PLAYING_KEY = "musicNowPlaying";

  togglePlay(): void {
    if (this.remoteSink?.("togglePlay")) return;
    if (this.currentSong) this.isPlaying = !this.isPlaying;
  }

  // Seeks to a position in seconds (forwarded when remote; applied by the
  // player's audio element when local).
  seek(seconds: number): void {
    if (this.remoteSink?.("seek", { position: seconds })) return;
    this.position = seconds;
    this.seekRequest = seconds;
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

  // (Re)arms the timeout from the current sleepUntil. If it has already passed
  // (e.g. it elapsed while the page was closed), pause immediately.
  private armSleepTimeout(): void {
    this.clearSleepHandle();
    if (this.sleepUntil === null) return;
    const ms = this.sleepUntil - Date.now();
    if (ms <= 0) {
      this.isPlaying = false;
      this.sleepUntil = null;
      return;
    }
    this.sleepHandle = setTimeout(() => {
      this.isPlaying = false;
      this.sleepUntil = null;
      this.sleepHandle = null;
    }, ms);
  }

  // Sets a countdown sleep timer in minutes (pauses playback when it elapses).
  setSleepTimer(minutes: number): void {
    this.sleepAtTrackEnd = false;
    this.sleepUntil = Date.now() + minutes * 60_000;
    this.armSleepTimeout();
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

  // Original queue order before shuffling, to restore when shuffle is turned off.
  private preShuffleQueue: Song[] | null = null;

  // Fisher-Yates shuffle; returns a new array (input untouched).
  private shuffled(arr: Song[]): Song[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Shuffle reorders the queue itself so the visible order always matches what
  // plays next. Turning it on shuffles the upcoming tracks (current + already
  // played stay put); turning it off restores the pre-shuffle order.
  toggleShuffle(): void {
    if (this.remoteSink?.("toggleShuffle")) return;
    if (!this.shuffle) {
      this.shuffle = true;
      if (this.currentIndex === null || this.queue.length <= 1) return;
      this.preShuffleQueue = [...this.queue];
      // Keep the current track AND the hand-queued block fixed; shuffle only the
      // rest of the context after them.
      const at = this.manualEnd;
      this.queue = [
        ...this.queue.slice(0, at),
        ...this.shuffled(this.queue.slice(at)),
      ];
    } else {
      this.shuffle = false;
      const saved = this.preShuffleQueue;
      this.preShuffleQueue = null;
      // Restore the original order (keeping the current track loaded), unless
      // the queue was edited while shuffled.
      if (saved && saved.length === this.queue.length) {
        const curId = this.currentSong?.id ?? null;
        this.queue = saved;
        const idx =
          curId !== null ? saved.findIndex((s) => s.id === curId) : -1;
        if (idx >= 0) this.currentIndex = idx;
      }
    }
  }

  // Cycles repeat off -> all -> one -> off.
  cycleRepeat(): void {
    if (this.remoteSink?.("cycleRepeat")) return;
    this.repeat =
      this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
  }

  // The next index in the queue (shuffle is baked into the queue order, so this
  // is always sequential); null means "stop".
  private nextIndex(): number | null {
    if (this.currentIndex === null || this.queue.length === 0) return null;
    const n = this.currentIndex + 1;
    if (n < this.queue.length) return n;
    return this.repeat === "all" ? 0 : null;
  }

  // The song currently loaded in the player, if any.
  // A $derived (not a getter) so it reliably re-tracks when the queue array is
  // replaced in place — e.g. replaceSong() updating the *currently playing*
  // track, which a getter accessed across a component boundary could miss.
  currentSong: Song | null = $derived(
    this.currentIndex === null ? null : (this.queue[this.currentIndex] ?? null)
  );

  // The track a "next" skip would land on (null at the end with repeat off).
  // Used by the UI to preview the upcoming art during a swipe.
  get peekNext(): Song | null {
    const n = this.nextIndex();
    return n === null ? null : this.queue[n] ?? null;
  }

  // The track a "previous" skip would land on. Mirrors prev()'s skip target
  // (ignoring its restart-current-track behavior) so the swipe can preview it.
  get peekPrev(): Song | null {
    if (this.currentIndex === null) return null;
    if (this.currentIndex > 0) return this.queue[this.currentIndex - 1] ?? null;
    if (this.repeat === "all") return this.queue[this.queue.length - 1] ?? null;
    return null;
  }

  // Plays an arbitrary list of songs starting at the given index. If shuffle is
  // on, the list is shuffled (the chosen track first) so the queue order is
  // exactly what will play.
  playQueue(songs: Song[], index: number): void {
    if (this.remoteSink?.("playQueue", { songs, index })) return;
    if (index < 0 || index >= songs.length) return;
    if (this.shuffle && songs.length > 1) {
      const picked = songs[index];
      this.preShuffleQueue = [...songs];
      this.queue = [picked, ...this.shuffled(songs.filter((_, i) => i !== index))];
      this.currentIndex = 0;
    } else {
      this.preShuffleQueue = null;
      this.queue = songs;
      this.currentIndex = index;
    }
    this.queuedCount = 0; // fresh context — nothing hand-queued yet
    this.isPlaying = true;
  }

  // Plays a list from the top in order (turns shuffle off).
  playList(songs: Song[]): void {
    if (songs.length === 0) return;
    if (this.remoteSink?.("playList", { songs })) return;
    this.shuffle = false;
    this.playQueue(songs, 0);
  }

  // Plays a list shuffled (turns shuffle on; playQueue does the shuffling).
  shufflePlay(songs: Song[]): void {
    if (songs.length === 0) return;
    if (this.remoteSink?.("shufflePlay", { songs })) return;
    this.shuffle = true;
    // Start on a random track so the first song is shuffled too, rather than
    // always the list's first; playQueue then shuffles the remainder after it.
    const start = Math.floor(Math.random() * songs.length);
    this.playQueue(songs, start);
  }

  // Plays from the full library list (used by the song list).
  play(index: number): void {
    this.playQueue(this.songs, index);
  }

  // Adds a song to the END of the manual queue — after the current track and
  // any already-queued/play-next songs, but before the rest of the context.
  // If nothing is playing, starts it.
  addToQueue(song: Song): void {
    if (this.remoteSink?.("addToQueue", { song })) return;
    if (this.currentIndex === null) {
      this.queue = [song];
      this.currentIndex = 0;
      this.isPlaying = true;
      this.queuedCount = 0;
    } else {
      const at = this.manualEnd;
      this.queue = [...this.queue.slice(0, at), song, ...this.queue.slice(at)];
      this.queuedCount += 1;
    }
  }

  // Inserts a song at the FRONT of the manual queue — it plays right after the
  // current track, ahead of anything already queued.
  playNext(song: Song): void {
    if (this.remoteSink?.("playNext", { song })) return;
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
    this.queuedCount += 1;
  }

  // Removes the queue entry at index, keeping the current track stable.
  removeFromQueue(index: number): void {
    if (this.remoteSink?.("removeFromQueue", { index })) return;
    if (index < 0 || index >= this.queue.length) return;
    const removingCurrent = index === this.currentIndex;
    // Was the removed entry one of the hand-queued tracks after the current one?
    const inManual =
      this.currentIndex !== null &&
      index > this.currentIndex &&
      index <= this.currentIndex + this.queuedCount;
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
    if (inManual) this.queuedCount -= 1;
    this.clampQueued();
  }

  // Moves a queue entry, keeping the current track pointer correct.
  moveInQueue(from: number, to: number): void {
    if (this.remoteSink?.("moveInQueue", { from, to })) return;
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
    this.clampQueued();
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

  // Persists a manual order for the given song ids (e.g. an artist's tracks),
  // updating sortOrder locally so derived groupings re-sort immediately.
  async reorderSongs(ids: number[]): Promise<void> {
    const pos = new Map(ids.map((id, i) => [id, i]));
    this.songs = this.songs.map((s) =>
      pos.has(s.id) ? { ...s, sortOrder: pos.get(s.id)! } : s
    );
    try {
      await reorderSongsApi(ids);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to save order";
    }
  }

  // --- Cross-device sync ---
  // A snapshot of playback for the active device to broadcast.
  playbackSnapshot(): PlaybackSnapshot {
    return {
      queue: this.queue,
      currentIndex: this.currentIndex,
      queuedCount: this.queuedCount,
      // Untracked so a reactive pusher doesn't re-run on every timeupdate.
      position: untrack(() => this.position),
      duration: this.duration,
      isPlaying: this.isPlaying,
      shuffle: this.shuffle,
      repeat: this.repeat,
    };
  }

  // Mirrors a remote device's playback state (used by non-active devices).
  // Re-map queued songs to their current library versions (by id) so a snapshot
  // or a remote device's stale queue can't revert per-song metadata that was
  // changed locally (clip on/off, liked, art, etc.). Falls back to the snapshot
  // copy for songs not in the library (e.g. shared/not-yet-loaded).
  private freshenQueue(q: Song[]): Song[] {
    if (!this.songs.length) return q;
    const byId = new Map(this.songs.map((s) => [s.id, s]));
    return q.map((s) => byId.get(s.id) ?? s);
  }

  applyRemoteState(s: PlaybackSnapshot): void {
    this.queue = this.freshenQueue(s.queue);
    this.currentIndex = s.currentIndex;
    this.queuedCount = s.queuedCount ?? 0;
    this.isPlaying = s.isPlaying;
    this.shuffle = s.shuffle;
    this.repeat = s.repeat;
    this.position = s.position;
    this.duration = s.duration;
    this.clampQueued();
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
      const inManual =
        this.currentIndex !== null &&
        queueIdx > this.currentIndex &&
        queueIdx <= this.currentIndex + this.queuedCount;
      this.queue = this.queue.filter((s) => s.id !== id);
      if (wasCurrent) {
        // Stop playback; the loaded track no longer exists.
        this.currentIndex = null;
        this.isPlaying = false;
      } else if (this.currentIndex !== null && queueIdx < this.currentIndex) {
        // Keep pointing at the same song now that earlier entries shifted.
        this.currentIndex -= 1;
      }
      if (inManual) this.queuedCount -= 1;
      this.clampQueued();
    }
  }

  // Advances to the next song (honoring shuffle/repeat); false if it stops.
  next(): boolean {
    if (this.remoteSink?.("next")) return false;
    const n = this.nextIndex();
    if (n === null) {
      this.isPlaying = false;
      return false;
    }
    // Advancing one step consumes the first manual-queue track; a wrap (repeat
    // all) starts a fresh pass with no pending manual queue.
    const stepped = n === this.currentIndex! + 1;
    this.currentIndex = n;
    if (stepped) this.queuedCount = Math.max(0, this.queuedCount - 1);
    else this.queuedCount = 0;
    this.isPlaying = true;
    return true;
  }

  // Skips straight to the previous track, never restarting the current one.
  // The swipe gesture uses this (it previews and commits to the earlier track),
  // unlike the prev() button which restarts when a few seconds in.
  prevTrack(): boolean {
    if (this.remoteSink?.("prev")) return false;
    if (this.currentIndex === null) return false;
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.queuedCount = 0;
      this.isPlaying = true;
      return true;
    }
    if (this.repeat === "all") {
      this.currentIndex = this.queue.length - 1;
      this.queuedCount = 0;
      this.isPlaying = true;
      return true;
    }
    return false;
  }

  // How many seconds into a track the "previous" button restarts it instead of
  // skipping to the earlier track (standard music-player behavior).
  private readonly PREV_RESTART_SECONDS = 3;

  // Handles the "previous" button. Like every common player, this restarts the
  // current track when we're more than a few seconds in; only near the very
  // start does it skip to the earlier track. At the start of the first track it
  // restarts rather than doing nothing, so the button always responds.
  prev(): boolean {
    if (this.remoteSink?.("prev")) return false;
    if (this.currentIndex === null) return false;
    // Past the lead-in: restart the current track.
    if (this.position > this.PREV_RESTART_SECONDS) {
      this.seek(0);
      this.isPlaying = true;
      return true;
    }
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.queuedCount = 0;
      this.isPlaying = true;
      return true;
    }
    if (this.repeat === "all") {
      this.currentIndex = this.queue.length - 1;
      this.queuedCount = 0;
      this.isPlaying = true;
      return true;
    }
    // First track, at the start: restart it so the button still gives feedback.
    this.seek(0);
    this.isPlaying = true;
    return true;
  }

  // savedAt of the snapshot we last restored, so a server snapshot only wins
  // when it's strictly newer than what this device already has.
  private restoredSavedAt = 0;
  private lastRemoteSaveAt = 0;

  // Builds the now-playing snapshot (or null when nothing is queued). Position
  // is read untracked so callers in reactive effects don't re-run every tick.
  private buildSnapshot(): Record<string, unknown> | null {
    if (this.currentIndex === null || this.queue.length === 0) return null;
    return {
      queue: this.queue,
      currentIndex: this.currentIndex,
      queuedCount: this.queuedCount,
      isPlaying: this.isPlaying,
      shuffle: this.shuffle,
      repeat: this.repeat,
      volume: this.volume,
      position: untrack(() => this.position),
      sleepUntil: this.sleepUntil,
      sleepAtTrackEnd: this.sleepAtTrackEnd,
      savedAt: Date.now(),
    };
  }

  // Applies a parsed snapshot to the player. Returns true when it took effect.
  private applySnapshot(s: Record<string, unknown> | null): boolean {
    if (!s || !Array.isArray(s.queue) || s.queue.length === 0) return false;
    const queue = s.queue as Song[];
    const ci = s.currentIndex;
    const idx =
      typeof ci === "number" && ci >= 0 && ci < queue.length ? ci : 0;
    this.queue = this.freshenQueue(queue);
    this.currentIndex = idx;
    this.queuedCount =
      typeof s.queuedCount === "number" ? s.queuedCount : 0;
    this.clampQueued();
    this.shuffle = !!s.shuffle;
    this.repeat =
      s.repeat === "all" || s.repeat === "one"
        ? (s.repeat as "all" | "one")
        : "off";
    if (typeof s.volume === "number") this.volume = s.volume;
    this.resumeAt = typeof s.position === "number" ? s.position : 0;
    // The resume position belongs to the restored current track only.
    this.resumeSongId = this.resumeAt > 0 ? (queue[idx]?.id ?? null) : null;
    this.suppressPlayRecord = true;
    this.isPlaying = !!s.isPlaying;
    // Restore the sleep timer; re-arm from the saved deadline (pausing now if it
    // already elapsed while away).
    this.sleepAtTrackEnd = !!s.sleepAtTrackEnd;
    this.sleepUntil = typeof s.sleepUntil === "number" ? s.sleepUntil : null;
    this.armSleepTimeout();
    this.restoredSavedAt = typeof s.savedAt === "number" ? s.savedAt : 0;
    return true;
  }

  // Writes the snapshot to localStorage (instant same-device resume).
  persist(): void {
    if (typeof localStorage === "undefined") return;
    const snap = this.buildSnapshot();
    if (!snap) {
      localStorage.removeItem(this.NOW_PLAYING_KEY);
      return;
    }
    try {
      localStorage.setItem(this.NOW_PLAYING_KEY, JSON.stringify(snap));
    } catch {
      /* storage full/unavailable — best-effort */
    }
  }

  // Saves the snapshot to the server so playback resumes on other devices.
  // Throttled to ~5s; force/keepalive for the final save on page hide.
  persistRemote(opts?: { force?: boolean; keepalive?: boolean }): void {
    const now = Date.now();
    if (!opts?.force && now - this.lastRemoteSaveAt < 5000) return;
    const snap = this.buildSnapshot();
    this.lastRemoteSaveAt = now;
    savePlaybackState(snap, now, opts?.keepalive); // snap null clears the server
  }

  // Restores the local (same-device) snapshot. The player decides whether
  // autoplay policy lets it resume.
  restore(): boolean {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(this.NOW_PLAYING_KEY);
    if (!raw) return false;
    try {
      return this.applySnapshot(JSON.parse(raw));
    } catch {
      return false;
    }
  }

  // Pulls the server snapshot and applies it when it's newer than whatever this
  // device restored locally — so opening on another device resumes where you
  // left off. Returns true when the server state was applied.
  async restoreRemote(): Promise<boolean> {
    const remote = await fetchPlaybackState();
    if (!remote?.state) return false;
    const savedAt =
      typeof remote.state.savedAt === "number"
        ? remote.state.savedAt
        : remote.updatedAt;
    if (savedAt <= this.restoredSavedAt) return false; // local is as fresh
    return this.applySnapshot(remote.state);
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

  // --- Upload staging (review before adding to the library) ---

  // Loads any pending uploads from a previous session into the review list.
  async loadStaged(): Promise<void> {
    try {
      this.staged = await fetchPendingSongs();
    } catch {
      /* non-fatal */
    }
  }

  // Updates a staged song in place after an edit.
  replaceStaged(updated: Song): void {
    this.staged = this.staged.map((s) => (s.id === updated.id ? updated : s));
  }

  // Discards a staged upload (deletes the file + record).
  async removeStaged(id: number): Promise<void> {
    try {
      await deleteSong(id);
    } catch {
      /* best-effort; still drop it from the list */
    }
    this.staged = this.staged.filter((s) => s.id !== id);
  }

  // Confirms all staged uploads into the library. Returns how many were added.
  async finalizeStaged(): Promise<number> {
    const ids = this.staged.map((s) => s.id);
    if (ids.length === 0) return 0;
    this.error = null;
    try {
      const confirmed = await finalizeSongs(ids);
      this.songs = [...confirmed, ...this.songs];
      this.staged = [];
      return confirmed.length;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to add to library";
      return 0;
    }
  }

  // Searches YouTube by name (server runs yt-dlp). Returns candidate tracks for
  // the user to pick from; the chosen one is imported via importFromLink.
  async searchYouTube(query: string): Promise<YouTubeResult[]> {
    this.searching = true;
    this.error = null;
    try {
      return await searchYouTubeApi(query);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Search failed";
      return [];
    } finally {
      this.searching = false;
    }
  }

  // Imports audio from a link (server runs yt-dlp). Returns how many tracks
  // were staged for review.
  async importFromLink(url: string, playlist = false): Promise<number> {
    this.importing = true;
    this.error = null;
    this.importStage = "download";
    this.importPercent = null;
    try {
      const songs = await importLink(
        url,
        (p) => {
          this.importStage = p.stage;
          if (typeof p.percent === "number") this.importPercent = p.percent;
          else if (p.stage !== "download") this.importPercent = null;
        },
        playlist
      );
      this.staged = [...this.staged, ...songs];
      return songs.length;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Import failed";
      return 0;
    } finally {
      this.importing = false;
      this.importStage = "";
      this.importPercent = null;
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

  // Uploads multiple files sequentially, tracking progress. Each lands in the
  // staging list for review; failures are summarized in `error`.
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
        this.staged = [...this.staged, song];
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
