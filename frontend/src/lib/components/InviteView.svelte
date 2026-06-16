<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    createInvite,
    fetchInvites,
    inviteLink,
    type Invite,
  } from "$lib/services/inviteService";

  let invites = $state<Invite[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let copied = $state<string | null>(null);

  onMount(load);

  async function load() {
    try {
      invites = await fetchInvites();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load invites";
    }
  }

  async function generate() {
    busy = true;
    error = null;
    try {
      const inv = await createInvite();
      invites = [inv, ...invites];
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to create invite";
    } finally {
      busy = false;
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      copied = code;
      setTimeout(() => (copied = copied === code ? null : copied), 1500);
    } catch {
      error = "Couldn't copy to clipboard";
    }
  }
</script>

<p class="lead">
  Share an invite link so a friend can create their own account and library.
</p>

<button class="generate" onclick={generate} disabled={busy}>
  <Icon name="person_add" size={20} />
  {busy ? "Creating…" : "Create invite link"}
</button>

{#if error}<p class="error">{error}</p>{/if}

{#if invites.length > 0}
  <ul>
    {#each invites as inv (inv.code)}
      <li class:used={inv.used}>
        <span class="link">{inviteLink(inv.code)}</span>
        {#if inv.used}
          <span class="badge">Used</span>
        {:else}
          <button class="copy" onclick={() => copy(inv.code)}>
            <Icon name={copied === inv.code ? "check" : "content_copy"} size={18} />
            {copied === inv.code ? "Copied" : "Copy"}
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted">No invite links yet.</p>
{/if}

<style>
  .lead {
    color: var(--muted);
    margin: 0 0 1rem;
  }
  .generate {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 1.25rem;
  }
  .generate:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .generate:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--surface-2);
  }
  li.used {
    opacity: 0.55;
  }
  .link {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    color: var(--text);
  }
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    padding: 0.35rem 0.7rem;
    background: var(--surface-2);
    border: none;
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .copy:hover {
    background: var(--border-strong);
  }
  .badge {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .error {
    color: var(--danger-text);
    background: var(--danger-bg);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
