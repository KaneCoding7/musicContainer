<script lang="ts">
  let { children } = $props();
</script>

<main>
  {@render children()}
</main>

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

  :global(body) {
    margin: 0;
    background: #0f0f12;
    color: #e5e7eb;
    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif;
  }
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
</style>
