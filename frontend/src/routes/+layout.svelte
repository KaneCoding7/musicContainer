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
</style>
