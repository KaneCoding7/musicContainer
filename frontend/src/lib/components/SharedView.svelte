<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import PlaylistMembers from "$lib/components/PlaylistMembers.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { reorderHandle } from "$lib/actions/reorderHandle";
  import { copySongToLibrary, thumbUrl } from "$lib/services/songService";
  import {
    addSongToPlaylist,
    deletePlaylist,
    playlistImageUrl,
    playlistZipUrl,
    removeSongFromPlaylist,
    reorderPlaylist,
  } from "$lib/services/playlistService";
  import {
    copySharedPlaylist,
    fetchSharedPlaylistSongs,
    fetchSharedWithMe,
    type SharedPlaylist,
  } from "$lib/services/shareService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  // onCopied lets the page refresh the personal playlist list after saving.
  let { songVm, onCopied }: { songVm: SongViewModel; onCopied?: () => void } =
    $props();

  let playlists = $state<SharedPlaylist[]>([]);
  let open = $state<SharedPlaylist | null>(null);
  let songs = $state<Song[]>([]);
  let error = $state<string | null>(null);
  let saving = $state(false);
  // The id of my saved copy of the open shared playlist (null = not saved).
  let savedCopyId = $state<number | null>(null);

  // Search/filter the shared grid by name or owner.
  let query = $state("");
  const filteredPlaylists = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q
      ? playlists.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.ownerName.toLowerCase().includes(q)
        )
      : playlists;
  });

  // Per-song "add to my library" state (keyed by the shared song's id).
  let addedToLib = $state<Set<number>>(new Set());
  let addingLib = $state<number | null>(null);
  // True if I already own this song (it's in my library).
  const ownsSong = (id: number) => songVm.songs.some((s) => s.id === id);

  async function addToLibrary(songId: number) {
    if (addingLib !== null || addedToLib.has(songId)) return;
    addingLib = songId;
    error = null;
    try {
      const copied = await copySongToLibrary(songId);
      songVm.songs = [copied, ...songVm.songs];
      addedToLib = new Set([...addedToLib, songId]);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to add to library";
    } finally {
      addingLib = null;
    }
  }

  // Toggles the open shared playlist in/out of my personal playlists.
  async function toggleSave() {
    if (!open || saving) return;
    saving = true;
    error = null;
    try {
      if (savedCopyId !== null) {
        await deletePlaylist(savedCopyId);
        savedCopyId = null;
      } else {
        const copy = await copySharedPlaylist(open.id);
        savedCopyId = copy.id;
      }
      onCopied?.(); // refresh the personal playlist list
      playlists = await fetchSharedWithMe(); // keep saved-state fresh
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to update your library";
    } finally {
      saving = false;
    }
  }

  // --- Add songs (collaborators) ---
  let addOpen = $state(false);
  let addQuery = $state("");
  // Songs in my library not already in the open shared playlist.
  const addableSongs = $derived(
    songVm.songs.filter((s) => !songs.some((ps) => ps.id === s.id))
  );
  const ADD_LIMIT = 50;
  const addResults = $derived.by(() => {
    const q = addQuery.trim().toLowerCase();
    const list = q
      ? addableSongs.filter(
          (s) =>
            s.originalFilename.toLowerCase().includes(q) ||
            (s.artist ?? "").toLowerCase().includes(q) ||
            (s.album ?? "").toLowerCase().includes(q)
        )
      : addableSongs;
    return list.slice(0, ADD_LIMIT);
  });

  async function refreshSongs() {
    if (open) songs = await fetchSharedPlaylistSongs(open.id);
  }

  async function addSong(songId: number) {
    if (!open) return;
    error = null;
    try {
      await addSongToPlaylist(open.id, songId);
      await refreshSongs();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to add song";
    }
  }

  async function removeSong(songId: number) {
    if (!open) return;
    error = null;
    try {
      await removeSongFromPlaylist(open.id, songId);
      await refreshSongs();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to remove song";
    }
  }

  // --- Drag-to-reorder (collaborators) ---
  let reordering = $state(false);
  function moveTrack(from: number, to: number) {
    if (from === to || !open) return;
    const arr = [...songs];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const previous = songs;
    songs = arr; // optimistic
    reorderPlaylist(
      open.id,
      arr.map((s) => s.id)
    ).catch((e) => {
      songs = previous; // revert on error
      error = e instanceof Error ? e.message : "Failed to reorder";
    });
  }

  function playFrom(index: number) {
    songVm.playQueue(songs, index);
  }

  onMount(async () => {
    try {
      playlists = await fetchSharedWithMe();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load shared playlists";
    }
  });

  async function openPlaylist(p: SharedPlaylist) {
    error = null;
    savedCopyId = p.savedCopyId;
    reordering = false;
    addOpen = false;
    addQuery = "";
    try {
      songs = await fetchSharedPlaylistSongs(p.id);
      open = p;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load songs";
    }
  }
  function closePlaylist() {
    open = null;
  }
</script>

