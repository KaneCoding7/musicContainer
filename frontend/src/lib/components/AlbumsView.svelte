<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  let openAlbum = $state<string | null>(null);

  interface Album {
    name: string;
    songs: Song[];
    artId: number | null; // id of a track with embedded art, for the cover
  }

  // Group the library by album name (untagged tracks go under "Singles").
  const albums = $derived.by((): Album[] => {
    const map = new Map<string, Song[]>();
    for (const s of vm.songs) {
      const key = s.album?.trim() || "Singles";
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

  const current = $derived(albums.find((a) => a.name === openAlbum) ?? null);

  function durationLabel(songs: Song[]): string {
    return `${songs.length} ${songs.length === 1 ? "track" : "tracks"}`;
  }
</script>

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to see albums.</p>
{:else if current}
  <button class="back" onclick={() => (openAlbum = null)}>
    <Icon name="arrow_back" size={20} /> All albums
  </button>
  <div class="album-head">
    <span class="big-art">
      {#if current.artId !== null}
        <img src={thumbUrl(current.artId, 512)} alt="" />
      {:else}
        <Icon name="album" size={48} />
      {/if}
    </span>
    <div>
      <h3>{current.name}</h3>
      <p class="muted">{durationLabel(current.songs)}</p>
      <PlayActions {vm} songs={current.songs} />
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
            {#if song.artist}<span class="t-artist">{song.artist}</span>{/if}
          </span>
          <span
            class="plays"
            title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
          >
            <Icon name="play_arrow" size={13} />{song.playCount}
          </span>
        </button>
      </li>
    {/each}
  </ol>
{:else}
  <div class="grid">
    {#each albums as album (album.name)}
      <button class="card" onclick={() => (openAlbum = album.name)}>
        <span class="cover">
          {#if album.artId !== null}
            <img src={thumbUrl(album.artId, 512)} alt="" />
          {:else}
            <Icon name="album" size={42} />
          {/if}
        </span>
        <span class="card-name">{album.name}</span>
        <span class="card-sub">{durationLabel(album.songs)}</span>
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
  .cover img {
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
  .album-head {
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
  .big-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .album-head h3 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
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
    flex: 1;
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
</style>
