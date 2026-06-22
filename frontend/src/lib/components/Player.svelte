<script lang="ts">
  import { mount, unmount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MiniPlayer from "$lib/components/MiniPlayer.svelte";
  import QueueView from "$lib/components/QueueView.svelte";
  import {
    artUrl,
    clipUrl,
    generateClip,
    streamUrl,
    thumbUrl,
  } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";
  import type { Song } from "$lib/types";

  let {
    vm,
    queueOpen = false,
    active = true,
    onToggleQueue,
  }: {
    vm: SongViewModel;
    queueOpen?: boolean;
    active?: boolean; // false when another device is the audio output (remote)
    onToggleQueue?: () => void;
  } = $props();

  let audio = $state<HTMLAudioElement | null>(null);
  let currentTime = $state(0);
  let duration = $state(0);
  // True while the user is dragging a seek bar, so playback's timeupdate events
  // don't yank currentTime (and thus the fill) back to the live position and
  // fight the scrub.
  let seeking = $state(false);
  // The track id we've already counted a play for, so a play is recorded once
  // per listen (reset when the same track restarts — replay / repeat-one).
  let recordedSongId: number | null = null;

  const song = $derived(vm.currentSong);

  // Warm the browser cache with nearby cover art (±2 tracks) so the stack
  // animation almost always has the image ready when you skip or go back.
  // peekPrev/peekNext cover the immediate neighbours (wrap-aware); the queue
  // lookups add one more on each side.
  const preloadIds = $derived.by(() => {
    const ids = new Set<number>();
    const add = (s: Song | null | undefined) => {
      if (s?.hasArt) ids.add(s.id);
    };
    add(vm.peekPrev);
    add(vm.peekNext);
    const q = vm.queue;
    const i = vm.currentIndex;
    if (i !== null) for (const off of [-2, 2]) add(q[i + off]);
    return [...ids];
  });
  // Hold the Image refs so an in-flight fetch isn't GC'd before it completes.
  let preloadImgs: HTMLImageElement[] = [];
  $effect(() => {
    if (typeof Image === "undefined") return;
    preloadImgs = preloadIds.map((id) => {
      const img = new Image();
      img.src = artUrl(id);
      return img;
    });
  });

  // --- Volume normalization (loudness leveling) ---
  const NORM_TARGET_LUFS = -14;
  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;

  // iOS suspends the AudioContext when the screen locks and won't play audio
  // routed through Web Audio in the background — only a plain <audio> element
  // keeps playing on the lock screen. So on iOS we skip the graph entirely and
  // fall back to element-volume normalization (attenuate only; no boost).
  const isIOS =
    typeof navigator !== "undefined" &&
    (/iP(hone|od|ad)/.test(navigator.platform) ||
      (navigator.userAgent.includes("Mac") && "ontouchend" in document) ||
      /iPad|iPhone|iPod/.test(navigator.userAgent));
  // Reactive flag flipped once the graph is built. audioCtx/gainNode are plain
  // (non-reactive) refs — wrapping Web Audio nodes in $state proxies breaks
  // them — so the gain effect below tracks this flag to re-run when the graph
  // becomes available.
  let graphReady = $state(false);

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
    if (isIOS) return; // keep plain element playback so the lock screen works
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
      // Apply the current gain immediately (the element now runs at unity and
      // the gain node carries volume × normalization).
      audio.volume = 1;
      gainNode.gain.value = vm.volume * normGain;
      graphReady = true; // notify the gain effect the graph is live
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

  // Load a new source whenever the selected song changes. The play itself is
  // counted later, once the listener reaches ~75% of the track (see
  // maybeRecordPlay), not the instant it loads.
  $effect(() => {
    const el = audio;
    const id = song?.id;
    if (!el || id == null) return;
    if (!active) return; // another device is the audio output; stay silent
    const url = streamUrl(id);
    if (el.src !== url) {
      prefetchCtrl?.abort(); // don't let a prefetch starve the new track's buffer
      el.src = url;
      el.load();
      const restored = vm.suppressPlayRecord;
      if (restored) {
        vm.suppressPlayRecord = false;
        // A track restored after a refresh resumes mid-way; don't let crossing
        // 75% on resume re-count a play it may already have earned.
        recordedSongId = id;
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
    if (!active) {
      // Remote device: never emit audio (the active device plays).
      if (!audio.paused) audio.pause();
      return;
    }
    if (vm.isPlaying && audio.paused) tryResume(audio);
    if (!vm.isPlaying && !audio.paused) audio.pause();
  });

  // Prebuffer the upcoming track so a forward skip starts instantly. We use
  // fetch() rather than an <audio preload> element because iOS Safari ignores
  // preload on a non-playing element (to save data) — a plain fetch warms the
  // browser's HTTP cache, which the main <audio> then replays without a network
  // round-trip (the stream is immutable + cacheable).
  //
  // Crucially this only fires once the CURRENT track is comfortably buffered
  // (the audio element's `canplaythrough`), and is aborted the moment we load a
  // new track — otherwise the whole-file prefetch competes with playback for
  // the server's bandwidth and starves the current track, causing it to stall.
  let prefetchCtrl: AbortController | null = null;
  function prefetchNext() {
    if (!active) return;
    const id = vm.peekNext?.id;
    if (id == null) return;
    prefetchCtrl?.abort();
    const ctrl = new AbortController();
    prefetchCtrl = ctrl;
    const init: RequestInit = { signal: ctrl.signal };
    // Deprioritise behind the playing track (where the browser supports it).
    (init as Record<string, unknown>).priority = "low";
    fetch(streamUrl(id), init)
      .then((r) => r.arrayBuffer())
      .catch(() => {}); // aborted on track change, or offline — ignore
  }

  // Keep volume + normalization in sync. With the Web Audio graph active, the
  // element stays at unity and the gain node carries volume × normalization
  // (so quiet tracks can be boosted past 1). Without it, use element volume.
  $effect(() => {
    if (!audio) return;
    void graphReady; // re-run as soon as the Web Audio graph is built
    if (gainNode && audioCtx) {
      audio.volume = 1;
      gainNode.gain.value = vm.volume * normGain;
    } else {
      // No Web Audio graph (iOS, or Web Audio unavailable): normalize via
      // element volume. Capped at 1, so loud tracks get turned down but quiet
      // tracks can't be boosted above unity.
      audio.volume = Math.min(1, vm.volume * normGain);
    }
  });

  // --- Media Session (Cycle 26): OS / lock-screen / headphone controls ---
  const hasMediaSession =
    typeof navigator !== "undefined" && "mediaSession" in navigator;

  // iOS shows now-playing art in a square frame, so non-square album art gets
  // letterboxed (looks short). Cover-crop it onto a 512×512 canvas so the
  // lock-screen artwork always fills a clean square. Returns an object URL.
  let artObjectUrl: string | null = null;
  function buildSquareArtwork(id: number): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const SIZE = 512;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx || !img.width || !img.height) return resolve(null);
        // cover: scale so the shorter side fills, then center-crop the overflow
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        canvas.toBlob(
          (blob) => resolve(blob ? URL.createObjectURL(blob) : null),
          "image/jpeg",
          0.9
        );
      };
      img.onerror = () => resolve(null);
      img.src = artUrl(id);
    });
  }

  // Publish now-playing metadata as the track changes.
  $effect(() => {
    if (!hasMediaSession) return;
    const s = song;
    if (!s) {
      navigator.mediaSession.metadata = null;
      return;
    }
    let cancelled = false;
    const setMeta = (artwork: MediaImage[]) => {
      if (cancelled) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.originalFilename,
        artist: s.artist ?? "",
        album: s.album ?? "",
        artwork,
      });
    };
    // Show the raw art immediately, then upgrade to the square-cropped version.
    setMeta(
      s.hasArt ? [{ src: artUrl(s.id), sizes: "512x512", type: "image/jpeg" }] : []
    );
    if (s.hasArt) {
      buildSquareArtwork(s.id).then((url) => {
        if (cancelled || !url) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (artObjectUrl) URL.revokeObjectURL(artObjectUrl);
        artObjectUrl = url;
        setMeta([{ src: url, sizes: "512x512", type: "image/jpeg" }]);
      });
    }
    return () => {
      cancelled = true;
    };
  });

  // Mirror play/pause state to the OS.
  $effect(() => {
    if (hasMediaSession) {
      navigator.mediaSession.playbackState = vm.isPlaying ? "playing" : "paused";
    }
  });

  // Register hardware/lock-screen action handlers. iOS re-derives the Now
  // Playing controls whenever the now-playing item or play state changes, and
  // reverts to the ±15s seek buttons unless prev/next are re-asserted — so we
  // depend on song id + isPlaying to re-run and re-register on every change.
  $effect(() => {
    const el = audio;
    if (!el || !hasMediaSession) return;
    void song?.id; // re-assert when the track changes (iOS resets controls)
    void vm.isPlaying; // ...and when play/pause toggles
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => {
      if (!vm.isPlaying) vm.togglePlay();
    });
    ms.setActionHandler("pause", () => {
      if (vm.isPlaying) vm.togglePlay();
    });
    ms.setActionHandler("previoustrack", () => vm.prev());
    ms.setActionHandler("nexttrack", () => vm.next());
    ms.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) el.currentTime = d.seekTime;
    });
    // iOS shows ±15s skip buttons on the lock screen whenever seekforward/
    // seekbackward handlers exist, hiding the track skip buttons. Clearing
    // them forces iOS to fall back to prev/next track controls instead.
    ms.setActionHandler("seekbackward", null);
    ms.setActionHandler("seekforward", null);
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
    if (seeking) return; // don't fight an active scrub
    currentTime = audio?.currentTime ?? 0;
    vm.position = currentTime; // tracked for refresh-resume persistence
    updatePositionState();
    maybeRecordPlay();
  }

  // Count a play once ~75% of the track has been reached — a real listen, not a
  // brief sample or an accidental tap. Only the device actually playing audio
  // (active) counts it, and only once per listen; a restart (replay/repeat-one)
  // re-arms it.
  function maybeRecordPlay() {
    if (!active) return;
    const id = song?.id;
    if (id == null || !duration || !isFinite(duration)) return;
    if (id === recordedSongId && currentTime < 1) recordedSongId = null;
    if (id !== recordedSongId && currentTime / duration >= 0.75) {
      recordedSongId = id;
      vm.recordPlay(id);
    }
  }
  function onLoadedMetadata() {
    duration = audio?.duration ?? 0;
    vm.duration = duration; // for the pop-out mini player
    // Resume from the saved position after a refresh / cross-device handoff —
    // but ONLY for the track the position actually belongs to. Consume the
    // marker on the first load either way, so it can never leak onto the next
    // song (which would make it start partway through).
    if (vm.resumeAt > 0) {
      if (audio && song?.id === vm.resumeSongId) {
        audio.currentTime = Math.min(vm.resumeAt, duration || vm.resumeAt);
        currentTime = audio.currentTime;
      }
      vm.resumeAt = 0;
      vm.resumeSongId = null;
    }
    updatePositionState();
  }

  // Point the element at the *current* song and start it immediately, in the
  // caller's own call stack. The reactive $effect above also loads the current
  // song, but it runs asynchronously (a microtask later). That async gap is the
  // reason playback dies after a track when the phone is locked: iOS/Android
  // only let a backgrounded tab keep audio going if play() is called
  // synchronously within the `ended` event — once a tick passes, the autoplay
  // grant is gone, play() is rejected, and we strand the queue waiting for a
  // screen touch. Calling this straight from the `ended`/`error` handlers keeps
  // the next track inside that same media-event tick. The effect's
  // `el.src !== url` guard then sees the src already set and does nothing, so
  // there's no double-load.
  function playCurrent() {
    const el = audio;
    const id = vm.currentSong?.id;
    if (!el || id == null || !active) return;
    const url = streamUrl(id);
    if (el.src !== url) {
      prefetchCtrl?.abort(); // don't let a prefetch starve the new track's buffer
      el.src = url;
      el.load();
    }
    tryResume(el);
  }

  // A track reached its natural end: honor the sleep timer / repeat-one, else
  // advance the queue. Shared by the element's `ended` event and the stall
  // watchdog below (some browsers stall at EOF and never fire `ended`).
  function handleTrackEnd() {
    if (vm.sleepAtTrackEnd) {
      vm.isPlaying = false;
      vm.cancelSleep();
      return;
    }
    if (vm.repeat === "one" && audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (vm.next()) playCurrent();
    else vm.isPlaying = false;
  }

  // A track failed to play (network drop or decode error). Don't silently pause
  // and strand the queue, and don't loop a broken file under repeat-one — just
  // skip to the next track, exactly like a normal end-of-track advance.
  function handleTrackError() {
    if (vm.sleepAtTrackEnd) {
      vm.isPlaying = false;
      vm.cancelSleep();
      return;
    }
    if (vm.next()) playCurrent();
    else vm.isPlaying = false;
  }

  // Safety net for the "song finishes but the next one never starts" hang.
  // Occasionally a stream stalls in the final fraction of a second and the
  // browser never emits `ended`, leaving us paused mid-queue. While we're
  // supposed to be playing, watch for the play head sitting still right at the
  // end and treat it as a finished track. The conditions are deliberately tight
  // (at the very end, and not progressing for two consecutive checks) so a
  // normally-playing track — which always advances `currentTime` — is untouched.
  let lastWatchdogTime = -1;
  let watchdogStalls = 0;
  $effect(() => {
    const el = audio;
    if (!el || !active) return;
    const iv = setInterval(() => {
      if (el.paused || el.ended || el.seeking || seeking) {
        watchdogStalls = 0;
        lastWatchdogTime = el.currentTime;
        return;
      }
      if (!duration || !isFinite(duration)) return;
      if (el.currentTime !== lastWatchdogTime) {
        lastWatchdogTime = el.currentTime;
        watchdogStalls = 0;
        return;
      }
      // The play head hasn't moved since the last check while we're meant to be
      // playing. Only act on it when we're effectively at the end of the track.
      watchdogStalls += 1;
      if (duration - el.currentTime <= 1.5 && watchdogStalls >= 2) {
        watchdogStalls = 0;
        lastWatchdogTime = -1;
        handleTrackEnd();
      }
    }, 1000);
    return () => {
      clearInterval(iv);
      watchdogStalls = 0;
      lastWatchdogTime = -1;
    };
  });

  // Apply a seek requested from the mini player.
  $effect(() => {
    const t = vm.seekRequest;
    if (t !== null && audio) {
      audio.currentTime = t;
      currentTime = t;
      vm.seekRequest = null;
    }
  });

  // Remote device: it outputs no audio, so `ontimeupdate` never fires and the
  // seek bar's local `currentTime`/`duration` would stay frozen. Mirror the
  // active device's synced position/duration (kept live by the sync broadcasts
  // and the per-second interpolation in +page.svelte) so the bar tracks
  // playback. Skip while the user is scrubbing here so a drag isn't yanked back.
  $effect(() => {
    if (active) return;
    const pos = vm.position;
    const dur = vm.duration;
    if (seeking) return;
    currentTime = pos;
    duration = dur;
  });

  function togglePlay() {
    vm.togglePlay();
  }

  // Full-screen now-playing overlay (Cycle 36).
  let expanded = $state(false);
  // Queue sheet that slides up over the now-playing screen.
  let queueSheet = $state(false);
  // Reset the queue sheet whenever the now-playing view closes, so it doesn't
  // pop back open (already slid up) next time the screen is expanded.
  $effect(() => {
    if (!expanded) queueSheet = false;
  });

  // Canvas clip: when the full-screen view is open for a link-imported track
  // that doesn't have a clip yet, generate one in the background (cached on the
  // server). Once ready, replaceSong flips hasClip and the video fades in. Track
  // attempted ids so we don't re-request a song that failed or is in flight.
  const clipTried = new Set<number>();
  $effect(() => {
    if (!expanded || !song) return;
    if (!song.hasSource || song.hasClip || clipTried.has(song.id)) return;
    const id = song.id;
    clipTried.add(id);
    generateClip(id)
      .then((updated) => vm.replaceSong(updated))
      .catch(() => {
        /* no clip available — the artwork stays as-is */
      });
  });

  // Decide how a canvas clip fits the screen, set imperatively when it loads
  // (no reactive churn that could restart the <video>). Fill the screen (cover)
  // only when the clip and the viewport are similar shapes; otherwise fit the
  // whole clip (contain) — e.g. a 16:9 clip on a tall phone, which cover would
  // crop hard ("super zoomed in"). Also kick off playback explicitly, which some
  // mobile browsers need even for muted autoplay.
  function onCanvasLoaded(e: Event) {
    const v = e.currentTarget as HTMLVideoElement;
    if (v.videoWidth && v.videoHeight && window.innerHeight) {
      const clipAR = v.videoWidth / v.videoHeight;
      const viewAR = window.innerWidth / window.innerHeight;
      const visible = Math.min(clipAR, viewAR) / Math.max(clipAR, viewAR);
      v.style.objectFit = visible >= 0.62 ? "cover" : "contain";
    }
    v.play?.().catch(() => {});
  }

  // Esc closes the queue sheet first, then the full-screen now-playing view.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (queueSheet) queueSheet = false;
    else if (expanded) expanded = false;
  }

  // --- Mobile bottom-bar swipe: left/right changes track ---
  // A tap on the bar still opens the expanded view; barSwiped suppresses that
  // tap-open (and any button tap) when the gesture turned into a swipe.
  let barStartX = 0;
  let barStartY = 0;
  let barAxis: "" | "x" | "y" = "";
  let barSwiped = false;
  let barDragX = $state(0); // how far the bar content follows the finger (px)
  let barDragging = $state(false); // true while a horizontal drag is in progress
  function barTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    barStartX = t.clientX;
    barStartY = t.clientY;
    barAxis = "";
    barSwiped = false;
    barDragX = 0;
  }
  function barTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - barStartX;
    const dy = t.clientY - barStartY;
    if (barAxis === "" && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      barAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (barAxis === "x") {
      barDragging = true;
      // Dampened + capped so it reads as a nudge, not a full drag-off.
      barDragX = Math.max(-56, Math.min(56, dx * 0.5));
    }
  }
  function barTouchEnd(e: TouchEvent) {
    barDragging = false;
    barDragX = 0; // springs back via the CSS transition
    if (barAxis !== "x") return;
    const dx = e.changedTouches[0].clientX - barStartX;
    if (Math.abs(dx) > 60) {
      barSwiped = true;
      if (dx < 0) vm.next();
      else vm.prevTrack();
    }
  }

  // --- Touch gestures on the full-screen view ---
  // Swipe down (anywhere) drags the whole sheet down to dismiss. Swipe the
  // artwork left/right to change tracks with a stacked-records animation:
  // swiping forward pulls the next record onto the top of the stack, swiping
  // back lifts the current record off to reveal the previous one beneath.
  // Gestures on the scrubber or a button are ignored so those still work.
  let dragY = $state(0); // vertical finger offset on the whole sheet (px)
  // Horizontal swipe progress: dir is the direction being dragged and p is how
  // far through the gesture we are (0 → 1, where 1 means the skip commits). The
  // moving "top" record is driven entirely off these two values.
  let dir = $state<"none" | "next" | "prev">("none");
  let p = $state(0);
  // Stable snapshot of the three records for the current gesture. Captured once
  // when a swipe/animation begins so the cards never re-render mid-animation
  // (binding to live vm.peek* flashes the wrong art when the track swaps).
  let gPrev = $state<Song | null>(null);
  let gCur = $state<Song | null>(null);
  let gNext = $state<Song | null>(null);
  function captureNeighbors() {
    gPrev = vm.peekPrev;
    gCur = song;
    gNext = vm.peekNext;
  }
  let npDragging = $state(false); // true while the finger is down (no transition)
  let npStartX = 0;
  let npStartY = 0;
  let npAxis: "" | "x" | "y" = "";
  let committing = false; // a skip animation is in progress
  const SKIP_THRESHOLD = 135; // px the record must travel before a skip commits
  const SETTLE_MS = 340; // matches the .npf-card transform transition

  function npTouchStart(e: TouchEvent) {
    if (committing || queueSheet) return; // queue sheet owns its own scrolling
    if ((e.target as HTMLElement).closest("input,button")) return;
    const t = e.touches[0];
    npStartX = t.clientX;
    npStartY = t.clientY;
    npAxis = "";
    dir = "none";
    p = 0;
    npDragging = true;
  }
  function npTouchMove(e: TouchEvent) {
    if (!npDragging) return;
    const t = e.touches[0];
    const dx = t.clientX - npStartX;
    const dy = t.clientY - npStartY;
    if (npAxis === "" && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      npAxis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
    }
    if (npAxis === "y" && dy > 0) dragY = dy; // follow downward drags only
    else if (npAxis === "x") {
      if (dir === "none") {
        // Lock the direction for this gesture (jitter mustn't flip it) and
        // snapshot the records so the cards stay stable.
        dir = dx < 0 ? "next" : "prev";
        captureNeighbors();
      }
      const sign = dir === "next" ? -1 : 1; // forward = drag left
      p = Math.max(0, Math.min(1, (dx * sign) / SKIP_THRESHOLD));
    }
  }
  function npTouchEnd(e: TouchEvent) {
    if (!npDragging) return;
    npDragging = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - npStartX;
    const dy = t.clientY - npStartY;
    if (npAxis === "y" && dy > 90) expanded = false;
    else if (npAxis === "x" && dx <= -SKIP_THRESHOLD && vm.peekNext) {
      commitSkip("next");
    } else if (npAxis === "x" && dx >= SKIP_THRESHOLD && vm.peekPrev) {
      commitSkip("prev");
    } else if (npAxis === "x") {
      // Below threshold (or no neighbor): the record settles back onto the
      // stack. Clear the gesture once the spring-back transition finishes.
      p = 0;
      setTimeout(() => (dir = "none"), SETTLE_MS);
    }
    dragY = 0;
    npAxis = "";
  }

  // Button-driven skip: replay the same stacked-record animation from the
  // start so tapping prev/next teaches the swipe gesture. Renders the incoming/
  // revealed card at p=0 for a frame, then runs it to completion via commitSkip.
  async function animateSkip(d: "next" | "prev") {
    if (committing) return;
    committing = true;
    // Pre-decode the destination art before animating. A swipe gets this for
    // free (the art decodes while you drag), but a button press runs the whole
    // animation in ~340ms — without this the base card is revealed before its
    // new image has decoded and flashes the previous cover for a frame.
    const target = d === "next" ? vm.peekNext : vm.peekPrev;
    if (target?.hasArt && typeof Image !== "undefined") {
      try {
        const img = new Image();
        img.src = artUrl(target.id);
        await img.decode();
      } catch {
        /* decode can reject if interrupted — proceed anyway */
      }
    }
    npDragging = false; // transitions on
    captureNeighbors();
    dir = d;
    p = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => commitSkip(d)));
  }

  // The full-screen prev/next buttons. Both animate the stacked-record skip when
  // there's a neighbouring track, matching the swipe gesture (so prev always
  // animates to the previous track rather than restarting the current one). At
  // the very first track prev just restarts, so the button still responds.
  function buttonNext() {
    if (vm.peekNext) animateSkip("next");
    else vm.next();
  }
  function buttonPrev() {
    if (vm.peekPrev) animateSkip("prev");
    else vm.prev();
  }

  // Run the record the rest of the way, then snap the stack back to centre.
  // The track swap happens NOW (not after the animation) so the new song's
  // audio loads/plays during the slide instead of after it — no skip delay.
  // The visuals run off the gPrev/gCur/gNext snapshot, so the live swap doesn't
  // disturb them; resetting dir at the end just reveals the (already-playing)
  // current track, which matches the record that landed on top.
  function commitSkip(d: "next" | "prev") {
    committing = true;
    if (d === "next") vm.next();
    else vm.prevTrack();
    p = 1; // transition animates the record the rest of the way
    setTimeout(() => {
      npDragging = true; // disable transitions for the instant reset
      dir = "none";
      p = 0;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          npDragging = false; // re-enable transitions for the next gesture
          committing = false;
        })
      );
    }, SETTLE_MS);
  }

  // --- Pop-out mini player (Document Picture-in-Picture) ---
  // A small always-on-top window with our own controls, available on Chromium
  // desktop. We mount a MiniPlayer component into the PiP window so Svelte's
  // event handling works there; it's driven through the shared view-model, so
  // there's no separate audio element or duplicated state.
  const hasDocumentPip =
    typeof window !== "undefined" && "documentPictureInPicture" in window;
  let pipActive = $state(false);
  let pipWindow: Window | null = null;
  let pipApp: Record<string, unknown> | null = null; // mounted MiniPlayer

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
    if (!hasDocumentPip || pipActive) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dpip = (window as any).documentPictureInPicture;
    pipWindow = await dpip.requestWindow({ width: 300, height: 340 });
    if (!pipWindow) return;
    copyStyles(pipWindow);
    pipWindow.document.documentElement.dataset.theme =
      document.documentElement.dataset.theme ?? "dark";
    pipWindow.document.body.style.margin = "0";
    pipApp = mount(MiniPlayer, {
      target: pipWindow.document.body,
      props: { vm },
    });
    pipActive = true;
    pipWindow.addEventListener("pagehide", () => {
      if (pipApp) unmount(pipApp);
      pipApp = null;
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
    currentTime = value; // keep the thumb and the filled track in lockstep
    vm.seek(value); // forwards as a command when this device is a remote
  }
  // Native sliders (web): mark the scrub so playback doesn't fight the fill.
  function onSeekStart() {
    seeking = true;
  }
  function onSeekCommit() {
    seeking = false;
  }

  // Full-screen seek row: dragging anywhere across it scrubs the position,
  // rather than the swipe being read as a track skip. The skip gesture stays on
  // the album art above. Touches here are kept from bubbling to the skip
  // handler (npTouch*), and mapped to a time via the slider's width.
  let seekInput: HTMLInputElement | null = null;
  function seekFromClientX(clientX: number) {
    if (!seekInput || !duration) return;
    const r = seekInput.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const t = frac * duration;
    currentTime = t; // immediate visual feedback while dragging
    vm.seek(t);
  }
  function seekTouchStart(e: TouchEvent) {
    e.stopPropagation(); // don't let the skip-swipe see this gesture
    seeking = true;
    seekFromClientX(e.touches[0].clientX);
  }
  function seekTouchMove(e: TouchEvent) {
    e.stopPropagation();
    e.preventDefault(); // own the gesture: no page scroll / skip animation
    seekFromClientX(e.touches[0].clientX);
  }
  function seekTouchEnd(e: TouchEvent) {
    e.stopPropagation();
    seeking = false;
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
  preload="auto"
  oncanplaythrough={prefetchNext}
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
  onended={handleTrackEnd}
  onerror={() => {
    // Only react while we're the active output and actually trying to play, so
    // a benign error on a backgrounded/remote element can't skip the queue.
    if (active && vm.isPlaying) handleTrackError();
  }}
></audio>

{#if sleepMenu}
  <button
    class="sleep-backdrop"
    aria-label="Close sleep menu"
    onclick={() => (sleepMenu = false)}
  ></button>
{/if}

{#snippet cover(s: Song | null)}
  {#if s?.hasArt}
    <img src={artUrl(s.id)} alt="" />
  {:else}
    <Icon name="music_note" size={96} />
  {/if}
{/snippet}

{#if song && expanded}
  <div
    class="np-full"
    class:np-canvas={song.hasClip}
    class:np-dragging={npDragging}
    ontouchstart={npTouchStart}
    ontouchmove={npTouchMove}
    ontouchend={npTouchEnd}
    ontouchcancel={npTouchEnd}
    style="transform: translateY({dragY}px); opacity: {1 - Math.min(dragY / 500, 0.6)}"
  >
    {#if song.hasClip}
      <!-- Looping canvas clip from the source video: a muted, full-bleed
           backdrop behind the artwork/controls. Keyed on id so it reloads on
           track change. A scrim keeps the foreground readable. -->
      {#key song.id}
        <video
          class="npf-canvas"
          src={clipUrl(song.id)}
          autoplay
          loop
          muted
          playsinline
          preload="auto"
          onloadedmetadata={onCanvasLoaded}
        ></video>
      {/key}
      <div class="npf-canvas-scrim"></div>
    {/if}
    <button class="np-collapse" onclick={() => (expanded = false)} aria-label="Close">
      <Icon name="keyboard_arrow_down" size={28} />
    </button>
    <button
      class="np-queue"
      onclick={() => (queueSheet = true)}
      aria-label="Queue"
      title="Queue"
    >
      <Icon name="queue_music" size={26} />
    </button>
    <div class="npf-art">
      <div class="npf-stack" class:np-dragging={npDragging}>
        <!-- The live current record — the source of truth for what's playing.
             It's hidden while a gesture's snapshot cards animate on top, then
             revealed at the end. Because its source swaps at commit-start (well
             before it's shown) it's already decoded when revealed, so there's
             no morph/flash; the card it replaces showed the identical image. -->
        <div class="npf-card npf-base" style="opacity: {dir === 'none' ? 1 : 0}">
          {@render cover(song)}
        </div>

        {#if dir === "next"}
          <!-- old current receding as the next is pulled over it -->
          <div
            class="npf-card npf-recede"
            style="transform: translateY({p * 14}px) scale({1 - 0.18 * p})"
          >
            {@render cover(gCur)}
          </div>
          <!-- next record pulled onto the top of the stack -->
          <div
            class="npf-card npf-raised"
            style="transform: translateX({(1 - p) * 112}%) rotate({(1 - p) * 7}deg)"
          >
            {@render cover(gNext)}
          </div>
        {:else if dir === "prev"}
          <!-- previous record revealed beneath, popping up into place -->
          <div
            class="npf-card npf-reveal"
            style="transform: translateY({(1 - p) * 14}px) scale({0.82 + 0.18 * p})"
          >
            {@render cover(gPrev)}
          </div>
          <!-- old current lifting off the top of the stack -->
          <div
            class="npf-card npf-raised"
            style="transform: translateX({p * 112}%) rotate({p * 7}deg)"
          >
            {@render cover(gCur)}
          </div>
        {/if}
      </div>
    </div>
    <div class="npf-meta">
      <h2>{song.originalFilename}</h2>
      {#if song.artist}<p class="npf-artist">{song.artist}</p>{/if}
      {#if song.album}<p class="npf-album">{song.album}</p>{/if}
    </div>
    <div
      class="npf-seek"
      ontouchstart={seekTouchStart}
      ontouchmove={seekTouchMove}
      ontouchend={seekTouchEnd}
      ontouchcancel={seekTouchEnd}
    >
      <span class="time">{formatTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={duration || 0}
        step="0.1"
        value={currentTime}
        oninput={onSeek}
        onpointerdown={onSeekStart}
        onpointerup={onSeekCommit}
        onpointercancel={onSeekCommit}
        onchange={onSeekCommit}
        bind:this={seekInput}
        style="--pct: {duration ? (currentTime / duration) * 100 : 0}%"
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
      <button onclick={buttonPrev} aria-label="Previous"
        ><Icon name="skip_previous" fill size={38} /></button
      >
      <button class="npf-play" onclick={togglePlay} aria-label="Play/Pause">
        <Icon name={vm.isPlaying ? "pause" : "play_arrow"} fill size={48} />
      </button>
      <button onclick={buttonNext} aria-label="Next"
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

    <!-- Queue sheet that slides up over the now-playing screen. -->
    <div class="npf-queue" class:open={queueSheet}>
      <div class="npf-queue-head">
        <span class="npf-queue-title">Up Next</span>
        <button
          class="np-collapse npf-queue-close"
          onclick={() => (queueSheet = false)}
          aria-label="Close queue"
        >
          <Icon name="keyboard_arrow_down" size={28} />
        </button>
      </div>
      <div class="npf-queue-body">
        {#if vm.queue.length === 0}
          <p class="npf-queue-empty">Nothing queued yet.</p>
        {:else}
          <QueueView {vm} />
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if song}
  <div
    class="player"
    ontouchstart={barTouchStart}
    ontouchmove={barTouchMove}
    ontouchend={barTouchEnd}
  >
    <button
      class="now-playing"
      class:bar-dragging={barDragging}
      style="transform: translateX({barDragX}px)"
      onclick={() => {
        if (barSwiped) return; // a swipe just happened — don't open the view
        expanded = true;
      }}
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
      <button
        class="play"
        onclick={() => {
          if (barSwiped) return; // ignore a play tap that was really a swipe
          togglePlay();
        }}
        aria-label="Play/Pause"
      >
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
        onpointerdown={onSeekStart}
        onpointerup={onSeekCommit}
        onpointercancel={onSeekCommit}
        onchange={onSeekCommit}
        style="--pct: {duration ? (currentTime / duration) * 100 : 0}%"
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
        onclick={() => {
          if (barSwiped) return; // ignore a queue tap that was really a swipe
          onToggleQueue?.();
        }}
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
        style="--pct: {vm.volume * 100}%"
        aria-label="Volume"
      />
    </div>

    <!-- Thin track-progress line along the bottom edge (mobile only). -->
    <div
      class="mini-progress"
      style="--pct: {duration ? (currentTime / duration) * 100 : 0}%"
    ></div>
  </div>
{/if}

<style>
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
    touch-action: none; /* let us own the swipe gestures */
    transition: transform 0.25s ease, opacity 0.25s ease; /* snap-back */
  }
  .np-full.np-dragging {
    transition: none; /* follow the finger 1:1 while dragging */
  }
  /* Looping canvas clip backdrop. Negative z-index keeps it behind the artwork,
     meta and controls (which stay non-positioned / auto-z) without having to
     raise each of them; pointer-events:none lets swipe gestures pass through. */
  .npf-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* Default to contain (fit the whole clip — safe for square/vertical clips
       and before metadata loads). The video's onloadedmetadata upgrades
       widescreen clips to cover (full-bleed). The dark scrim fills any leftover
       space and darkens the top/sides (corner buttons) + bottom (controls). */
    object-fit: contain;
    object-position: center;
    z-index: -1;
    pointer-events: none;
    animation: npf-fade 0.6s ease both;
  }
  .npf-canvas-scrim {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    /* Three stacked layers (first = on top):
       1. top fade — darkens the top so the corner buttons read,
       2. right-edge fade — darkens the right side,
       3. the bottom fade (unchanged) — the smooth, bottom-heavy ramp that makes
          the controls read; left exactly as before.
       Each has a few intermediate stops to avoid visible banding. */
    background:
      linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.62) 0%,
        rgba(0, 0, 0, 0.34) 14%,
        rgba(0, 0, 0, 0.12) 27%,
        rgba(0, 0, 0, 0) 40%
      ),
      linear-gradient(
        to left,
        rgba(0, 0, 0, 0.5) 0%,
        rgba(0, 0, 0, 0.27) 12%,
        rgba(0, 0, 0, 0.08) 23%,
        rgba(0, 0, 0, 0) 35%
      ),
      linear-gradient(
        to right,
        rgba(0, 0, 0, 0.5) 0%,
        rgba(0, 0, 0, 0.27) 12%,
        rgba(0, 0, 0, 0.08) 23%,
        rgba(0, 0, 0, 0) 35%
      ),
      linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.2) 0%,
        rgba(0, 0, 0, 0.23) 10%,
        rgba(0, 0, 0, 0.27) 20%,
        rgba(0, 0, 0, 0.33) 30%,
        rgba(0, 0, 0, 0.4) 40%,
        rgba(0, 0, 0, 0.48) 48%,
        rgba(0, 0, 0, 0.57) 55%,
        rgba(0, 0, 0, 0.67) 62%,
        rgba(0, 0, 0, 0.77) 69%,
        rgba(0, 0, 0, 0.87) 76%,
        rgba(0, 0, 0, 0.94) 82%,
        rgba(0, 0, 0, 0.98) 88%,
        rgba(0, 0, 0, 1) 94%,
        rgba(0, 0, 0, 1) 100%
      );
  }
  @keyframes npf-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  /* With a video backdrop the foreground must read on a dark scrim regardless of
     the light/dark theme, so force light text + a soft shadow for the canvas. */
  .np-full.np-canvas {
    color: #fff;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
  }
  .np-full.np-canvas :global(.npf-meta h2),
  .np-full.np-canvas :global(.npf-artist),
  .np-full.np-canvas :global(.npf-album) {
    color: #fff;
  }
  /* The clip is the star: hide the album-art card so it isn't sitting on top of
     the video, and anchor the title/controls to the bottom (Spotify-canvas
     style) so the clip fills the view above them. */
  .np-full.np-canvas {
    justify-content: flex-end;
    gap: 1rem;
    /* Drop the cluster down into the dark bottom band (the heavy scrim there
       masks any burned-in subtitles), off the very edge for breathing room. */
    padding-bottom: clamp(1rem, 3.5vh, 3rem);
  }
  .np-full.np-canvas :global(.npf-art) {
    display: none;
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
  @media (hover: hover) {
    .np-collapse:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .np-queue {
    position: absolute;
    top: 1rem;
    right: 1rem;
    display: inline-flex;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem;
    border-radius: 0.5rem;
  }
  @media (hover: hover) {
    .np-queue:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .npf-queue {
    position: absolute;
    inset: 0;
    z-index: 5; /* above the art/controls (z 0-3) and the top buttons */
    background: var(--bg);
    display: flex;
    flex-direction: column;
    transform: translateY(100%); /* parked below the screen */
    transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform;
  }
  .npf-queue.open {
    transform: translateY(0); /* slides up over the now-playing screen */
  }
  .npf-queue-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1rem 0.5rem;
    flex-shrink: 0;
  }
  .npf-queue-title {
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .npf-queue-close {
    position: static; /* override .np-collapse's absolute positioning */
  }
  .npf-queue-body {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0 1rem 1.5rem;
  }
  .npf-queue-empty {
    color: var(--muted);
    text-align: center;
    margin-top: 2rem;
  }
  .npf-art {
    /* Square stage holding the stacked record cards. */
    width: min(320px, 70vw);
    aspect-ratio: 1;
    position: relative;
  }
  .npf-stack {
    position: absolute;
    inset: 0;
  }
  .npf-card {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    color: var(--dim);
    border-radius: 0.75rem;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
    /* Decelerating ease so the record settles smoothly. Keep the duration in
       sync with SETTLE_MS in the script. will-change promotes each card to its
       own GPU layer so the motion stays buttery. */
    transition:
      transform 0.34s cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 0.34s ease;
    will-change: transform;
  }
  .npf-stack.np-dragging .npf-card {
    transition: none; /* follow the finger 1:1 while dragging */
  }
  .npf-base {
    z-index: 0; /* the live current record, revealed at rest / gesture end */
  }
  .npf-recede,
  .npf-reveal {
    z-index: 2; /* the record being covered / revealed beneath the mover */
  }
  /* The record being moved (pulled on for next, lifted off for prev) sits on
     top of the stack with a deeper shadow so it reads as raised. */
  .npf-raised {
    z-index: 3;
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
  }
  .npf-card img {
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
    /* Taller hit area so a drag in this row reliably scrubs instead of being
       read as a track-skip swipe, and own the touch gesture (no page pan). */
    padding: 0.5rem 0;
    touch-action: none;
  }
  .npf-seek input {
    flex: 1;
    accent-color: var(--accent);
    touch-action: auto; /* keep native drag-to-seek (parent owns swipes) */
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
  @media (hover: hover) {
    .npf-controls button:hover {
      background: var(--surface-2);
    }
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
    -webkit-user-select: none;
    user-select: none; /* swiping the bar shouldn't select the title/artist */
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
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1); /* swipe spring-back */
  }
  .now-playing.bar-dragging {
    transition: none; /* follow the finger 1:1 while dragging */
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
  @media (hover: hover) {
    .controls button:hover {
      background: var(--surface-2);
    }
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
  @media (hover: hover) {
    .sleep-menu button:hover {
      background: var(--hover);
    }
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
  @media (hover: hover) {
    .queue-toggle:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .queue-toggle.active {
    color: var(--accent-text);
    background: var(--active-bg);
  }
  /* Thin, crisp custom sliders (fill driven by --pct on the element). */
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    height: 12px;
    background: transparent;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(
      to right,
      var(--accent) 0 var(--pct, 0%),
      var(--surface-2) var(--pct, 0%)
    );
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -3.5px;
    border-radius: 50%;
    background: var(--accent);
  }
  input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
  }
  input[type="range"]::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: var(--accent);
  }
  input[type="range"]::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 50%;
    background: var(--accent);
  }
  /* Thin track-progress line (mobile only); hidden on desktop. */
  .mini-progress {
    display: none;
  }

  @media (max-width: 768px) {
    /* Compact bar: art + title/artist, play/pause, queue — track changes are
       done by swiping the bar left/right, with a thin progress line below. */
    .player {
      position: relative;
      grid-template-columns: 1fr auto auto;
      grid-template-areas: "now controls extras";
      gap: 0.35rem 0.5rem;
      /* Extra bottom padding clears the iOS home indicator when installed as a
         PWA (0 in Safari, where dvh already accounts for the toolbar). */
      padding: 0.6rem 0.8rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
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
    /* Only play/pause stays in the controls; prev/next become swipe, and
       shuffle/repeat live in the full-screen view. */
    .controls button:not(.play) {
      display: none;
    }
    /* Extras: keep only the queue button. Sleep timer + volume live in the
       full-screen view; the OS handles output volume on phones. */
    .sleep-wrap,
    .volume > input,
    .volume > :global(.material-symbols-rounded) {
      display: none;
    }
    /* Replace the scrubber row with the thin bottom progress line. */
    .progress {
      display: none;
    }
    .mini-progress {
      display: block;
      position: absolute;
      left: 0;
      right: 0;
      bottom: env(safe-area-inset-bottom, 0px); /* sit above the home indicator */
      height: 3px;
      background: linear-gradient(
        to right,
        var(--accent) 0 var(--pct, 0%),
        var(--surface-2) var(--pct, 0%)
      );
    }
    .play,
    .queue-toggle {
      padding: 0.4rem;
    }
  }
</style>
