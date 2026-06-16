<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { artUrl } from "$lib/services/songService";
  import {
    fetchSharedPlaylistSongs,
    fetchSharedWithMe,
    type SharedPlaylist,
  } from "$lib/services/shareService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { songVm }: { songVm: SongViewModel } = $props();

  let playlists = $state<SharedPlaylist[]>([]);
  let open = $state<SharedPlaylist | null>(null);
  let songs = $state<Song[]>([]);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      playlists = await fetchSharedWithMe();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load shared playlists";
    }
  });

  async function openPlaylist(p: SharedPlaylist) {
    error = null;
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
        <img src={artUrl(open.coverSongId)} alt="" />
      {:else}
        <Icon name="queue_music" size={48} />
      {/if}
    </span>
    <div>
      <h3>{open.name}</h3>
      <p class="muted">Shared by {open.ownerName} · {songs.length} tracks</p>
      {#if songs.length > 0}
        <button class="play-all" onclick={() => songVm.playQueue(songs, 0)}>
          <Icon name="play_arrow" fill size={20} /> Play
        </button>
      {/if}
    </div>
  </div>
  <ol>
    {#each songs as song, i (song.id)}
      {@const isCurrent = song.id === songVm.currentSong?.id}
      <li class:current={isCurrent}>
        <button class="track" onclick={() => songVm.playQueue(songs, i)}>
          <span class="num">{i + 1}</span>
          <span class="t-meta">
            <span class="t-name">{song.originalFilename}</span>
            {#if song.artist}<span class="t-artist">{song.artist}</span>{/if}
          </span>
        </button>
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
            <img src={artUrl(p.coverSongId)} alt="" />
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
  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.75rem;
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
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
  }
  .track {
    width: 100%;
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
