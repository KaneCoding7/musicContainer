// ViewModel: owns playlist state and the operations the UI triggers.
import * as api from "$lib/services/playlistService";
import type { Playlist, Song } from "$lib/types";

export class PlaylistViewModel {
  playlists = $state<Playlist[]>([]);
  selectedId = $state<number | null>(null);
  selectedSongs = $state<Song[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  get selected(): Playlist | null {
    return this.playlists.find((p) => p.id === this.selectedId) ?? null;
  }

  // Loads the list of playlists.
  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.playlists = await api.fetchPlaylists();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load playlists";
    } finally {
      this.loading = false;
    }
  }

  // Creates a playlist and selects it. Returns true on success.
  async create(name: string): Promise<boolean> {
    this.error = null;
    try {
      const playlist = await api.createPlaylist(name);
      this.playlists = [playlist, ...this.playlists];
      await this.select(playlist.id);
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to create playlist";
      return false;
    }
  }

  // Renames a playlist.
  async rename(id: number, name: string): Promise<void> {
    this.error = null;
    try {
      const updated = await api.renamePlaylist(id, name);
      this.playlists = this.playlists.map((p) => (p.id === id ? updated : p));
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to rename playlist";
    }
  }

  // Deletes a playlist, clearing the selection if it was selected.
  async remove(id: number): Promise<void> {
    this.error = null;
    try {
      await api.deletePlaylist(id);
      this.playlists = this.playlists.filter((p) => p.id !== id);
      if (this.selectedId === id) {
        this.selectedId = null;
        this.selectedSongs = [];
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to delete playlist";
    }
  }

  // Selects a playlist and loads its songs.
  async select(id: number): Promise<void> {
    this.selectedId = id;
    this.error = null;
    try {
      this.selectedSongs = await api.fetchPlaylistSongs(id);
    } catch (e) {
      this.selectedSongs = [];
      this.error = e instanceof Error ? e.message : "Failed to load songs";
    }
  }

  // Adds a song to the selected playlist and refreshes its songs.
  async addSong(songId: number): Promise<void> {
    if (this.selectedId === null) return;
    this.error = null;
    try {
      await api.addSongToPlaylist(this.selectedId, songId);
      this.selectedSongs = await api.fetchPlaylistSongs(this.selectedId);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to add song";
    }
  }

  // Reorders the selected playlist's songs (optimistic; reloads on failure).
  async reorder(orderedSongs: Song[]): Promise<void> {
    if (this.selectedId === null) return;
    const previous = this.selectedSongs;
    this.selectedSongs = orderedSongs; // optimistic update
    this.error = null;
    try {
      await api.reorderPlaylist(
        this.selectedId,
        orderedSongs.map((s) => s.id)
      );
    } catch (e) {
      this.selectedSongs = previous; // revert on error
      this.error = e instanceof Error ? e.message : "Failed to reorder";
    }
  }

  // Removes a song from the selected playlist and refreshes its songs.
  async removeSong(songId: number): Promise<void> {
    if (this.selectedId === null) return;
    this.error = null;
    try {
      await api.removeSongFromPlaylist(this.selectedId, songId);
      this.selectedSongs = await api.fetchPlaylistSongs(this.selectedId);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to remove song";
    }
  }
}
