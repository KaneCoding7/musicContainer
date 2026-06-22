<script lang="ts">
  import { untrack } from "svelte";
  import FramePickerDialog from "$lib/components/FramePickerDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";

  // Move the dialog up to the app's top-level container so it isn't nested
  // inside the scrolling content area or a swipe-handling song row — iOS Safari
  // won't open a file input that lives inside such ancestors. We target
  // ".layout" (not <body>) so it stays within Svelte's event-delegation root
  // and the dialog's own buttons keep working.
  function portal(node: HTMLElement) {
    const target = document.querySelector(".layout") ?? document.body;
    target.appendChild(node);
    return {
      destroy() {
        node.parentNode?.removeChild(node);
      },
    };
  }
  import { bumpArtVersion } from "$lib/services/artVersion.svelte";
  import {
    thumbUrl,
    removeArt,
    uploadArt,
    type SongMetadata,
  } from "$lib/services/songService";
  import {
    disableSongPublicLink,
    enableSongPublicLink,
    getSongPublicToken,
    publicLink,
  } from "$lib/services/shareService";
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
  let artBusy = $state(false);
  let artError = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function onPickArt(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    pendingFrameUrl = null;
    artBusy = true;
    artError = null;
    try {
      const updated = await uploadArt(song.id, file);
      hasArt = updated.hasArt;
      bumpArtVersion(song.id);
      onArtChanged?.(updated);
    } catch (e) {
      artError = e instanceof Error ? e.message : "Failed to upload art";
    } finally {
      artBusy = false;
      if (fileInput) fileInput.value = "";
    }
  }

  async function clearArt() {
    pendingFrameUrl = null;
    artBusy = true;
    artError = null;
    try {
      const updated = await removeArt(song.id);
      hasArt = updated.hasArt;
      bumpArtVersion(song.id);
      onArtChanged?.(updated);
    } catch (e) {
      artError = e instanceof Error ? e.message : "Failed to remove art";
    } finally {
      artBusy = false;
    }
  }

  // Pick album art from a frame of the source video (link-imported tracks).
  // The selected frame is previewed and only applied when the dialog is saved.
  let framePicking = $state(false);
  let pendingFrameUrl = $state<string | null>(null);

  // Public link (Cycle 39).
  let publicToken = $state<string | null>(null);
  let publicCopied = $state(false);
  let publicBusy = $state(false);
  $effect(() => {
    getSongPublicToken(song.id)
      .then((t) => (publicToken = t))
      .catch(() => {});
  });
  async function togglePublic() {
    publicBusy = true;
    try {
      if (publicToken) {
        await disableSongPublicLink(song.id);
        publicToken = null;
      } else {
        publicToken = await enableSongPublicLink(song.id);
      }
    } catch {
      /* ignore */
    } finally {
      publicBusy = false;
    }
  }
  async function copyPublic() {
    if (!publicToken) return;
    try {
      await navigator.clipboard.writeText(publicLink(publicToken));
      publicCopied = true;
      setTimeout(() => (publicCopied = false), 1500);
    } catch {
      /* ignore */
    }
  }

  // Source link (e.g. the YouTube URL a track was imported from). Read-only —
  // shown and copyable, but not editable.
  let sourceCopied = $state(false);
  async function copySource() {
    if (!song.sourceUrl) return;
    try {
      await navigator.clipboard.writeText(song.sourceUrl);
      sourceCopied = true;
      setTimeout(() => (sourceCopied = false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function save() {
    if (!name.trim()) return;
    // Apply a previewed video frame as the cover, if one was selected.
    if (pendingFrameUrl) {
      artBusy = true;
      artError = null;
      try {
        const blob = await (await fetch(pendingFrameUrl)).blob();
        const file = new File([blob], "cover", {
          type: blob.type || "image/jpeg",
        });
        const updated = await uploadArt(song.id, file);
        bumpArtVersion(song.id);
        onArtChanged?.(updated);
        pendingFrameUrl = null;
      } catch (e) {
        artError = e instanceof Error ? e.message : "Failed to set the cover";
        artBusy = false;
        return; // keep the dialog open on failure
      }
      artBusy = false;
    }
    onSave(song.id, {
      originalFilename: name.trim(),
      artist: artist.trim(),
      album: album.trim(),
    });
    onClose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" use:portal>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Edit song">
    <h3>Edit song</h3>

    <div class="art-row">
      <span class="art-thumb">
        {#if pendingFrameUrl}
          <img src={pendingFrameUrl} alt="" />
        {:else if hasArt}
          <img src={thumbUrl(song.id, 256)} alt="" />
        {:else}
          <Icon name="music_note" size={26} />
        {/if}
      </span>
      <div class="art-actions">
        <input
          class="art-file"
          bind:this={fileInput}
          type="file"
          accept="image/*"
          onchange={onPickArt}
          disabled={artBusy}
        />
        <span class="art-hint">
          {pendingFrameUrl
            ? "New cover — applied when you Save"
            : hasArt
              ? "Change album art"
              : "Add album art"}
        </span>
        <div class="art-btns">
          {#if song.hasSource}
            <button
              type="button"
              class="art-frames"
              onclick={() => (framePicking = true)}
              disabled={artBusy}
            >
              <Icon name="album" size={16} /> Pick from video
            </button>
          {/if}
          {#if hasArt}
            <button
              type="button"
              class="art-remove"
              onclick={clearArt}
              disabled={artBusy}>Remove</button
            >
          {/if}
        </div>
        {#if artError}<span class="art-error">{artError}</span>{/if}
      </div>
    </div>

    {#if framePicking}
      <FramePickerDialog
        {song}
        onPick={(frame) => (pendingFrameUrl = frame.dataUrl)}
        onClose={() => (framePicking = false)}
      />
    {/if}

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

    {#if song.sourceUrl}
      <div class="source-block">
        <span class="source-label"><Icon name="link" size={18} /> Source link</span>
        <div class="source-url">
          <a class="url" href={song.sourceUrl} target="_blank" rel="noopener noreferrer">
            {song.sourceUrl}
          </a>
          <button type="button" class="copy" onclick={copySource}>
            <Icon name={sourceCopied ? "check" : "content_copy"} size={16} />
            {sourceCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    {/if}

    <div class="public-block">
      <div class="public-head">
        <span><Icon name="public" size={18} /> Public link</span>
        <button type="button" class="link-toggle" onclick={togglePublic} disabled={publicBusy}>
          {publicToken ? "Turn off" : "Create"}
        </button>
      </div>
      {#if publicToken}
        <div class="public-url">
          <span class="url">{publicLink(publicToken)}</span>
          <button type="button" class="copy" onclick={copyPublic}>
            <Icon name={publicCopied ? "check" : "content_copy"} size={16} />
            {publicCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <p class="hint">Anyone with this link can listen — no account needed.</p>
      {/if}
    </div>

    <div class="actions">
      <button class="secondary" onclick={onClose}>Cancel</button>
      <button onclick={save} disabled={!name.trim() || artBusy}>Save</button>
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
    padding: 1rem;
    box-sizing: border-box;
    z-index: 50;
  }
  .dialog {
    width: min(420px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    box-sizing: border-box;
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
  /* Plain, fully-visible native file input — its own button opens the picker
     (the most reliable on iOS Safari), and keeping it visible means the tap
     can't fall through to a form field behind it. */
  .art-file {
    max-width: 100%;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .art-file::file-selector-button,
  .art-file::-webkit-file-upload-button {
    margin-right: 0.5rem;
    padding: 0.45rem 0.85rem;
    background: var(--accent);
    border: none;
    border-radius: 0.4rem;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .art-hint {
    font-size: 0.72rem;
    color: var(--dim);
  }
  .art-btns {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .art-remove {
    padding: 0.3rem 0.7rem;
    background: transparent;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 500;
  }
  @media (hover: hover) {
    .art-remove:hover:not(:disabled) {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .art-frames {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.7rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) {
    .art-frames:hover:not(:disabled) {
      background: var(--hover);
    }
  }
  .art-frames:disabled {
    opacity: 0.6;
    cursor: default;
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
  .source-block {
    margin-bottom: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-2);
  }
  .source-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .source-url {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .source-url .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--accent-text);
    text-decoration: none;
  }
  @media (hover: hover) {
    .source-url .url:hover {
      text-decoration: underline;
    }
  }
  .source-url .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  @media (hover: hover) {
    .source-url .copy:hover {
      background: var(--border-strong);
    }
  }
  .public-block {
    margin-bottom: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-2);
  }
  .public-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .public-head span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .link-toggle {
    padding: 0.3rem 0.7rem;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8rem;
    font-weight: 500;
  }
  @media (hover: hover) {
    .link-toggle:hover:not(:disabled) {
      background: var(--border-strong);
    }
  }
  .public-url {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .public-url .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--accent-text);
  }
  .public-url .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8rem;
  }
  @media (hover: hover) {
    .public-url .copy:hover {
      background: var(--border-strong);
    }
  }
  .hint {
    margin: 0.4rem 0 0;
    color: var(--dim);
    font-size: 0.78rem;
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
  @media (hover: hover) {
    button:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secondary {
    background: var(--border-strong);
  }
  @media (hover: hover) {
    .secondary:hover {
      background: var(--border-strong);
    }
  }
</style>
