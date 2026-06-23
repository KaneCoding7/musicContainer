<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { thumbUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  // Date/duration formatting — mirrors the All Songs view columns.
  function parseDate(iso: string): Date {
    return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  }
  function formatDate(iso: string): string {
    const d = parseDate(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
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

  let query = $state("");
  // Collapsible search: a lone icon until clicked, then a field expands.
  let searchOpen = $state(false);
  function autofocus(node: HTMLInputElement) {
    node.focus();
  }
  function collapseSearchIfEmpty() {
    if (!query.trim()) searchOpen = false;
  }
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vm.likedSongs;
    return vm.likedSongs.filter(
      (s) =>
        s.originalFilename.toLowerCase().includes(q) ||
        (s.artist?.toLowerCase().includes(q) ?? false) ||
        (s.album?.toLowerCase().includes(q) ?? false)
    );
  });
</script>

{#if vm.likedSongs.length === 0}
  <p class="muted">No liked songs yet. Tap the heart on a song to like it.</p>
{:else}
  <div class="liked">
  <div class="control-row">
    <div class="actions-bar"><PlayActions {vm} songs={filtered} /></div>
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
          type="search"
          placeholder="Search"
          bind:value={query}
          use:autofocus
          onblur={collapseSearchIfEmpty}
        />
      {/if}
    </div>
  </div>
  {#if filtered.length === 0}
    <p class="muted">No liked songs match “{query}”.</p>
  {:else}
  <div class="list-head" aria-hidden="true">
    <span class="head-title">Title</span>
    <div class="row-end">
      <span class="head-date">Added</span>
      <span class="col-plays">Plays</span>
      <span class="col-dur"><Icon name="schedule" size={18} /></span>
      <span class="col-menu"></span>
    </div>
  </div>
  <ul>
    {#each filtered as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li
        class:current={isCurrent}
        use:swipeQueue={{ onQueue: () => vm.playNext(song) }}
      >
        <button class="row" onclick={() => vm.playQueue(filtered, i)}>
          <span class="thumb">
            {#if song.hasArt}
              <img src={thumbUrl(song.id, 128)} alt="" />
            {:else}
              <Icon name="music_note" size={20} />
            {/if}
            {#if isCurrent && vm.isPlaying}
              <span class="thumb-wave"><EqualizerBars size={20} /></span>
            {/if}
          </span>
          <span class="meta">
            <span class="name">{song.originalFilename}</span>
            {#if song.artist}<span class="artist">{song.artist}</span>{/if}
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
          <SongMenu {vm} {song} />
        </div>
      </li>
    {/each}
  </ul>
  {/if}
  </div>
{/if}

<style>
  /* Mobile: fill the screen, keep the play-actions header fixed and scroll the
     list (mirrors the All Songs view). */
  @media (max-width: 768px) {
    /* No column headers on phones; drop the metadata columns to keep rows clean.
       Scoped to .liked so these win over the base rules regardless of source
       order (equal-specificity rules would otherwise lose to the later base). */
    .liked .list-head {
      display: none;
    }
    .liked .col-date,
    .liked .col-plays,
    .liked .col-dur {
      display: none;
    }
    .liked {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .liked > :not(ul) {
      flex-shrink: 0;
    }
    .search {
      max-width: none;
    }
    .liked ul {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
  }
  /* Play/Shuffle (left) and the collapsible search (right) share one row. */
  .control-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.85rem;
  }
  .actions-bar {
    margin: 0;
    flex-shrink: 0;
  }
  /* Pushed right; expands leftward when opened instead of wrapping. */
  .search {
    margin-left: auto;
  }
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
  .search.open .search-icon {
    width: auto;
    height: auto;
    background: transparent;
    border: none;
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
  /* Column headers, aligned over the row values (web only — hidden on phones).
     head-like (3.05rem) matches the .like button box, head-menu (2.25rem)
     matches the SongMenu trigger, so "Plays" lines up over the play counts. */
  .list-head {
    display: flex;
    align-items: center;
    padding: 0 0 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .head-title {
    flex: 1;
    min-width: 0;
  }
  .list-head .col-dur,
  .list-head .col-plays {
    display: inline-flex;
    justify-content: flex-end;
  }
  .row-end {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    flex-shrink: 0;
  }
  .col-date {
    width: 7.5rem;
    text-align: right;
    color: var(--dim);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-date {
    width: 7.5rem;
    text-align: right;
  }
  .col-plays {
    width: 3rem;
    justify-content: flex-end;
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
  .col-menu {
    width: 2.25rem;
  }
  ul {
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
  .row {
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
    .row:hover {
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
  .thumb-wave {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
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
  .plays {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--dim);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
</style>
