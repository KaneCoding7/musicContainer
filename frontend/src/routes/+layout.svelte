<script lang="ts">
  let { children } = $props();
</script>

<main>
  {@render children()}
</main>

<style>
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
