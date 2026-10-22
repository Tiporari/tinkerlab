import { describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Game } from "../src/core/Game";
import { setPixels } from "../src/core/images";
import { makeMask, maskRects, solidPixels, traceOutlines, type Pixels } from "../src/core/trace";
import type { LevelData } from "../src/core/types";
import { importerFor } from "../src/editor/Editor";
import { drawnLevel } from "../src/levels";
import { decodePng, fromBase64 } from "./png";

registerBuiltinActors();

/** A picture drawn with a function that says what color each pixel is. */
function paint(width: number, height: number, color: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [20, 20, 20, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function level(actors: LevelData["actors"]): LevelData {
  return { format: "tinkerlab/level", version: 1, name: "test", gravity: [0, -10], actors };
}

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) game.step();
}

describe("tracing pictures", () => {
  it("treats white and transparent pixels as empty", () => {
    const p = paint(3, 1, (x) => [WHITE, BLACK, CLEAR][x]);
    expect([...solidPixels(p, { color: "#ffffff", tolerance: 10 })]).toEqual([0, 1, 0]);
    // With no see-through color, white is solid but transparency still isn't.
    expect([...solidPixels(p, { color: "", tolerance: 10 })]).toEqual([1, 1, 0]);
    // Off-white counts as white within the closeness setting.
    const cream = paint(1, 1, () => [245, 240, 230, 255]);
    expect(solidPixels(cream, { color: "#ffffff", tolerance: 12 })[0]).toBe(0);
    expect(solidPixels(cream, { color: "#ffffff", tolerance: 2 })[0]).toBe(1);
  });

  it("outlines a square with one loop and a ring with two", () => {
    const square = makeMask(new Uint8Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]), 4, 4, 4);
    const loops = traceOutlines(square);
    expect(loops).toHaveLength(1);
    // Corners are trimmed a little, so a square becomes an octagon at most.
    expect(loops[0].length).toBeGreaterThanOrEqual(4);
    expect(loops[0].length).toBeLessThanOrEqual(8);

    const ring = paint(10, 10, (x, y) => (x >= 1 && x <= 8 && y >= 1 && y <= 8 && !(x >= 3 && x <= 6 && y >= 3 && y <= 6) ? BLACK : WHITE));
    const mask = makeMask(solidPixels(ring, { color: "#ffffff", tolerance: 10 }), 10, 10, 10);
    expect(traceOutlines(mask)).toHaveLength(2);
  });

  it("keeps two squares touching at a corner apart", () => {
    const mask = { cols: 2, rows: 2, cells: new Uint8Array([1, 0, 0, 1]) };
    const loops = traceOutlines(mask, 0, 0);
    expect(loops).toHaveLength(2);
  });

  it("smooths a staircase into a slope", () => {
    // A right triangle drawn in pixels.
    const tri = paint(40, 40, (x, y) => (x <= y ? BLACK : WHITE));
    const mask = makeMask(solidPixels(tri, { color: "#ffffff", tolerance: 10 }), 40, 40, 40);
    const [loop] = traceOutlines(mask);
    expect(loop.length).toBeLessThan(8);
  });

  it("merges solid cells into a few boxes for moving pictures", () => {
    const block = makeMask(new Uint8Array(100).fill(1), 10, 10, 10);
    expect(maskRects(block)).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });

  it("picks the picture actor for image files", () => {
    expect(importerFor({ type: "image/png" })?.type).toBe("picture");
    expect(importerFor({ type: "application/json" })).toBeUndefined();
  });
});

describe("pictures in a level", () => {
  // 80 x 40 pixels at 2 m x 1 m per 40 px... a floor along the bottom with a gap in the middle, white above.
  const course = paint(80, 40, (x, y) => (y >= 32 && !(x >= 36 && x < 44) ? BLACK : WHITE));
  setPixels("test:course", course);

  it("is solid where it's drawn and empty where it's white", () => {
    const game = new Game(
      level([
        { type: "picture", x: 0, y: 0, props: { src: "test:course", width: 8, height: 4, detail: 80 } },
        { id: "on-floor", type: "ball", x: -2, y: 1 },
        { id: "over-gap", type: "ball", x: 0, y: 1 },
      ]),
    );
    run(game, 2);
    // The floor's top is 32/40 of the way down a 4 m tall picture: y = 2 - 3.2 = -1.2.
    expect(game.find("on-floor")!.body!.getPosition().y).toBeCloseTo(-1.2 + 0.25, 1);
    expect(game.find("over-gap")!.body!.getPosition().y).toBeLessThan(-3);
  });

  it("can be picked only on its solid parts", () => {
    const game = new Game(level([{ id: "pic", type: "picture", x: 0, y: 0, props: { src: "test:course", width: 8, height: 4 } }]));
    const pic = game.find("pic")!;
    expect(pic.hitTest(-2, -1.6)).toBe(true);
    expect(pic.hitTest(-2, 1)).toBe(false);
    expect(pic.localBounds()).toEqual({ minX: -4, minY: -2, maxX: 4, maxY: 2 });
  });

  it("moves as one thing when Moves is on, and lands on another picture", () => {
    setPixels("test:crate", paint(10, 10, () => BLACK));
    const game = new Game(
      level([
        { type: "picture", x: 0, y: 0, props: { src: "test:course", width: 8, height: 4 } },
        { id: "crate", type: "picture", x: -2, y: 1, props: { src: "test:crate", width: 0.5, height: 0.5, dynamic: true } },
      ]),
    );
    run(game, 2);
    const body = game.find("crate")!.body!;
    expect(body.getType()).toBe("dynamic");
    expect(body.getPosition().y).toBeCloseTo(-1.2 + 0.25, 1);
  });

  it("draws behind other things unless set in front", () => {
    const game = new Game(
      level([
        { id: "ball", type: "ball", x: 0, y: 3 },
        { id: "pic", type: "picture", x: 0, y: 0, props: { src: "test:course", width: 8, height: 4 } },
        { id: "front", type: "picture", x: 0, y: 0, props: { src: "test:course", width: 8, height: 4, inFront: true } },
      ]),
    );
    expect(game.layered().map((a) => a.id)).toEqual(["pic", "ball", "front"]);
  });

  it("saves and loads with its picture", () => {
    const game = new Game(level([{ type: "picture", x: 1, y: 2, props: { src: "test:course", width: 8, height: 4 } }]));
    const saved = game.serialize();
    expect(saved.actors[0].props?.src).toBe("test:course");
    const again = new Game(saved);
    expect(again.actors[0].body!.getFixtureList()).toBeTruthy();
  });
});

describe("the drawn level", () => {
  it("plays: marbles roll down the drawing into the bowl", async () => {
    const src = String(drawnLevel.actors.find((a) => a.type === "picture")!.props!.src);
    setPixels(src, await decodePng(fromBase64(src.split(",")[1])));
    const game = new Game(drawnLevel);
    let finished = 0;
    game.events.on("finish", () => finished++);
    game.play();
    run(game, 20);
    expect(finished).toBeGreaterThan(2);
  });
});
