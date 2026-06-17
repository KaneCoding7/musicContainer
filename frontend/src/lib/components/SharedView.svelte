<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PlaylistMembers from "$lib/components/PlaylistMembers.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import {
    addSongToPlaylist,
    removeSongFromPlaylist,
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
  let addId = $state<string>("");
  let saving = $state(false);
  let saved = $state(false);

  async function saveToMine() {
    if (!open || saving) return;
    saving = true;
    error = null;
    try {
      await copySharedPlaylist(open.id);
      saved = true;
      onCopied?.();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save playlist";
    } finally {
      saving = false;
    }
  }

  // Songs in my library not already in the open shared playlist (for adding).
  const addable = $derived(
    songVm.songs.filter((s) => !songs.some((ps) => ps.id === s.id))
  );

  async function refreshSongs() {
    if (open) songs = await fetchSharedPlaylistSongs(open.id);
  }

  async function addSelected() {
    const id = Number(addId);
    if (!open || !id) return;
    error = null;
    try {
      await addSongToPlaylist(open.id, id);
      await refreshSongs();
      addId = "";
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

  onMount(async () => {
    try {
      playlists = await fetchSharedWithMe();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load shared playlists";
    }
  });

  async function openPlaylist(p: SharedPlaylist) {
    error = null;
    saved = false;
    try {
      songs = await fetchSharedPlaylistSongs(p.id);
      open = p;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load songs";
    }
  }
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if open}
  <button class="back" onclick={() => (open = null)}>
    <Icon name="arrow_back" size={20} /> Shared with me
  </button>
  <div class="head">
    <span class="big-art">
      {#if open.coverSongId != null}
        <img src={thumbUrl(open.coverSongId, 512)} alt="" />
      {:else}
        <Icon name="queue_music" size={48} />
      {/if}
    </span>
    <div>
      <h3>{open.name} {#if open.canEdit}<span class="edit-tag">collaborative</span>{/if}</h3>
      <p class="muted">Shared by {open.ownerName} · {songs.length} tracks</p>
      <div class="head-btns">
        {#if songs.length > 0}
          <button class="play-all" onclick={() => songVm.playQueue(songs, 0)}>
            <Icon name="play_arrow" fill size={20} /> Play
          </button>
          <button class="shuffle-all" onclick={() => songVm.shufflePlay(songs)}>
            <Icon name="shuffle" size={18} /> Shuffle
          </button>
        {/if}
        <button class="save-btn" onclick={saveToMine} disabled={saving || saved}>
          <Icon name={saved ? "check_circle" : "playlist_add"} size={18} />
          {saved ? "Saved to your playlists" : saving ? "Saving…" : "Add to my playlists"}
        </button>
      </div>
    </div>
  </div>

  <PlaylistMembers playlistId={open.id} />

  {#if open.canEdit && addable.length > 0}
    <div class="add-row">
      <select bind:value={addId}>
        <option value="" disabled selected>Add a song from your library…</option>
        {#each addable as s (s.id)}
          <option value={String(s.id)}>{s.originalFilename}</option>
        {/each}
      </select>
      <button onclick={addSelected} disabled={!addId}>Add</button>
    </div>
  {/if}

  <ol>
    {#each songs as song, i (song.id)}
      {@const isCurrent = song.id === songVm.currentSong?.id}
      <li class:current={isCurrent}>
        <button class="track" onclick={() => songVm.playQueue(songs, i)}>
          <span class="num">{i + 1}</span>
          <span class="t-meta">
            <span class="t-name">{song.originalFilename}</span>
            {#if song.artist}<span class="t-artist">{song.artist}</span>{/if}
            {#if song.addedBy}<span class="t-added">Added by {song.addedBy}</span>{/if}
          </span>
        </button>
        {#if open.canEdit}
          <button
            class="remove"
            title="Remove from playlist"
            aria-label="Remove from playlist"
            onclick={() => removeSong(song.id)}><Icon name="close" size={18} /></button
          >
        {/if}
      </li>
    {/each}
  </ol>
{:else if playlists.length === 0}
  <p class="muted">No one has shared a playlist with you yet.</p>
{:else}
  <div class="grid">
    {#each playlists as p (p.id)}
      <button class="card" onclick={() => openPlaylist(p)}>
        <span class="cover">
          {#if p.coverSongId != null}
            <img src={thumbUrl(p.coverSongId, 512)} alt="" />
          {:else}
            <Icon name="queue_music" size={26} />
          {/if}
        </span>
        <span class="card-name">{p.name}</span>
        <span class="card-sub">by {p.ownerName} · {p.trackCount ?? 0} tracks</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
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
  .card:hover {
    background: var(--hover);
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
  .cover img,
  .big-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
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
  .back:hover {
    color: var(--text);
  }
  .head {
    display: flex;
    gap: 1.25rem;
    align-items: flex-end;
    margin-bottom: 1.5rem;
  }
  .big-art {
    width: 140px;
    height: 140px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.6rem;
    color: var(--dim);
    overflow: hidden;
  }
  .head h3 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .head-btns {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 2rem;
    font-weight: 600;
    cursor: pointer;
  }
  .play-all:hover {
    background: var(--accent-hover);
  }
  .shuffle-all {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .shuffle-all:hover {
    background: var(--hover);
  }
  .save-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .save-btn:hover:not(:disabled) {
    background: var(--hover);
  }
  .save-btn:disabled {
    opacity: 0.7;
    cursor: default;
  }
  ol {
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
  .remove {
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
  .remove:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .add-row select {
    flex: 1;
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    color: var(--text);
  }
  .add-row button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
  }
  .add-row button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  .track {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0.75rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .track:hover {
    background: var(--hover);
  }
  .num {
    width: 1.5rem;
    color: var(--dim);
    text-align: right;
  }
  .t-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .t-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t-artist {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .t-added {
    color: var(--dim);
    font-size: 0.72rem;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--danger-text);
    background: var(--danger-bg);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }
</style>
