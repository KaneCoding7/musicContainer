<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  let openArtist = $state<string | null>(null);

  interface Artist {
    name: string;
    songs: Song[];
    artId: number | null; // id of a track with embedded art, for the avatar
  }

  // Group the library by artist (untagged tracks go under "Unknown Artist").
  const artists = $derived.by((): Artist[] => {
    const map = new Map<string, Song[]>();
    for (const s of vm.songs) {
      const key = s.artist?.trim() || "Unknown Artist";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([name, songs]) => ({
        name,
        songs,
        artId: songs.find((s) => s.hasArt)?.id ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const current = $derived(artists.find((a) => a.name === openArtist) ?? null);

  function trackLabel(songs: Song[]): string {
    return `${songs.length} ${songs.length === 1 ? "track" : "tracks"}`;
  }
</script>

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to see artists.</p>
{:else if current}
  <button class="back" onclick={() => (openArtist = null)}>
    <Icon name="arrow_back" size={20} /> All artists
  </button>
  <div class="head">
    <span class="avatar">
      {#if current.artId !== null}
        <img src={thumbUrl(current.artId, 512)} alt="" />
      {:else}
        <Icon name="person" size={48} />
      {/if}
    </span>
    <div>
      <h3>{current.name}</h3>
      <p class="muted">{trackLabel(current.songs)}</p>
      <button class="play-all" onclick={() => vm.playQueue(current.songs, 0)}>
        <Icon name="play_arrow" fill size={20} /> Play
      </button>
    </div>
  </div>
  <ol>
    {#each current.songs as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li class:current={isCurrent}>
        <button class="track" onclick={() => vm.playQueue(current.songs, i)}>
          <span class="num">{i + 1}</span>
          <span class="t-meta">
            <span class="t-name">{song.originalFilename}</span>
            {#if song.album}<span class="t-sub">{song.album}</span>{/if}
          </span>
        </button>
      </li>
    {/each}
  </ol>
{:else}
  <div class="grid">
    {#each artists as artist (artist.name)}
      <button class="card" onclick={() => (openArtist = artist.name)}>
        <span class="avatar">
          {#if artist.artId !== null}
            <img src={thumbUrl(artist.artId, 512)} alt="" />
          {:else}
            <Icon name="person" size={40} />
          {/if}
        </span>
        <span class="card-name">{artist.name}</span>
        <span class="card-sub">{trackLabel(artist.songs)}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 1rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--surface-2);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: center;
    color: inherit;
    font: inherit;
  }
  .card:hover {
    background: var(--hover);
  }
  .avatar {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 50%;
    color: var(--dim);
    overflow: hidden;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .card-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .card-sub {
    color: var(--muted);
    font-size: 0.8rem;
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
    align-items: center;
    margin-bottom: 1.5rem;
  }
  .head .avatar {
    width: 120px;
    height: 120px;
    flex-shrink: 0;
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
  .t-sub {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
