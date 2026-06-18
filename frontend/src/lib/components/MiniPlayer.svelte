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

<div class="pip" class:noart={!song?.hasArt}>
  {#if song?.hasArt}
    <img class="bg" src={thumbUrl(song.id, 512)} alt="" />
  {:else}
    <div class="bg-fallback"><Icon name="music_note" size={80} /></div>
  {/if}
  <div class="scrim"></div>

  <div class="overlay">
    <div class="meta">
      <span class="title">{song?.originalFilename ?? "Nothing playing"}</span>
      {#if song?.artist}<span class="artist">{song.artist}</span>{/if}
    </div>

    <div class="seek">
      <input
        type="range"
        min="0"
        max={vm.duration || 0}
        step="0.1"
        value={vm.position}
        oninput={onSeek}
        style="--pct: {vm.duration ? (vm.position / vm.duration) * 100 : 0}%"
        aria-label="Seek"
      />
      <div class="times">
        <span>{formatTime(vm.position)}</span>
        <span>{formatTime(vm.duration)}</span>
      </div>
    </div>

    <div class="controls">
      <button onclick={() => vm.prev()} aria-label="Previous">
        <Icon name="skip_previous" fill size={30} />
      </button>
      <button class="play" onclick={() => vm.togglePlay()} aria-label="Play/Pause">
        <Icon name={vm.isPlaying ? "pause" : "play_arrow"} fill size={32} />
      </button>
      <button onclick={() => vm.next()} aria-label="Next">
        <Icon name="skip_next" fill size={30} />
      </button>
    </div>
  </div>
</div>

<style>
  .pip {
    position: relative;
    width: 100%;
    height: 100vh;
    overflow: hidden;
    background: #000;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    user-select: none;
  }
  .bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .bg-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--surface-2), var(--bg));
    color: var(--dim);
  }
  /* Darken top + bottom so white controls stay legible over any artwork. */
  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.45) 0%,
      rgba(0, 0, 0, 0) 35%,
      rgba(0, 0, 0, 0.35) 60%,
      rgba(0, 0, 0, 0.85) 100%
    );
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.85rem 0.95rem 1rem;
    color: #fff;
  }
  .meta {
    min-width: 0;
  }
  .title {
    display: block;
    font-weight: 700;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }
  .artist {
    display: block;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.82);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }
  .seek {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .seek input {
    width: 100%;
    margin: 0;
    -webkit-appearance: none;
    appearance: none;
    height: 12px;
    background: transparent;
    cursor: pointer;
  }
  .seek input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(
      to right,
      #fff 0 var(--pct, 0%),
      rgba(255, 255, 255, 0.3) var(--pct, 0%)
    );
  }
  .seek input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -3.5px;
    border-radius: 50%;
    background: #fff;
  }
  .seek input::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.3);
  }
  .seek input::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: #fff;
  }
  .seek input::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 50%;
    background: #fff;
  }
  .times {
    display: flex;
    justify-content: space-between;
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.8);
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.9rem;
  }
  .controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #fff;
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 50%;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
  }
  .controls button:hover {
    background: rgba(255, 255, 255, 0.18);
  }
  .controls .play {
    background: rgba(255, 255, 255, 0.95);
    color: #000;
    width: 48px;
    height: 48px;
  }
  .controls .play:hover {
    background: #fff;
  }
</style>
