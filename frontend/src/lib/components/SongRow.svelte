<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
  import ArtistLinks from "$lib/components/ArtistLinks.svelte";

  // The play-button portion of a track row (artwork thumbnail + title/artist),
  // shared by the in-app song list and the public share page so both stay
  // visually identical. The parent owns the <li>, any selection checkbox, and
  // the trailing columns (date/plays/duration/menu) — this is just the clickable
  // core. Art is passed as a resolved URL so each caller can use its own
  // endpoint (authenticated thumbUrl vs. public share art).
  //
  // The thumbnail and title are the play affordance; the artist name sits beside
  // them (not nested in the play button — HTML forbids nested interactive
  // elements). Set `linkArtist` in the app to make the name navigate to the
  // artist's profile; the public share page leaves it off (no profile there).
  let {
    artUrl = null,
    title,
    artist = null,
    artists = [],
    current = false,
    playing = false,
    linkArtist = false,
    onclick,
  }: {
    artUrl?: string | null;
    title: string;
    artist?: string | null;
    artists?: { id: number; name: string }[];
    current?: boolean;
    playing?: boolean;
    linkArtist?: boolean;
    onclick?: (e: MouseEvent) => void;
  } = $props();
</script>

<div class="row" class:show-play={current && !playing}>
  <button class="thumb-btn" {onclick} aria-label={`Play ${title}`}>
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
  </button>
  <span class="meta">
    <button class="name-btn" {onclick}>
      <span class="name">{title}</span>
    </button>
    {#if artist || artists.length}
      <span class="artist">
        <ArtistLinks {artists} fallback={artist} link={linkArtist} />
      </span>
    {/if}
  </span>
</div>

<style>
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.6rem 0;
    color: inherit;
  }
  .thumb-btn {
    flex-shrink: 0;
    display: inline-flex;
    padding: 0;
    background: transparent;
    border: none;
    color: inherit;
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
    align-items: flex-start;
  }
  .name-btn {
    max-width: 100%;
    padding: 0;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  /* The row itself is the play affordance — no focus outline box on the parts. */
  .thumb-btn:focus,
  .thumb-btn:focus-visible,
  .name-btn:focus,
  .name-btn:focus-visible {
    outline: none;
  }
  .name {
    display: block;
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
    max-width: 100%;
  }
</style>
