// Svelte action: swipe a row right on a touch device to play it next
// (Spotify-style). As you drag, a "Play next" affordance is revealed in the
// space the row vacates; past the threshold it commits on release. No-op on
// non-touch devices (mouse/desktop), so it never interferes with clicking.
//
// Usage: <li use:swipeQueue={{ onQueue: () => vm.playNext(song) }}> … </li>

interface Params {
  onQueue: () => void;
  label?: string; // hint + toast text; defaults to "Play next"
  disabled?: boolean; // off in edit/reorder mode so drag-to-reorder can work
}

const THRESHOLD = 70; // px of rightward travel needed to trigger

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string) {
  if (typeof document === "undefined") return;
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "swipe-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  void toastEl.offsetWidth; // force reflow so the transition re-triggers
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove("show"), 1400);
}

export function swipeQueue(node: HTMLElement, params: Params) {
  let onQueue = params.onQueue;
  let label = params.label ?? "Play next";
  let disabled = params.disabled ?? false;

  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  if (!isTouch) return {}; // desktop / mouse: do nothing

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let active = false;
  let horizontal = false;
  let hint: HTMLElement | null = null;

  node.style.touchAction = "pan-y"; // we own horizontal gestures

  // Built lazily on the first swipe so idle rows stay cheap.
  function ensureHint(): HTMLElement {
    if (hint) return hint;
    if (getComputedStyle(node).position === "static") {
      node.style.position = "relative";
    }
    hint = document.createElement("div");
    hint.className = "swipe-hint";
    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = "playlist_play";
    const text = document.createElement("span");
    text.textContent = label;
    hint.append(icon, text);
    node.appendChild(hint);
    return hint;
  }

  function start(e: TouchEvent) {
    if (disabled) return; // edit/reorder mode owns the gesture
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    active = true;
    horizontal = false;
  }

  function move(e: TouchEvent) {
    if (!active) return;
    const ddx = e.touches[0].clientX - startX;
    const ddy = e.touches[0].clientY - startY;
    if (!horizontal) {
      if (ddx > 10 && ddx > Math.abs(ddy)) {
        horizontal = true; // committed to a rightward swipe
      } else if (Math.abs(ddy) > 10 || ddx < -10) {
        active = false; // vertical scroll or leftward — bail
        return;
      } else {
        return;
      }
    }
    dx = Math.max(0, ddx); // right only
    node.style.transition = "none";
    node.style.transform = `translateX(${dx}px)`;
    const h = ensureHint();
    // Counter-translate so the hint stays put as the row slides away from it,
    // revealing it in the vacated space.
    h.style.transform = `translateX(${-dx}px)`;
    h.style.opacity = String(Math.min(1, dx / THRESHOLD));
    h.classList.toggle("armed", dx > THRESHOLD);
  }

  function end() {
    if (!active) return;
    active = false;
    const trigger = dx > THRESHOLD;
    node.style.transition = "transform 0.18s ease";
    node.style.transform = "translateX(0)";
    if (hint) {
      hint.style.transition = "opacity 0.18s ease, transform 0.18s ease";
      hint.style.opacity = "0";
      hint.style.transform = "translateX(0)";
      hint.classList.remove("armed");
    }
    if (trigger) {
      onQueue();
      showToast(label);
    }
    // Clear the transform once settled so it doesn't leave a containing block
    // (which would trap position:fixed descendants like menu backdrops).
    setTimeout(() => {
      node.style.transform = "";
      node.style.transition = "";
      if (hint) hint.style.transition = "";
    }, 200);
    dx = 0;
    horizontal = false;
  }

  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: true });
  node.addEventListener("touchend", end);
  node.addEventListener("touchcancel", end);

  return {
    update(p: Params) {
      onQueue = p.onQueue;
      disabled = p.disabled ?? false;
      if (p.label && hint) {
        label = p.label;
        (hint.lastChild as Text).textContent = label;
      } else if (p.label) {
        label = p.label;
      }
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
      hint?.remove();
    },
  };
}
