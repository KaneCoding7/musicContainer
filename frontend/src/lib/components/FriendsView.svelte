<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import UserAutocomplete from "$lib/components/UserAutocomplete.svelte";
  import type { FriendsViewModel } from "$lib/viewmodels/friendsViewModel.svelte";

  let { vm }: { vm: FriendsViewModel } = $props();

  // Feedback after sending a request (cleared on the next action).
  let notice = $state<string | null>(null);

  async function add(email: string) {
    notice = null;
    const ok = await vm.add(email);
    if (ok) notice = `Request sent to ${email}`;
  }

  // Initials for the avatar fallback.
  function initial(name: string): string {
    return (name.trim()[0] ?? "?").toUpperCase();
  }
</script>

<p class="lead">
  Add friends by name or email. They'll need to accept before you're connected.
</p>

<div class="add-row">
  <UserAutocomplete placeholder="Find friends by name or email…" onSelect={(u) => add(u.email)} />
</div>

{#if notice}<p class="notice">{notice}</p>{/if}
{#if vm.error}<p class="error">{vm.error}</p>{/if}

{#if vm.incoming.length > 0}
  <section>
    <h3>Friend requests</h3>
    <ul>
      {#each vm.incoming as r (r.id)}
        <li>
          <span class="avatar">{initial(r.name)}</span>
          <span class="who">
            <span class="nm">{r.name}</span>
            <span class="em">{r.email}</span>
          </span>
          <button class="primary" onclick={() => vm.accept(r.id)}>
            <Icon name="check" size={18} /> Accept
          </button>
          <button class="ghost" onclick={() => vm.remove(r.id)}>Decline</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if vm.outgoing.length > 0}
  <section>
    <h3>Pending</h3>
    <ul>
      {#each vm.outgoing as r (r.id)}
        <li>
          <span class="avatar">{initial(r.name)}</span>
          <span class="who">
            <span class="nm">{r.name}</span>
            <span class="em">{r.email}</span>
          </span>
          <span class="tag">Requested</span>
          <button class="ghost" onclick={() => vm.remove(r.id)}>Cancel</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section>
  <h3>Friends</h3>
  {#if vm.loading && vm.friends.length === 0}
    <p class="muted">Loading…</p>
  {:else if vm.friends.length === 0}
    <p class="muted">No friends yet. Search above to add someone.</p>
  {:else}
    <ul>
      {#each vm.friends as f (f.id)}
        <li>
          <span class="avatar">{initial(f.name)}</span>
          <span class="who">
            <span class="nm">{f.name}</span>
            <span class="em">{f.email}</span>
          </span>
          <button class="ghost" onclick={() => vm.remove(f.id)}>
            <Icon name="person_remove" size={18} /> Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .lead {
    color: var(--muted);
    margin: 0 0 1rem;
  }
  .add-row {
    display: flex;
    max-width: 480px;
    margin-bottom: 0.75rem;
  }
  .notice {
    color: var(--accent-text);
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .error {
    color: var(--danger-text);
    background: var(--danger-bg);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    margin: 0 0 1rem;
  }
  section {
    margin-top: 1.5rem;
  }
  section h3 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.25rem;
    border-bottom: 1px solid var(--surface-2);
  }
  .avatar {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 50%;
    color: var(--text);
    font-weight: 600;
    font-size: 0.95rem;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .nm {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .em {
    color: var(--dim);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  button {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.8rem;
    border: none;
    border-radius: 2rem;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: #fff;
  }
  button.primary:hover {
    background: var(--accent-hover);
  }
  button.ghost {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 500;
  }
  button.ghost:hover {
    background: var(--border-strong);
  }
  .muted {
    color: var(--muted);
    padding: 0.25rem 0;
  }
</style>
