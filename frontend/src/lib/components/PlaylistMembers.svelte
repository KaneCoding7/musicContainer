<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import {
    fetchPlaylistMembers,
    type PlaylistMember,
  } from "$lib/services/shareService";

  // Renders the people with access to a playlist. Only shows when the playlist
  // is actually shared (more than just the owner).
  let { playlistId, refresh = 0 }: { playlistId: number; refresh?: number } =
    $props();

  let members = $state<PlaylistMember[]>([]);

  $effect(() => {
    const id = playlistId;
    void refresh; // re-fetch when the parent bumps this (e.g. after sharing)
    let cancelled = false;
    fetchPlaylistMembers(id)
      .then((m) => {
        if (!cancelled) members = m;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });
</script>

{#if members.length > 1}
  <div class="members">
    <Icon name="person" size={16} />
    <ul>
      {#each members as m (m.id)}
        <li class="chip" class:owner={m.isOwner}>
          {m.name}
          <span class="tag">{m.isOwner ? "owner" : m.canEdit ? "editor" : "viewer"}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .members {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 0.25rem 0 1rem;
    color: var(--dim);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.55rem;
    background: var(--surface-2);
    border-radius: 1rem;
    color: var(--text);
    font-size: 0.82rem;
  }
  .chip.owner {
    background: var(--active-bg);
  }
  .tag {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--dim);
  }
  .chip.owner .tag {
    color: var(--accent-text);
  }
</style>
