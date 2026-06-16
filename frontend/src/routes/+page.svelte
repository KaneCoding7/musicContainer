<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Player from "$lib/components/Player.svelte";
  import PlaylistManager from "$lib/components/PlaylistManager.svelte";
  import QueueView from "$lib/components/QueueView.svelte";
  import SongList from "$lib/components/SongList.svelte";
  import UploadForm from "$lib/components/UploadForm.svelte";
  import type { SongMetadata } from "$lib/services/songService";
  import { PlaylistViewModel } from "$lib/viewmodels/playlistViewModel.svelte";
  import { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  const vm = new SongViewModel();
  const playlistVm = new PlaylistViewModel();

  onMount(() => {
    vm.load();
    playlistVm.load();
  });

  // Delete a song, then refresh the open playlist (its membership may change).
  async function handleDelete(id: number) {
    await vm.remove(id);
    if (playlistVm.selectedId !== null) {
      await playlistVm.select(playlistVm.selectedId);
    }
  }

  // Edit a song's metadata, then refresh the open playlist so it updates there.
  async function handleUpdate(id: number, fields: SongMetadata) {
    await vm.updateMeta(id, fields);
    if (playlistVm.selectedId !== null) {
      await playlistVm.select(playlistVm.selectedId);
    }
  }

  // Global keyboard shortcuts (ignored while typing in a field).
  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable;

    if (e.key === "/" && !typing) {
      e.preventDefault();
      document.getElementById("song-search")?.focus();
      return;
    }
    if (typing) return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        vm.togglePlay();
        break;
      case "ArrowRight":
        vm.next();
        break;
      case "ArrowLeft":
        vm.prev();
        break;
      case "ArrowUp":
        e.preventDefault();
        vm.adjustVolume(0.05);
        break;
      case "ArrowDown":
        e.preventDefault();
        vm.adjustVolume(-0.05);
        break;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<header>
  <h1><Icon name="library_music" fill size={28} /> Music Server</h1>
  <UploadForm {vm} />
</header>

{#if vm.error}
  <p class="error">{vm.error}</p>
{/if}

<section>
  <h2>Songs</h2>
  <SongList {vm} onDelete={handleDelete} onUpdate={handleUpdate} />
</section>

<section>
  <h2>Playlists</h2>
  <PlaylistManager vm={playlistVm} songVm={vm} />
</section>

{#if vm.queue.length > 0}
  <section>
    <h2>Up Next</h2>
    <QueueView {vm} />
  </section>
{/if}

<Player {vm} />

<p class="shortcuts">
  Shortcuts: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> prev/next ·
  <kbd>↑</kbd>/<kbd>↓</kbd> volume · <kbd>/</kbd> search
</p>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #a78bfa;
  }
  h2 {
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
    margin: 0 0 0.5rem;
  }
  .error {
    background: #7f1d1d;
    color: #fecaca;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin: 0 0 1rem;
  }
  .shortcuts {
    margin: 1rem 0 0;
    text-align: center;
    color: #6b7280;
    font-size: 0.78rem;
  }
  .shortcuts kbd {
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 0.25rem;
    padding: 0.05rem 0.35rem;
    font-family: inherit;
    font-size: 0.72rem;
  }
</style>
