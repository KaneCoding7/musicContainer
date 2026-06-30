<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { thumbUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  function relativeTime(iso: string): string {
    const then = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    const diff = Date.now() - then.getTime();
    if (Number.isNaN(diff)) return "";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
</script>

{#if vm.recentlyPlayed.length === 0}
  <p class="muted">Nothing played yet. Play a song to see it here.</p>
{:else}
  <div class="recent">
  <div class="actions-bar"><PlayActions {vm} songs={vm.recentlyPlayed} queue={false} /></div>
  <div class="list-head" aria-hidden="true">
    <span class="head-title">Title</span>
    <div class="row-end">
      <span class="head-date">Last played</span>
      <span class="col-plays">Plays</span>
      <span class="col-dur"><Icon name="schedule" size={18} /></span>
      <span class="col-menu"></span>
    </div>
  </div>
  <ul>
    {#each vm.recentlyPlayed as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li
        class:current={isCurrent}
        use:swipeQueue={{ onQueue: () => vm.playNext(song) }}
      >
        <button class="row" onclick={() => vm.playQueue(vm.recentlyPlayed, i)}>
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
          <span class="col-date">{relativeTime(song.lastPlayedAt ?? "")}</span>
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
  </div>
{/if}

<style>
  /* Mobile: fixed play-actions header, scrolling list (matches All Songs). */
  @media (max-width: 768px) {
    /* No column headers on phones; drop metadata columns to keep rows clean.
       Scoped to .recent so these win over the base rules regardless of source
       order (equal-specificity rules would otherwise lose to the later base). */
    .recent .list-head {
      display: none;
    }
    .recent .col-date,
    .recent .col-plays,
    .recent .col-dur {
      display: none;
    }
    .recent {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .recent > .actions-bar {
      flex-shrink: 0;
    }
    .recent ul {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
  }
  .actions-bar {
    margin-bottom: 1rem;
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
  /* Column headers + metadata columns mirror the All Songs view (web only). */
  .list-head {
    display: flex;
    align-items: center;
    padding: 0 0 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .list-head .col-dur,
  .list-head .col-plays {
    display: inline-flex;
    justify-content: flex-end;
  }
  .head-title {
    flex: 1;
    min-width: 0;
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
  .plays {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--dim);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
</style>
