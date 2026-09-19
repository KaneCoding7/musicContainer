<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";

  // Previous / play-pause / next transport, shared by the in-app player (bar +
  // full-screen) and the public share page so the controls stay identical. The
  // parent places any extra controls (shuffle/repeat) as siblings around it —
  // this renders exactly the three universal buttons, no wrapper, so it drops
  // straight into the parent's flex row.
  let {
    isPlaying = false,
    variant = "bar",
    onPrev,
    onToggle,
    onNext,
  }: {
    isPlaying?: boolean;
    variant?: "bar" | "full";
    onPrev?: () => void;
    onToggle?: () => void;
    onNext?: () => void;
  } = $props();

  const sz = $derived(variant === "full" ? 38 : 26);
  const playSz = $derived(variant === "full" ? 48 : 32);
</script>

<button class="tc {variant}" onclick={onPrev} aria-label="Previous" title="Previous">
  <Icon name="skip_previous" fill size={sz} />
</button>
<button
  class="tc play {variant}"
  onclick={onToggle}
  aria-label="Play/Pause"
  title="Play/Pause"
>
  <Icon name={isPlaying ? "pause" : "play_arrow"} fill size={playSz} />
</button>
<button class="tc {variant}" onclick={onNext} aria-label="Next" title="Next">
  <Icon name="skip_next" fill size={sz} />
</button>

<style>
  .tc {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
  }
  .tc.bar {
    padding: 0.3rem;
    border-radius: 0.4rem;
  }
  .tc.full {
    padding: 0.4rem;
    border-radius: 50%;
  }
  .tc.play {
    color: var(--accent-text);
  }
  @media (hover: hover) {
    .tc:hover {
      background: var(--surface-2);
    }
  }
</style>
