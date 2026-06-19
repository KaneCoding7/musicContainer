<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import Icon from "$lib/components/Icon.svelte";
  import EqualizerBars from "$lib/components/EqualizerBars.svelte";
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

  const current = $derived(
    data && currentIndex !== null ? data.songs[currentIndex] : null
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

  function play(i: number) {
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
  function fmtDur(d: number | null): string {
    return d ? fmt(d) : "";
  }
</script>

<svelte:head><title>{data ? data.name : "Shared playlist"} · Music Server</title></svelte:head>

<div class="page">
  <header>
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
    <div class="hero">
      <span class="art">
        {#if data.songs.find((s) => s.hasArt)}
          <img src={publicArtUrl(token, data.songs.find((s) => s.hasArt)!.id)} alt="" />
        {:else}
          <Icon name="queue_music" size={56} />
        {/if}
      </span>
      <div>
        <p class="kicker">Shared playlist</p>
        <h1>{data.name}</h1>
        <p class="muted">by {data.ownerName} · {data.songs.length} tracks</p>
        {#if data.songs.length > 0}
          <button class="play-all" onclick={() => play(0)}>
            <Icon name="play_arrow" fill size={20} /> Play
          </button>
        {/if}
      </div>
    </div>

    <ol>
      {#each data.songs as song, i (song.id)}
        {@const isCurrent = i === currentIndex}
        <li class:current={isCurrent}>
          <button class="row" onclick={() => play(i)}>
            {#if isCurrent && isPlaying}
              <span class="num"><EqualizerBars size={16} /></span>
            {/if}
            <span class="meta">
              <span class="name">{song.originalFilename}</span>
              {#if song.artist}<span class="artist">{song.artist}</span>{/if}
            </span>
            <span class="dur">{fmtDur(song.duration)}</span>
          </button>
        </li>
      {/each}
    </ol>
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
    <div class="player">
      <div class="np" title={current.originalFilename}>
        <span class="np-art">
          {#if current.hasArt}
            <img src={publicArtUrl(token, current.id)} alt="" />
          {:else}
            <Icon name="music_note" size={18} />
          {/if}
        </span>
        <span class="np-meta">
          <span class="np-title">{current.originalFilename}</span>
          {#if current.artist}<span class="np-artist">{current.artist}</span>{/if}
        </span>
      </div>
      <div class="controls">
        <button onclick={prev} aria-label="Previous"><Icon name="skip_previous" fill size={24} /></button>
        <button class="pp" onclick={toggle} aria-label="Play/pause">
          <Icon name={isPlaying ? "pause" : "play_arrow"} fill size={30} />
        </button>
        <button onclick={next} aria-label="Next"><Icon name="skip_next" fill size={24} /></button>
      </div>
      <div class="seek">
        <span class="t">{fmt(currentTime)}</span>
        <input type="range" min="0" max={duration || 0} step="0.1" value={currentTime} oninput={onSeek} aria-label="Seek" />
        <span class="t">{fmt(duration)}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    max-width: 820px;
    margin: 0 auto;
  }
  header {
    padding: 1rem 1.5rem;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
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
  .hero {
    display: flex;
    gap: 1.25rem;
    align-items: flex-end;
    padding: 1rem 1.5rem 1.5rem;
  }
  .art {
    width: 150px;
    height: 150px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.6rem;
    color: var(--dim);
    overflow: hidden;
  }
  .art img,
  .np-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .kicker {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
    color: var(--muted);
  }
  h1 {
    margin: 0.15rem 0 0.25rem;
    font-size: 2rem;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.85rem;
    padding: 0.55rem 1.2rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 2rem;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) {
    .play-all:hover {
      background: var(--accent-hover);
    }
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0 0.75rem;
    flex: 1;
    overflow-y: auto;
  }
  li {
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0.75rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .row:hover {
      background: var(--hover);
    }
  }
  .num {
    width: 1.5rem;
    text-align: center;
    color: var(--dim);
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .artist {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .dur {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .player {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: 1fr auto 1.5fr;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.5rem;
    background: var(--surface);
    border-top: 1px solid var(--surface-2);
  }
  .np {
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
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .controls button {
    display: inline-flex;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 0.4rem;
  }
  .controls .pp {
    color: var(--accent-text);
  }
  @media (hover: hover) {
    .controls button:hover {
      background: var(--surface-2);
    }
  }
  .seek {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .seek input {
    flex: 1;
    accent-color: var(--accent);
  }
  .t {
    color: var(--muted);
    font-size: 0.75rem;
    min-width: 2.5rem;
    text-align: center;
  }
  @media (max-width: 600px) {
    .player {
      grid-template-columns: 1fr;
    }
  }
</style>
