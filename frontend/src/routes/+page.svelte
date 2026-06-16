<script lang="ts">
  import { onMount } from "svelte";
  import AlbumsView from "$lib/components/AlbumsView.svelte";
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

  type View = "songs" | "playlists" | "albums";
  let view = $state<View>("songs");
  let queueOpen = $state(false);

  const nav: { id: View; label: string; icon: string }[] = [
    { id: "songs", label: "All Songs", icon: "library_music" },
    { id: "playlists", label: "Playlists", icon: "queue_music" },
    { id: "albums", label: "Albums", icon: "album" },
  ];

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
      view = "songs";
      requestAnimationFrame(() => document.getElementById("song-search")?.focus());
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

<div class="layout">
  <div class="body">
    <aside class="sidebar">
      <div class="brand">
        <Icon name="library_music" fill size={26} /> Music Server
      </div>

      <nav>
        {#each nav as item (item.id)}
          <button
            class="nav-item"
            class:active={view === item.id}
            onclick={() => (view = item.id)}
          >
            <Icon name={item.icon} size={22} />
            {item.label}
          </button>
        {/each}
      </nav>

      <div class="sidebar-foot">
        <UploadForm {vm} />

        <details class="shortcuts">
          <summary>
            <Icon name="keyboard" size={18} />
            <span class="sc-label">Shortcuts</span>
            <span class="chev"><Icon name="expand_more" size={18} /></span>
          </summary>
          <dl>
            <div><dt><kbd>Space</kbd></dt><dd>Play / pause</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next</dd></div>
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Volume</dd></div>
            <div><dt><kbd>/</kbd></dt><dd>Search</dd></div>
          </dl>
        </details>
      </div>
    </aside>

    <main class="content">
      {#if vm.error}
        <p class="error">{vm.error}</p>
      {/if}

      {#if view === "songs"}
        <h2>All Songs</h2>
        <SongList
          {vm}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          playlists={playlistVm.playlists}
          onBulkAdd={(id, songIds) => playlistVm.addSongs(id, songIds)}
        />
      {:else if view === "playlists"}
        <h2>Playlists</h2>
        <PlaylistManager vm={playlistVm} songVm={vm} />
      {:else}
        <h2>Albums</h2>
        <AlbumsView {vm} />
      {/if}
    </main>
  </div>

  {#if queueOpen}
    <section class="queue-panel">
      <div class="queue-head">
        <h3>Queue</h3>
        <button
          class="collapse"
          onclick={() => (queueOpen = false)}
          aria-label="Collapse queue"
        >
          <Icon name="keyboard_arrow_down" size={22} />
        </button>
      </div>
      {#if vm.queue.length === 0}
        <p class="muted">Nothing queued yet.</p>
      {:else}
        <QueueView {vm} />
      {/if}
    </section>
  {/if}

  <Player {vm} {queueOpen} onToggleQueue={() => (queueOpen = !queueOpen)} />
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .sidebar {
    width: 230px;
    flex-shrink: 0;
    background: #0b0b0e;
    border-right: 1px solid #27272a;
    padding: 1.25rem 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.15rem;
    font-weight: 700;
    color: #a78bfa;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: #cbd5e1;
    font: inherit;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .nav-item:hover {
    background: #1c1c20;
    color: #fff;
  }
  .nav-item.active {
    background: #2a1d4d;
    color: #fff;
  }
  .sidebar-foot {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .shortcuts {
    font-size: 0.78rem;
    color: #9ca3af;
  }
  .shortcuts summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.5rem;
    border-radius: 0.4rem;
    cursor: pointer;
    list-style: none;
    color: #9ca3af;
    user-select: none;
  }
  .shortcuts summary::-webkit-details-marker {
    display: none;
  }
  .shortcuts summary:hover {
    background: #1c1c20;
    color: #e5e7eb;
  }
  .sc-label {
    flex: 1;
  }
  .chev {
    display: inline-flex;
    transition: transform 0.15s ease;
  }
  .shortcuts[open] .chev {
    transform: rotate(180deg);
  }
  .shortcuts dl {
    margin: 0.25rem 0 0;
    padding: 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .shortcuts dl div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .shortcuts dt {
    display: flex;
    gap: 0.2rem;
  }
  .shortcuts dd {
    margin: 0;
    color: #6b7280;
  }
  .shortcuts kbd {
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 0.25rem;
    padding: 0.02rem 0.32rem;
    font-family: inherit;
    font-size: 0.7rem;
    color: #cbd5e1;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 2rem 2rem;
  }
  .content h2 {
    margin: 0 0 1rem;
    font-size: 1.4rem;
  }
  .error {
    background: #7f1d1d;
    color: #fecaca;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin: 0 0 1rem;
  }
  .queue-panel {
    border-top: 1px solid #27272a;
    background: #141417;
    max-height: 38vh;
    overflow-y: auto;
    padding: 0.5rem 1rem 1rem;
  }
  .queue-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    background: #141417;
    padding: 0.5rem 0;
  }
  .queue-head h3 {
    margin: 0;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
  }
  .collapse {
    display: inline-flex;
    background: transparent;
    border: none;
    color: #9ca3af;
    cursor: pointer;
  }
  .collapse:hover {
    color: #fff;
  }
  .muted {
    color: #9ca3af;
    padding: 0.5rem 0;
  }
</style>
