<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { SyncController } from "$lib/viewmodels/syncController.svelte";

  // Shown when another device is the active audio output. Indicates where
  // playback is happening and lets you transfer it to this device.
  let { sync }: { sync: SyncController } = $props();
</script>

<div class="device-bar">
  <span class="info">
    <Icon name="graphic_eq" size={18} />
    Playing on <strong>{sync.activeDeviceName}</strong>
  </span>
  <button class="here" onclick={() => sync.claim()} title="Transfer playback here">
    <Icon name="play_arrow" fill size={16} /> Play here
  </button>
</div>

<style>
  .device-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1.25rem;
    background: var(--active-bg);
    border-top: 1px solid var(--accent);
    color: var(--accent-text);
    font-size: 0.85rem;
  }
  .info {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info strong {
    color: var(--text);
  }
  .here {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    padding: 0.35rem 0.8rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .here:hover {
    background: var(--accent-hover);
  }
</style>
