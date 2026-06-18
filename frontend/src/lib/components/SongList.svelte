<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { thumbUrl, type SongMetadata } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  import type { Playlist } from "$lib/types";

  let {
    vm,
    onDelete,
    onUpdate,
    playlists = [],
    onBulkAdd,
    onBulkEdit,
  }: {
    vm: SongViewModel;
    onDelete?: (id: number) => void;
    onUpdate?: (id: number, fields: SongMetadata) => void;
    playlists?: Playlist[];
    onBulkAdd?: (playlistId: number, songIds: number[]) => Promise<number>;
    onBulkEdit?: (ids: number[], fields: SongMetadata) => Promise<number>;
  } = $props();

  // --- Multi-select (Cycle 16) ---
  let selecting = $state(false);
  let selected = $state<Set<number>>(new Set());
  let addTarget = $state<string>("");
  let addStatus = $state<string | null>(null);

  // Bulk metadata edit. Blank fields are left unchanged across the selection.
  let editMode = $state(false);
  let bulkArtist = $state("");
  let bulkAlbum = $state("");

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
    editMode = false;
    bulkArtist = "";
    bulkAlbum = "";
  }

  async function addSelected() {
    const id = Number(addTarget);
    if (!id || selected.size === 0 || !onBulkAdd) return;
    const added = await onBulkAdd(id, [...selected]);
    addStatus = `Added ${added} ${added === 1 ? "song" : "songs"}`;
    selected = new Set();
    addTarget = "";
  }

  async function applyBulkEdit() {
    if (!onBulkEdit || selected.size === 0) return;
    const fields: SongMetadata = {};
    if (bulkArtist.trim()) fields.artist = bulkArtist.trim();
    if (bulkAlbum.trim()) fields.album = bulkAlbum.trim();
    if (fields.artist === undefined && fields.album === undefined) return;
    const n = await onBulkEdit([...selected], fields);
    addStatus = `Updated ${n} ${n === 1 ? "song" : "songs"}`;
    bulkArtist = "";
    bulkAlbum = "";
    editMode = false;
    selected = new Set();
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

</script>

<div class="song-list">
  {#if vm.songs.length > 0}
    <div class="actions-bar">
      <PlayActions {vm} songs={vm.filteredSongs} />
    </div>
    <div class="toolbar">
      <div class="search">
        <Icon name="search" size={20} />
        <input
          id="song-search"
          type="search"
          placeholder="Search songs, artists, albums…"
          bind:value={vm.query}
        />
      </div>
      <label class="sort" title="Sort">
        <Icon name="sort" size={20} />
        <select bind:value={vm.sortBy} aria-label="Sort songs">
          <option value="added">Recently added</option>
          <option value="name">Name (A–Z)</option>
          <option value="plays">Most played</option>
          <option value="duration">Duration</option>
        </select>
      </label>
      {#if (onBulkAdd && playlists.length > 0) || onBulkEdit}
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
        {#if onBulkAdd && playlists.length > 0}
          <select bind:value={addTarget}>
            <option value="" disabled selected>Add to playlist…</option>
            {#each playlists as p (p.id)}
              <option value={String(p.id)}>{p.name}</option>
            {/each}
          </select>
          <button onclick={addSelected} disabled={!addTarget || selected.size === 0}>
            Add
          </button>
        {/if}
        {#if onBulkEdit}
          <button
            class="ghost"
            class:active={editMode}
            onclick={() => (editMode = !editMode)}
            disabled={selected.size === 0}
          >
            <Icon name="edit" size={18} /> Edit
          </button>
        {/if}
        {#if addStatus}<span class="status">{addStatus}</span>{/if}
      </div>

      {#if editMode && onBulkEdit}
        <div class="selbar editbar">
          <input
            bind:value={bulkArtist}
            placeholder="Artist (blank = keep)"
            aria-label="Set artist on selected songs"
          />
          <input
            bind:value={bulkAlbum}
            placeholder="Album (blank = keep)"
            aria-label="Set album on selected songs"
          />
          <button
            onclick={applyBulkEdit}
            disabled={selected.size === 0 ||
              (!bulkArtist.trim() && !bulkAlbum.trim())}
          >
            Apply to {selected.size}
          </button>
        </div>
      {/if}
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
        <li
          class:current={isCurrent}
          class:selected={selected.has(song.id)}
          use:swipeQueue={{ onQueue: () => vm.addToQueue(song) }}
        >
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
                <img src={thumbUrl(song.id, 128)} alt="" />
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
          <span
            class="plays"
            title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
          >
            <Icon name="play_arrow" size={13} />{song.playCount}
          </span>
          <button
            class="action like"
            class:liked={song.liked}
            title={song.liked ? "Unlike" : "Like"}
            aria-label={song.liked ? "Unlike song" : "Like song"}
            onclick={() => vm.toggleLike(song.id)}
            ><Icon name="favorite" fill={song.liked} size={20} /></button
          >
          <SongMenu {vm} {song} onEdit={onUpdate} onDelete={onDelete} />
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .actions-bar {
    margin-bottom: 0.85rem;
  }
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--text);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .ghost:hover {
    background: var(--border-strong);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
    padding: 0.4rem 0.9rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--muted);
  }
  .sort select {
    background: transparent;
    border: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    outline: none;
  }
  .selbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.8rem;
    margin-bottom: 0.75rem;
    background: var(--active-bg);
    border-radius: 0.5rem;
  }
  .selbar .count {
    font-weight: 600;
  }
  .selbar select {
    padding: 0.4rem 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
  }
  .selbar button {
    padding: 0.4rem 0.9rem;
    background: var(--accent);
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
    color: var(--accent-text);
    font-size: 0.85rem;
  }
  .selbar button.ghost {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
  }
  .selbar button.ghost:hover:not(:disabled) {
    background: var(--border-strong);
  }
  .selbar button.ghost.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .selbar.editbar {
    margin-top: -0.4rem;
  }
  .selbar.editbar input {
    flex: 1 1 10rem;
    min-width: 0;
    padding: 0.45rem 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
  }
  .check {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: var(--accent-text);
    cursor: pointer;
    padding: 0 0.25rem 0 0.75rem;
  }
  li.selected {
    background: var(--active-bg);
  }
  .search {
    flex: 0 1 22rem;
    min-width: 0;
    max-width: 22rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.1rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--dim);
  }
  .search input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
  }
  .search input::placeholder {
    color: var(--dim);
  }
  .song-list ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
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
  .action {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.5rem 0.7rem;
    font-size: 0.95rem;
    text-decoration: none;
  }
  .action:hover {
    background: var(--surface-2);
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
  .like.liked {
    color: #ef4444;
  }
  .row:hover {
    background: var(--hover);
  }
  li.current .row:hover {
    background: var(--active-bg);
  }
  .thumb {
    position: relative;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.35rem;
    color: var(--dim);
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
    color: var(--muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .date {
    color: var(--muted);
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .muted {
    color: var(--muted);
    padding: 1rem;
  }

  @media (max-width: 768px) {
    .search {
      flex-basis: 100%;
      max-width: none;
    }
    .row {
      gap: 0.6rem;
      padding: 0.6rem 0.35rem;
    }
    .action {
      padding: 0.45rem 0.4rem;
    }
    .check {
      padding-left: 0.4rem;
    }
  }
</style>
