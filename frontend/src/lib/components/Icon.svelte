<script lang="ts">
  // Renders a Google Material Symbol (self-hosted variable font, see
  // +layout.svelte for the @font-face). The slot text is the icon name, used
  // as a ligature, e.g. <Icon name="play_arrow" />.
  let {
    name,
    size = 24,
    fill = false,
    weight = 400,
  }: { name: string; size?: number; fill?: boolean; weight?: number } =
    $props();
</script>

<span
  class="material-symbols-rounded"
  aria-hidden="true"
  style="font-size: {size}px; font-variation-settings: 'FILL' {fill
    ? 1
    : 0}, 'wght' {weight}, 'GRAD' 0, 'opsz' {size};">{name}</span
>

<style>
  .material-symbols-rounded {
    line-height: 1;
    user-select: none;
    flex-shrink: 0;
  }
</style>
