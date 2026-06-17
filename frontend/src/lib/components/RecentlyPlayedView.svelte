<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
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
</script>

{#if vm.recentlyPlayed.length === 0}
  <p class="muted">Nothing played yet. Play a song to see it here.</p>
{:else}
  <div class="actions-bar"><PlayActions {vm} songs={vm.recentlyPlayed} /></div>
  <ul>
    {#each vm.recentlyPlayed as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li class:current={isCurrent}>
        <button class="row" onclick={() => vm.playQueue(vm.recentlyPlayed, i)}>
          <span class="thumb">
            {#if song.hasArt}
              <img src={thumbUrl(song.id, 128)} alt="" />
            {:else}
              <Icon name="music_note" size={20} />
            {/if}
          </span>
          <span class="meta">
            <span class="name">{song.originalFilename}</span>
            {#if song.artist}<span class="artist">{song.artist}</span>{/if}
          </span>
          <span class="stats">
            <span class="when">{relativeTime(song.lastPlayedAt ?? "")}</span>
            <span class="plays">
              <Icon name="play_arrow" fill size={14} />
              {song.playCount}
            </span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .actions-bar {
    margin-bottom: 1rem;
  }
  ul {
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
  .row {
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
  .row:hover {
    background: var(--hover);
  }
  .thumb {
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
  .stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.78rem;
  }
  .plays {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--dim);
  }
</style>
