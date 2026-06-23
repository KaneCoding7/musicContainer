<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import {
    fetchPlaylistMembers,
    type PlaylistMember,
  } from "$lib/services/shareService";

  // Renders the people with access to a playlist. Only shows when the playlist
  // is actually shared (more than just the owner). The owner stays visible
  // inline; everyone else collapses into a people-count that opens a modal —
  // so a heavily-shared playlist doesn't sprawl a long chip list.
  let { playlistId, refresh = 0 }: { playlistId: number; refresh?: number } =
    $props();

  let members = $state<PlaylistMember[]>([]);
  let open = $state(false);

  function roleOf(m: PlaylistMember): string {
    return m.isOwner ? "owner" : m.canEdit ? "editor" : "viewer";
  }

  $effect(() => {
    const id = playlistId;
    void refresh; // re-fetch when the parent bumps this (e.g. after sharing)
    let cancelled = false;
    open = false; // close the modal when switching playlists
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
    <button
      class="count"
      title="See everyone on this playlist"
      onclick={() => (open = true)}
    >
      <Icon name="group" size={15} />
      {members.length}
      {members.length === 1 ? "person" : "people"}
    </button>
  </div>
{/if}

{#if open}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && (open = false)}
    onkeydown={(e) => e.key === "Escape" && (open = false)}
  >
    <div class="dialog" role="dialog" tabindex="-1" aria-modal="true" aria-label="People with access">
      <div class="dialog-head">
        <h3>People with access</h3>
        <button
          class="dialog-close"
          title="Close"
          aria-label="Close"
          onclick={() => (open = false)}><Icon name="close" size={20} /></button
        >
      </div>
      <ul class="people">
        {#each members as m (m.id)}
          <li>
            <span class="avatar">{m.name.slice(0, 1).toUpperCase()}</span>
            <span class="who">{m.name}</span>
            <span class="role" class:owner={m.isOwner} class:view={!m.isOwner && !m.canEdit}>
              {roleOf(m)}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .members {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0 1rem;
    color: var(--dim);
  }
  /* People-count pill — opens the full list. */
  .count {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.6rem;
    background: var(--surface-2);
    border: none;
    border-radius: 1rem;
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  @media (hover: hover) {
    .count:hover {
      background: var(--border-strong);
    }
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    box-sizing: border-box;
  }
  .dialog {
    width: min(380px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .dialog-head h3 {
    margin: 0;
  }
  .dialog-close {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: transparent;
    border: none;
    border-radius: 0.4rem;
    color: var(--muted);
    cursor: pointer;
  }
  @media (hover: hover) {
    .dialog-close:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .people {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.4rem 0;
  }
  .avatar {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .who {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .role {
    flex-shrink: 0;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .role.owner {
    color: var(--accent-text);
  }
  .role.view {
    color: var(--dim);
  }
</style>
