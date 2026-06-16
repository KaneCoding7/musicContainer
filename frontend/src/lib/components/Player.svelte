<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { artUrl, streamUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let {
    vm,
    queueOpen = false,
    onToggleQueue,
  }: {
    vm: SongViewModel;
    queueOpen?: boolean;
    onToggleQueue?: () => void;
  } = $props();

  let audio = $state<HTMLAudioElement | null>(null);
  let currentTime = $state(0);
  let duration = $state(0);

  const song = $derived(vm.currentSong);

  // Load (and autoplay) a new source whenever the selected song changes,
  // recording a play for each newly loaded track.
  $effect(() => {
    const el = audio;
    const id = song?.id;
    if (!el || id == null) return;
    const url = streamUrl(id);
    if (el.src !== url) {
      el.src = url;
      el.load();
      el.play().catch(() => {});
      vm.recordPlay(id);
    }
  });

  // Mirror the requested play/pause state onto the element.
  $effect(() => {
    if (!audio || !song) return;
    if (vm.isPlaying && audio.paused) audio.play().catch(() => {});
    if (!vm.isPlaying && !audio.paused) audio.pause();
  });

  // Keep element volume in sync.
  $effect(() => {
    if (audio) audio.volume = vm.volume;
  });

  // --- Media Session (Cycle 26): OS / lock-screen / headphone controls ---
  const hasMediaSession =
    typeof navigator !== "undefined" && "mediaSession" in navigator;

  // Publish now-playing metadata as the track changes.
  $effect(() => {
    if (!hasMediaSession) return;
    const s = song;
    if (!s) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.originalFilename,
      artist: s.artist ?? "",
      album: s.album ?? "",
      artwork: s.hasArt
        ? [{ src: artUrl(s.id), sizes: "512x512", type: "image/jpeg" }]
        : [],
    });
  });

  // Mirror play/pause state to the OS.
  $effect(() => {
    if (hasMediaSession) {
      navigator.mediaSession.playbackState = vm.isPlaying ? "playing" : "paused";
    }
  });

  // Register hardware/lock-screen action handlers once the element exists.
  $effect(() => {
    const el = audio;
    if (!el || !hasMediaSession) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => (vm.isPlaying = true));
    ms.setActionHandler("pause", () => (vm.isPlaying = false));
    ms.setActionHandler("previoustrack", () => vm.prev());
    ms.setActionHandler("nexttrack", () => vm.next());
    ms.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) el.currentTime = d.seekTime;
    });
    ms.setActionHandler("seekbackward", (d) => {
      el.currentTime = Math.max(0, el.currentTime - (d.seekOffset ?? 10));
    });
    ms.setActionHandler("seekforward", (d) => {
      el.currentTime = Math.min(
        el.duration || 0,
        el.currentTime + (d.seekOffset ?? 10)
      );
    });
  });

  // Keeps the OS scrubber in sync.
  function updatePositionState() {
    if (!audio || !hasMediaSession || !navigator.mediaSession.setPositionState)
      return;
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, d),
    });
  }

  function onTimeUpdate() {
    currentTime = audio?.currentTime ?? 0;
    updatePositionState();
  }
  function onLoadedMetadata() {
    duration = audio?.duration ?? 0;
    updatePositionState();
  }

  function togglePlay() {
    vm.togglePlay();
  }

  // --- Sleep timer UI (Cycle 35) ---
  let sleepMenu = $state(false);
  let nowMs = $state(Date.now());
  $effect(() => {
    if (vm.sleepUntil === null) return;
    const id = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(id);
  });
  const sleepRemaining = $derived(
    vm.sleepUntil !== null ? Math.max(0, vm.sleepUntil - nowMs) : 0
  );
  function fmtRemain(ms: number): string {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, "0")}`;
  }

  function onSeek(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (audio) audio.currentTime = value;
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
</script>

<audio
  bind:this={audio}
  ontimeupdate={onTimeUpdate}
  onloadedmetadata={onLoadedMetadata}
  onplay={() => (vm.isPlaying = true)}
  onpause={() => (vm.isPlaying = false)}
  onended={() => {
    if (vm.sleepAtTrackEnd) {
      vm.isPlaying = false;
      vm.cancelSleep();
      return;
    }
    if (vm.repeat === "one" && audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (!vm.next()) {
      vm.isPlaying = false;
    }
  }}
></audio>

{#if sleepMenu}
  <button
    class="sleep-backdrop"
    aria-label="Close sleep menu"
    onclick={() => (sleepMenu = false)}
  ></button>
{/if}

{#if song}
  <div class="player">
    <div class="now-playing">
      <span class="np-art">
        {#if song.hasArt}
          <img src={artUrl(song.id)} alt="" />
        {:else}
          <Icon name="music_note" size={20} />
        {/if}
      </span>
      <span class="np-meta">
        <span class="np-title" title={song.originalFilename}
          >{song.originalFilename}</span
        >
        {#if song.artist}
          <span class="np-artist" title={song.artist}>{song.artist}</span>
        {/if}
      </span>
    </div>

    <div class="controls">
      <button
        class="toggle"
        class:active={vm.shuffle}
        onclick={() => vm.toggleShuffle()}
        aria-label="Shuffle"
        title="Shuffle"><Icon name="shuffle" size={22} /></button
      >
      <button onclick={() => vm.prev()} aria-label="Previous" title="Previous"
        ><Icon name="skip_previous" fill size={26} /></button
      >
      <button class="play" onclick={togglePlay} aria-label="Play/Pause">
        <Icon name={vm.isPlaying ? "pause" : "play_arrow"} fill size={32} />
      </button>
      <button onclick={() => vm.next()} aria-label="Next" title="Next"
        ><Icon name="skip_next" fill size={26} /></button
      >
      <button
        class="toggle"
        class:active={vm.repeat !== "off"}
        onclick={() => vm.cycleRepeat()}
        aria-label="Repeat"
        title={vm.repeat === "one"
          ? "Repeat one"
          : vm.repeat === "all"
            ? "Repeat all"
            : "Repeat off"}
        ><Icon
          name={vm.repeat === "one" ? "repeat_one" : "repeat"}
          size={22}
        /></button
      >
    </div>

    <div class="progress">
      <span class="time">{formatTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={duration || 0}
        step="0.1"
        value={currentTime}
        oninput={onSeek}
        aria-label="Seek"
      />
      <span class="time">{formatTime(duration)}</span>
    </div>

    <div class="volume">
      <div class="sleep-wrap">
        <button
          class="queue-toggle"
          class:active={vm.sleepActive}
          onclick={() => (sleepMenu = !sleepMenu)}
          aria-label="Sleep timer"
          title="Sleep timer"><Icon name="bedtime" size={20} /></button
        >
        {#if vm.sleepUntil !== null}
          <span class="sleep-badge">{fmtRemain(sleepRemaining)}</span>
        {/if}
        {#if sleepMenu}
          <div class="sleep-menu">
            <button onclick={() => { vm.setSleepTimer(15); sleepMenu = false; }}>15 minutes</button>
            <button onclick={() => { vm.setSleepTimer(30); sleepMenu = false; }}>30 minutes</button>
            <button onclick={() => { vm.setSleepTimer(60); sleepMenu = false; }}>1 hour</button>
            <button
              class:on={vm.sleepAtTrackEnd}
              onclick={() => { vm.setSleepAtTrackEnd(); sleepMenu = false; }}
              >End of track</button
            >
            {#if vm.sleepActive}
              <button class="off" onclick={() => { vm.cancelSleep(); sleepMenu = false; }}>Turn off</button>
            {/if}
          </div>
        {/if}
      </div>
      <button
        class="queue-toggle"
        class:active={queueOpen}
        onclick={() => onToggleQueue?.()}
        aria-label="Toggle queue"
        title="Queue"><Icon name="queue_music" size={22} /></button
      >
      <Icon name="volume_up" size={20} />
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        bind:value={vm.volume}
        aria-label="Volume"
      />
    </div>
  </div>
{/if}

<style>
  .player {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: 1fr auto 2fr auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    background: var(--surface);
    border-top: 1px solid var(--surface-2);
  }
  .now-playing {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .np-art {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.35rem;
    color: var(--dim);
    overflow: hidden;
  }
  .np-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .np-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .np-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .np-artist {
    color: var(--muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 0.4rem;
  }
  .controls button:hover {
    background: var(--surface-2);
  }
  .controls .play {
    color: var(--accent-text);
  }
  .controls .toggle {
    color: var(--muted);
    opacity: 0.65;
  }
  .controls .toggle.active {
    opacity: 1;
    color: var(--accent-text);
    background: var(--active-bg);
  }
  .volume :global(.material-symbols-rounded) {
    color: var(--muted);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .progress input {
    flex: 1;
  }
  .time {
    color: var(--muted);
    font-size: 0.75rem;
    min-width: 2.5rem;
    text-align: center;
  }
  .volume {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .sleep-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .sleep-badge {
    margin-left: 0.15rem;
    color: var(--accent-text);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .sleep-menu {
    position: absolute;
    bottom: calc(100% + 0.4rem);
    right: 0;
    z-index: 30;
    min-width: 150px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    padding: 0.25rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
  }
  .sleep-menu button {
    padding: 0.5rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: 0.35rem;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .sleep-menu button:hover {
    background: var(--hover);
  }
  .sleep-menu button.on {
    color: var(--accent-text);
  }
  .sleep-menu button.off {
    color: var(--danger-text);
  }
  .sleep-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: transparent;
    border: none;
    padding: 0;
  }
  .volume input {
    width: 70px;
  }
  .queue-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 0.4rem;
    margin-right: 0.25rem;
  }
  .queue-toggle:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .queue-toggle.active {
    color: var(--accent-text);
    background: var(--active-bg);
  }
  input[type="range"] {
    accent-color: var(--accent);
  }
  @media (max-width: 600px) {
    .player {
      grid-template-columns: 1fr;
      gap: 0.6rem;
    }
  }
</style>
