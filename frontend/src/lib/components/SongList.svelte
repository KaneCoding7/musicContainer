<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
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

  function parseDate(iso: string): Date {
    return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  }

  function formatDate(iso: string): string {
    const d = parseDate(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  // Compact "added X ago" label for the Date added column.
  function relativeDate(iso: string): string {
    const d = parseDate(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    const min = Math.round(sec / 60);
    const hr = Math.round(min / 60);
    const day = Math.round(hr / 24);
    if (sec < 60) return "just now";
    if (min < 60) return `${min}m ago`;
    if (hr < 24) return `${hr}h ago`;
    if (day < 7) return `${day}d ago`;
    if (day < 30) return `${Math.round(day / 7)}w ago`;
    if (day < 365) return `${Math.round(day / 30)}mo ago`;
    return `${Math.round(day / 365)}y ago`;
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // Total runtime of the currently shown songs, as "11h 42m" / "42m".
  const totalDuration = $derived(
    vm.filteredSongs.reduce((sum, s) => sum + (s.duration ?? 0), 0)
  );
  function formatTotal(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
</script>

<div class="song-list">
  {#if vm.songs.length > 0}
    <p class="stats">
      {vm.filteredSongs.length}
      {vm.filteredSongs.length === 1 ? "song" : "songs"} · {formatTotal(
        totalDuration
      )}
    </p>
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
    <div class="list-head" class:selecting aria-hidden="true">
      {#if selecting}<span class="col-index"></span>{/if}
      <span class="head-title">Title</span>
      <div class="row-end">
        <span class="head-date">Added</span>
        <span class="col-plays">Plays</span>
        <span class="col-dur"><Icon name="schedule" size={18} /></span>
        <span class="col-like"></span>
        <span class="col-menu"></span>
      </div>
    </div>
    <ul class:selecting>
      {#each vm.filteredSongs as song, i (song.id)}
        {@const isCurrent = song.id === vm.currentSong?.id}
        <li
          class="song-row"
          class:current={isCurrent}
          class:playing={isCurrent && vm.isPlaying}
          class:selected={selected.has(song.id)}
          use:swipeQueue={{ onQueue: () => vm.playNext(song) }}
        >
          {#if selecting}
            <span class="col-index">
              <button
                class="check"
                role="checkbox"
                aria-checked={selected.has(song.id)}
                aria-label="Select song"
                onclick={() => toggleSelect(song.id)}
              >
                <Icon
                  name={selected.has(song.id)
                    ? "check_box"
                    : "check_box_outline_blank"}
                  size={22}
                />
              </button>
            </span>
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
              {#if isCurrent && vm.isPlaying}
                <span class="thumb-wave"><EqualizerBars size={20} /></span>
              {/if}
            </span>
            <span class="meta">
              <span class="name">{song.originalFilename}</span>
              {#if song.artist}
                <span class="artist">{song.artist}</span>
              {/if}
            </span>
          </button>
          <div class="row-end">
            <span class="col-date" title={formatDate(song.uploadedAt)}>
              {relativeDate(song.uploadedAt)}
            </span>
            <span
              class="col-plays plays"
              title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
            >
              <Icon name="play_arrow" size={13} />{song.playCount}
            </span>
            <span class="col-dur dur">
              {song.duration ? formatDuration(song.duration) : "—"}
            </span>
            <button
              class="col-like action like"
              class:liked={song.liked}
              title={song.liked ? "Unlike" : "Like"}
              aria-label={song.liked ? "Unlike song" : "Like song"}
              onclick={() => vm.toggleLike(song.id)}
              ><Icon name="favorite" fill={song.liked} size={20} /></button
            >
            <SongMenu {vm} {song} onEdit={onUpdate} onDelete={onDelete} />
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .stats {
    margin: 0 0 0.85rem;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 500;
  }
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
  @media (hover: hover) {
    .ghost:hover {
      background: var(--border-strong);
    }
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
  @media (hover: hover) {
    .selbar button.ghost:hover:not(:disabled) {
      background: var(--border-strong);
    }
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
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--accent-text);
    cursor: pointer;
    padding: 0;
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
  /* Two sections: the track (art + title + artist) fills the left, the metadata
     group sits on the right, with the flexible space between them. */
  .list-head,
  li.song-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .head-title {
    flex: 1;
    min-width: 0;
  }
  .row-end {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-shrink: 0;
  }
  .list-head {
    padding: 0 0.75rem 0.5rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .list-head .col-dur {
    display: inline-flex;
    justify-content: flex-end;
  }
  .col-like {
    width: 2.25rem;
  }
  .col-menu {
    width: 2.25rem;
  }
  li.song-row {
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
  }
  @media (hover: hover) {
    li.song-row:hover {
      background: var(--hover);
    }
  }
  @media (hover: hover) {
    li.current:hover {
      background: var(--active-bg);
    }
  }
  .col-index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    flex-shrink: 0;
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.6rem 0;
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
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem;
    border-radius: 0.4rem;
    font-size: 0.95rem;
    text-decoration: none;
  }
  @media (hover: hover) {
    .action:hover {
      background: var(--surface-2);
    }
  }
  /* Fixed widths keep the header labels lined up over their values. */
  .col-date {
    width: 7.5rem;
    text-align: right;
    color: var(--muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Header label for the date column: aligned over .col-date but inheriting the
     list-head typography so it matches the "Title" header. */
  .head-date {
    width: 7.5rem;
    text-align: right;
  }
  .col-dur {
    width: 3rem;
    text-align: right;
  }
  .col-dur.dur {
    color: var(--muted);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }
  .col-plays {
    width: 3rem;
    justify-content: flex-end;
  }
  .plays {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .like.liked {
    color: #ef4444;
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
  li.current:not(.playing) .thumb-play {
    opacity: 1;
  }

  @media (hover: hover) {
    li.song-row:hover .thumb-play {
      opacity: 1;
    }
  }
  /* The playing track shows the live sound-wave by default; hovering hides it
     so the play/pause control underneath is reachable. */
  .thumb-wave {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    transition: opacity 0.12s;
  }
  @media (hover: hover) {
    li.song-row:hover .thumb-wave {
      opacity: 0;
    }
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
  .muted {
    color: var(--muted);
    padding: 1rem;
  }

  @media (max-width: 768px) {
    .search {
      flex-basis: 100%;
      max-width: none;
    }
    /* Track on the left, controls on the right (flex handles the split). Date,
       plays and duration are dropped to keep rows readable on phones — hide
       both the body cells and their header labels so the columns line up. */
    .col-date,
    .head-date,
    .col-plays,
    .col-dur {
      display: none;
    }
    .row {
      gap: 0.6rem;
    }
    .action {
      padding: 0.4rem;
    }
  }
</style>
