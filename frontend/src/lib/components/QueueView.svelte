<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { thumbUrl } from "$lib/services/songService";
  import type { SongViewModel } from "$lib/viewmodels/songViewModel.svelte";

  let { vm }: { vm: SongViewModel } = $props();

  // Drag-to-reorder state (Cycle 29).
  let dragIndex = $state<number | null>(null);
  let overIndex = $state<number | null>(null);

  function onDrop(i: number) {
    if (dragIndex !== null && dragIndex !== i) vm.moveInQueue(dragIndex, i);
    dragIndex = null;
    overIndex = null;
  }
</script>

<div class="queue">
  <ol>
    {#each vm.queue as song, i (`${song.id}-${i}`)}
      {@const isCurrent = i === vm.currentIndex}
      {@const isPast = vm.currentIndex !== null && i < vm.currentIndex}
      <li
        class:current={isCurrent}
        class:past={isPast}
        class:dragging={i === dragIndex}
        class:dragover={i === overIndex && i !== dragIndex}
        draggable="true"
        ondragstart={() => (dragIndex = i)}
        ondragover={(e) => {
          e.preventDefault();
          overIndex = i;
        }}
        ondrop={(e) => {
          e.preventDefault();
          onDrop(i);
        }}
        ondragend={() => {
          dragIndex = null;
          overIndex = null;
        }}
      >
        <button class="row" onclick={() => vm.playQueue(vm.queue, i)}>
          <span class="thumb">
            {#if song.hasArt}
              <img src={thumbUrl(song.id, 128)} alt="" />
            {:else}
              <Icon name="music_note" size={18} />
            {/if}
            {#if isCurrent}
              <span class="thumb-state">
                <Icon name={vm.isPlaying ? "equalizer" : "pause"} fill size={18} />
              </span>
            {/if}
          </span>
          <span class="meta">
            <span class="name">{song.originalFilename}</span>
            {#if song.artist}<span class="artist">{song.artist}</span>{/if}
          </span>
          {#if isCurrent}
            <span class="badge">Now playing</span>
          {/if}
        </button>
        <button
          class="remove"
          title="Remove from queue"
          aria-label="Remove from queue"
          onclick={() => vm.removeFromQueue(i)}><Icon name="close" size={18} /></button
        >
      </li>
    {/each}
  </ol>
</div>

<style>
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--surface-2);
  }
  li.current {
    background: var(--active-bg);
  }
  li.past {
    opacity: 0.55;
  }
  li.dragging {
    opacity: 0.4;
  }
  li.dragover {
    border-top: 2px solid var(--accent);
  }
  .remove {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.6rem;
    border-radius: 0.35rem;
  }
  .remove:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--hover);
  }
  li.current .row:hover {
    background: var(--active-bg);
  }
  .thumb {
    position: relative;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border-radius: 0.3rem;
    color: var(--dim);
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
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
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex-shrink: 0;
    color: var(--accent-text);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
