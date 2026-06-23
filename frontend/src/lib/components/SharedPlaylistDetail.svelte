<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import PlaylistMembers from "$lib/components/PlaylistMembers.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { reorderHandle } from "$lib/actions/reorderHandle";
  import { copySongToLibrary, thumbUrl } from "$lib/services/songService";
  import {
    addSongToPlaylist,
    downloadPlaylistZip,
    playlistImageUrl,
    removeSongFromPlaylist,
    reorderPlaylist,
  } from "$lib/services/playlistService";
  import {
    fetchSharedPlaylistSongs,
    type SharedPlaylist,
  } from "$lib/services/shareService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    songVm,
    playlist,
    onClose,
    onChanged,
  }: {
    songVm: SongViewModel;
    playlist: SharedPlaylist;
    onClose: () => void;
    onChanged?: () => void; // bump the grid (track counts) after an edit
  } = $props();

  let songs = $state<Song[]>([]);
  let error = $state<string | null>(null);
  let reordering = $state(false);
  let orgNoteOpen = $state(false); // collapsed "what's this?" explainer
  let downloading = $state(false);

  // Download as a zip, with a spinner while the server tags + bundles tracks.
  async function downloadZip() {
    if (downloading) return;
    downloading = true;
    try {
      await downloadPlaylistZip(playlist.id, playlist.name);
    } catch (e) {
      error = e instanceof Error ? e.message : "Download failed";
    } finally {
      downloading = false;
    }
  }
  let addOpen = $state(false);
  let addQuery = $state("");
  let addedToLib = $state<Set<number>>(new Set());
  let addingLib = $state<number | null>(null);

  // (Re)load songs only when the open playlist actually changes — not when the
  // parent merely hands us a fresh object for the same playlist (e.g. after a
  // track-count refresh), which would otherwise reset the add panel.
  let loadedId = -1;
  $effect(() => {
    const id = playlist.id;
    if (id === loadedId) return;
    loadedId = id;
    error = null;
    reordering = false;
    addOpen = false;
    addQuery = "";
    fetchSharedPlaylistSongs(id)
      .then((s) => (songs = s))
      .catch(
        (e) => (error = e instanceof Error ? e.message : "Failed to load songs")
      );
  });

  // True if I already own this song (it's in my library).
  const ownsSong = (id: number) => songVm.songs.some((s) => s.id === id);

  // Total runtime, e.g. "4h 3m" or "12m" (empty if unknown). Mirrors the owner view.
  const totalDuration = $derived.by(() => {
    const secs = songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
    if (secs <= 0) return "";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  });

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

  // --- Add songs (collaborators) ---
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
    songs = await fetchSharedPlaylistSongs(playlist.id);
    onChanged?.();
  }

  async function addSong(songId: number) {
    error = null;
    try {
      await addSongToPlaylist(playlist.id, songId);
      await refreshSongs();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to add song";
    }
  }

  async function removeSong(songId: number) {
    const song = songs.find((s) => s.id === songId);
    const label = song?.originalFilename ?? "this track";
    if (!confirm(`Remove "${label}" from this playlist?`)) return;
    error = null;
    try {
      await removeSongFromPlaylist(playlist.id, songId);
      await refreshSongs();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to remove song";
    }
  }

  // --- Drag-to-reorder (collaborators) ---
  function moveTrack(from: number, to: number) {
    if (from === to) return;
    const arr = [...songs];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const previous = songs;
    songs = arr; // optimistic
    reorderPlaylist(
      playlist.id,
      arr.map((s) => s.id)
    )
      .then(() => onChanged?.())
      .catch((e) => {
        songs = previous; // revert on error
        error = e instanceof Error ? e.message : "Failed to reorder";
      });
  }

  function playFrom(index: number) {
    songVm.playQueue(songs, index);
  }
</script>

