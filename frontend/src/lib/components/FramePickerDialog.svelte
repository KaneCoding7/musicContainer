<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { fetchVideoFrames, type VideoFrame } from "$lib/services/songService";
  import type { Song } from "$lib/types";

  let {
    song,
    onPick,
    onClose,
  }: {
    song: Song;
    onPick: (frame: VideoFrame) => void;
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

  // Selecting just hands the frame back; the editor applies it on Save.
  function pick(frame: VideoFrame) {
    onPick(frame);
    onClose();
  }

  function caption(frame: VideoFrame): string {
    if (frame.label) return frame.label;
    return frame.t != null ? `${frame.t}s` : "";
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
      <p class="hint">Tap a frame to preview it. It's applied when you Save.</p>
      <div class="grid">
        {#each frames as f, i (f.label ?? f.t ?? i)}
          <button class="frame" class:thumb={!!f.label} onclick={() => pick(f)}>
            <img src={f.dataUrl} alt={caption(f)} />
            {#if caption(f)}<span class="cap">{caption(f)}</span>{/if}
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
  @media (hover: hover) {
    .x:hover {
      background: var(--surface-2);
      color: var(--text);
    }
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
  @media (hover: hover) {
    .frame:hover {
      border-color: var(--accent);
    }
  }
  .frame.thumb {
    border-color: var(--border-strong);
  }
  @media (hover: hover) {
    .frame.thumb:hover {
      border-color: var(--accent);
    }
  }
  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cap {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 0.1rem 0.4rem;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 0.68rem;
    border-top-right-radius: 0.35rem;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
