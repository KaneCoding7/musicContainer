<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { artUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();
</script>

<div class="queue">
  <ol>
    {#each vm.queue as song, i (`${song.id}-${i}`)}
      {@const isCurrent = i === vm.currentIndex}
      {@const isPast = vm.currentIndex !== null && i < vm.currentIndex}
      <li class:current={isCurrent} class:past={isPast}>
        <button class="row" onclick={() => vm.playQueue(vm.queue, i)}>
          <span class="thumb">
            {#if song.hasArt}
              <img src={artUrl(song.id)} alt="" />
            {:else}
              <Icon name="music_note" size={18} />
            {/if}
            {#if isCurrent}
              <span class="thumb-state">
                <Icon name={vm.isPlaying ? "equalizer" : "pause"} fill size={18} />
              </span>
            {/if}
          </span>
          <span class="meta">
            <span class="name">{song.originalFilename}</span>
            {#if song.artist}<span class="artist">{song.artist}</span>{/if}
          </span>
          {#if isCurrent}
            <span class="badge">Now playing</span>
          {/if}
        </button>
      </li>
    {/each}
  </ol>
</div>

<style>
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    border-bottom: 1px solid #27272a;
  }
  li.current {
    background: #2a1d4d;
  }
  li.past {
    opacity: 0.55;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: #1c1c20;
  }
  li.current .row:hover {
    background: #34245e;
  }
  .thumb {
    position: relative;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #27272a;
    border-radius: 0.3rem;
    color: #6b7280;
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb-state {
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .artist {
    color: #9ca3af;
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex-shrink: 0;
    color: #a78bfa;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
