<script lang="ts">
  import { onMount } from "svelte";
  import Player from "$lib/components/Player.svelte";
  import SongList from "$lib/components/SongList.svelte";
  import UploadForm from "$lib/components/UploadForm.svelte";
  import { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  const vm = new SongViewModel();

  onMount(() => {
    vm.load();
  });
</script>

<header>
  <h1>🎵 Music Server</h1>
  <UploadForm {vm} />
</header>

{#if vm.error}
  <p class="error">{vm.error}</p>
{/if}

<section>
  <h2>Songs</h2>
  <SongList {vm} />
</section>

<Player {vm} />

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  h2 {
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
    margin: 0 0 0.5rem;
  }
  .error {
    background: #7f1d1d;
    color: #fecaca;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    margin: 0 0 1rem;
  }
</style>
