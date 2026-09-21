<script lang="ts">
  import { onMount, untrack } from "svelte";
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
    fetchLyrics,
    setLyrics,
    refetchLyrics,
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
    readOnly = false,
    knownArtists = [],
  }: {
    song: Song;
    // Not required in read-only mode (nothing to save).
    onSave?: (id: number, fields: SongMetadata) => void;
    onClose: () => void;
    onArtChanged?: (song: Song) => void;
    // View-only: show the same fields you'd normally edit, but not editable and
    // with no save. Used for tracks the viewer doesn't own (shared playlists).
    readOnly?: boolean;
    // Optional: existing artist names for the add-field autocomplete.
    knownArtists?: string[];
  } = $props();

  // The dialog mounts fresh per edit, so seed the form from the song once.
  let name = $state(untrack(() => song.originalFilename));
  // Ordered artist list. Seed from the relational list, falling back to the
  // legacy single string (split isn't attempted — one string = one artist).
  let artistList = $state<string[]>(
    untrack(() =>
      song.artists.length > 0
        ? song.artists.map((a) => a.name)
        : song.artist
          ? [song.artist]
          : []
    )
  );
  let artistDraft = $state("");
  let dragIndex = $state<number | null>(null);
  let album = $state(untrack(() => song.album ?? ""));

  // Lyrics: load the current plain text lazily so it can be edited. Editing
  // replaces LRCLIB/synced lyrics with manual plain text (a note warns of this).
  let lyricsText = $state("");
  let lyricsLoaded = $state(""); // baseline to detect an actual edit on save
  let lyricsHasSynced = $state(false);
  let lyricsBusy = $state(false);
  let lyricsError = $state<string | null>(null);
  onMount(async () => {
    if (readOnly || !song.hasLyrics) return;
    try {
      const ly = await fetchLyrics(song.id);
      lyricsText = ly?.plain ?? "";
      lyricsLoaded = lyricsText;
      lyricsHasSynced = !!ly?.synced;
    } catch {
      /* leave the field empty on failure */
    }
  });
  async function reFetchLyrics() {
    lyricsBusy = true;
    lyricsError = null;
    try {
      const updated = await refetchLyrics(song.id);
      onArtChanged?.(updated); // propagates the hasLyrics flag
      const ly = await fetchLyrics(song.id);
      lyricsText = ly?.plain ?? "";
      lyricsLoaded = lyricsText;
      lyricsHasSynced = !!ly?.synced;
      if (!ly) lyricsError = "No lyrics found on LRCLIB for this track.";
    } catch (e) {
      lyricsError = e instanceof Error ? e.message : "Re-fetch failed";
    } finally {
      lyricsBusy = false;
    }
  }

  // Adds the current draft as a chip (deduped case-insensitively).
  function addArtist() {
    const v = artistDraft.trim();
    artistDraft = "";
    if (!v) return;
    if (artistList.some((a) => a.toLowerCase() === v.toLowerCase())) return;
    artistList = [...artistList, v];
  }
  function removeArtist(i: number) {
    artistList = artistList.filter((_, idx) => idx !== i);
  }
  function onArtistKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addArtist();
    } else if (e.key === "Backspace" && artistDraft === "" && artistList.length) {
      // Backspace on an empty field removes the last chip, like a tag input.
      artistList = artistList.slice(0, -1);
    }
  }
  function dropArtist(target: number) {
    if (dragIndex === null || dragIndex === target) {
      dragIndex = null;
      return;
    }
    const next = [...artistList];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    artistList = next;
    dragIndex = null;
  }
  // Names not already chosen, for the datalist suggestions.
  const artistSuggestions = $derived(
    knownArtists.filter(
      (n) => !artistList.some((a) => a.toLowerCase() === n.toLowerCase())
    )
  );

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
    if (readOnly) return; // owner-only action; not shown when viewing
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
    // Persist edited lyrics (manual plain text) if they changed.
    if (lyricsText !== lyricsLoaded) {
      try {
        const updated = await setLyrics(song.id, {
          plain: lyricsText.trim() || null,
        });
        onArtChanged?.(updated);
      } catch (e) {
        lyricsError = e instanceof Error ? e.message : "Failed to save lyrics";
        return; // keep the dialog open on failure
      }
    }
    // Commit any half-typed artist before saving, then send the ordered list.
    if (artistDraft.trim()) addArtist();
    onSave?.(song.id, {
      originalFilename: name.trim(),
      artists: artistList,
      album: album.trim(),
    });
    onClose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" use:portal>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={readOnly ? "Song details" : "Edit song"}
  >
    <h3>{readOnly ? "Song details" : "Edit song"}</h3>

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
      {#if readOnly}
        <div class="art-actions">
          <span class="art-hint">{hasArt ? "Album art" : "No album art"}</span>
        </div>
      {:else}
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
      {/if}
    </div>

    {#if framePicking}
      <FramePickerDialog
        {song}
        onPick={(frame) => (pendingFrameUrl = frame.dataUrl)}
        onClose={() => (framePicking = false)}
      />
    {/if}

    {#if readOnly}
      <label>
        Name
        <p class="ro-value">{name || "Untitled"}</p>
      </label>
      <label>
        Artist
        <p class="ro-value" class:empty={artistList.length === 0}>
          {artistList.length ? artistList.join(", ") : "Unknown artist"}
        </p>
      </label>
      <label>
        Album
        <p class="ro-value" class:empty={!album}>{album || "No album"}</p>
      </label>
    {:else}
      <label>
        Name
        <input bind:value={name} />
      </label>
      <div class="field">
        <span class="field-label">Artists</span>
        <div class="chips">
          {#each artistList as a, i (a)}
            <span
              class="chip"
              role="listitem"
              draggable="true"
              ondragstart={() => (dragIndex = i)}
              ondragover={(e) => e.preventDefault()}
              ondrop={() => dropArtist(i)}
              ondragend={() => (dragIndex = null)}
            >
              <span class="chip-name">{a}</span>
              <button
                type="button"
                class="chip-x"
                aria-label={`Remove ${a}`}
                onclick={() => removeArtist(i)}><Icon name="close" size={16} /></button
              >
            </span>
          {/each}
          <input
            class="chip-input"
            bind:value={artistDraft}
            onkeydown={onArtistKey}
            onblur={addArtist}
            placeholder={artistList.length ? "Add another…" : "Add an artist…"}
            list="artist-suggestions"
          />
          {#if artistSuggestions.length}
            <datalist id="artist-suggestions">
              {#each artistSuggestions as s (s)}<option value={s}></option>{/each}
            </datalist>
          {/if}
        </div>
        <span class="field-hint">Enter or comma to add · drag to reorder</span>
      </div>
      <label>
        Album
        <input bind:value={album} placeholder="No album" />
      </label>
    {/if}

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

    {#if !readOnly}
      <div class="lyrics-block">
        <div class="lyrics-head">
          <span class="source-label">Lyrics</span>
          {#if song.artist}
            <button
              type="button"
              class="link-toggle"
              onclick={reFetchLyrics}
              disabled={lyricsBusy}
            >
              {lyricsBusy ? "Fetching…" : "Fetch from LRCLIB"}
            </button>
          {/if}
        </div>
        <textarea
          class="lyrics-input"
          bind:value={lyricsText}
          rows="6"
          placeholder="No lyrics yet — paste or type them here"
        ></textarea>
        {#if lyricsHasSynced}
          <p class="hint">
            This track has time-synced lyrics — editing here replaces them with
            plain text.
          </p>
        {/if}
        {#if lyricsError}<p class="hint err">{lyricsError}</p>{/if}
      </div>

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
    {/if}

    <div class="actions">
      {#if readOnly}
        <button onclick={onClose}>Close</button>
      {:else}
        <button class="secondary" onclick={onClose}>Cancel</button>
        <button onclick={save} disabled={!name.trim() || artBusy}>Save</button>
      {/if}
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
    /* Above the expanded now-playing view (.np-full z60) and the track menu
       (z70) so the dialog is reachable when opened from the full-screen player,
       not hidden behind it. It's a focused modal, so topmost is correct. */
    z-index: 80;
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
  /* Read-only field value — looks like a disabled input, not editable. */
  .ro-value {
    margin: 0.25rem 0 0;
    padding: 0.5rem 0.7rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
    word-break: break-word;
  }
  .ro-value.empty {
    color: var(--dim);
  }
  /* Multi-artist chip editor */
  .field {
    margin-bottom: 0.75rem;
  }
  .field-label {
    display: block;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.25rem;
    padding: 0.35rem 0.4rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.2rem 0.2rem 0.2rem 0.6rem;
    background: var(--surface-2);
    border-radius: 1rem;
    color: var(--text);
    font-size: 0.85rem;
    cursor: grab;
    user-select: none;
  }
  .chip-name {
    line-height: 1;
  }
  .chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.1rem;
    background: none;
    border: none;
    border-radius: 50%;
    color: var(--dim);
    cursor: pointer;
  }
  .chip-x:hover {
    color: var(--text);
  }
  .chip-input {
    flex: 1;
    width: auto;
    min-width: 9ch;
    margin: 0;
    padding: 0.25rem 0.3rem;
    background: transparent;
    border: none;
    border-radius: 0;
  }
  .chip-input:focus {
    outline: none;
  }
  .field-hint {
    display: block;
    margin-top: 0.3rem;
    color: var(--dim);
    font-size: 0.75rem;
  }
  .source-block {
    margin-bottom: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-2);
  }
  .lyrics-block {
    margin-bottom: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-2);
  }
  .lyrics-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .lyrics-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    line-height: 1.5;
    resize: vertical;
  }
  .hint.err {
    color: var(--danger-text);
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
