<script lang="ts">
  import EditSongDialog from "$lib/components/EditSongDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { artUrl, downloadUrl, type SongMetadata } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    onDelete,
    onUpdate,
  }: {
    vm: SongViewModel;
    onDelete?: (id: number) => void;
    onUpdate?: (id: number, fields: SongMetadata) => void;
  } = $props();

  let editing = $state<Song | null>(null);

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
    <div class="search">
      <Icon name="search" size={20} />
      <input
        id="song-search"
        type="search"
        placeholder="Search songs…"
        bind:value={vm.query}
      />
    </div>
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
        <li class:current={isCurrent}>
          <button class="row" onclick={() => vm.playQueue(vm.filteredSongs, i)}>
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
  .search {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.8rem;
    margin-bottom: 0.75rem;
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
