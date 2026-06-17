<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import SongMenu from "$lib/components/SongMenu.svelte";
  import { swipeQueue } from "$lib/actions/swipeQueue";
  import { thumbUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();
</script>

{#if vm.likedSongs.length === 0}
  <p class="muted">No liked songs yet. Tap the heart on a song to like it.</p>
{:else}
  <div class="actions-bar"><PlayActions {vm} songs={vm.likedSongs} /></div>
  <ul>
    {#each vm.likedSongs as song, i (song.id)}
      {@const isCurrent = song.id === vm.currentSong?.id}
      <li
        class:current={isCurrent}
        use:swipeQueue={{ onQueue: () => vm.addToQueue(song) }}
      >
        <button class="row" onclick={() => vm.playQueue(vm.likedSongs, i)}>
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
        </button>
        <span
          class="plays"
          title={`${song.playCount} play${song.playCount === 1 ? "" : "s"}`}
        >
          <Icon name="play_arrow" size={13} />{song.playCount}
        </span>
        <button
          class="like"
          title="Unlike"
          aria-label="Unlike song"
          onclick={() => vm.toggleLike(song.id)}
        >
          <Icon name="favorite" fill size={20} />
        </button>
        <SongMenu {vm} {song} />
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
  .like {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: #ef4444;
    cursor: pointer;
    padding: 0.5rem 0.9rem;
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
</style>
