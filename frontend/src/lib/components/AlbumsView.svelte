<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { reorderHandle } from "$lib/actions/reorderHandle";
  import { thumbUrl, downloadSongsZip } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  // The open album is driven by the URL (?album=…) so the browser back button
  // returns to the album grid instead of the previous view.
  const openAlbum = $derived(page.url.searchParams.get("album"));
  function openAlbumView(name: string) {
    goto(`?view=albums&album=${encodeURIComponent(name)}`, { noScroll: true });
  }
  function closeAlbum() {
    goto("?view=albums", { noScroll: true });
  }

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
        // Honour a manual album order (albumSortOrder) when the user has
        // reordered; otherwise fall back to library order (newest first).
        songs: [...songs].sort((a, b) => {
          const ao = a.albumSortOrder ?? Infinity;
          const bo = b.albumSortOrder ?? Infinity;
          return ao !== bo ? ao - bo : 0;
        }),
        artId: songs.find((s) => s.hasArt)?.id ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const current = $derived(albums.find((a) => a.name === openAlbum) ?? null);

  function durationLabel(songs: Song[]): string {
    return `${songs.length} ${songs.length === 1 ? "track" : "tracks"}`;
  }

  // Drag-to-reorder the open album's tracks. Off by default — toggled with the
  // Edit button so the handles only appear when rearranging.
  let reordering = $state(false);

  function moveTrack(from: number, to: number) {
    const songs = current?.songs ?? [];
    if (from === to || songs.length === 0) return;
    const ids = songs.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    vm.reorderAlbumSongs(ids);
  }

  // Download the whole album as a zip.
  let downloading = $state(false);
  async function downloadAlbum() {
    if (downloading || !current) return;
    downloading = true;
    try {
      await downloadSongsZip(
        current.songs.map((s) => s.id),
        current.name
      );
    } catch (e) {
      vm.error = e instanceof Error ? e.message : "Download failed";
    } finally {
      downloading = false;
    }
  }
</script>

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to see albums.</p>
{:else if current}
  <div class="detail">
  <button class="back" onclick={closeAlbum}>
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
      <div class="head-actions">
        <PlayActions {vm} songs={current.songs} compactMobile />
        {#if current.songs.length > 1}
          <button
            class="edit-order"
            class:on={reordering}
            onclick={() => (reordering = !reordering)}
            title={reordering ? "Done" : "Edit order"}
          >
            <Icon name={reordering ? "check" : "edit"} size={18} />
            <span class="btn-label">{reordering ? "Done" : "Edit"}</span>
          </button>
        {/if}
        <button
          class="edit-order"
          class:loading={downloading}
          onclick={downloadAlbum}
          disabled={downloading}
          title="Download album as zip"
          aria-label="Download album as zip"
        >
          <Icon name={downloading ? "progress_activity" : "download"} size={18} />
          <span class="btn-label">{downloading ? "Downloading…" : "Download"}</span>
        </button>
      </div>
    </div>
  </div>
  <div class="list-head" aria-hidden="true">
    <div class="head-track">
      <span class="head-title">Title</span>
      <span class="head-plays">Plays</span>
    </div>
    <span class="head-menu"></span>
  </div>
  <ol>
    {#each current.songs as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li
        class:current={isCurrent}
        data-reorder-index={i}
        use:swipeQueue={{
          onQueue: () => vm.playNext(song),
          disabled: reordering,
        }}
      >
        {#if reordering}
          <span
            class="handle"
            title="Drag to reorder"
            use:reorderHandle={{ index: i, onMove: moveTrack }}
          >
            <Icon name="drag_indicator" size={18} />
          </span>
        {/if}
        <button class="track" onclick={() => vm.playQueue(current.songs, i)}>
          {#if isCurrent && vm.isPlaying}
            <span class="num"><EqualizerBars size={14} /></span>
          {/if}
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
        <SongMenu {vm} {song} />
      </li>
    {/each}
  </ol>
  </div>
{:else}
  <div class="grid">
    {#each albums as album (album.name)}
      <button class="card" onclick={() => openAlbumView(album.name)}>
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
  @media (hover: hover) {
    .card:hover {
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
  @media (hover: hover) {
    .back:hover {
      color: var(--text);
    }
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
  .head-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .edit-order {
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
  .edit-order.on {
    background: var(--active-bg);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .edit-order:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .edit-order.loading :global(.material-symbols-rounded) {
    animation: spin 1.1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
  @media (hover: hover) {
    .track:hover {
      background: var(--hover);
    }
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
    justify-content: flex-end;
    gap: 0.15rem;
    width: 3rem;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  /* Column headers (web only). head-track mirrors the .track box (flex:1 +
     0.75rem side padding) so "Plays" lines up over the play counts. */
  .list-head {
    display: flex;
    align-items: center;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .head-track {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 0.75rem;
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
  /* Mobile: album detail keeps its header fixed and scrolls the track list. */
  @media (max-width: 768px) {
    /* No column headers on phones. Scoped to .detail so it wins regardless of
       source order. */
    .detail .list-head {
      display: none;
    }
    /* Icon-only round Edit button on mobile so it sits neatly beside Play. */
    .edit-order {
      padding: 0.65rem;
      border-radius: 50%;
    }
    .btn-label {
      display: none;
    }
    .detail {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .detail > :not(ol) {
      flex-shrink: 0;
    }
    .detail ol {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
  }
</style>