<div class="shared">
  {#if open === null}
    {#if playlists.length > 0}
      <div class="pl-toolbar">
        <div class="search">
          <Icon name="search" size={20} />
          <input type="search" placeholder="Search shared playlists…" bind:value={query} />
        </div>
      </div>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    {#if playlists.length === 0}
      <p class="muted">No one has shared a playlist with you yet.</p>
    {:else if filteredPlaylists.length === 0}
      <p class="muted">No playlists match “{query}”.</p>
    {:else}
      <div class="cards">
        {#each filteredPlaylists as p (p.id)}
          <button class="card" onclick={() => openPlaylist(p)}>
            <span class="cover">
              {#if p.hasImage}
                <img src={playlistImageUrl(p.id, 512)} alt="" />
              {:else if p.coverSongId != null}
                <img src={thumbUrl(p.coverSongId, 512)} alt="" />
              {:else}
                <Icon name="queue_music" size={26} />
              {/if}
            </span>
            <span class="card-text">
              <span class="card-name">{p.name}</span>
              <span class="card-sub">
                by {p.ownerName} · {p.trackCount ?? 0}
                {(p.trackCount ?? 0) === 1 ? "track" : "tracks"}
              </span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <button class="back" onclick={closePlaylist}>
      <Icon name="arrow_back" size={20} /> Shared with me
    </button>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="detail">
      <div class="head">
        <span class="cover-lg">
          {#if open.hasImage}
            <img src={playlistImageUrl(open.id, 512)} alt="" />
          {:else if open.coverSongId != null}
            <img src={thumbUrl(open.coverSongId, 512)} alt="" />
          {:else}
            <Icon name="queue_music" size={48} />
          {/if}
        </span>
        <div class="head-info">
          <h3>
            {open.name}
            {#if open.canEdit}<span class="edit-tag">collaborative</span>{/if}
          </h3>
          <p class="muted">
            Shared by {open.ownerName} · {songs.length}
            {songs.length === 1 ? "track" : "tracks"}
          </p>
          <div class="detail-actions">
            <button
              class="head-action"
              class:on={savedCopyId !== null}
              title={savedCopyId !== null ? "Remove from my playlists" : "Add to my playlists"}
              aria-label={savedCopyId !== null ? "Remove from my playlists" : "Add to my playlists"}
              onclick={toggleSave}
              disabled={saving}
              ><Icon name={savedCopyId !== null ? "bookmark_added" : "bookmark_add"} size={20} /></button
            >
            {#if open.canEdit && songs.length > 1}
              <button
                class="head-action"
                class:on={reordering}
                title={reordering ? "Done" : "Reorder"}
                aria-label={reordering ? "Done" : "Reorder"}
                onclick={() => (reordering = !reordering)}
                ><Icon name={reordering ? "check" : "swap_vert"} size={20} /></button
              >
            {/if}
            {#if songs.length > 0}
              <a
                class="head-action"
                href={playlistZipUrl(open.id)}
                title="Download as zip"
                aria-label="Download playlist as zip"><Icon name="download" size={20} /></a
              >
            {/if}
          </div>
        </div>
      </div>

      {#if songs.length > 0}
        <div class="actions-bar">
          <PlayActions vm={songVm} {songs} />
        </div>
      {/if}

      <PlaylistMembers playlistId={open.id} />

      {#if songs.length === 0}
        <p class="muted">No songs in this playlist yet.</p>
      {:else}
        <ol>
          {#each songs as song, i (song.id)}
            {@const isCurrent = song.id === songVm.currentSong?.id}
            <li
              class:current={isCurrent}
              class:playing={isCurrent && songVm.isPlaying}
              data-reorder-index={i}
              use:swipeQueue={{
                onQueue: () => songVm.playNext(song),
                disabled: reordering,
              }}
            >
              {#if reordering}
                <span
                  class="handle"
                  title="Drag to reorder"
                  use:reorderHandle={{ index: i, onMove: moveTrack }}
                >
                  <Icon name="drag_indicator" size={20} />
                </span>
              {/if}
              <button class="play-btn" onclick={() => playFrom(i)}>
                <span class="thumb">
                  {#if song.hasArt}
                    <img src={thumbUrl(song.id, 128)} alt="" />
                  {:else}
                    <Icon name="music_note" size={18} />
                  {/if}
                  <span class="thumb-play">
                    <Icon
                      name={isCurrent && songVm.isPlaying ? "pause" : "play_arrow"}
                      fill
                      size={20}
                    />
                  </span>
                  {#if isCurrent && songVm.isPlaying}
                    <span class="thumb-wave"><EqualizerBars size={18} /></span>
                  {/if}
                </span>
                <span class="name">{song.originalFilename}</span>
              </button>
              {#if song.addedBy}
                <span class="added-by" title={`Added by ${song.addedBy}`}>
                  <Icon name="person" size={13} />{song.addedBy}
                </span>
              {/if}
              {#if !ownsSong(song.id)}
                <button
                  class="to-lib"
                  class:done={addedToLib.has(song.id)}
                  class:loading={addingLib === song.id}
                  title={addedToLib.has(song.id) ? "In your library" : "Add to my library"}
                  aria-label="Add to my library"
                  disabled={addingLib !== null || addedToLib.has(song.id)}
                  onclick={() => addToLibrary(song.id)}
                >
                  <Icon
                    name={addedToLib.has(song.id)
                      ? "check_circle"
                      : addingLib === song.id
                        ? "progress_activity"
                        : "library_music"}
                    size={18}
                  />
                </button>
              {/if}
              {#if open.canEdit}
                <button
                  class="remove"
                  title="Remove from playlist"
                  aria-label="Remove from playlist"
                  onclick={() => removeSong(song.id)}><Icon name="close" size={20} /></button
                >
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      {#if open.canEdit}
        <div class="add-block">
          <button class="add-toggle" onclick={() => (addOpen = !addOpen)}>
            <Icon name={addOpen ? "expand_more" : "playlist_add"} size={18} />
            {addOpen ? "Done" : "Add songs"}
          </button>

          {#if addOpen}
            {#if addableSongs.length === 0}
              <p class="muted small">All your songs are already in this playlist.</p>
            {:else}
              <input
                class="add-search"
                type="text"
                placeholder="Search your library to add…"
                bind:value={addQuery}
              />
              {#if addResults.length === 0}
                <p class="muted small">No songs match “{addQuery}”.</p>
              {:else}
                <ul class="add-results">
                  {#each addResults as song (song.id)}
                    <li>
                      <span class="ar-meta">
                        <span class="ar-name">{song.originalFilename}</span>
                        {#if song.artist}<span class="ar-artist">{song.artist}</span>{/if}
                      </span>
                      <button
                        class="ar-add"
                        title="Add to playlist"
                        aria-label="Add to playlist"
                        onclick={() => addSong(song.id)}
                      >
                        <Icon name="playlist_add" size={18} />
                      </button>
                    </li>
                  {/each}
                </ul>
                {#if addResults.length === ADD_LIMIT}
                  <p class="muted small">Showing the first {ADD_LIMIT} — keep typing to narrow it down.</p>
                {/if}
              {/if}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pl-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .search {
    flex: 1;
    min-width: 0;
    max-width: 22rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1.1rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--dim);
  }
  .search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
  }
  .search input::placeholder {
    color: var(--dim);
  }
  @media (max-width: 768px) {
    .search {
      max-width: none;
    }
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.25rem 0;
    margin-bottom: 1rem;
    font: inherit;
  }
  @media (hover: hover) {
    .back:hover {
      color: var(--text);
    }
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
    color: inherit;
    font: inherit;
  }
  @media (hover: hover) {
    .cards .card:hover {
      background: var(--hover);
    }
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    margin-bottom: 1.25rem;
  }
  .cover-lg {
    flex-shrink: 0;
    width: 120px;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.6rem;
    color: var(--dim);
    overflow: hidden;
  }
  .cover-lg img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .head-info {
    min-width: 0;
  }
  .head-info h3 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-info .muted {
    margin: 0 0 0.6rem;
    padding: 0;
  }
  .edit-tag {
    font-size: 0.6rem;
    vertical-align: middle;
    padding: 0.1rem 0.4rem;
    background: var(--active-bg);
    color: var(--accent-text);
    border-radius: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
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
  @media (hover: hover) {
    .head-action:hover {
      background: var(--surface-2);
    }
  }
  .head-action.on {
    background: var(--active-bg);
    color: var(--accent-text);
  }
  .head-action:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .actions-bar {
    margin-bottom: 1rem;
  }
  ol {
    list-style: none;
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
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    padding: 0.6rem 0.5rem;
  }
  @media (hover: hover) {
    .play-btn:hover {
      background: var(--hover);
    }
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
    .play-btn:hover .thumb-play {
      opacity: 1;
    }
  }
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
    .play-btn:hover .thumb-wave {
      opacity: 0;
    }
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .added-by {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.76rem;
    font-weight: 400;
    color: var(--dim);
  }
  .to-lib {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.6rem;
    border-radius: 0.35rem;
  }
  @media (hover: hover) {
    .to-lib:hover:not(:disabled) {
      background: var(--surface-2);
      color: var(--accent-text);
    }
  }
  .to-lib.done {
    color: var(--accent-text);
    cursor: default;
  }
  .to-lib.loading :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
  @media (hover: hover) {
    .remove:hover {
      background: var(--danger-bg);
      color: var(--danger-text);
    }
  }
  .add-block {
    margin-top: 1rem;
  }
  .add-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.9rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .add-toggle:hover {
      background: var(--hover);
    }
  }
  .add-search {
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.6rem;
    padding: 0.5rem 1.1rem;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--text);
    font: inherit;
  }
  .add-search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .add-results {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .add-results li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.25rem;
    border-bottom: 1px solid var(--surface-2);
  }
  .ar-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .ar-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ar-artist {
    font-size: 0.78rem;
    color: var(--dim);
  }
  .ar-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0.35rem;
    background: transparent;
    border: none;
    color: var(--accent-text);
    border-radius: 0.35rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .ar-add:hover {
      background: var(--active-bg);
      color: var(--accent);
    }
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
