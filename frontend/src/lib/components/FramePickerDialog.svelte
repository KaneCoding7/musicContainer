<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import {
    fetchVideoFrames,
    uploadArt,
    type VideoFrame,
  } from "$lib/services/songService";
  import type { Song } from "$lib/types";

  let {
    song,
    onPicked,
    onClose,
  }: {
    song: Song;
    onPicked: (updated: Song) => void;
    onClose: () => void;
  } = $props();

  // Move to the top-level container so it isn't trapped inside scroll/row
  // ancestors (same reason as the edit dialog).
  function portal(node: HTMLElement) {
    const target = document.querySelector(".layout") ?? document.body;
    target.appendChild(node);
    return {
      destroy() {
        node.parentNode?.removeChild(node);
      },
    };
  }

  let frames = $state<VideoFrame[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let savingT = $state<number | null>(null);

  $effect(() => {
    let cancelled = false;
    fetchVideoFrames(song.id)
      .then((f) => {
        if (!cancelled) frames = f;
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : "Couldn't load frames";
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  async function pick(frame: VideoFrame) {
    if (savingT !== null) return;
    savingT = frame.t;
    error = null;
    try {
      const blob = await (await fetch(frame.dataUrl)).blob();
      const file = new File([blob], `frame-${frame.t}.jpg`, {
        type: "image/jpeg",
      });
      const updated = await uploadArt(song.id, file);
      onPicked(updated);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : "Couldn't set the cover";
      savingT = null;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" use:portal>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Choose cover from video">
    <div class="head">
      <h3>Choose a cover frame</h3>
      <button class="x" aria-label="Close" onclick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </div>

    {#if loading}
      <p class="status"><Icon name="progress_activity" size={20} /> Grabbing frames from the video…</p>
    {:else if error && frames.length === 0}
      <p class="status err">{error}</p>
    {:else}
      <p class="hint">Tap a frame to use it as the album art.</p>
      <div class="grid">
        {#each frames as f (f.t)}
          <button class="frame" onclick={() => pick(f)} disabled={savingT !== null}>
            <img src={f.dataUrl} alt={`Frame at ${f.t}s`} />
            {#if savingT === f.t}
              <span class="spin"><Icon name="progress_activity" size={26} /></span>
            {/if}
          </button>
        {/each}
      </div>
      {#if error}<p class="status err">{error}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    box-sizing: border-box;
    z-index: 60;
  }
  .dialog {
    width: min(560px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .head h3 {
    margin: 0;
  }
  .x {
    display: inline-flex;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 0.3rem;
  }
  .x:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .hint {
    margin: 0.25rem 0 1rem;
    color: var(--dim);
    font-size: 0.85rem;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 1.5rem 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .status.err {
    color: var(--danger-text);
  }
  .status :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.6rem;
  }
  .frame {
    position: relative;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--surface-2);
    cursor: pointer;
  }
  .frame:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .frame:disabled {
    cursor: default;
  }
  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .spin {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
  }
  .spin :global(.material-symbols-rounded) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
