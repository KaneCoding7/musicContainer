<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    artUrl,
    removeArt,
    uploadArt,
    type SongMetadata,
  } from "$lib/services/songService";
  import type { Song } from "$lib/types";

  let {
    song,
    onSave,
    onClose,
    onArtChanged,
  }: {
    song: Song;
    onSave: (id: number, fields: SongMetadata) => void;
    onClose: () => void;
    onArtChanged?: (song: Song) => void;
  } = $props();

  // The dialog mounts fresh per edit, so seed the form from the song once.
  let name = $state(untrack(() => song.originalFilename));
  let artist = $state(untrack(() => song.artist ?? ""));
  let album = $state(untrack(() => song.album ?? ""));

  // Album art state (Cycle 32). `hasArt` + a cache-buster track changes locally.
  let hasArt = $state(untrack(() => song.hasArt));
  let artVersion = $state(0);
  let artBusy = $state(false);
  let artError = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function onPickArt(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    artBusy = true;
    artError = null;
    try {
      const updated = await uploadArt(song.id, file);
      hasArt = updated.hasArt;
      artVersion += 1;
      onArtChanged?.(updated);
    } catch (e) {
      artError = e instanceof Error ? e.message : "Failed to upload art";
    } finally {
      artBusy = false;
      if (fileInput) fileInput.value = "";
    }
  }

  async function clearArt() {
    artBusy = true;
    artError = null;
    try {
      const updated = await removeArt(song.id);
      hasArt = updated.hasArt;
      artVersion += 1;
      onArtChanged?.(updated);
    } catch (e) {
      artError = e instanceof Error ? e.message : "Failed to remove art";
    } finally {
      artBusy = false;
    }
  }

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

    <div class="art-row">
      <span class="art-thumb">
        {#if hasArt}
          <img src={`${artUrl(song.id)}&v=${artVersion}`} alt="" />
        {:else}
          <Icon name="music_note" size={26} />
        {/if}
      </span>
      <div class="art-actions">
        <label class="art-btn">
          {artBusy ? "Working…" : hasArt ? "Change art" : "Upload art"}
          <input
            bind:this={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            onchange={onPickArt}
            disabled={artBusy}
            hidden
          />
        </label>
        {#if hasArt}
          <button
            type="button"
            class="art-remove"
            onclick={clearArt}
            disabled={artBusy}>Remove</button
          >
        {/if}
        {#if artError}<span class="art-error">{artError}</span>{/if}
      </div>
    </div>

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
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  h3 {
    margin: 0 0 1rem;
  }
  .art-row {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  .art-thumb {
    width: 72px;
    height: 72px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.5rem;
    color: var(--dim);
    overflow: hidden;
  }
  .art-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art-actions {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .art-btn {
    padding: 0.4rem 0.8rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }
  .art-btn:hover {
    background: var(--hover);
  }
  .art-remove {
    padding: 0.3rem 0.7rem;
    background: transparent;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .art-remove:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .art-error {
    color: var(--danger-text);
    font-size: 0.8rem;
  }
  label {
    display: block;
    margin-bottom: 0.75rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.25rem;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
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
    background: var(--accent);
    color: white;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secondary {
    background: var(--border-strong);
  }
  .secondary:hover {
    background: var(--border-strong);
  }
</style>
