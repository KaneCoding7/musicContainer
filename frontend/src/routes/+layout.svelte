<script lang="ts">
  let { children } = $props();
</script>

{@render children()}

<style>
  /* Self-hosted Google Material Symbols (variable font). */
  @font-face {
    font-family: "Material Symbols Rounded";
    font-style: normal;
    font-weight: 100 700;
    font-display: block;
    src: url("/fonts/material-symbols-rounded.woff2") format("woff2");
  }
  :global(.material-symbols-rounded) {
    font-family: "Material Symbols Rounded";
    font-weight: normal;
    font-style: normal;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    letter-spacing: normal;
    text-transform: none;
    -webkit-font-feature-settings: "liga";
    font-feature-settings: "liga";
    -webkit-font-smoothing: antialiased;
  }

  /* Theme palette — dark by default, overridden for [data-theme="light"]. */
  :global(:root) {
    --bg: #0f0f12;
    --surface: #18181b;
    --surface-2: #27272a;
    --sidebar: #0b0b0e;
    --hover: #1c1c20;
    --panel: #141417;
    --border-strong: #3f3f46;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --dim: #6b7280;
    --accent: #6d28d9;
    --accent-hover: #5b21b6;
    --accent-text: #a78bfa;
    --active-bg: #2a1d4d;
    --danger-bg: #7f1d1d;
    --danger-text: #fecaca;
  }
  :global(html[data-theme="light"]) {
    --bg: #f6f6f8;
    --surface: #ffffff;
    --surface-2: #e7e7ee;
    --sidebar: #eeeef3;
    --hover: #ececf1;
    --panel: #f0f0f4;
    --border-strong: #cfcfd8;
    --text: #1a1a1f;
    --muted: #5b5b66;
    --dim: #8a8a95;
    --accent: #6d28d9;
    --accent-hover: #5b21b6;
    --accent-text: #6d28d9;
    --active-bg: #ece6fb;
    --danger-bg: #fee2e2;
    --danger-text: #b91c1c;
  }

  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif;
  }

  /* Native dropdowns: iOS renders its own picker, but Windows/Chrome paints the
     popup from the element's own colors — without these the option list falls
     back to a white system background with our light text and is unreadable.
     Setting select + option colors explicitly fixes it cross-platform. */
  :global(select) {
    color: var(--text);
    background-color: var(--surface-2);
  }
  :global(select option),
  :global(select optgroup) {
    color: var(--text);
    background-color: var(--surface);
  }

  /* Clickable artist name → opens the artist's profile (see $lib/artistNav).
     A button reset that inherits the surrounding text's font/color so it looks
     identical to the plain artist labels it replaces; each call site's own
     scoped .artist/.t-artist/etc. rule still wins for color/size. Only the
     hover underline + pointer mark it as interactive. */
  :global(.artist-link) {
    max-width: 100%;
    padding: 0;
    /* !important for the same reason as .row-play: beat a scoped bare button. */
    margin: 0 !important;
    background: none !important;
    border: none !important;
    font: inherit;
    color: inherit !important;
    text-align: inherit;
    cursor: pointer;
  }
  :global(.artist-link:hover),
  :global(.artist-link:focus) {
    outline: none;
  }
  :global(.artist-link:focus-visible) {
    outline: none;
    text-decoration: underline;
  }

  /* Button reset for the play-triggering pieces of a track row (thumbnail and
     title) once the artist name is split out into its own .artist-link. Lets a
     row that used to be a single <button> become a container holding two small
     reset buttons + the artist link, without duplicating this reset per view.
     Inherits layout from the row's existing flex rules. */
  :global(.row-play) {
    display: block;
    max-width: 100%;
    /* !important so this reset beats a component's scoped bare `button {}` base
       style (Svelte's scope hash gives that higher specificity than this global
       class) — otherwise row play/title buttons inherit its fill AND padding,
       which mis-sizes the row. */
    padding: 0 !important;
    margin: 0 !important;
    background: none !important;
    border: none !important;
    font: inherit;
    color: inherit !important;
    text-align: inherit;
    cursor: pointer;
  }
  /* The thumbnail button in a row: inline-flex + no shrink so it hugs the 40px
     thumb and doesn't add line-box height (matches SongRow's .thumb-btn). */
  :global(.row-play.thumb-btn) {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  /* No focus ring on the row play buttons: the whole row is the affordance, and
     a full-width outline box around each row looked out of place (the rest of
     the app doesn't ring its rows). Keyboard users still get the row's hover/
     active styling. */
  :global(.row-play:focus),
  :global(.row-play:focus-visible) {
    outline: none;
  }

  /* Transient confirmation toast (e.g. swipe-to-queue). */
  :global(.swipe-toast) {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 5.5rem);
    transform: translate(-50%, 1rem);
    z-index: 80;
    padding: 0.55rem 1rem;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 0.85rem;
    border-radius: 2rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }
  :global(.swipe-toast.show) {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  /* "Play next" affordance revealed in the space a row vacates as you swipe it
     right (Spotify-style). The action sets its transform/opacity live. */
  :global(.swipe-hint) {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding-left: 0.9rem;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.82rem;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
  }
  :global(.swipe-hint .material-symbols-rounded) {
    transition: transform 0.12s ease;
  }
  :global(.swipe-hint.armed .material-symbols-rounded) {
    transform: scale(1.25);
  }
  /* "Like" affordance revealed as a row is swiped left — anchored to the right
     edge and tinted red to match the liked heart. */
  :global(.swipe-hint.like) {
    left: auto;
    right: 0;
    padding-left: 0;
    padding-right: 0.9rem;
    color: #ef4444;
  }
</style>
