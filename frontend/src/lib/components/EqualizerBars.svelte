<script lang="ts">
  // Animated "now playing" sound-wave indicator — bars that ripple up and down
  // so it reads as live audio. Inherits color via currentColor. `size` is the
  // square box edge in px.
  let { size = 18 }: { size?: number } = $props();
</script>

<span class="eq" style="height: {size}px; width: {size}px;" aria-label="Playing">
  <span></span><span></span><span></span><span></span>
</span>

<style>
  .eq {
    display: inline-flex;
    align-items: center; /* bars grow from the centre, like a waveform */
    justify-content: center;
    gap: 2px;
  }
  .eq > span {
    width: 2.5px;
    height: 100%;
    background: currentColor;
    border-radius: 2px;
    transform-origin: center;
    animation: eq-wave 1s ease-in-out infinite;
  }
  /* Staggered delays make the motion travel across the bars like a wave. */
  .eq > span:nth-child(1) {
    animation-delay: 0s;
  }
  .eq > span:nth-child(2) {
    animation-delay: 0.18s;
  }
  .eq > span:nth-child(3) {
    animation-delay: 0.36s;
  }
  .eq > span:nth-child(4) {
    animation-delay: 0.54s;
  }
  @keyframes eq-wave {
    0%,
    100% {
      transform: scaleY(0.3);
    }
    50% {
      transform: scaleY(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .eq > span {
      animation: none;
      transform: scaleY(0.6);
    }
  }
</style>
