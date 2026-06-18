// Svelte action for a drag handle that reorders a list via pointer events, so
// it works on touch (iOS Safari has no HTML5 drag-and-drop) as well as mouse.
// Press the handle and drag: the row follows your finger and drops at the row
// you release over. Each row must carry data-reorder-index; the handle calls
// onMove(from, to) on release.
//
// Usage:
//   <li data-reorder-index={i}>
//     <span class="handle" use:reorderHandle={{ index: i, onMove }}>…</span>

interface Params {
  index: number;
  onMove: (from: number, to: number) => void;
}

export function reorderHandle(node: HTMLElement, params: Params) {
  let p = params;
  const li = node.closest<HTMLElement>("[data-reorder-index]");
  if (!li) return {};

  let from = -1;
  let to = -1;
  let startY = 0;

  function indexUnder(x: number, y: number): number {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-reorder-index]");
    return el ? Number(el.dataset.reorderIndex) : to;
  }

  function down(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    from = p.index;
    to = p.index;
    startY = e.clientY;
    // Lift the row and let taps fall through it so elementFromPoint sees the
    // rows underneath.
    li!.style.transition = "none";
    li!.style.zIndex = "5";
    li!.style.position = "relative";
    li!.style.opacity = "0.85";
    li!.style.pointerEvents = "none";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function move(e: PointerEvent) {
    li!.style.transform = `translateY(${e.clientY - startY}px)`;
    to = indexUnder(e.clientX, e.clientY);
  }

  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    li!.style.transition = "";
    li!.style.transform = "";
    li!.style.zIndex = "";
    li!.style.position = "";
    li!.style.opacity = "";
    li!.style.pointerEvents = "";
    document.body.style.userSelect = "";
    if (from >= 0 && to >= 0 && from !== to) p.onMove(from, to);
    from = to = -1;
  }

  node.style.touchAction = "none"; // the handle owns the gesture (no scroll)
  node.addEventListener("pointerdown", down);

  return {
    update(np: Params) {
      p = np;
    },
    destroy() {
      node.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    },
  };
}
