<script lang="ts">
  import EditSongDialog from "$lib/components/EditSongDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { artUrl, downloadUrl, type SongMetadata } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  import type { Playlist } from "$lib/types";

  let {
    vm,
    onDelete,
    onUpdate,
    playlists = [],
    onBulkAdd,
  }: {
    vm: SongViewModel;
    onDelete?: (id: number) => void;
    onUpdate?: (id: number, fields: SongMetadata) => void;
    playlists?: Playlist[];
    onBulkAdd?: (playlistId: number, songIds: number[]) => Promise<number>;
  } = $props();

  let editing = $state<Song | null>(null);

  // --- Multi-select (Cycle 16) ---
  let selecting = $state(false);
  let selected = $state<Set<number>>(new Set());
  let addTarget = $state<string>("");
  let addStatus = $state<string | null>(null);

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function exitSelect() {
    selecting = false;
    selected = new Set();
    addTarget = "";
    addStatus = null;
  }

  async function addSelected() {
    const id = Number(addTarget);
    if (!id || selected.size === 0 || !onBulkAdd) return;
    const added = await onBulkAdd(id, [...selected]);
    addStatus = `Added ${added} ${added === 1 ? "song" : "songs"}`;
    selected = new Set();
    addTarget = "";
  }

  function formatDate(iso: string): string {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function confirmDelete(song: Song) {
    if (confirm(`Delete "${song.originalFilename}"? This cannot be undone.`)) {
      onDelete?.(song.id);
    }
  }
</script>

<div class="song-list">
  {#if vm.songs.length > 0}
    <div class="toolbar">
      <div class="search">
        <Icon name="search" size={20} />
        <input
          id="song-search"
          type="search"
          placeholder="Search songs…"
          bind:value={vm.query}
        />
      </div>
      {#if onBulkAdd && playlists.length > 0}
        {#if selecting}
          <button class="ghost" onclick={exitSelect}>Done</button>
        {:else}
          <button class="ghost" onclick={() => (selecting = true)}>
            <Icon name="playlist_add" size={20} /> Select
          </button>
        {/if}
      {/if}
    </div>

    {#if selecting}
      <div class="selbar">
        <span class="count">{selected.size} selected</span>
        <select bind:value={addTarget}>
          <option value="" disabled selected>Add to playlist…</option>
          {#each playlists as p (p.id)}
            <option value={String(p.id)}>{p.name}</option>
          {/each}
        </select>
        <button onclick={addSelected} disabled={!addTarget || selected.size === 0}>
          Add
        </button>
        {#if addStatus}<span class="status">{addStatus}</span>{/if}
      </div>
    {/if}
  {/if}

  {#if vm.loading}
    <p class="muted">Loading songs…</p>
  {:else if vm.songs.length === 0}
    <p class="muted">No songs yet. Upload one to get started.</p>
  {:else if vm.filteredSongs.length === 0}
    <p class="muted">No songs match "{vm.query}".</p>
  {:else}
    <ul>
      {#each vm.filteredSongs as song, i (song.id)}
        {@const isCurrent = song.id === vm.currentSong?.id}
        <li class:current={isCurrent} class:selected={selected.has(song.id)}>
          {#if selecting}
            <button
              class="check"
              role="checkbox"
              aria-checked={selected.has(song.id)}
              aria-label="Select song"
              onclick={() => toggleSelect(song.id)}
            >
              <Icon
                name={selected.has(song.id) ? "check_box" : "check_box_outline_blank"}
                size={22}
              />
            </button>
          {/if}
          <button
            class="row"
            onclick={() =>
              selecting
                ? toggleSelect(song.id)
                : vm.playQueue(vm.filteredSongs, i)}
          >
            <span class="thumb">
              {#if song.hasArt}
                <img src={artUrl(song.id)} alt="" />
              {:else}
                <Icon name="music_note" size={20} />
              {/if}
              <span class="thumb-play">
                <Icon
                  name={isCurrent && vm.isPlaying ? "pause" : "play_arrow"}
                  fill
                  size={22}
                />
              </span>
            </span>
            <span class="meta">
              <span class="name">{song.originalFilename}</span>
              {#if song.artist}
                <span class="artist">{song.artist}</span>
              {/if}
            </span>
            {#if song.duration}
              <span class="date" title={formatDate(song.uploadedAt)}
                >{formatDuration(song.duration)}</span
              >
            {:else}
              <span class="date">{formatDate(song.uploadedAt)}</span>
            {/if}
          </button>
          <a
            class="action"
            href={downloadUrl(song.id)}
            title="Download song"
            aria-label="Download song"><Icon name="download" size={20} /></a
          >
          {#if onUpdate}
            <button
              class="action"
              title="Edit song"
              aria-label="Edit song"
              onclick={() => (editing = song)}
              ><Icon name="edit" size={20} /></button
            >
          {/if}
          {#if onDelete}
            <button
              class="delete"
              title="Delete song"
              aria-label="Delete song"
              onclick={() => confirmDelete(song)}
              ><Icon name="delete" size={20} /></button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if editing}
  <EditSongDialog
    song={editing}
    onSave={(id, fields) => onUpdate?.(id, fields)}
    onClose={() => (editing = null)}
  />
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    padding: 0.5rem 0.8rem;
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 0.5rem;
    color: #e5e7eb;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .ghost:hover {
    background: #3f3f46;
  }
  .selbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.8rem;
    margin-bottom: 0.75rem;
    background: #2a1d4d;
    border-radius: 0.5rem;
  }
  .selbar .count {
    font-weight: 600;
  }
  .selbar select {
    padding: 0.4rem 0.6rem;
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 0.4rem;
    color: #e5e7eb;
  }
  .selbar button {
    padding: 0.4rem 0.9rem;
    background: #6d28d9;
    color: #fff;
    border: none;
    border-radius: 0.4rem;
    font-weight: 600;
    cursor: pointer;
  }
  .selbar button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .selbar .status {
    color: #a78bfa;
    font-size: 0.85rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: #a78bfa;
    cursor: pointer;
    padding: 0 0.25rem 0 0.75rem;
  }
  li.selected {
    background: #241a3d;
  }
  .search {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.8rem;
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 0.5rem;
    color: #6b7280;
  }
  .search input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e5e7eb;
    font: inherit;
  }
  .search input::placeholder {
    color: #6b7280;
  }
  .song-list ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #27272a;
  }
  li.current {
    background: #2a1d4d;
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .action,
  .delete {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    padding: 0.5rem 0.7rem;
    font-size: 0.95rem;
    text-decoration: none;
  }
  .action:hover {
    background: #27272a;
  }
  .delete:hover {
    background: #7f1d1d;
    color: #fecaca;
  }
  .row:hover {
    background: #1c1c20;
  }
  li.current .row:hover {
    background: #34245e;
  }
  .thumb {
    position: relative;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #27272a;
    border-radius: 0.35rem;
    color: #6b7280;
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .row:hover .thumb-play,
  li.current .thumb-play {
    opacity: 1;
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .artist {
    color: #9ca3af;
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .date {
    color: #9ca3af;
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .muted {
    color: #9ca3af;
    padding: 1rem;
  }
</style>
