<script lang="ts">
  import { untrack } from "svelte";
  import type { SongMetadata } from "$lib/services/songService";
  import type { Song } from "$lib/types";

  let {
    song,
    onSave,
    onClose,
  }: {
    song: Song;
    onSave: (id: number, fields: SongMetadata) => void;
    onClose: () => void;
  } = $props();

  // The dialog mounts fresh per edit, so seed the form from the song once.
  let name = $state(untrack(() => song.originalFilename));
  let artist = $state(untrack(() => song.artist ?? ""));
  let album = $state(untrack(() => song.album ?? ""));

  function save() {
    if (!name.trim()) return;
    onSave(song.id, {
      originalFilename: name.trim(),
      artist: artist.trim(),
      album: album.trim(),
    });
    onClose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Edit song">
    <h3>Edit song</h3>
    <label>
      Name
      <input bind:value={name} />
    </label>
    <label>
      Artist
      <input bind:value={artist} placeholder="Unknown artist" />
    </label>
    <label>
      Album
      <input bind:value={album} placeholder="No album" />
    </label>
    <div class="actions">
      <button class="secondary" onclick={onClose}>Cancel</button>
      <button onclick={save} disabled={!name.trim()}>Save</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .dialog {
    width: min(420px, 92vw);
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  h3 {
    margin: 0 0 1rem;
  }
  label {
    display: block;
    margin-bottom: 0.75rem;
    color: #9ca3af;
    font-size: 0.85rem;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.25rem;
    padding: 0.5rem 0.7rem;
    background: #0f0f12;
    border: 1px solid #3f3f46;
    border-radius: 0.5rem;
    color: #e5e7eb;
    font: inherit;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.5rem;
    background: #6d28d9;
    color: white;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #5b21b6;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secondary {
    background: #3f3f46;
  }
  .secondary:hover {
    background: #52525b;
  }
</style>
