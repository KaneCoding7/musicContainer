<script lang="ts">
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
</script>

<div class="song-list">
  {#if vm.loading}
    <p class="muted">Loading songs…</p>
  {:else if vm.songs.length === 0}
    <p class="muted">No songs yet. Upload one to get started.</p>
  {:else}
    <ul>
      {#each vm.songs as song (song.id)}
        <li>
          <span class="name">{song.originalFilename}</span>
          <span class="date">{formatDate(song.uploadedAt)}</span>
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
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #27272a;
  }
  li:hover {
    background: #1c1c20;
  }
  .name {
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
