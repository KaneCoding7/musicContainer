<script lang="ts">
  import { getContext } from "svelte";
  import EditSongDialog from "$lib/components/EditSongDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    addSongToPlaylist,
    fetchPlaylists,
  } from "$lib/services/playlistService";
  import {
    downloadUrl,
    setClipEnabled,
    type SongMetadata,
  } from "$lib/services/songService";
  import type { Playlist, Song } from "$lib/types";
  import type { PlaylistViewModel } from "$lib/viewmodels/playlistViewModel.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  // The shared playlist view-model, provided by the page via setContext. When
  // present, adds route through it so the playlist list (track counts / covers)
  // and the open playlist's songs update live — instead of only after a reload.
  const playlistVm = getContext<PlaylistViewModel | undefined>("playlistVm");

  // Reusable per-row "⋮" menu: queue actions + edit / download / delete. Drop
  // one next to any song row. Manages its own edit dialog and delete confirm.
  // onEdit/onDelete override the default view-model actions when a list needs
  // extra work (e.g. refreshing an open playlist).
  let {
    vm,
    song,
    onEdit,
    onDelete,
    onChanged,
    onRemoveFromPlaylist,
    onAddToLibrary,
    inLibrary = false,
    canModify = true,
    showTrigger = true,
  }: {
    vm: SongViewModel;
    song: Song;
    onEdit?: (id: number, fields: SongMetadata) => void | Promise<void>;
    onDelete?: (id: number) => void | Promise<void>;
    onChanged?: () => void | Promise<void>;
    // When set (i.e. shown within a playlist), adds a "Remove from playlist"
    // item that calls this instead of deleting the song from the library.
    onRemoveFromPlaylist?: () => void | Promise<void>;
    // When set (someone else's track), adds an "Add to my library" item.
    onAddToLibrary?: () => void | Promise<void>;
    inLibrary?: boolean; // already in my library — show a done state instead
    // False for tracks the viewer doesn't own (shared/org playlists): hides the
    // library-editing actions (Edit / Delete) they're not allowed to perform.
    canModify?: boolean;
    // When false, the "⋮" trigger button is hidden and the menu opens only via
    // right-click / long-press on the row (used in the player's now-playing bar).
    showTrigger?: boolean;
  } = $props();

  let open = $state(false);
  let editing = $state(false);
  let wrapEl = $state<HTMLElement | null>(null);
  // When opened by right-click, the menu is positioned at the cursor; null means
  // anchored to the ⋮ button instead.
  let cursorPos = $state<{ x: number; y: number } | null>(null);

  // "Add to playlist" submenu. Playlists are fetched the first time it's opened.
  let showPlaylists = $state(false);
  let playlists = $state<Playlist[]>([]);
  let plBusy = $state(false);
  let plDone = $state<string | null>(null);

  function close() {
    open = false;
    cursorPos = null;
    showPlaylists = false;
    plDone = null;
  }

  async function openPlaylists() {
    showPlaylists = true;
    // Show the page's already-loaded list instantly when available; otherwise
    // fetch it on first open.
    if (playlistVm && playlistVm.playlists.length > 0) {
      playlists = playlistVm.playlists;
      plBusy = false;
      return;
    }
    plBusy = true;
    try {
      playlists = await fetchPlaylists();
    } catch {
      /* leave list empty */
    } finally {
      plBusy = false;
    }
  }

  async function addToPlaylist(p: Playlist) {
    try {
      // Route through the shared view-model when present so the playlists list
      // and any open playlist reflect the new song immediately (no refresh).
      if (playlistVm) await playlistVm.addSongs(p.id, [song.id]);
      else await addSongToPlaylist(p.id, song.id);
      plDone = p.name;
      setTimeout(close, 800); // brief confirmation, then close
    } catch {
      close();
    }
  }

  // Right-clicking (or long-pressing) anywhere on the row opens this menu at the
  // cursor, the same items as the ⋮ button. We attach to the enclosing row so
  // no list component has to wire it up. List rows are <li>; card grids (e.g.
  // the Home view) mark their container with data-song-menu-row instead.
  $effect(() => {
    const row = wrapEl?.closest<HTMLElement>("li, [data-song-menu-row]");
    if (!row) return;
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const MENU_W = 180;
      const MENU_H = 230;
      cursorPos = {
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - MENU_W - 8)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H - 8)),
      };
      open = true;
    };
    row.addEventListener("contextmenu", onContext);
    return () => row.removeEventListener("contextmenu", onContext);
  });

  async function toggleClip() {
    close();
    try {
      const updated = await setClipEnabled(song.id, song.clipDisabled);
      vm.replaceSong(updated);
      await onChanged?.();
    } catch {
      /* ignore */
    }
  }

  async function saveEdit(id: number, fields: SongMetadata) {
    if (onEdit) await onEdit(id, fields);
    else await vm.updateMeta(id, fields);
    await onChanged?.();
  }

  async function confirmDelete() {
    close();
    if (confirm(`Delete "${song.originalFilename}"? This cannot be undone.`)) {
      if (onDelete) await onDelete(song.id);
      else await vm.remove(song.id);
      await onChanged?.();
    }
  }
