<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import Icon from "$lib/components/Icon.svelte";
  import SongRow from "$lib/components/SongRow.svelte";
  import TransportControls from "$lib/components/TransportControls.svelte";
  import {
    fetchPublicShare,
    publicArtUrl,
    publicStreamUrl,
    type PublicShare,
  } from "$lib/services/publicService";

  const token = $page.params.token ?? "";

  let data = $state<PublicShare | null>(null);
  let error = $state<string | null>(null);

  let audio = $state<HTMLAudioElement | null>(null);
  let currentTime = $state(0);
  let duration = $state(0);
  let isPlaying = $state(false);
  let expanded = $state(false);
  let shuffle = $state(false);
  let repeat = $state<"off" | "all" | "one">("off");

  // Play order (indices into data.songs) and the position within it, so shuffle
  // and repeat work like the in-app player without reordering the visible list.
  let order = $state<number[]>([]);
  let pos = $state<number | null>(null);

  const currentIndex = $derived(pos !== null ? (order[pos] ?? null) : null);
  const current = $derived(
    data && currentIndex !== null ? data.songs[currentIndex] : null
  );
  // First track with artwork stands in as the playlist cover.
  const coverId = $derived(data?.songs.find((s) => s.hasArt)?.id ?? null);
  const totalDuration = $derived(
    (data?.songs ?? []).reduce((sum, s) => sum + (s.duration ?? 0), 0)
  );

  onMount(async () => {
    try {
      data = await fetchPublicShare(token);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load share";
    }
  });

  // Load + autoplay when the selected track changes.
  $effect(() => {
    const el = audio;
    const song = current;
    if (!el || !song) return;
    const url = publicStreamUrl(token, song.id);
    if (el.src !== url) {
      el.src = url;
      el.load();
      el.play().catch(() => {});
    }
  });

  function shuffledFrom(n: number, first: number): number[] {
    const a = Array.from({ length: n }, (_, k) => k);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    const at = a.indexOf(first);
    if (at > 0) {
      a.splice(at, 1);
      a.unshift(first);
    }
    return a;
  }
  function buildOrder(start: number) {
    const n = data?.songs.length ?? 0;
    if (n === 0) {
      order = [];
      pos = null;
      return;
    }
    if (shuffle) {
      order = shuffledFrom(n, start);
      pos = 0;
    } else {
      order = Array.from({ length: n }, (_, k) => k);
      pos = start;
    }
  }
  function play(i: number) {
    if (i === currentIndex) {
      toggle();
      return;
    }
    buildOrder(i);
    isPlaying = true;
  }
  function playAll() {
    shuffle = false;
    buildOrder(0);
    isPlaying = true;
  }
  function shufflePlay() {
    const n = data?.songs.length ?? 0;
    if (n === 0) return;
    shuffle = true;
    buildOrder(Math.floor(Math.random() * n));
    isPlaying = true;
  }
  function toggle() {
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }
  function advance(): boolean {
    if (pos === null) return false;
    if (pos < order.length - 1) {
      pos += 1;
      return true;
    }
    if (repeat === "all") {
      if (shuffle) buildOrder(Math.floor(Math.random() * (data?.songs.length ?? 1)));
      else pos = 0;
      return true;
    }
    return false;
  }
  function next() {
    advance();
  }
  function prev() {
    if (pos === null) return;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0; // restart the track first, like most players
      return;
    }
    if (pos > 0) pos -= 1;
    else if (repeat === "all") pos = order.length - 1;
  }
  function onEnded() {
    if (repeat === "one") {
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    if (!advance()) isPlaying = false;
  }
  function toggleShuffle() {
    shuffle = !shuffle;
    if (currentIndex !== null) buildOrder(currentIndex);
  }
  function cycleRepeat() {
    repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
  }
  function onSeek(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    if (audio) audio.currentTime = v;
  }
  function fmt(s: number): string {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }
  function fmtTotal(s: number): string {
    if (!s) return "";
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
</script>

<svelte:head
  ><title>{data ? data.name : "Shared playlist"} · Music Server</title
  ></svelte:head
>

<div class="page">
  <header class="topbar">
    <div class="brand"><Icon name="library_music" fill size={22} /> Music Server</div>
  </header>

  {#if error}
    <div class="state">
      <Icon name="link_off" size={40} />
      <p>{error}</p>
    </div>
  {:else if !data}
    <div class="state"><p>Loading…</p></div>
  {:else}
    <div class="content">
      {#if coverId !== null}
        <div class="pl-backdrop" aria-hidden="true">
          <img src={publicArtUrl(token, coverId)} alt="" />
        </div>
      {/if}

      <div class="detail" class:has-hero={coverId !== null}>
        <div class="head">
          <span class="cover-lg">
            {#if coverId !== null}
              <img src={publicArtUrl(token, coverId)} alt="" />
            {:else}
              <Icon name="queue_music" size={48} />
            {/if}
          </span>
          <div class="head-info">
            <h3><span class="pl-name">{data.name}</span></h3>
            <p class="muted">
              Shared by {data.ownerName} · {data.songs.length}
              {data.songs.length === 1 ? "track" : "tracks"}
              {#if totalDuration}· {fmtTotal(totalDuration)}{/if}
            </p>
          </div>
        </div>

        {#if data.songs.length > 0}
          <div class="toolbar-row">
            <div class="play-actions">
              <button class="pa play" onclick={playAll} title="Play" aria-label="Play">
                <Icon name="play_arrow" fill size={20} /><span>Play</span>
              </button>
              <button
                class="pa shuffle"
                onclick={shufflePlay}
                title="Shuffle"
                aria-label="Shuffle"
              >
                <Icon name="shuffle" size={20} /><span>Shuffle</span>
              </button>
            </div>
          </div>

          <div class="list-head" aria-hidden="true">
            <span class="head-title">Title</span>
            <span class="head-dur"><Icon name="schedule" size={18} /></span>
          </div>
          <ul class="tracks">
            {#each data.songs as song, i (song.id)}
              {@const isCurrent = i === currentIndex}
              <li
                class="song-row"
                class:current={isCurrent}
                class:playing={isCurrent && isPlaying}
              >
                <SongRow
                  artUrl={song.hasArt ? publicArtUrl(token, song.id) : null}
                  title={song.originalFilename}
                  artist={song.artist}
                  current={isCurrent}
                  playing={isCurrent && isPlaying}
                  onclick={() => play(i)}
                />
                <span class="col-dur">{song.duration ? fmt(song.duration) : "—"}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  <audio
    bind:this={audio}
    ontimeupdate={() => (currentTime = audio?.currentTime ?? 0)}
    onloadedmetadata={() => (duration = audio?.duration ?? 0)}
    onplay={() => (isPlaying = true)}
    onpause={() => (isPlaying = false)}
    onended={onEnded}
  ></audio>

  {#if current}
    <!-- Collapsed now-playing bar; tap the art/title to open the full screen. -->
    <div class="player">
      <button
        class="now-playing"
        onclick={() => (expanded = true)}
        title="Open now playing"
      >
        <span class="np-art">
          {#if current.hasArt}
            <img src={publicArtUrl(token, current.id)} alt="" />
          {:else}
            <Icon name="music_note" size={20} />
          {/if}
        </span>
        <span class="np-meta">
          <span class="np-title">{current.originalFilename}</span>
          {#if current.artist}<span class="np-artist">{current.artist}</span>{/if}
        </span>
      </button>

      <div class="controls">
        <button
          class="toggle"
          class:active={shuffle}
          onclick={toggleShuffle}
          aria-label="Shuffle"
          title="Shuffle"><Icon name="shuffle" size={22} /></button
        >
        <TransportControls
          {isPlaying}
          variant="bar"
          onPrev={prev}
          onToggle={toggle}
          onNext={next}
        />
        <button
          class="toggle"
          class:active={repeat !== "off"}
          onclick={cycleRepeat}
          aria-label="Repeat"
          title={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"}
          ><Icon name={repeat === "one" ? "repeat_one" : "repeat"} size={22} /></button
        >
      </div>

      <div class="progress">
        <span class="time">{fmt(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          oninput={onSeek}
          aria-label="Seek"
        />
        <span class="time">{fmt(duration)}</span>
      </div>
    </div>
  {/if}

  {#if current && expanded}
    <div class="np-full">
      <button
        class="np-collapse"
        onclick={() => (expanded = false)}
        aria-label="Close"
      >
        <Icon name="keyboard_arrow_down" size={28} />
      </button>

      <div class="npf-art">
        <div class="npf-card">
          {#if current.hasArt}
            <img src={publicArtUrl(token, current.id)} alt="" />
          {:else}
            <Icon name="music_note" size={72} />
          {/if}
        </div>
      </div>

      <div class="npf-meta"><h2>{current.originalFilename}</h2></div>
      {#if current.artist}<p class="npf-artist">{current.artist}</p>{/if}

      <div class="npf-seek">
        <span class="time">{fmt(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          oninput={onSeek}
          aria-label="Seek"
        />
        <span class="time">{fmt(duration)}</span>
      </div>

      <div class="npf-controls">
        <button
          class="toggle"
          class:active={shuffle}
          onclick={toggleShuffle}
          aria-label="Shuffle"><Icon name="shuffle" size={26} /></button
        >
        <TransportControls
          {isPlaying}
          variant="full"
          onPrev={prev}
          onToggle={toggle}
          onNext={next}
        />
        <button
          class="toggle"
          class:active={repeat !== "off"}
          onclick={cycleRepeat}
          aria-label="Repeat"
          ><Icon name={repeat === "one" ? "repeat_one" : "repeat"} size={26} /></button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh; /* fallback */
    height: 100dvh;
  }
  .topbar {
    flex-shrink: 0;
    padding: 1rem 2rem;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--accent-text);
  }
  .state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    color: var(--muted);
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem 2rem 2rem;
    position: relative;
  }
  .detail {
    position: relative;
    z-index: 1;
  }

  /* Immersive, blurred cover-art backdrop behind the header — identical to the
     app's open-playlist view. */
  .pl-backdrop {
    position: absolute;
    z-index: 0;
    top: -1.5rem;
    left: -2rem;
    right: -2rem;
    height: 620px;
    overflow: hidden;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(
      to bottom,
      #000 0%,
      #000 52%,
      transparent 100%
    );
    mask-image: linear-gradient(to bottom, #000 0%, #000 52%, transparent 100%);
  }
  .pl-backdrop img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(44px) saturate(1.7);
    transform: scale(1.3);
    opacity: 0.85;
  }
  .pl-backdrop::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--bg) 8%, transparent),
      color-mix(in srgb, var(--bg) 34%, transparent)
    );
  }
  .detail.has-hero .head-info h3,
  .detail.has-hero .head-info .muted {
    text-shadow: 0 1px 14px rgba(0, 0, 0, 0.55);
  }

  .head {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    margin-bottom: 1.25rem;
  }
  .cover-lg {
    flex-shrink: 0;
    width: 260px;
    height: 260px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.6rem;
    color: var(--dim);
    overflow: hidden;
  }
  .detail.has-hero .cover-lg {
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .cover-lg img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .head-info {
    min-width: 0;
  }
  .head-info h3 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    min-width: 0;
  }
  .head-info h3 .pl-name {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-info .muted {
    margin: 0 0 0.6rem;
    color: var(--muted);
    font-size: 0.82rem;
  }

  .toolbar-row {
    display: flex;
    align-items: center;
    margin: 0 0 1rem;
  }
  .play-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .pa {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.95rem;
    border: none;
    border-radius: 2rem;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .pa.play {
    background: var(--accent);
    color: #fff;
  }
  @media (hover: hover) {
    .pa.play:hover {
      background: var(--accent-hover);
    }
  }
  .pa.shuffle {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border-strong);
  }
  @media (hover: hover) {
    .pa.shuffle:hover {
      background: var(--hover);
    }
  }

  /* Track-list column header, matching the app. */
  .list-head {
    display: flex;
    align-items: center;
    padding: 0 0.75rem 0.5rem;
    border-bottom: 1px solid var(--border-strong);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .head-title {
    flex: 1;
    min-width: 0;
  }
  .head-dur {
    display: inline-flex;
    justify-content: flex-end;
    width: 3rem;
  }

  .tracks {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li.song-row {
    display: flex;
    align-items: center;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
  }
  @media (hover: hover) {
    li.song-row:hover {
      background: var(--hover);
    }
    li.current:hover {
      background: var(--active-bg);
    }
  }
  .col-dur {
    flex-shrink: 0;
    width: 3rem;
    text-align: right;
    color: var(--dim);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }

  /* --- Collapsed now-playing bar (matches the app's .player). --- */
  .player {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.6fr);
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.5rem;
    background: var(--surface);
    border-top: 1px solid var(--surface-2);
    -webkit-user-select: none;
    user-select: none;
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
    justify-content: center;
    gap: 0.4rem;
  }
  /* Shuffle / repeat toggles flanking the shared transport. */
  .controls .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    opacity: 0.65;
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 0.4rem;
  }
  @media (hover: hover) {
    .controls .toggle:hover {
      background: var(--surface-2);
    }
  }
  .controls .toggle.active {
    opacity: 1;
    color: var(--accent-text);
    background: var(--active-bg);
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .progress input {
    flex: 1;
    accent-color: var(--accent);
  }
  .time {
    color: var(--muted);
    font-size: 0.75rem;
    min-width: 2.75rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* --- Full-screen now-playing view (matches the app's .np-full). --- */
  .np-full {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem 1.5rem;
    padding-bottom: clamp(1rem, 3.5vh, 3rem);
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
  @media (hover: hover) {
    .np-collapse:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }
  .npf-art {
    width: min(520px, 90vw);
    aspect-ratio: 1;
    position: relative;
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
    margin: -0.5rem 0 0;
    text-align: center;
    color: var(--muted);
    font-size: 0.95rem;
    max-width: min(520px, 90vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .npf-seek {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: min(520px, 90vw);
    padding: 0.5rem 0;
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
  .npf-controls .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--muted);
    opacity: 0.7;
    cursor: pointer;
    padding: 0.4rem;
    border-radius: 50%;
  }
  @media (hover: hover) {
    .npf-controls .toggle:hover {
      background: var(--surface-2);
    }
  }
  .npf-controls .toggle.active {
    color: var(--accent-text);
    opacity: 1;
  }

  /* Phones: center the hero and shrink the cover, like the app. */
  @media (max-width: 768px) {
    .content {
      padding: 1rem;
    }
    .pl-backdrop {
      left: -1rem;
      right: -1rem;
      top: -1rem;
      height: 480px;
    }
    .head {
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      text-align: center;
      margin-bottom: 0.6rem;
    }
    .head-info {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .cover-lg {
      width: 220px;
      height: 220px;
    }
    .player {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .progress {
      display: none;
    }
  }
</style>
