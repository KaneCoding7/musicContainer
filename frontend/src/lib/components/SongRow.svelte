<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";

  // The play-button portion of a track row (artwork thumbnail + title/artist),
  // shared by the in-app song list and the public share page so both stay
  // visually identical. The parent owns the <li>, any selection checkbox, and
  // the trailing columns (date/plays/duration/menu) — this is just the clickable
  // core. Art is passed as a resolved URL so each caller can use its own
  // endpoint (authenticated thumbUrl vs. public share art).
  let {
    artUrl = null,
    title,
    artist = null,
    current = false,
    playing = false,
    onclick,
  }: {
    artUrl?: string | null;
    title: string;
    artist?: string | null;
    current?: boolean;
    playing?: boolean;
    onclick?: (e: MouseEvent) => void;
  } = $props();
</script>

<button class="row" class:show-play={current && !playing} {onclick}>
  <span class="thumb">
    {#if artUrl}
      <img src={artUrl} alt="" />
    {:else}
      <Icon name="music_note" size={20} />
    {/if}
    <span class="thumb-play">
      <Icon name={playing ? "pause" : "play_arrow"} fill size={22} />
    </span>
    {#if playing}
      <span class="thumb-wave"><EqualizerBars size={20} /></span>
    {/if}
  </span>
  <span class="meta">
    <span class="name">{title}</span>
    {#if artist}<span class="artist">{artist}</span>{/if}
  </span>
</button>

<style>
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.6rem 0;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
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
  /* The current-but-paused track shows the play affordance without a hover. */
  .row.show-play .thumb-play {
    opacity: 1;
  }
  @media (hover: hover) {
    .row:hover .thumb-play {
      opacity: 1;
    }
  }
  /* The playing track shows the live sound-wave by default; hovering hides it so
     the play/pause control underneath is reachable. */
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
    .row:hover .thumb-wave {
      opacity: 0;
    }
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
</style>
