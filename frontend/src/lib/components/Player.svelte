<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { artUrl, streamUrl, thumbUrl } from "$lib/services/songService";
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

  // --- Volume normalization (loudness leveling) ---
  const NORM_TARGET_LUFS = -14;
  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;

  // Linear gain for the current track so it plays near the target loudness.
  // 1 when normalization is off or the track hasn't been analyzed.
  const normGain = $derived.by(() => {
    if (!vm.normalize) return 1;
    const lufs = song?.loudness;
    if (lufs == null) return 1;
    const gainDb = Math.max(-12, Math.min(12, NORM_TARGET_LUFS - lufs));
    return Math.pow(10, gainDb / 20);
  });

  // Lazily build a Web Audio graph (source → gain → limiter → output) so quiet
  // tracks can be boosted without clipping. Created on first playback; falls
  // back to plain element volume if Web Audio is unavailable or the media is
  // cross-origin without CORS (which would taint the graph).
  function ensureAudioGraph() {
    if (audioCtx || !audio) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
      const source = audioCtx.createMediaElementSource(audio);
      gainNode = audioCtx.createGain();
      const limiter = audioCtx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      source.connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(audioCtx.destination);
    } catch {
      audioCtx = null;
      gainNode = null;
    }
  }

  // True from the moment we try to resume a restored track until it actually
  // starts playing. While true, pause events are treated as "autoplay blocked"
  // (keep the intent + wait for a gesture) rather than "user paused".
  let awaitingFirstPlay = false;

  // When the browser blocks autoplay (e.g. resuming on refresh before any user
  // interaction), resume playback on the first interaction so a track that was
  // playing keeps playing. Idempotent: only one listener is ever armed.
  let resumeArmed = false;
  function armAutoResume() {
    if (resumeArmed) return;
    resumeArmed = true;
    const events = ["pointerdown", "touchstart", "keydown", "click"] as const;
    const resume = () => {
      for (const e of events) window.removeEventListener(e, resume);
      resumeArmed = false;
      if (vm.isPlaying && audio?.paused) {
        ensureAudioGraph();
        audioCtx?.resume();
        audio.play().catch(() => {});
      }
    };
    for (const e of events) window.addEventListener(e, resume);
  }

  // Start (or resume) playback. A normal play() succeeds when there's been a
  // user gesture or the browser already trusts the site (Chrome's Media
  // Engagement Index). When it's blocked — e.g. resuming on refresh before any
  // interaction — there is no reliable way to force unmuted audio, so we fall
  // back to resuming on the first interaction. vm.isPlaying stays true so the UI
  // and lock-screen reflect the intent to play.
  function tryResume(el: HTMLAudioElement) {
    ensureAudioGraph();
    audioCtx?.resume();
    el.play().catch(() => armAutoResume());
  }

  // Load a new source whenever the selected song changes, recording a play for
  // each newly loaded track (but not for one merely restored after a refresh).
  $effect(() => {
    const el = audio;
    const id = song?.id;
    if (!el || id == null) return;
    const url = streamUrl(id);
    if (el.src !== url) {
      el.src = url;
      el.load();
      const restored = vm.suppressPlayRecord;
      if (restored) {
        vm.suppressPlayRecord = false;
      } else {
        vm.recordPlay(id);
      }
      if (vm.isPlaying) {
        if (restored) {
          // Resuming after a refresh: guard against autoplay being blocked or
          // silently paused, and pre-arm a gesture fallback.
          awaitingFirstPlay = true;
          armAutoResume();
        }
        tryResume(el);
      }
    }
  });

  // Mirror the requested play/pause state onto the element.
  $effect(() => {
    if (!audio || !song) return;
    if (vm.isPlaying && audio.paused) tryResume(audio);
    if (!vm.isPlaying && !audio.paused) audio.pause();
  });

  // Keep volume + normalization in sync. With the Web Audio graph active, the
  // element stays at unity and the gain node carries volume × normalization
  // (so quiet tracks can be boosted past 1). Without it, use element volume.
  $effect(() => {
    if (!audio) return;
    if (gainNode && audioCtx) {
      audio.volume = 1;
      gainNode.gain.value = vm.volume * normGain;
    } else {
      audio.volume = vm.volume;
    }
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
        ? [{ src: artUrl(s.id), sizes: "512x512" }]
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
    vm.position = currentTime; // tracked for refresh-resume persistence
    updatePositionState();
  }
  function onLoadedMetadata() {
    duration = audio?.duration ?? 0;
    // Resume from the saved position after a refresh, then clear the marker.
    if (audio && vm.resumeAt > 0) {
      audio.currentTime = Math.min(vm.resumeAt, duration || vm.resumeAt);
      currentTime = audio.currentTime;
      vm.resumeAt = 0;
    }
    updatePositionState();
  }

  function togglePlay() {
    vm.togglePlay();
  }

  // Full-screen now-playing overlay (Cycle 36).
  let expanded = $state(false);

  // Esc closes the full-screen now-playing view.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && expanded) expanded = false;
  }

  // --- Pop-out mini player (Document Picture-in-Picture) ---
  // A small always-on-top window with our own controls, available on Chromium
  // desktop. We render the mini UI into a hidden element and physically move
  // that DOM node into the PiP window (and back on close) so it stays bound to
  // the same view-model — no separate audio element, no duplicated state.
  const hasDocumentPip =
    typeof window !== "undefined" && "documentPictureInPicture" in window;
  let pipHome = $state<HTMLElement | null>(null); // hidden host in the page
  let pipRoot = $state<HTMLElement | null>(null); // the mini UI we relocate
  let pipActive = $state(false);
  let pipWindow: Window | null = null;

  // Clone the page's stylesheets into the PiP window so our scoped classes and
  // theme variables apply there too.
  function copyStyles(win: Window) {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const css = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join("\n");
        const style = win.document.createElement("style");
        style.textContent = css;
        win.document.head.appendChild(style);
      } catch {
        if (sheet.href) {
          const link = win.document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          win.document.head.appendChild(link);
        }
      }
    }
  }

  async function openPip() {
    if (!hasDocumentPip || !pipRoot || pipActive) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dpip = (window as any).documentPictureInPicture;
    pipWindow = await dpip.requestWindow({ width: 320, height: 360 });
    if (!pipWindow) return;
    copyStyles(pipWindow);
    pipWindow.document.documentElement.dataset.theme =
      document.documentElement.dataset.theme ?? "dark";
    pipWindow.document.body.style.margin = "0";
    pipWindow.document.body.append(pipRoot);
    pipActive = true;
    pipWindow.addEventListener("pagehide", () => {
      pipHome?.append(pipRoot!); // move the UI back into the page
      pipActive = false;
      pipWindow = null;
    });
  }

  function closePip() {
    pipWindow?.close();
  }

  function togglePip() {
    pipActive ? closePip() : openPip();
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

<svelte:window onkeydown={onWindowKeydown} />

<audio
  bind:this={audio}
  crossorigin="anonymous"
  ontimeupdate={onTimeUpdate}
  onloadedmetadata={onLoadedMetadata}
  onplay={() => {
    vm.isPlaying = true;
    awaitingFirstPlay = false; // playback really started; stop guarding pauses
  }}
  onpause={() => {
    // While resuming after a refresh, a pause means autoplay was blocked, not a
    // user action — keep the intent and wait for a gesture instead of flipping
    // the UI to paused. User pauses (buttons/lock-screen) set isPlaying=false
    // themselves before the element pauses, so those still work.
    if (awaitingFirstPlay) {
      armAutoResume();
      return;
    }
    vm.isPlaying = false;
  }}
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

<!-- Pop-out mini player content. Hidden in the page; physically relocated into
     the Document Picture-in-Picture window when active. -->
<div bind:this={pipHome} style="display: none">
  <div bind:this={pipRoot} class="pip-mini">
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
    <div class="pip-controls">
      <button onclick={() => vm.prev()} aria-label="Previous"
        ><Icon name="skip_previous" fill size={30} /></button
      >
      <button class="pip-play" onclick={togglePlay} aria-label="Play/Pause">
        <Icon name={vm.isPlaying ? "pause" : "play_arrow"} fill size={40} />
      </button>
      <button onclick={() => vm.next()} aria-label="Next"
        ><Icon name="skip_next" fill size={30} /></button
      >
    </div>
  </div>
</div>

{#if sleepMenu}
  <button
    class="sleep-backdrop"
    aria-label="Close sleep menu"
    onclick={() => (sleepMenu = false)}
  ></button>
{/if}

{#if song && expanded}
  <div class="np-full">
    <button class="np-collapse" onclick={() => (expanded = false)} aria-label="Close">
      <Icon name="keyboard_arrow_down" size={28} />
    </button>
    <div class="npf-art">
      {#if song.hasArt}
        <img src={artUrl(song.id)} alt="" />
      {:else}
        <Icon name="music_note" size={96} />
      {/if}
    </div>
    <div class="npf-meta">
      <h2>{song.originalFilename}</h2>
      {#if song.artist}<p class="npf-artist">{song.artist}</p>{/if}
      {#if song.album}<p class="npf-album">{song.album}</p>{/if}
    </div>
    <div class="npf-seek">
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
    <div class="npf-controls">
      <button
        class="toggle"
        class:active={vm.shuffle}
        onclick={() => vm.toggleShuffle()}
        aria-label="Shuffle"><Icon name="shuffle" size={26} /></button
      >
      <button onclick={() => vm.prev()} aria-label="Previous"
        ><Icon name="skip_previous" fill size={38} /></button
      >
      <button class="npf-play" onclick={togglePlay} aria-label="Play/Pause">
        <Icon name={vm.isPlaying ? "pause" : "play_arrow"} fill size={48} />
      </button>
      <button onclick={() => vm.next()} aria-label="Next"
        ><Icon name="skip_next" fill size={38} /></button
      >
      <button
        class="toggle"
        class:active={vm.repeat !== "off"}
        onclick={() => vm.cycleRepeat()}
        aria-label="Repeat"
        ><Icon
          name={vm.repeat === "one" ? "repeat_one" : "repeat"}
          size={26}
        /></button
      >
    </div>
  </div>
{/if}

{#if song}
  <div class="player">
    <button
      class="now-playing"
      onclick={() => (expanded = true)}
      title="Open now playing"
    >
      <span class="np-art">
        {#if song.hasArt}
          <img src={thumbUrl(song.id, 128)} alt="" />
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
    </button>

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
      {#if hasDocumentPip}
        <button
          class="queue-toggle"
          class:active={pipActive}
          onclick={togglePip}
          aria-label="Pop out mini player"
          title="Pop out mini player"
          ><Icon name="picture_in_picture_alt" size={20} /></button
        >
      {/if}
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
  /* Pop-out mini player (Document PiP). Styles are copied into the PiP window;
     the scoped class hashes travel with the relocated nodes. */
  .pip-mini {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    height: 100%;
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

  .np-full {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 2rem 1.5rem;
    box-sizing: border-box;
  }
  .np-collapse {
    position: absolute;
    top: 1rem;
    left: 1rem;
    display: inline-flex;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem;
    border-radius: 0.5rem;
  }
  .np-collapse:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .npf-art {
    width: min(320px, 70vw);
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.75rem;
    color: var(--dim);
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }
  .npf-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .npf-meta {
    text-align: center;
    max-width: min(520px, 90vw);
  }
  .npf-meta h2 {
    margin: 0;
    font-size: 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .npf-artist {
    margin: 0.35rem 0 0;
    color: var(--muted);
  }
  .npf-album {
    margin: 0.15rem 0 0;
    color: var(--dim);
    font-size: 0.85rem;
  }
  .npf-seek {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: min(520px, 90vw);
  }
  .npf-seek input {
    flex: 1;
    accent-color: var(--accent);
  }
  .npf-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .npf-controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0.4rem;
    border-radius: 50%;
  }
  .npf-controls button:hover {
    background: var(--surface-2);
  }
  .npf-controls .npf-play {
    color: var(--accent-text);
  }
  .npf-controls .toggle {
    color: var(--muted);
    opacity: 0.7;
  }
  .npf-controls .toggle.active {
    color: var(--accent-text);
    opacity: 1;
  }
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
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
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
  @media (max-width: 768px) {
    .player {
      grid-template-columns: 1fr auto auto;
      grid-template-areas:
        "now controls extras"
        "progress progress progress";
      gap: 0.35rem 0.5rem;
      padding: 0.6rem 0.8rem;
    }
    .now-playing {
      grid-area: now;
    }
    .controls {
      grid-area: controls;
    }
    .volume {
      grid-area: extras;
    }
    .progress {
      grid-area: progress;
    }
    /* Shuffle/repeat live in the full-screen view on mobile to save space. */
    .controls .toggle {
      display: none;
    }
    /* System handles output volume on phones; drop the slider + its icon. */
    .volume > input,
    .volume > :global(.material-symbols-rounded) {
      display: none;
    }
    .controls button,
    .queue-toggle {
      padding: 0.4rem;
    }
  }
</style>
