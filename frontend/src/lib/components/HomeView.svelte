<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PlayActions from "$lib/components/PlayActions.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  const LIMIT = 8;
  const recentlyAdded = $derived(vm.recentlyAdded.slice(0, LIMIT));
  const mostPlayed = $derived(vm.mostPlayed.slice(0, LIMIT));
  const recentlyPlayed = $derived(vm.recentlyPlayed.slice(0, LIMIT));
</script>

{#snippet section(title: string, icon: string, list: Song[])}
  {#if list.length > 0}
    <section>
      <div class="head">
        <h3><Icon name={icon} size={20} /> {title}</h3>
        <PlayActions {vm} songs={list} />
      </div>
      <div class="cards">
        {#each list as song, i (song.id)}
          <button class="card" onclick={() => vm.playQueue(list, i)}>
            <span class="cover">
              {#if song.hasArt}
                <img src={thumbUrl(song.id, 128)} alt="" />
              {:else}
                <Icon name="music_note" size={26} />
              {/if}
              <span class="play-overlay"><Icon name="play_arrow" fill size={26} /></span>
            </span>
            <span class="c-name">{song.originalFilename}</span>
            {#if song.artist}<span class="c-sub">{song.artist}</span>{/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

{#if vm.songs.length === 0}
  <p class="muted">No songs yet. Upload some to get started.</p>
{:else}
  {@render section("Recently Added", "schedule", recentlyAdded)}
  {@render section("Most Played", "trending_up", mostPlayed)}
  {@render section("Recently Played", "history", recentlyPlayed)}
{/if}

<style>
  section {
    margin-bottom: 2rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: 1.15rem;
  }
  .cards {
    display: grid;
    /* auto-fit (not auto-fill) collapses empty trailing tracks so the cards
       fill the row and their right edge lines up with the header's Play
       button on wide screens. */
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
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
    position: relative;
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
  .play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .card:hover .play-overlay {
    opacity: 1;
  }
  .c-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .c-sub {
    color: var(--muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--muted);
  }
</style>
