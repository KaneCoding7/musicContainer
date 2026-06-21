// Svelte action: swipe a row on a touch device to trigger a quick action
// (Spotify-style). Swipe RIGHT to add it to the queue; swipe LEFT to like it
// (when an onLike handler is provided). As you drag, an affordance is revealed
// in the space the row vacates; past the threshold it commits on release. No-op
// on non-touch devices (mouse/desktop), so it never interferes with clicking.
//
// Usage:
//   <li use:swipeQueue={{ onQueue: () => vm.addToQueue(song),
//                         onLike: () => vm.toggleLike(song.id) }}> … </li>

interface Params {
  onQueue: () => void;
  onLike?: () => void; // left-swipe action; omit to disable left swipes
  label?: string; // right-swipe hint/toast text; defaults to "Play next"
  likeLabel?: string; // left-swipe hint/toast text; defaults to "Like"
  disabled?: boolean; // off in edit/reorder mode so drag-to-reorder can work
}

const THRESHOLD = 70; // px of travel needed to trigger

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
  let onLike = params.onLike;
  let label = params.label ?? "Add to queue";
  let likeLabel = params.likeLabel ?? "Like";
  let disabled = params.disabled ?? false;

  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;
  if (!isTouch) return {}; // desktop / mouse: do nothing

  let startX = 0;
  let startY = 0;
  let dx = 0; // signed travel: + right (play next), − left (like)
  let active = false;
  let horizontal = false;
  // Two affordances, built lazily: the "play next" hint anchored left (revealed
  // as the row slides right), the "like" hint anchored right (revealed as it
  // slides left).
  let queueHint: HTMLElement | null = null;
  let likeHint: HTMLElement | null = null;

  node.style.touchAction = "pan-y"; // we own horizontal gestures

  function buildHint(
    side: "queue" | "like",
    icon: string,
    text: string,
  ): HTMLElement {
    if (getComputedStyle(node).position === "static") {
      node.style.position = "relative";
    }
    const el = document.createElement("div");
    el.className = side === "like" ? "swipe-hint like" : "swipe-hint";
    const ic = document.createElement("span");
    ic.className = "material-symbols-rounded";
    ic.textContent = icon;
    const tx = document.createElement("span");
    tx.textContent = text;
    el.append(ic, tx);
    node.appendChild(el);
    return el;
  }
  function ensureQueueHint(): HTMLElement {
    if (!queueHint) queueHint = buildHint("queue", "queue_music", label);
    return queueHint;
  }
  function ensureLikeHint(): HTMLElement {
    if (!likeHint) likeHint = buildHint("like", "favorite", likeLabel);
    return likeHint;
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
      if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy)) {
        // A leftward swipe only counts when there's a like handler.
        if (ddx < 0 && !onLike) {
          active = false;
          return;
        }
        horizontal = true; // committed to a horizontal swipe
      } else if (Math.abs(ddy) > 10) {
        active = false; // vertical scroll — bail
        return;
      } else {
        return;
      }
    }
    dx = ddx;
    node.style.transition = "none";
    node.style.transform = `translateX(${dx}px)`;
    // The active hint counter-translates so it stays put as the row slides away
    // from it, revealing it in the vacated space.
    const h = dx >= 0 ? ensureQueueHint() : ensureLikeHint();
    const other = dx >= 0 ? likeHint : queueHint;
    if (other) other.style.opacity = "0";
    h.style.transform = `translateX(${-dx}px)`;
    h.style.opacity = String(Math.min(1, Math.abs(dx) / THRESHOLD));
    h.classList.toggle("armed", Math.abs(dx) > THRESHOLD);
  }

  function resetHint(h: HTMLElement | null) {
    if (!h) return;
    h.style.transition = "opacity 0.18s ease, transform 0.18s ease";
    h.style.opacity = "0";
    h.style.transform = "translateX(0)";
    h.classList.remove("armed");
  }

  function end() {
    if (!active) return;
    active = false;
    const trigger = Math.abs(dx) > THRESHOLD;
    const wentLeft = dx < 0;
    node.style.transition = "transform 0.18s ease";
    node.style.transform = "translateX(0)";
    resetHint(queueHint);
    resetHint(likeHint);
    if (trigger) {
      if (wentLeft && onLike) {
        onLike();
        showToast(likeLabel);
      } else if (!wentLeft) {
        onQueue();
        showToast(label);
      }
    }
    // Clear the transform once settled so it doesn't leave a containing block
    // (which would trap position:fixed descendants like menu backdrops).
    setTimeout(() => {
      node.style.transform = "";
      node.style.transition = "";
      if (queueHint) queueHint.style.transition = "";
      if (likeHint) likeHint.style.transition = "";
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
      onLike = p.onLike;
      disabled = p.disabled ?? false;
      if (p.label) {
        label = p.label;
        if (queueHint) (queueHint.lastChild as Text).textContent = label;
      }
      if (p.likeLabel) {
        likeLabel = p.likeLabel;
        if (likeHint) (likeHint.lastChild as Text).textContent = likeLabel;
      }
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
      queueHint?.remove();
      likeHint?.remove();
    },
  };
}
