<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { playlistZipUrl } from "$lib/services/playlistService";
  import { thumbUrl } from "$lib/services/songService";
  import {
    disablePublicLink,
    enablePublicLink,
    fetchPlaylistShares,
    getPublicToken,
    publicLink,
    sharePlaylist,
    unsharePlaylist,
    type ShareUser,
  } from "$lib/services/shareService";
  import type { PlaylistViewModel } from "$lib/viewmodels/playlistViewModel.svelte";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    songVm,
  }: { vm: PlaylistViewModel; songVm: SongViewModel } = $props();

  let newName = $state("");
  let addSongId = $state<string>("");

  // --- Sharing ---
  let shareOpen = $state(false);
  let shareEmail = $state("");
  let shareCanEdit = $state(false);
  let shares = $state<ShareUser[]>([]);
  let shareError = $state<string | null>(null);
  let publicToken = $state<string | null>(null);
  let publicCopied = $state(false);

  // Load the share list + public-link state whenever a different playlist is
  // selected.
  $effect(() => {
    const id = vm.selectedId;
    shareOpen = false;
    shareError = null;
    shares = [];
    publicToken = null;
    publicCopied = false;
    if (id !== null) {
      fetchPlaylistShares(id)
        .then((s) => (shares = s))
        .catch(() => {});
      getPublicToken(id)
        .then((t) => (publicToken = t))
        .catch(() => {});
    }
  });

  async function togglePublic() {
    const id = vm.selectedId;
    if (id === null) return;
    shareError = null;
    try {
      if (publicToken) {
        await disablePublicLink(id);
        publicToken = null;
      } else {
        publicToken = await enablePublicLink(id);
      }
    } catch (e) {
      shareError = e instanceof Error ? e.message : "Failed to update link";
    }
  }

  async function copyPublic() {
    if (!publicToken) return;
    try {
      await navigator.clipboard.writeText(publicLink(publicToken));
      publicCopied = true;
      setTimeout(() => (publicCopied = false), 1500);
    } catch {
      shareError = "Couldn't copy to clipboard";
    }
  }

  async function doShare() {
    const id = vm.selectedId;
    const email = shareEmail.trim();
    if (id === null || !email) return;
    shareError = null;
    try {
      await sharePlaylist(id, email, shareCanEdit);
      shares = await fetchPlaylistShares(id);
      shareEmail = "";
    } catch (e) {
      shareError = e instanceof Error ? e.message : "Failed to share";
    }
  }

  async function revoke(userId: string) {
    const id = vm.selectedId;
    if (id === null) return;
    try {
      await unsharePlaylist(id, userId);
      shares = shares.filter((s) => s.id !== userId);
    } catch (e) {
      shareError = e instanceof Error ? e.message : "Failed to revoke";
    }
  }

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

  function renameSelected() {
    const current = vm.selected;
    if (!current) return;
    const name = prompt("Rename playlist", current.name);
    if (name && name.trim() && name.trim() !== current.name) {
      vm.rename(current.id, name.trim());
    }
  }

  function deleteSelected() {
    const current = vm.selected;
    if (!current) return;
    if (confirm(`Delete playlist "${current.name}"? This cannot be undone.`)) {
      vm.remove(current.id);
    }
  }

  // --- Drag-to-reorder ---
  let dragIndex = $state<number | null>(null);
  let overIndex = $state<number | null>(null);

  function onDragStart(i: number) {
    dragIndex = i;
  }
  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault(); // allow drop
    overIndex = i;
  }
  function onDrop(i: number) {
    const from = dragIndex;
    dragIndex = null;
    overIndex = null;
    if (from === null || from === i) return;
    const arr = [...vm.selectedSongs];
    const [moved] = arr.splice(from, 1);
    arr.splice(i, 0, moved);
    vm.reorder(arr);
  }
  function onDragEnd() {
    dragIndex = null;
    overIndex = null;
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
    <div class="cards">
      {#each vm.playlists as playlist (playlist.id)}
        <button
          class="card"
          class:active={playlist.id === vm.selectedId}
          onclick={() => vm.select(playlist.id)}
        >
          <span class="cover">
            {#if playlist.coverSongId != null}
              <img src={thumbUrl(playlist.coverSongId, 512)} alt="" />
            {:else}
              <Icon name="queue_music" size={26} />
            {/if}
          </span>
          <span class="card-text">
            <span class="card-name">{playlist.name}</span>
            <span class="card-sub">
              {playlist.trackCount ?? 0}
              {(playlist.trackCount ?? 0) === 1 ? "track" : "tracks"}
            </span>
          </span>
        </button>
      {/each}
    </div>
  {/if}

  {#if vm.selected}
    <div class="detail">
      <div class="detail-head">
        <h3>{vm.selected.name}</h3>
        <button
          class="head-action"
          title="Rename playlist"
          aria-label="Rename playlist"
          onclick={renameSelected}><Icon name="edit" size={20} /></button
        >
        {#if vm.selectedSongs.length > 0}
          <a
            class="head-action"
            href={playlistZipUrl(vm.selectedId ?? 0)}
            title="Download as zip"
            aria-label="Download playlist as zip"><Icon name="download" size={20} /></a
          >
        {/if}
        <button
          class="head-action"
          class:on={shareOpen}
          title="Share playlist"
          aria-label="Share playlist"
          onclick={() => (shareOpen = !shareOpen)}
          ><Icon name="share" size={20} /></button
        >
        <button
          class="head-action danger"
          title="Delete playlist"
          aria-label="Delete playlist"
          onclick={deleteSelected}><Icon name="delete" size={20} /></button
        >
      </div>

      {#if vm.selectedSongs.length > 0}
        <div class="actions-bar">
          <PlayActions vm={songVm} songs={vm.selectedSongs} />
        </div>
      {/if}

      {#if shareOpen}
        <div class="share-panel">
          <div class="share-row">
            <input
              type="email"
              placeholder="Share with email…"
              bind:value={shareEmail}
              onkeydown={(e) => e.key === "Enter" && doShare()}
            />
            <button onclick={doShare} disabled={!shareEmail.trim()}>Share</button>
          </div>
          <label class="can-edit">
            <input type="checkbox" bind:checked={shareCanEdit} />
            Allow editing (add / remove tracks)
          </label>
          {#if shareError}<p class="share-error">{shareError}</p>{/if}
          {#if shares.length > 0}
            <ul class="share-list">
              {#each shares as u (u.id)}
                <li>
                  <span class="share-who"
                    >{u.name} <span class="dim">({u.email})</span>{#if u.canEdit}<span
                        class="edit-tag">editor</span
                      >{/if}</span
                  >
                  <button
                    class="revoke"
                    title="Revoke"
                    aria-label="Revoke share"
                    onclick={() => revoke(u.id)}><Icon name="close" size={18} /></button
                  >
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted small">Not shared with anyone yet.</p>
          {/if}

          <div class="public-block">
            <div class="public-head">
              <span><Icon name="public" size={18} /> Public link</span>
              <button class="link-toggle" onclick={togglePublic}>
                {publicToken ? "Turn off" : "Create"}
              </button>
            </div>
            {#if publicToken}
              <div class="public-url">
                <span class="url">{publicLink(publicToken)}</span>
                <button class="copy" onclick={copyPublic}>
                  <Icon name={publicCopied ? "check" : "content_copy"} size={16} />
                  {publicCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <p class="muted small">Anyone with this link can listen — no account needed.</p>
            {/if}
          </div>
        </div>
      {/if}

      {#if vm.selectedSongs.length === 0}
        <p class="muted">No songs in this playlist yet.</p>
      {:else}
        <ol>
          {#each vm.selectedSongs as song, i (song.id)}
            {@const isCurrent = song.id === songVm.currentSong?.id}
            <li
              class:current={isCurrent}
              class:dragging={i === dragIndex}
              class:dragover={i === overIndex && i !== dragIndex}
              draggable="true"
              ondragstart={() => onDragStart(i)}
              ondragover={(e) => onDragOver(e, i)}
              ondrop={() => onDrop(i)}
              ondragend={onDragEnd}
            >
              <span class="handle" title="Drag to reorder" aria-hidden="true">
                <Icon name="drag_indicator" size={20} />
              </span>
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
              <span
                class="plays"
                title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
              >
                <Icon name="play_arrow" size={13} />{song.playCount}
              </span>
              <SongMenu
                vm={songVm}
                {song}
                onChanged={() => {
                  if (vm.selectedId !== null) vm.select(vm.selectedId);
                }}
              />
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
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
  }
  button {
    padding: 0.5rem 0.9rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
  }
  button:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
  }
  .cards .card:hover {
    background: var(--hover);
  }
  .card.active {
    border-color: var(--accent);
    background: var(--active-bg);
  }
  .cover {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.4rem;
    color: var(--dim);
    overflow: hidden;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .card-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .card-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-sub {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .detail {
    border-top: 1px solid var(--surface-2);
    padding-top: 1rem;
  }
  .actions-bar {
    margin-bottom: 1rem;
  }
  .detail-head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .detail-head h3 {
    margin: 0;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-action {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.35rem 0.5rem;
    border-radius: 0.4rem;
  }
  .head-action:hover {
    background: var(--surface-2);
  }
  .head-action.danger:hover {
    background: var(--danger-bg);
    color: var(--danger-text);
  }
  .head-action.on {
    background: var(--active-bg);
    color: var(--accent-text);
  }
  .share-panel {
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }
  .share-row {
    display: flex;
    gap: 0.5rem;
  }
  .share-row input {
    flex: 1;
    padding: 0.45rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
  }
  .share-row button {
    padding: 0.45rem 0.9rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.4rem;
    font-weight: 600;
    cursor: pointer;
  }
  .share-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .can-edit {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
    font-size: 0.82rem;
    color: var(--muted);
    cursor: pointer;
  }
  .edit-tag {
    margin-left: 0.4rem;
    padding: 0.05rem 0.4rem;
    background: var(--active-bg);
    color: var(--accent-text);
    border-radius: 0.3rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .share-list {
    list-style: none;
    padding: 0;
    margin: 0.6rem 0 0;
  }
  .share-list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0;
  }
  .share-who {
    flex: 1;
    min-width: 0;
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .share-who .dim {
    color: var(--muted);
  }
  .revoke {
    display: inline-flex;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 0.3rem;
  }
  .revoke:hover {
    background: var(--danger-bg);
    color: var(--danger-text);
  }
  .share-error {
    color: var(--danger-text);
    font-size: 0.85rem;
    margin: 0.5rem 0 0;
  }
  .public-block {
    margin-top: 0.85rem;
    padding-top: 0.75rem;
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
    font-size: 0.88rem;
    font-weight: 600;
  }
  .link-toggle {
    padding: 0.3rem 0.7rem;
    background: var(--surface-2);
    border: none;
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .link-toggle:hover {
    background: var(--border-strong);
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
    font-size: 0.82rem;
    color: var(--accent-text);
  }
  .public-url .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    padding: 0.3rem 0.6rem;
    background: var(--surface-2);
    border: none;
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .public-url .copy:hover {
    background: var(--border-strong);
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
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
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
    background: var(--hover);
  }
  li.dragging {
    opacity: 0.4;
  }
  li.dragover {
    border-top: 2px solid var(--accent-text);
  }
  .handle {
    display: inline-flex;
    align-items: center;
    color: var(--dim);
    cursor: grab;
    padding-left: 0.25rem;
  }
  .handle:active {
    cursor: grabbing;
  }
  .icon {
    display: inline-flex;
    color: var(--accent-text);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plays {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .remove {
    display: inline-flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.6rem;
  }
  .remove:hover {
    background: var(--danger-bg);
    color: var(--danger-text);
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
  }
  .muted {
    color: var(--muted);
    padding: 0.5rem 0;
  }
  .muted.small {
    font-size: 0.85rem;
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger-text);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }
</style>
