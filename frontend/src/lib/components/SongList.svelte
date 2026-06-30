<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import Dropdown from "$lib/components/Dropdown.svelte";
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

  // Sort options for the custom dropdown.
  const SORT_OPTIONS: { value: string; label: string }[] = [
    { value: "added", label: "Recently added" },
    { value: "name", label: "Name (A–Z)" },
    { value: "plays", label: "Most played" },
    { value: "duration", label: "Duration" },
  ];
  // Playlists as dropdown options (bulk "add to playlist").
  const playlistOptions = $derived(
    playlists.map((p) => ({ value: String(p.id), label: p.name }))
  );

  // Collapsible search: a lone icon until clicked, then a search field expands.
  let searchOpen = $state(false);
  function autofocus(node: HTMLInputElement) {
    node.focus();
  }
  function collapseSearchIfEmpty() {
    if (!vm.query.trim()) searchOpen = false;
  }

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

  // Index (within filteredSongs) of the last plain click — the anchor for a
  // subsequent shift-click range select.
  let anchor = $state<number | null>(null);

  // Click in select mode: shift-click selects every row between the anchor and
  // this one (inclusive), keeping anything already selected; a plain click
  // toggles just this row and becomes the new anchor.
  function selectAt(i: number, e: MouseEvent) {
    const song = vm.filteredSongs[i];
    if (!song) return;
    if (e.shiftKey && anchor !== null) {
      const [lo, hi] = anchor < i ? [anchor, i] : [i, anchor];
      const next = new Set(selected);
      for (let k = lo; k <= hi; k++) next.add(vm.filteredSongs[k].id);
      selected = next;
    } else {
      toggleSelect(song.id);
      anchor = i;
    }
  }

  function exitSelect() {
    selecting = false;
    anchor = null;
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
    <div class="control-row">
    <div class="actions-bar">
      <PlayActions {vm} songs={vm.filteredSongs} queue={false} />
    </div>
    <div class="toolbar">
      <div class="search" class:open={searchOpen}>
        <button
          class="icon-btn search-icon"
          title="Search"
          aria-label="Search"
          onclick={() => (searchOpen ? collapseSearchIfEmpty() : (searchOpen = true))}
        >
          <Icon name="search" size={20} />
        </button>
        {#if searchOpen}
          <input
            id="song-search"
            type="search"
            placeholder="Search"
            bind:value={vm.query}
            use:autofocus
            onblur={collapseSearchIfEmpty}
          />
        {/if}
      </div>
      <Dropdown
        icon="sort"
        ariaLabel="Sort songs"
        align="right"
        options={SORT_OPTIONS}
        value={vm.sortBy}
        onSelect={(v) => (vm.sortBy = v as typeof vm.sortBy)}
      />
      {#if (onBulkAdd && playlists.length > 0) || onBulkEdit}
        <button
          class="icon-btn select-btn"
          class:active={selecting}
          title={selecting ? "Done selecting" : "Select"}
          aria-label={selecting ? "Done selecting" : "Select"}
          onclick={() => (selecting ? exitSelect() : (selecting = true))}
        >
          <Icon name={selecting ? "check" : "playlist_add"} size={20} />
        </button>
      {/if}
    </div>
    </div>

    {#if selecting}
      <div class="selbar">
        <span class="count">{selected.size} selected</span>
        {#if onBulkAdd && playlists.length > 0}
          <Dropdown
            placeholder="Add to playlist…"
            ariaLabel="Add selected to playlist"
            options={playlistOptions}
            value={addTarget}
            onSelect={(v) => (addTarget = v)}
          />
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
          use:swipeQueue={{
            onQueue: () => vm.addToQueue(song),
            onLike: () => vm.toggleLike(song.id),
          }}
        >
          {#if selecting}
            <span class="col-index">
              <button
                class="check"
                role="checkbox"
                aria-checked={selected.has(song.id)}
                aria-label="Select song"
                onclick={(e) => selectAt(i, e)}
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
            onclick={(e) =>
              selecting
                ? selectAt(i, e)
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
  /* Play/Shuffle (left) and the search/sort/select controls (right) share one row. */
  .control-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0.6rem 0 0.85rem;
  }
  .control-row .actions-bar {
    margin: 0;
    flex-shrink: 0;
  }
  /* The toolbar takes the remaining width and right-aligns; the search then
     expands leftward into that space instead of wrapping to a new line. */
  .control-row .toolbar {
    margin: 0;
    flex: 1;
    min-width: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  /* Round icon button used by the collapsed search + the select toggle. */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    color: var(--muted);
    cursor: pointer;
  }
  @media (hover: hover) {
    .icon-btn:hover {
      background: var(--border-strong);
      color: var(--text);
    }
  }
  .icon-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    padding: 0.3rem 0.9rem;
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
  /* Collapsed: just the icon button. Open: expands into a search pill. */
  .search {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .search.open {
    flex: 0 1 13rem;
    min-width: 0;
    max-width: 13rem;
    height: 2rem;
    box-sizing: border-box;
    gap: 0.4rem;
    padding: 0 1.1rem 0 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--dim);
  }
  /* Inside the open pill the search icon is a plain prefix, not its own circle. */
  .search.open .search-icon {
    width: auto;
    height: auto;
    background: transparent;
    border: none;
    color: var(--dim);
  }
  .search input {
    flex: 1;
    min-width: 0; /* allow the input to shrink so the toolbar can't overflow */
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
  /* In select mode, shift-click range-selects; stop the browser from
     highlighting the text spanned by the shift-click. */
  .song-list ul.selecting {
    user-select: none;
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
    gap: 1.6rem;
    flex-shrink: 0;
  }
  .list-head {
    padding: 0 0.75rem 0.5rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0;
  }
  .list-head .col-dur,
  .list-head .col-plays {
    display: inline-flex;
    justify-content: flex-end;
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
  /* Fixed widths keep the header labels lined up over their values. */
  .col-date {
    width: 7.5rem;
    text-align: right;
    color: var(--dim);
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
    color: var(--dim);
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
    color: var(--dim);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
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
    /* Keep the header (stats, play actions, search/sort) fixed and scroll only
       the song list. The in-view title is hidden on mobile, so the list fills
       the content height. */
    .song-list {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .song-list > :not(ul) {
      flex-shrink: 0;
    }
    .song-list ul {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
    /* The toolbar stays right-aligned; the collapsed search remains a compact
       icon on the right (next to sort). Only when OPENED does it expand to fill
       the row, with the sort dropdown to its right — both the same height. */
    .toolbar {
      flex-wrap: nowrap;
      margin-top: 0.25rem;
      align-items: stretch;
    }
    .search.open {
      flex: 1 1 auto;
      max-width: none;
    }
    /* Multi-select isn't offered on phones. */
    .toolbar .select-btn,
    .selbar {
      display: none;
    }
    /* No column headers on phones. Scoped to .song-list so it can't be
       overridden by a later base rule regardless of source order. */
    .song-list .list-head {
      display: none;
    }
    /* Date, plays and duration body cells are dropped to keep rows readable. */
    .song-list .col-date,
    .song-list .col-plays,
    .song-list .col-dur {
      display: none;
    }
    .row {
      gap: 0.6rem;
    }
  }
</style>
