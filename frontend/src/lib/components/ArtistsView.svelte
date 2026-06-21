<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { reorderHandle } from "$lib/actions/reorderHandle";
  import {
    disableArtistPublicLink,
    enableArtistPublicLink,
    getArtistPublicToken,
    publicLink,
  } from "$lib/services/shareService";
  import {
    artistImageUrl,
    fetchArtistImages,
    removeArtistImage,
    thumbUrl,
    uploadArtistImage,
  } from "$lib/services/songService";
  import { onMount } from "svelte";
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

  // Public "listen to this artist" link.
  let shareToken = $state<string | null>(null);
  let shareBusy = $state(false);
  let shareCopied = $state(false);

  // Load the artist's public token when a (real) artist is opened.
  $effect(() => {
    const name = current?.name;
    shareToken = null;
    shareCopied = false;
    reordering = false; // leave reorder mode when switching artists
    if (!name || name === NO_ARTIST) return;
    let cancelled = false;
    getArtistPublicToken(name)
      .then((t) => {
        if (!cancelled) shareToken = t;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  async function toggleArtistShare() {
    if (!current || shareBusy) return;
    shareBusy = true;
    try {
      if (shareToken) {
        await disableArtistPublicLink(current.name);
        shareToken = null;
      } else {
        shareToken = await enableArtistPublicLink(current.name);
      }
    } catch {
      /* ignore */
    } finally {
      shareBusy = false;
    }
  }

  async function copyArtistLink() {
    if (!shareToken) return;
    try {
      await navigator.clipboard.writeText(publicLink(shareToken));
      shareCopied = true;
      setTimeout(() => (shareCopied = false), 1500);
    } catch {
      /* ignore */
    }
  }

  function trackLabel(songs: Song[]): string {
    return `${songs.length} ${songs.length === 1 ? "track" : "tracks"}`;
  }

  // Drag-to-reorder the current artist's tracks (persisted via the view-model).
  // Off by default — turned on with the Reorder button so the drag handles only
  // appear when you actually want to rearrange.
  let reordering = $state(false);

  // Custom artist images: names the user has uploaded a picture for. The avatar
  // uses it when present, else falls back to the top track's embedded art.
  let customImages = $state<Set<string>>(new Set());
  let imgVersion = $state(0); // bumped after upload/remove to bust the cache
  let imageInput = $state<HTMLInputElement | null>(null);
  onMount(async () => {
    customImages = new Set(await fetchArtistImages());
  });

  function pickArtistImage() {
    imageInput?.click();
  }
  async function onArtistImagePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-picking the same file
    if (!file || !current) return;
    try {
      await uploadArtistImage(current.name, file);
      customImages = new Set(customImages).add(current.name);
      imgVersion++;
    } catch {
      /* ignore — keep the existing image */
    }
  }
  async function clearArtistImage() {
    if (!current) return;
    try {
      await removeArtistImage(current.name);
      const next = new Set(customImages);
      next.delete(current.name);
      customImages = next;
      imgVersion++;
    } catch {
      /* ignore */
    }
  }

  function moveTrack(from: number, to: number) {
    const songs = current?.songs ?? [];
    if (from === to || songs.length === 0) return;
    const ids = songs.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    vm.reorderSongs(ids);
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
      {#if customImages.has(current.name)}
        <img src={artistImageUrl(current.name, imgVersion)} alt="" />
      {:else if current.artId !== null}
        <img src={thumbUrl(current.artId, 512)} alt="" />
      {:else if current.name === NO_ARTIST}
        <Icon name="music_note" size={44} />
      {:else}
        <Icon name="person" size={48} />
      {/if}
      {#if reordering && current.name !== NO_ARTIST}
        <button
          class="avatar-edit"
          onclick={pickArtistImage}
          title="Change artist image"
          aria-label="Change artist image"
        >
          <Icon name="photo_camera" size={20} />
        </button>
        <input
          type="file"
          accept="image/*"
          bind:this={imageInput}
          onchange={onArtistImagePicked}
          hidden
        />
      {/if}
    </span>
    <div>
      <h3>{current.name}</h3>
      <p class="muted">{trackLabel(current.songs)}</p>
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
        {#if reordering && current.name !== NO_ARTIST && customImages.has(current.name)}
          <button class="edit-order" onclick={clearArtistImage} title="Remove image">
            <Icon name="hide_image" size={18} />
            <span class="btn-label">Remove image</span>
          </button>
        {/if}
        {#if current.name !== NO_ARTIST}
          <button
            class="share-artist"
            onclick={toggleArtistShare}
            disabled={shareBusy}
            title={shareToken ? "Public · turn off" : "Share artist"}
          >
            <Icon name="public" size={18} />
            <span class="btn-label">{shareToken ? "Public · turn off" : "Share artist"}</span>
          </button>
        {/if}
      </div>
    </div>
  </div>

  {#if shareToken}
    <div class="share-url">
      <span class="url">{publicLink(shareToken)}</span>
      <button class="copy" onclick={copyArtistLink}>
        <Icon name={shareCopied ? "check" : "content_copy"} size={16} />
        {shareCopied ? "Copied" : "Copy"}
      </button>
    </div>
    <p class="muted small">Anyone with this link can listen to {current.name} — no account needed.</p>
  {/if}
  <ol>
    {#each current.songs as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li
        class:current={isCurrent}
        class:playing={isCurrent && vm.isPlaying}
        data-reorder-index={i}
        use:swipeQueue={{
          onQueue: () => vm.addToQueue(song),
          onLike: () => vm.toggleLike(song.id),
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
          <span class="thumb">
            {#if song.hasArt}
              <img src={thumbUrl(song.id, 128)} alt="" />
            {:else}
              <Icon name="album" size={18} />
            {/if}
            <span class="thumb-play">
              <Icon
                name={isCurrent && vm.isPlaying ? "pause" : "play_arrow"}
                fill
                size={22}
              />
            </span>
            {#if isCurrent && vm.isPlaying}
              <span class="thumb-wave"><EqualizerBars size={18} /></span>
            {/if}
          </span>
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
          {#if customImages.has(artist.name)}
            <img src={artistImageUrl(artist.name, imgVersion)} alt="" />
          {:else if artist.artId !== null}
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
  @media (hover: hover) {
    .card:hover {
      background: var(--hover);
    }
  }
  .avatar {
    position: relative;
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
  /* Camera overlay shown only in edit mode to change the artist picture. */
  .avatar-edit {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    color: #fff;
    cursor: pointer;
  }
  @media (hover: hover) {
    .avatar-edit:hover {
      background: rgba(0, 0, 0, 0.55);
    }
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
  @media (hover: hover) {
    .back:hover {
      color: var(--text);
    }
  }
  .head {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  /* On mobile, stack the avatar on top with the name and all action buttons
     centered in a row beneath it. */
  @media (max-width: 768px) {
    .head {
      flex-direction: column;
      text-align: center;
      gap: 0.85rem;
    }
    .head-actions {
      justify-content: center;
    }
    /* Icon-only round buttons on mobile so Play / Shuffle / Edit / Share all fit
       on one row under the avatar. */
    .share-artist,
    .edit-order {
      padding: 0.65rem;
      border-radius: 50%;
    }
    .btn-label {
      display: none;
    }
  }
  .head-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .share-artist,
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
  @media (hover: hover) {
    .share-artist:hover:not(:disabled) {
      background: var(--hover);
    }
  }
  .share-url {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
  }
  .share-url .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .share-url .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    padding: 0.3rem 0.6rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 0.4rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .muted.small {
    font-size: 0.82rem;
    margin-top: 0;
  }
  .head .avatar {
    width: 120px;
    height: 120px;
    flex-shrink: 0;
  }
  .head h3 {
    margin: 0 0 0.1rem;
    font-size: 1.6rem;
  }
  /* Track count sits tight under the name (kill the default paragraph margin). */
  .head p {
    margin: 0 0 0.6rem;
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
  @media (hover: hover) {
    .track:hover {
      background: var(--hover);
    }
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
    .track:hover .thumb-play {
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
    .track:hover .thumb-wave {
      opacity: 0;
    }
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
