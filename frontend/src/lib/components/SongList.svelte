<script lang="ts">
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    onDelete,
  }: { vm: SongViewModel; onDelete?: (id: number) => void } = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function confirmDelete(song: Song) {
    if (confirm(`Delete "${song.originalFilename}"? This cannot be undone.`)) {
      onDelete?.(song.id);
    }
  }
</script>

<div class="song-list">
  {#if vm.loading}
    <p class="muted">Loading songs…</p>
  {:else if vm.songs.length === 0}
    <p class="muted">No songs yet. Upload one to get started.</p>
  {:else}
    <ul>
      {#each vm.songs as song, i (song.id)}
        {@const isCurrent = song.id === vm.currentSong?.id}
        <li class:current={isCurrent}>
          <button class="row" onclick={() => vm.play(i)}>
            <span class="icon">
              {#if isCurrent && vm.isPlaying}⏸{:else}▶{/if}
            </span>
            <span class="name">{song.originalFilename}</span>
            <span class="date">{formatDate(song.uploadedAt)}</span>
          </button>
          {#if onDelete}
            <button
              class="delete"
              title="Delete song"
              aria-label="Delete song"
              onclick={() => confirmDelete(song)}>🗑</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
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
  .delete {
    background: transparent;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    padding: 0.5rem 0.9rem;
    font-size: 0.95rem;
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
  .icon {
    width: 1.2rem;
    color: #a78bfa;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    font-weight: 500;
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
