<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import Icon from "$lib/components/Icon.svelte";
  import { connectLastfm } from "$lib/services/lastfmService";

  let error = $state<string | null>(null);

  // Last.fm redirects here with ?token=… after the user authorizes. Exchange it
  // for a session (server-side), then return to Settings.
  onMount(async () => {
    const token = $page.url.searchParams.get("token");
    if (!token) {
      error = "No authorization token was returned by Last.fm.";
      return;
    }
    try {
      await connectLastfm(token);
      goto("/?view=settings", { replaceState: true });
    } catch (e) {
      error = e instanceof Error ? e.message : "Couldn't connect your Last.fm account.";
    }
  });
</script>

<div class="wrap" class:loading={!error}>
  {#if error}
    <Icon name="error" size={40} />
    <p class="msg">{error}</p>
    <a class="back" href="/?view=settings">Back to Settings</a>
  {:else}
    <Icon name="progress_activity" size={40} />
    <p class="msg">Connecting your Last.fm account…</p>
  {/if}
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
    padding: 1rem;
    color: var(--muted, #9aa);
  }
  .wrap :global(.material-symbols-rounded) {
    color: var(--accent-text, #c00);
  }
  .msg {
    margin: 0;
    font-size: 1rem;
  }
  .back {
    margin-top: 0.5rem;
    color: var(--accent-text, #c00);
    font-size: 0.9rem;
  }
  /* Spin only the loading icon. */
  .wrap.loading :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
