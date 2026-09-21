<script lang="ts">
  import { openArtist } from "$lib/artistNav";

  // Renders a song's artists as a ", "-separated list. In the app each name is a
  // clickable link to that artist's profile (link=true); on the public share
  // page there's no profile, so it falls back to plain text. Place inside an
  // element that carries the surrounding artist styling (color/size) — the links
  // inherit it via the global .artist-link reset.
  let {
    artists = [],
    fallback = null,
    link = false,
  }: {
    artists?: { id: number; name: string }[];
    fallback?: string | null; // used when the ordered list isn't available
    link?: boolean;
  } = $props();

  const names = $derived(
    artists.length > 0
      ? artists.map((a) => a.name)
      : fallback
        ? [fallback]
        : []
  );
</script>

{#each names as name, i (name + i)}
  {#if i > 0}, {/if}
  {#if link}
    <button
      type="button"
      class="artist-link"
      title={name}
      onclick={(e) => {
        e.stopPropagation();
        openArtist(name);
      }}>{name}</button
    >
  {:else}{name}{/if}
{/each}
