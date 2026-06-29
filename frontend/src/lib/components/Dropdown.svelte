<script lang="ts">
  // Custom themed dropdown — looks identical on every platform (unlike a native
  // <select> popup, which the OS draws). Trigger is either an icon button
  // (icon-only mode) or a labelled pill.
  import { tick } from "svelte";
  import Icon from "$lib/components/Icon.svelte";

  type Option = { value: string; label: string };
  let {
    options,
    value = "",
    onSelect,
    placeholder = "Select",
    icon = "",
    ariaLabel,
    align = "left",
    disabled = false,
  }: {
    options: Option[];
    value?: string;
    onSelect: (value: string) => void;
    placeholder?: string;
    icon?: string; // when set, render an icon-only trigger
    ariaLabel: string;
    align?: "left" | "right";
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let wrapEl = $state<HTMLElement | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  // Final clamped viewport coordinates for the (position: fixed) menu; null until
  // measured so it doesn't flash at the wrong spot.
  let placed = $state<{ left: number; top: number } | null>(null);
  const selected = $derived(options.find((o) => o.value === value) ?? null);

  function choose(v: string) {
    onSelect(v);
    open = false;
  }

  // Place the menu under (or above) the trigger and clamp it to the viewport so
  // it never runs off the screen, regardless of how many options it has.
  function placeMenu() {
    if (!open || !menuEl || !wrapEl) return;
    const margin = 8;
    const r = menuEl.getBoundingClientRect();
    const a = wrapEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Honour the requested horizontal alignment, then clamp.
    let left = align === "right" ? a.right - r.width : a.left;
    let top = a.bottom + 6;
    // Flip above the trigger if there isn't room below but there is above.
    if (top + r.height > vh - margin && a.top - r.height - 6 >= margin) {
      top = a.top - r.height - 6;
    }
    placed = {
      left: Math.max(margin, Math.min(left, vw - r.width - margin)),
      top: Math.max(margin, Math.min(top, vh - r.height - margin)),
    };
  }

  $effect(() => {
    if (!open) {
      placed = null;
      return;
    }
    tick().then(placeMenu);
    const onMove = () => placeMenu();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  });
</script>

<div class="dd-wrap" bind:this={wrapEl}>
  {#if icon}
    <button
      class="dd-icon"
      class:on={open}
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      {disabled}
      onclick={() => (open = !open)}
    >
      <Icon name={icon} size={20} />
    </button>
  {:else}
    <button
      class="dd-trigger"
      class:on={open}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      {disabled}
      onclick={() => (open = !open)}
    >
      <span class="dd-label">{selected ? selected.label : placeholder}</span>
      <Icon name="expand_more" size={18} />
    </button>
  {/if}

  {#if open}
    <button
      class="dd-backdrop"
      aria-hidden="true"
      tabindex="-1"
      onclick={() => (open = false)}
    ></button>
    <div
      class="dd-menu"
      bind:this={menuEl}
      role="listbox"
      aria-label={ariaLabel}
      style={placed
        ? `left:${placed.left}px; top:${placed.top}px;`
        : "visibility:hidden;"}
    >
      {#each options as o (o.value)}
        <button
          class="dd-opt"
          role="option"
          aria-selected={value === o.value}
          onclick={() => choose(o.value)}
        >
          <span class="dd-opt-label">{o.label}</span>
          {#if value === o.value}<Icon name="check" size={16} />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dd-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  /* Icon-only trigger (matches the round icon buttons in the toolbar). */
  .dd-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    color: var(--muted);
    cursor: pointer;
  }
  /* Labelled pill trigger. */
  .dd-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 2rem;
    box-sizing: border-box;
    padding: 0 0.5rem 0 0.9rem;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 2rem;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    max-width: 14rem;
  }
  .dd-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .dd-icon:hover,
    .dd-trigger:hover {
      background: var(--border-strong);
      color: var(--text);
    }
  }
  .dd-icon.on,
  .dd-trigger.on {
    border-color: var(--accent);
  }
  .dd-icon:disabled,
  .dd-trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .dd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 65;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }
  /* Positioned via JS (placeMenu) in viewport coordinates so it never runs off
     the screen; it flips above the trigger when there's no room below. */
  .dd-menu {
    position: fixed;
    z-index: 70;
    min-width: 12rem;
    max-width: calc(100vw - 16px);
    max-height: min(18rem, calc(100vh - 16px));
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 0.6rem;
    padding: 0.3rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
  }
  .dd-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    padding: 0.55rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: 0.4rem;
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    cursor: pointer;
  }
  .dd-opt-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dd-opt[aria-selected="true"] {
    color: var(--accent-text);
  }
  @media (hover: hover) {
    .dd-opt:hover {
      background: var(--hover);
    }
  }
</style>
