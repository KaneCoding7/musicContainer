<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { Song } from "$lib/types";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  // Play / Shuffle buttons for any list of songs. Drop in next to a list header.
  let {
    vm,
    songs,
    compact = false,
    compactMobile = false,
    shuffle = true,
  }: {
    vm: SongViewModel;
    songs: Song[];
    compact?: boolean;
    compactMobile?: boolean; // icon-only on mobile only (labels on desktop)
    shuffle?: boolean;
  } = $props();
</script>

{#if songs.length > 0}
  <div class="play-actions" class:compact class:compact-mobile={compactMobile}>
    <button class="play" onclick={() => vm.playList(songs)} title="Play" aria-label="Play">
      <Icon name="play_arrow" fill size={compact ? 18 : 20} />
      <span class="label">Play</span>
    </button>
    {#if shuffle}
      <button
        class="shuffle"
        onclick={() => vm.shufflePlay(songs)}
        title="Shuffle"
        aria-label="Shuffle"
      >
        <Icon name="shuffle" size={compact ? 18 : 20} />
        <span class="label">Shuffle</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .play-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.95rem;
    border: none;
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .play {
    background: var(--accent);
    color: #fff;
  }
  @media (hover: hover) {
    .play:hover {
      background: var(--accent-hover);
    }
  }
  .shuffle {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
  }
  @media (hover: hover) {
    .shuffle:hover {
      background: var(--hover);
    }
  }
  /* Compact: icon-only round buttons for tight headers. */
  .compact button {
    padding: 0.4rem;
    border-radius: 50%;
  }
  .compact .label {
    display: none;
  }
  /* Compact on mobile only: keep the labels on desktop, drop to icon-only pills
     on small screens so a header row stays tidy. */
  @media (max-width: 768px) {
    .compact-mobile button {
      padding: 0.4rem;
      border-radius: 50%;
    }
    .compact-mobile .label {
      display: none;
    }
  }
</style>
