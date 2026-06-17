// Svelte action: swipe a row horizontally on a touch device to add a song to
// the queue (Spotify-style). No-op on non-touch devices (mouse/desktop), so
// it never interferes with clicking.
//
// Usage: <li use:swipeQueue={{ onQueue: () => vm.addToQueue(song) }}> … </li>

interface Params {
  onQueue: () => void;
}

const THRESHOLD = 70; // px of horizontal travel needed to trigger

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
  // Force reflow so re-adding the class re-triggers the transition.
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove("show"), 1400);
}

export function swipeQueue(node: HTMLElement, params: Params) {
  let onQueue = params.onQueue;

  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  if (!isTouch) return {}; // desktop / mouse: do nothing

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let active = false;
  let horizontal = false;

  // Let the browser handle vertical scrolling; we take over horizontal gestures.
  node.style.touchAction = "pan-y";

  function start(e: TouchEvent) {
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
      if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy)) {
        horizontal = true; // committed to a horizontal swipe
      } else if (Math.abs(ddy) > 10) {
        active = false; // it's a vertical scroll — bail
        return;
      } else {
        return;
      }
    }
    dx = ddx;
    node.style.transition = "none";
    node.style.transform = `translateX(${dx}px)`;
    node.style.background = Math.abs(dx) > THRESHOLD ? "var(--active-bg)" : "";
  }

  function end() {
    if (!active) return;
    active = false;
    const trigger = Math.abs(dx) > THRESHOLD;
    node.style.transition = "transform 0.18s ease, background 0.18s ease";
    node.style.transform = "translateX(0)";
    node.style.background = "";
    if (trigger) {
      onQueue();
      showToast("Added to queue");
    }
    // Clear the transform once settled so it doesn't leave a containing block
    // (which would trap position:fixed descendants like menu backdrops).
    setTimeout(() => {
      node.style.transform = "";
      node.style.transition = "";
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
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    },
  };
}
