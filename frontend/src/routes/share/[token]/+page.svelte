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
  let currentIndex = $state<number | null>(null);
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  // Full-screen now-playing view, opened by tapping the bar — mirrors the
  // expandable player in the main app.
  let expanded = $state(false);

  const current = $derived(
    data && currentIndex !== null ? data.songs[currentIndex] : null
  );
  // The first track with artwork stands in as the playlist cover.
  const coverId = $derived(data?.songs.find((s) => s.hasArt)?.id ?? null);

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

  function play(i: number) {
    // Tapping the row that's already playing toggles it, so the pause icon the
    // thumbnail shows is actually actionable (matches the in-app song list).
    if (i === currentIndex) {
      toggle();
      return;
    }
    currentIndex = i;
    isPlaying = true;
  }
  function toggle() {
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }
  function next() {
    if (data && currentIndex !== null && currentIndex < data.songs.length - 1)
      currentIndex += 1;
  }
  function prev() {
    if (currentIndex !== null && currentIndex > 0) currentIndex -= 1;
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
      <div class="hero">
        <span class="hero-art">
          {#if coverId !== null}
            <img src={publicArtUrl(token, coverId)} alt="" />
          {:else}
            <Icon name="queue_music" size={64} />
          {/if}
        </span>
        <div class="hero-info">
          <p class="kicker">Shared playlist</p>
          <h1>{data.name}</h1>
          <p class="by">by {data.ownerName} · {data.songs.length} tracks</p>
          {#if data.songs.length > 0}
            <button class="play-all" onclick={() => play(0)}>
              <Icon name="play_arrow" fill size={20} /> Play
            </button>
          {/if}
        </div>
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
            <span class="dur">{song.duration ? fmt(song.duration) : "—"}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <audio
    bind:this={audio}
    ontimeupdate={() => (currentTime = audio?.currentTime ?? 0)}
    onloadedmetadata={() => (duration = audio?.duration ?? 0)}
    onplay={() => (isPlaying = true)}
    onpause={() => (isPlaying = false)}
    onended={next}
  ></audio>

  {#if current}
    <!-- Collapsed now-playing bar. Tapping the title/art opens the full-screen
         view, matching the main app's player. -->
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
        <TransportControls
          {isPlaying}
          variant="bar"
          onPrev={prev}
          onToggle={toggle}
          onNext={next}
        />
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
        <TransportControls
          {isPlaying}
          variant="full"
          onPrev={prev}
          onToggle={toggle}
          onNext={next}
        />
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

  /* Full-bleed scroll area, mirroring the app's main content column. */
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 2rem 2rem;
  }

  .hero {
    display: flex;
    gap: 1.5rem;
    align-items: flex-end;
    padding: 1rem 0 1.75rem;
  }
  .hero-art {
    width: 180px;
    height: 180px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.75rem;
    color: var(--dim);
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }
  .hero-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .hero-info {
    min-width: 0;
  }
  .kicker {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
  }
  h1 {
    margin: 0.3rem 0 0.4rem;
    font-size: 2.5rem;
    line-height: 1.1;
  }
  .by {
    color: var(--muted);
    margin: 0;
  }
  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 1rem;
    padding: 0.6rem 1.4rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 2rem;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
  }
  @media (hover: hover) {
    .play-all:hover {
      background: var(--accent-hover);
    }
  }

  /* --- Track list: identical treatment to the in-app song list. --- */
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
  .dur {
    flex-shrink: 0;
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
  /* Narrow screens: drop the inline scrubber, keep art + transport (the
     full-screen view has the scrubber). */
  @media (max-width: 700px) {
    .player {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .progress {
      display: none;
    }
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
</style>
