<script lang="ts">
  import EditSongDialog from "$lib/components/EditSongDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { downloadUrl, type SongMetadata } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

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
  }: {
    vm: SongViewModel;
    song: Song;
    onEdit?: (id: number, fields: SongMetadata) => void | Promise<void>;
    onDelete?: (id: number) => void | Promise<void>;
    onChanged?: () => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let editing = $state(false);
  let wrapEl = $state<HTMLElement | null>(null);
  // When opened by right-click, the menu is positioned at the cursor; null means
  // anchored to the ⋮ button instead.
  let cursorPos = $state<{ x: number; y: number } | null>(null);

  function close() {
    open = false;
    cursorPos = null;
  }

  // Right-clicking (or long-pressing) anywhere on the row opens this menu at the
  // cursor, the same items as the ⋮ button. We attach to the enclosing row so
  // no list component has to wire it up.
  $effect(() => {
    const row = wrapEl?.closest("li");
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

  {#if open}
    <div
      class="menu"
      class:at-cursor={cursorPos}
      style={cursorPos ? `left:${cursorPos.x}px; top:${cursorPos.y}px;` : ""}
    >
      <button onclick={() => { vm.playNext(song); close(); }}>
        <Icon name="playlist_play" size={18} /> Play next
      </button>
      <button onclick={() => { vm.addToQueue(song); close(); }}>
        <Icon name="queue_music" size={18} /> Add to queue
      </button>
      <button onclick={() => { editing = true; close(); }}>
        <Icon name="edit" size={18} /> Edit
      </button>
      <a class="item" href={downloadUrl(song.id)} onclick={close}>
        <Icon name="download" size={18} /> Download
      </a>
      <button class="danger" onclick={confirmDelete}>
        <Icon name="delete" size={18} /> Delete
      </button>
    </div>
  {/if}
</div>

{#if open}
  <button class="backdrop" aria-label="Close menu" onclick={close}></button>
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
  .dots:hover {
    background: var(--surface-2);
    color: var(--text);
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
  .menu button:hover,
  .menu .item:hover {
    background: var(--hover);
  }
  .menu .danger {
    color: var(--danger-text);
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
