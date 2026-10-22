/**
 * Turning a picture into collision shapes. Everything here works on plain
 * pixel arrays, so it runs (and is tested) without a browser.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, rows from the top. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface SeeThrough {
  /** "#rrggbb" counted as empty, or "" for none. PNG transparency always counts as empty. */
  color: string;
  /** 0 to 100: how far from `color` a pixel can be and still count as empty. */
  tolerance: number;
}

/** Which pixels are solid: not transparent, and not close to the see-through color. */
export function solidPixels(pixels: Pixels, see: SeeThrough): Uint8Array {
  const { width, height, data } = pixels;
  const solid = new Uint8Array(width * height);
  const key = see.color ? parseHex(see.color) : null;
  const limit = (Math.max(0, Math.min(100, see.tolerance)) / 100) * 255;
  for (let i = 0, p = 0; i < solid.length; i++, p += 4) {
    if (data[p + 3] < 128) continue;
    if (
      key &&
      Math.abs(data[p] - key[0]) <= limit &&
      Math.abs(data[p + 1] - key[1]) <= limit &&
      Math.abs(data[p + 2] - key[2]) <= limit
    ) {
      continue;
    }
    solid[i] = 1;
  }
  return solid;
}

/** A coarse grid of cells over the picture, each solid if at least half its pixels are. */
export interface Mask {
  cols: number;
  rows: number;
  /** Row-major from the top, 1 for solid. */
  cells: Uint8Array;
}

/** Shrink a pixel mask to a grid with `detail` cells along the picture's longer side (never finer than the pixels). */
export function makeMask(solid: Uint8Array, width: number, height: number, detail: number): Mask {
  const cellPx = Math.max(1, Math.max(width, height) / Math.max(1, detail));
  const cols = Math.max(1, Math.ceil(width / cellPx));
  const rows = Math.max(1, Math.ceil(height / cellPx));
  const count = new Uint32Array(cols * rows);
  const total = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const r = Math.min(rows - 1, Math.floor(y / cellPx));
    for (let x = 0; x < width; x++) {
      const c = Math.min(cols - 1, Math.floor(x / cellPx));
      const i = r * cols + c;
      total[i]++;
      count[i] += solid[y * width + x];
    }
  }
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = total[i] > 0 && count[i] * 2 >= total[i] ? 1 : 0;
  return { cols, rows, cells };
}

type Pt = [number, number];

/**
 * The outlines of the solid parts, as closed loops of grid corners (x from
 * the left, y from the top, in cells). Holes get loops of their own.
 * Loops are simplified, so a staircase becomes a slope.
 */
export function traceOutlines(mask: Mask, tolerance = 1, minArea = 1): Pt[][] {
  const { cols, rows, cells } = mask;
  const solidAt = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && cells[r * cols + c] === 1;
  // Directed edges going clockwise around each solid cell (y down), only where it borders empty space.
  const W = cols + 1;
  const key = (x: number, y: number) => y * W + x;
  const out = new Map<number, number[]>(); // vertex -> edge ids
  const from: number[] = [];
  const to: number[] = [];
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const id = from.length;
    from.push(key(x0, y0));
    to.push(key(x1, y1));
    const list = out.get(key(x0, y0));
    if (list) list.push(id);
    else out.set(key(x0, y0), [id]);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solidAt(c, r)) continue;
      if (!solidAt(c, r - 1)) addEdge(c, r, c + 1, r);
      if (!solidAt(c + 1, r)) addEdge(c + 1, r, c + 1, r + 1);
      if (!solidAt(c, r + 1)) addEdge(c + 1, r + 1, c, r + 1);
      if (!solidAt(c - 1, r)) addEdge(c, r + 1, c, r);
    }
  }
  const used = new Uint8Array(from.length);
  const dir = (id: number): Pt => [(to[id] % W) - (from[id] % W), Math.floor(to[id] / W) - Math.floor(from[id] / W)];
  const loops: Pt[][] = [];
  for (let start = 0; start < from.length; start++) {
    if (used[start]) continue;
    const loop: Pt[] = [];
    let edge = start;
    for (let guard = 0; guard <= from.length; guard++) {
      used[edge] = 1;
      loop.push([from[edge] % W, Math.floor(from[edge] / W)]);
      const [dx, dy] = dir(edge);
      // Where two cells touch only at a corner, hug the cell we're going round:
      // turn right first (y down), then straight, then left.
      const choices = out.get(to[edge]) ?? [];
      let next = -1;
      let best = 9;
      for (const id of choices) {
        if (used[id] && id !== start) continue;
        const [ex, ey] = dir(id);
        const rank = ex === -dy && ey === dx ? 0 : ex === dx && ey === dy ? 1 : ex === dy && ey === -dx ? 2 : 3;
        if (rank < best) {
          best = rank;
          next = id;
        }
      }
      if (next < 0 || next === start) break;
      edge = next;
    }
    const simple = simplifyLoop(dropStraight(midpoints(loop)), tolerance);
    if (simple.length >= 3 && Math.abs(area(simple)) >= minArea) loops.push(simple);
  }
  return loops;
}

/** Solid cells merged into as few rectangles as a simple sweep finds, for things that move. */
export function maskRects(mask: Mask): { x: number; y: number; w: number; h: number }[] {
  const { cols, rows, cells } = mask;
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const open = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (let r = 0; r < rows; r++) {
    const runs: [number, number][] = [];
    for (let c = 0; c < cols; ) {
      if (!cells[r * cols + c]) {
        c++;
        continue;
      }
      const s = c;
      while (c < cols && cells[r * cols + c]) c++;
      runs.push([s, c]);
    }
    const still = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const [s, e] of runs) {
      const k = `${s},${e}`;
      const rect = open.get(k);
      if (rect) {
        rect.h++;
        still.set(k, rect);
      } else {
        const fresh = { x: s, y: r, w: e - s, h: 1 };
        rects.push(fresh);
        still.set(k, fresh);
      }
    }
    open.clear();
    for (const [k, v] of still) open.set(k, v);
  }
  return rects;
}

/**
 * The middle of each cell edge instead of its corners. A staircase of cell
 * corners has dips a marble can get stuck in; the middles of its steps lie
 * almost on a straight line, so they smooth into a clean slope.
 */
function midpoints(loop: Pt[]): Pt[] {
  return loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Pt;
  });
}

function dropStraight(loop: Pt[]): Pt[] {
  const n = loop.length;
  return loop.filter((p, i) => {
    const a = loop[(i + n - 1) % n];
    const b = loop[(i + 1) % n];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

/** Douglas-Peucker for a closed loop: split it at two far-apart points and simplify each half. */
function simplifyLoop(loop: Pt[], tolerance: number): Pt[] {
  if (loop.length < 4 || tolerance <= 0) return loop;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplify([...loop.slice(0, far + 1)], tolerance);
  const b = simplify([...loop.slice(far), loop[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let index = 0;
  let max = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function area(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function parseHex(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
