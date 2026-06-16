<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { PlaylistViewModel } from "$lib/viewmodels/playlistViewModel.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    songVm,
  }: { vm: PlaylistViewModel; songVm: SongViewModel } = $props();

  let newName = $state("");
  let addSongId = $state<string>("");

  async function createPlaylist() {
    const name = newName.trim();
    if (!name) return;
    const ok = await vm.create(name);
    if (ok) newName = "";
  }

  async function addSelectedSong() {
    const id = Number(addSongId);
    if (!id) return;
    await vm.addSong(id);
    addSongId = "";
  }

  // Songs in the library not already in the selected playlist.
  const addableSongs = $derived(
    songVm.songs.filter(
      (s) => !vm.selectedSongs.some((ps) => ps.id === s.id)
    )
  );

  function playFrom(index: number) {
    songVm.playQueue(vm.selectedSongs, index);
  }
</script>

<div class="playlists">
  <div class="create">
    <input
      type="text"
      placeholder="New playlist name"
      bind:value={newName}
      onkeydown={(e) => e.key === "Enter" && createPlaylist()}
    />
    <button onclick={createPlaylist} disabled={!newName.trim()}>Create</button>
  </div>

  {#if vm.error}
    <p class="error">{vm.error}</p>
  {/if}

  {#if vm.playlists.length === 0}
    <p class="muted">No playlists yet. Create one above.</p>
  {:else}
    <div class="chips">
      {#each vm.playlists as playlist (playlist.id)}
        <button
          class="chip"
          class:active={playlist.id === vm.selectedId}
          onclick={() => vm.select(playlist.id)}
        >
          {playlist.name}
        </button>
      {/each}
    </div>
  {/if}

  {#if vm.selected}
    <div class="detail">
      <h3>{vm.selected.name}</h3>

      {#if vm.selectedSongs.length === 0}
        <p class="muted">No songs in this playlist yet.</p>
      {:else}
        <ol>
          {#each vm.selectedSongs as song, i (song.id)}
            {@const isCurrent = song.id === songVm.currentSong?.id}
            <li class:current={isCurrent}>
              <button class="play-btn" onclick={() => playFrom(i)}>
                <span class="icon">
                  <Icon
                    name={isCurrent && songVm.isPlaying ? "pause" : "play_arrow"}
                    fill
                    size={20}
                  />
                </span>
                <span class="name">{song.originalFilename}</span>
              </button>
              <button
                class="remove"
                title="Remove from playlist"
                aria-label="Remove from playlist"
                onclick={() => vm.removeSong(song.id)}
                ><Icon name="close" size={20} /></button
              >
            </li>
          {/each}
        </ol>
      {/if}

      {#if addableSongs.length > 0}
        <div class="add-row">
          <select bind:value={addSongId}>
            <option value="" disabled selected>Add a song…</option>
            {#each addableSongs as song (song.id)}
              <option value={String(song.id)}>{song.originalFilename}</option>
            {/each}
          </select>
          <button onclick={addSelectedSong} disabled={!addSongId}>Add</button>
        </div>
      {:else}
        <p class="muted small">All library songs are in this playlist.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .create {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  input[type="text"],
  select {
    flex: 1;
    padding: 0.5rem 0.7rem;
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 0.5rem;
    color: #e5e7eb;
  }
  button {
    padding: 0.5rem 0.9rem;
    background: #6d28d9;
    color: white;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
  }
  button:hover:not(:disabled) {
    background: #5b21b6;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .chip {
    background: #27272a;
    color: #e5e7eb;
    font-weight: 500;
  }
  .chip:hover {
    background: #3f3f46;
  }
  .chip.active {
    background: #6d28d9;
  }
  .detail {
    border-top: 1px solid #27272a;
    padding-top: 1rem;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  ol {
    list-style: none;
    counter-reset: track;
    padding: 0;
    margin: 0 0 1rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid #27272a;
  }
  li.current {
    background: #2a1d4d;
  }
  .play-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: transparent;
    color: inherit;
    font-weight: 500;
    padding: 0.6rem 0.5rem;
  }
  .play-btn:hover {
    background: #1c1c20;
  }
  .icon {
    display: inline-flex;
    color: #a78bfa;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: #9ca3af;
    cursor: pointer;
    padding: 0.4rem 0.6rem;
  }
  .remove:hover {
    background: #7f1d1d;
    color: #fecaca;
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
  }
  .muted {
    color: #9ca3af;
    padding: 0.5rem 0;
  }
  .muted.small {
    font-size: 0.85rem;
  }
  .error {
    background: #7f1d1d;
    color: #fecaca;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }
</style>