{#snippet detailActions()}
  <div class="detail-actions">
    {#if playlist.canEdit && songs.length > 1}
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
      <button
        class="head-action"
        class:loading={downloading}
        title="Download as zip"
        aria-label="Download playlist as zip"
        disabled={downloading}
        onclick={downloadZip}
      >
        <Icon name={downloading ? "progress_activity" : "download"} size={20} />
      </button>
    {/if}
  </div>
{/snippet}

<button class="back" onclick={onClose}>
  <Icon name="arrow_back" size={20} /> All playlists
</button>

{#if error}<p class="error">{error}</p>{/if}

<div class="detail">
  <div class="head">
    <span class="cover-lg">
      {#if playlist.hasImage}
        <img src={playlistImageUrl(playlist.id, 512)} alt="" />
      {:else if playlist.coverSongId != null}
        <img src={thumbUrl(playlist.coverSongId, 512)} alt="" />
      {:else}
        <Icon name="queue_music" size={48} />
      {/if}
    </span>
    <div class="head-info">
      <h3>
        <span class="pl-name">{playlist.name}</span>
        {#if playlist.isOrg}<span class="edit-tag">team</span>{:else if playlist.isGlobal}<span class="edit-tag">global</span>{:else if playlist.canEdit}<span class="edit-tag">collaborative</span>{/if}
      </h3>
      <p class="muted">
        {songs.length}
        {songs.length === 1 ? "track" : "tracks"}
        {#if totalDuration}· {totalDuration}{/if}
      </p>
      <PlaylistMembers playlistId={playlist.id} />
      <!-- Mobile: icons stay in the header under the people pill. -->
      <div class="head-actions-mobile">
        {@render detailActions()}
      </div>
    </div>
  </div>

  <!-- Desktop: Play/Shuffle on the left, the permission-gated icons on the
       right of the same row. On mobile this row is just Play/Shuffle. -->
  <div class="toolbar-row">
    {#if songs.length > 0}
      <div class="actions-bar">
        <PlayActions vm={songVm} {songs} />
      </div>
    {/if}
    <div class="head-actions-desktop">
      {@render detailActions()}
    </div>
  </div>

  {#if playlist.isOrg || playlist.isGlobal}
    <div class="org-info">
      <button
        class="org-tag"
        class:on={orgNoteOpen}
        aria-expanded={orgNoteOpen}
        onclick={() => (orgNoteOpen = !orgNoteOpen)}
      >
        <Icon name={playlist.isGlobal ? "public" : "group"} size={14} />
        What's this?
        <Icon name={orgNoteOpen ? "expand_less" : "expand_more"} size={16} />
      </button>
      {#if orgNoteOpen}
        <p class="org-note">
          {#if playlist.isGlobal}
            <strong>Global playlist.</strong> Everyone on the system shares this
            one. Add songs from your library and they show up for everybody —
            anyone can play them or save them to their own library. You can only
            remove the tracks <em>you</em> added.
          {:else}
            <strong>Team playlist.</strong> Everyone at {playlist.ownerName} shares
            this one. Add songs from your library and they show up for the whole
            team — anyone can play them or save them to their own library. You can
            only remove the tracks <em>you</em> added.
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  {#if songs.length === 0}
    <p class="muted">No songs in this playlist yet.</p>
  {:else}
    <div class="list-head" aria-hidden="true">
      <span class="head-title">Title</span>
      <span class="head-plays">Plays</span>
      <span class="head-menu"></span>
      {#if playlist.canEdit}<span class="head-remove"></span>{/if}
    </div>
    <ol>
      {#each songs as song, i (song.id)}
        {@const isCurrent = song.id === songVm.currentSong?.id}
        {@const canRemove =
          playlist.isOrg || playlist.isGlobal ? !!song.addedByMe : playlist.canEdit}
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
          <span
            class="plays"
            title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
          >
            <Icon name="play_arrow" size={13} />{song.playCount}
          </span>
          <SongMenu
            vm={songVm}
            {song}
            onRemoveFromPlaylist={canRemove ? () => removeSong(song.id) : undefined}
            onAddToLibrary={() => addToLibrary(song.id)}
            inLibrary={ownsSong(song.id) || addedToLib.has(song.id)}
            canModify={!!song.ownedByMe}
            onChanged={refreshSongs}
          />
          {#if canRemove}
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

  {#if playlist.canEdit}
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

<style>
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
  .head {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    margin-bottom: 1.25rem;
  }
  .cover-lg {
    flex-shrink: 0;
    width: 168px;
    height: 168px;
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
  /* Always stack the collaborative tag under the title. */
  .head-info h3 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    min-width: 0;
  }
  .pl-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .head-info .muted {
    margin: 0 0 0.6rem;
    padding: 0;
    font-size: 0.82rem;
  }
  .edit-tag {
    flex-shrink: 0;
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
  .head-action:disabled {
    cursor: default;
  }
  .head-action.loading :global(.material-symbols-rounded) {
    animation: spin 1.1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
  /* Desktop: Play/Shuffle (left) and the permission-gated icons (right) share
     one row. On mobile the icons live in the header instead. */
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  /* Collapsed "what's this?" explainer on Team playlists. */
  .org-info {
    margin: 0 0 1rem;
  }
  .org-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.6rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 1rem;
    color: var(--muted);
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .org-tag:hover {
      background: var(--border-strong);
      color: var(--text);
    }
  }
  .org-tag.on {
    background: var(--active-bg);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .org-note {
    margin: 0.5rem 0 0;
    padding: 0.7rem 0.9rem;
    background: var(--active-bg);
    border: 1px solid var(--border-strong);
    border-radius: 0.6rem;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .org-note strong {
    color: var(--text);
  }
  .actions-bar {
    margin-bottom: 0;
  }
  .head-actions-desktop {
    margin-left: auto;
  }
  .head-actions-mobile {
    display: none;
  }
  /* Track-list column headers (web only). */
  .list-head {
    display: flex;
    align-items: center;
    padding: 0 0 0.5rem 0.5rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .head-title {
    flex: 1;
    min-width: 0;
  }
  .head-plays {
    width: 3rem;
    text-align: right;
  }
  .head-menu {
    width: 2.25rem;
  }
  .head-remove {
    width: 2.45rem;
  }
  .plays {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.15rem;
    width: 3rem;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
  }
  @media (max-width: 768px) {
    /* No track-list column headers on phones; icons move into the header.
       Scoped to .detail so it wins regardless of source order. */
    .detail .list-head {
      display: none;
    }
    .head-actions-desktop {
      display: none;
    }
    .head-actions-mobile {
      display: block;
      margin-top: 0.25rem;
    }
    .head-actions-mobile .detail-actions {
      gap: 0;
    }
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
