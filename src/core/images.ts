import { makeMask, maskRects, solidPixels, traceOutlines, type Mask, type Pixels, type SeeThrough } from "./trace";

/**
 * Pictures used in levels, kept once per source no matter how many actors
 * use them. Sources are data URLs saved inside the level. Decoding needs a
 * browser, so it's asynchronous: `pixels()` returns null at first and calls
 * back when the picture is ready. Tests put pixels in directly with `setPixels`.
 */
const pixelsBySrc = new Map<string, Pixels>();
const waiting = new Map<string, Set<() => void>>();
const failed = new Set<string>();
const shapes = new Map<string, Traced>();
const visible = new Map<string, HTMLCanvasElement>();

/** A picture's outlines (for fixed things) and boxes (for moving things), in grid cells. */
export interface Traced {
  mask: Mask;
  loops: [number, number][][];
  rects: { x: number; y: number; w: number; h: number }[];
}

export function setPixels(src: string, pixels: Pixels): void {
  pixelsBySrc.set(src, pixels);
}

/** The picture's pixels, or null while it's still loading (then `onReady` runs once it has). */
export function pixels(src: string, onReady?: () => void): Pixels | null {
  const found = pixelsBySrc.get(src);
  if (found || !src || failed.has(src)) return found ?? null;
  if (onReady) {
    const list = waiting.get(src);
    if (list) {
      list.add(onReady);
      return null;
    }
    waiting.set(src, new Set([onReady]));
    decode(src).then(
      (p) => {
        pixelsBySrc.set(src, p);
        for (const fn of waiting.get(src) ?? []) fn();
        waiting.delete(src);
      },
      (err) => {
        console.error("Could not load a picture", err);
        failed.add(src);
        waiting.delete(src);
      },
    );
  }
  return null;
}

/** Outlines and boxes for a picture with these settings, worked out once and remembered. */
export function traced(src: string, see: SeeThrough, detail: number): Traced | null {
  const p = pixelsBySrc.get(src);
  if (!p) return null;
  const k = `${see.color}|${see.tolerance}|${detail}|${src}`;
  const hit = shapes.get(k);
  if (hit) return hit;
  const mask = makeMask(solidPixels(p, see), p.width, p.height, detail);
  const result = { mask, loops: traceOutlines(mask), rects: maskRects(mask) };
  if (shapes.size > 40) shapes.clear();
  shapes.set(k, result);
  return result;
}

/** The picture with its see-through parts made transparent, ready to draw. */
export function visibleCanvas(src: string, see: SeeThrough): HTMLCanvasElement | null {
  const p = pixelsBySrc.get(src);
  if (!p || typeof document === "undefined") return null;
  const k = `${see.color}|${see.tolerance}|${src}`;
  const hit = visible.get(k);
  if (hit) return hit;
  const solid = solidPixels(p, see);
  const data = new Uint8ClampedArray(p.data);
  for (let i = 0; i < solid.length; i++) if (!solid[i]) data[i * 4 + 3] = 0;
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  canvas.getContext("2d")!.putImageData(new ImageData(data, p.width, p.height), 0, 0);
  if (visible.size > 40) visible.clear();
  visible.set(k, canvas);
  return canvas;
}

/** Longest side, in pixels, that imported pictures are shrunk to so levels stay small enough to save. */
export const MAX_PICTURE_SIZE = 1024;

/**
 * Read a picture file into a PNG data URL (shrunk if it's huge), ready to
 * save in a level. Also returns its size in pixels.
 */
export async function importPicture(file: Blob): Promise<{ src: string; width: number; height: number }> {
  const img = await loadImage(URL.createObjectURL(file), true);
  const scale = Math.min(1, MAX_PICTURE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const src = canvas.toDataURL("image/png");
  pixelsBySrc.set(src, { width, height, data: ctx.getImageData(0, 0, width, height).data });
  return { src, width, height };
}

async function decode(src: string): Promise<Pixels> {
  if (typeof document === "undefined") throw new Error("Pictures need a browser to load");
  const img = await loadImage(src, false);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

function loadImage(url: string, revoke: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (revoke) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture this browser can open."));
    };
    img.src = url;
  });
}
