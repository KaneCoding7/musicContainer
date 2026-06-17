<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  // Pop-out (Document Picture-in-Picture) mini player. Mounted into the PiP
  // window so Svelte's events work there; everything is driven through the
  // shared view-model (the audio element stays in the main player).
  let { vm }: { vm: SongViewModel } = $props();

  const song = $derived(vm.currentSong);

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function onSeek(event: Event) {
    const t = Number((event.target as HTMLInputElement).value);
    vm.position = t; // optimistic
    vm.seekRequest = t; // the main player applies it to the audio element
  }
</script>

<div class="pip-mini">
  <div class="pip-art">
    {#if song?.hasArt}
      <img src={thumbUrl(song.id, 256)} alt="" />
    {:else}
      <Icon name="music_note" size={48} />
    {/if}
  </div>
  <div class="pip-meta">
    <span class="pip-title">{song?.originalFilename ?? "Nothing playing"}</span>
    {#if song?.artist}<span class="pip-artist">{song.artist}</span>{/if}
  </div>
  <div class="pip-seek">
    <span class="time">{formatTime(vm.position)}</span>
    <input
      type="range"
      min="0"
      max={vm.duration || 0}
      step="0.1"
      value={vm.position}
      oninput={onSeek}
      aria-label="Seek"
    />
    <span class="time">{formatTime(vm.duration)}</span>
  </div>
  <div class="pip-controls">
    <button onclick={() => vm.prev()} aria-label="Previous"
      ><Icon name="skip_previous" fill size={30} /></button
    >
    <button class="pip-play" onclick={() => vm.togglePlay()} aria-label="Play/Pause">
      <Icon name={vm.isPlaying ? "pause" : "play_arrow"} fill size={40} />
    </button>
    <button onclick={() => vm.next()} aria-label="Next"
      ><Icon name="skip_next" fill size={30} /></button
    >
  </div>
</div>

<style>
  .pip-mini {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    height: 100vh;
    box-sizing: border-box;
    padding: 0.9rem;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .pip-art {
    width: 128px;
    height: 128px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.6rem;
    color: var(--dim);
    overflow: hidden;
  }
  .pip-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .pip-meta {
    width: 100%;
    text-align: center;
    min-width: 0;
  }
  .pip-title {
    display: block;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pip-artist {
    display: block;
    color: var(--muted);
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pip-seek {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
  }
  .pip-seek input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .time {
    color: var(--muted);
    font-size: 0.75rem;
    min-width: 2.5rem;
    text-align: center;
  }
  .pip-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .pip-controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 50%;
  }
  .pip-controls button:hover {
    background: var(--surface-2);
  }
  .pip-controls .pip-play {
    color: var(--accent-text);
  }
</style>
