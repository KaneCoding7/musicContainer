<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { thumbUrl } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  // The open artist is driven by the URL (?artist=…) so it's deep-linkable
  // (e.g. from Home) and the browser back button returns to the artist list.
  const openArtist = $derived(page.url.searchParams.get("artist"));
  function openArtistView(name: string) {
    goto(`?view=artists&artist=${encodeURIComponent(name)}`, { noScroll: true });
  }
  function closeArtist() {
    goto("?view=artists", { noScroll: true });
  }

  interface Artist {
    name: string;
    songs: Song[];
    artId: number | null; // id of a track with embedded art, for the avatar
  }

  // Untagged tracks are grouped under this label so they're easy to find. The
  // card only appears when such tracks exist (no empty group), and it's pinned
  // to the end of the list.
  const NO_ARTIST = "No artist";

  // Group the library by artist.
  const artists = $derived.by((): Artist[] => {
    const map = new Map<string, Song[]>();
    for (const s of vm.songs) {
      const key = s.artist?.trim() || NO_ARTIST;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([name, songs]) => {
        // Apply the user's manual order; un-ordered tracks default to oldest
        // first (ascending id = order added).
        const sorted = [...songs].sort((a, b) => {
          const ao = a.sortOrder ?? Infinity;
          const bo = b.sortOrder ?? Infinity;
          return ao !== bo ? ao - bo : a.id - b.id;
        });
        return {
          name,
          songs: sorted,
          // The artist picture follows the top track in order (first with art).
          artId: sorted.find((s) => s.hasArt)?.id ?? null,
        };
      })
      .sort((a, b) => {
        // Pin the "No artist" group last; everything else alphabetical.
        if (a.name === NO_ARTIST) return 1;
        if (b.name === NO_ARTIST) return -1;
        return a.name.localeCompare(b.name);
      });
  });

  const current = $derived(artists.find((a) => a.name === openArtist) ?? null);

  function trackLabel(songs: Song[]): string {
    return `${songs.length} ${songs.length === 1 ? "track" : "tracks"}`;
  }

  // Drag-to-reorder the current artist's tracks (persisted via the view-model).
  let dragIndex = $state<number | null>(null);
  let overIndex = $state<number | null>(null);

  function onDrop(i: number) {
    const songs = current?.songs ?? [];
    if (dragIndex !== null && dragIndex !== i && songs.length > 0) {
      const ids = songs.map((s) => s.id);
      const [moved] = ids.splice(dragIndex, 1);
      ids.splice(i, 0, moved);
      vm.reorderSongs(ids);
    }
    dragIndex = null;
    overIndex = null;
  }
</script>

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to see artists.</p>
{:else if current}
  <button class="back" onclick={closeArtist}>
    <Icon name="arrow_back" size={20} /> All artists
  </button>
  <div class="head">
    <span class="avatar">
      {#if current.artId !== null}
        <img src={thumbUrl(current.artId, 512)} alt="" />
      {:else if current.name === NO_ARTIST}
        <Icon name="music_note" size={44} />
      {:else}
        <Icon name="person" size={48} />
      {/if}
    </span>
    <div>
      <h3>{current.name}</h3>
      <p class="muted">{trackLabel(current.songs)}</p>
      <PlayActions {vm} songs={current.songs} />
    </div>
  </div>
  <ol>
    {#each current.songs as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li
        class:current={isCurrent}
        class:dragging={i === dragIndex}
        class:dragover={i === overIndex && i !== dragIndex}
        draggable="true"
        ondragstart={() => (dragIndex = i)}
        ondragover={(e) => {
          e.preventDefault();
          overIndex = i;
        }}
        ondrop={(e) => {
          e.preventDefault();
          onDrop(i);
        }}
        ondragend={() => {
          dragIndex = null;
          overIndex = null;
        }}
        use:swipeQueue={{ onQueue: () => vm.addToQueue(song) }}
      >
        <span class="handle" title="Drag to reorder" aria-hidden="true">
          <Icon name="drag_indicator" size={18} />
        </span>
        <button class="track" onclick={() => vm.playQueue(current.songs, i)}>
          <span class="num">{i + 1}</span>
          <span class="t-meta">
            <span class="t-name">{song.originalFilename}</span>
            {#if song.album}<span class="t-sub">{song.album}</span>{/if}
          </span>
          <span
            class="plays"
            title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
          >
            <Icon name="play_arrow" size={13} />{song.playCount}
          </span>
        </button>
        <SongMenu {vm} {song} />
      </li>
    {/each}
  </ol>
{:else}
  <div class="grid">
    {#each artists as artist (artist.name)}
      <button class="card" onclick={() => openArtistView(artist.name)}>
        <span class="avatar">
          {#if artist.artId !== null}
            <img src={thumbUrl(artist.artId, 512)} alt="" />
          {:else if artist.name === NO_ARTIST}
            <Icon name="music_note" size={36} />
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
  li.dragging {
    opacity: 0.4;
  }
  li.dragover {
    border-top: 2px solid var(--accent);
  }
  .handle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--dim);
    cursor: grab;
    padding-left: 0.25rem;
  }
  .handle:active {
    cursor: grabbing;
  }
  li.current {
    background: var(--active-bg);
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
  .t-sub {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