</script>

<div class="menu-wrap" bind:this={wrapEl}>
  {#if showTrigger}
    <button
      class="dots"
      title="More options"
      aria-label="More options"
      onclick={(e) => {
        e.stopPropagation();
        cursorPos = null;
        open = !open;
      }}
    >
      <Icon name="more_vert" size={20} />
    </button>
  {/if}

  {#if open}
    <div
      class="menu"
      class:at-cursor={cursorPos}
      style={cursorPos ? `left:${cursorPos.x}px; top:${cursorPos.y}px;` : ""}
    >
      {#if showPlaylists}
        <button class="back" onclick={() => (showPlaylists = false)}>
          <Icon name="arrow_back" size={18} /> Add to playlist
        </button>
        {#if plDone}
          <span class="pl-msg"><Icon name="check_circle" size={16} /> Added to {plDone}</span>
        {:else if plBusy}
          <span class="pl-empty">Loading…</span>
        {:else if playlists.length === 0}
          <span class="pl-empty">No playlists yet</span>
        {:else}
          <div class="pl-list">
            {#each playlists as p (p.id)}
              <button onclick={() => addToPlaylist(p)}>
                <Icon name="queue_music" size={18} /> {p.name}
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <button
          class="like"
          class:liked={song.liked}
          onclick={() => { vm.toggleLike(song.id); close(); }}
        >
          <Icon name="favorite" fill={song.liked} size={18} />
          {song.liked ? "Unlike" : "Like"}
        </button>
        <button onclick={() => { vm.addToQueue(song); close(); }}>
          <Icon name="queue_music" size={18} /> Add to queue
        </button>
        <button onclick={() => { vm.playNext(song); close(); }}>
          <Icon name="playlist_play" size={18} /> Play next
        </button>
        <button onclick={openPlaylists}>
          <Icon name="playlist_add" size={18} /> Add to playlist
        </button>
        {#if onAddToLibrary}
          <button disabled={inLibrary} onclick={() => { onAddToLibrary?.(); close(); }}>
            <Icon name={inLibrary ? "check_circle" : "library_music"} size={18} />
            {inLibrary ? "In your library" : "Add to my library"}
          </button>
        {/if}
        {#if onRemoveFromPlaylist}
          <button onclick={() => { onRemoveFromPlaylist?.(); close(); }}>
            <Icon name="playlist_remove" size={18} /> Remove from playlist
          </button>
        {/if}
        {#if song.hasSource}
          <button onclick={toggleClip}>
            <Icon name={song.clipDisabled ? "smart_display" : "videocam_off"} size={18} />
            {song.clipDisabled ? "Show clip" : "Hide clip"}
          </button>
        {/if}
        {#if canModify}
          <button onclick={() => { editing = true; close(); }}>
            <Icon name="edit" size={18} /> Edit
          </button>
        {/if}
        <a class="item" href={downloadUrl(song.id)} onclick={close}>
          <Icon name="download" size={18} /> Download
        </a>
        {#if canModify}
          <button class="danger" onclick={confirmDelete}>
            <Icon name="delete" size={18} /> Delete
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

{#if open}
  <button
    class="backdrop"
    aria-label="Close menu"
    onpointerdown={(e) => {
      // Swallow the press so it only dismisses the menu — it shouldn't click
      // through to the row behind, nor start that row's swipe gesture.
      e.preventDefault();
      e.stopPropagation();
      close();
    }}
  ></button>
{/if}

{#if editing}
  <EditSongDialog
    {song}
    onSave={saveEdit}
    onArtChanged={(s) => {
      vm.replaceSong(s);
      onChanged?.();
    }}
    onClose={() => (editing = false)}
  />
{/if}

<style>
  .menu-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  .dots {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.5rem;
    border-radius: 0.35rem;
  }
  @media (hover: hover) {
    .dots:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.25rem);
    z-index: 30;
    min-width: 170px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    padding: 0.25rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
  }
  /* When opened by right-click, inline left/top place it at the cursor. */
  .menu.at-cursor {
    position: fixed;
    right: auto;
  }
  .menu button,
  .menu .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: 0.35rem;
    color: var(--text);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  @media (hover: hover) {
    .menu button:hover,
    .menu .item:hover {
      background: var(--hover);
    }
  }
  .menu .danger {
    color: var(--danger-text);
  }
  /* Liked state: fill the heart red, matching the rest of the app. */
  .menu .like.liked {
    color: #ef4444;
  }
  /* Add-to-playlist submenu */
  .menu .back {
    color: var(--dim);
    font-weight: 600;
  }
  .pl-list {
    display: flex;
    flex-direction: column;
    max-height: 220px;
    overflow-y: auto;
    border-top: 1px solid var(--surface-2);
    margin-top: 0.15rem;
    padding-top: 0.15rem;
  }
  .pl-empty {
    padding: 0.5rem 0.6rem;
    color: var(--dim);
    font-size: 0.85rem;
  }
  .pl-msg {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    color: var(--accent-text);
    font-size: 0.85rem;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
</style>
