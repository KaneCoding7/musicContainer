// Svelte action: on touch devices, swipe a row LEFT to remove it (the row
// follows the finger; past the threshold it slides off and onRemove() fires,
// otherwise it springs back). No-op on mouse/desktop, so the visible remove
// button stays the affordance there.
//
// Usage: <li use:swipeRemove={{ onRemove: () => vm.removeFromQueue(i) }}> … </li>

interface Params {
  onRemove: () => void;
}

const THRESHOLD = 80; // px of leftward travel needed to trigger removal

export function swipeRemove(node: HTMLElement, params: Params) {
  let onRemove = params.onRemove;

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
    dx = Math.min(0, ddx); // left only
    node.style.transition = "none";
    node.style.transform = `translateX(${dx}px)`;
    // Tint red once past the threshold so it's clear it'll delete.
    node.style.background =
      -dx > THRESHOLD ? "rgba(220, 53, 53, 0.28)" : "";
  }

  function end() {
    if (!active) return;
    active = false;
    const trigger = -dx > THRESHOLD;
    if (trigger) {
      // Slide the row off the left edge, then remove it.
      node.style.transition = "transform 0.2s ease, opacity 0.2s ease";
      node.style.transform = "translateX(-100%)";
      node.style.opacity = "0";
      setTimeout(() => {
        onRemove();
        // Reset in case the node is reused for another item.
        node.style.transform = "";
        node.style.transition = "";
        node.style.opacity = "";
        node.style.background = "";
      }, 200);
    } else {
      // Didn't pass the threshold — spring back.
      node.style.transition = "transform 0.18s ease, background 0.18s ease";
      node.style.transform = "translateX(0)";
      node.style.background = "";
      setTimeout(() => {
        node.style.transform = "";
        node.style.transition = "";
      }, 200);
    }
    dx = 0;
    horizontal = false;
  }

  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: true });
  node.addEventListener("touchend", end);
  node.addEventListener("touchcancel", end);

  return {
    update(p: Params) {
      onRemove = p.onRemove;
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    },
  };
}
