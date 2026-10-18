import type { Camera } from "./Camera";

/** Drag to pan, wheel or two-finger pinch to zoom. Works with mouse, pen and touch. */
export function attachViewControls(canvas: HTMLCanvasElement, camera: Camera): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    canvas.classList.add("dragging");
    if (pointers.size === 2) pinchDistance = distance([...pointers.values()]);
  });

  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = local(e);
    pointers.set(e.pointerId, next);
    if (pointers.size === 1) {
      camera.panBy(next.x - prev.x, next.y - prev.y);
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = distance(pts);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (pinchDistance > 0) camera.zoomAt(d / pinchDistance, mid.x, mid.y);
      pinchDistance = d;
      // Half the finger's motion pans, since both fingers report it.
      camera.panBy((next.x - prev.x) / 2, (next.y - prev.y) / 2);
    }
  });

  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    },
    { passive: false },
  );
}

function distance(pts: { x: number; y: number }[]): number {
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}
