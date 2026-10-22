import { beforeEach, describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Camera } from "../src/core/Camera";
import type { Connector } from "../src/core/Connector";
import { Game } from "../src/core/Game";
import type { LevelData } from "../src/core/types";
import { Editor } from "../src/editor/Editor";

registerBuiltinActors();

function fakeCanvas(): HTMLCanvasElement {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  target.style = {};
  target.setPointerCapture = () => {};
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  return target as unknown as HTMLCanvasElement;
}

const level: LevelData = {
  format: "tinkerlab/level",
  version: 1,
  name: "select test",
  gravity: [0, -10],
  actors: [
    { id: "floor", type: "block", x: 0, y: -1, props: { width: 30, height: 0.5 } },
    { id: "cart", type: "block", x: 0, y: 1, props: { width: 2, height: 0.5, dynamic: true } },
    { id: "wheel", type: "wheel", x: 0.7, y: 0.75, props: { a: "cart", ax: 0.7, ay: -0.25, radius: 0.3 } },
    { id: "jet", type: "thruster", x: -0.5, y: 1, props: { a: "cart", ax: -0.5, ay: 0 } },
    { id: "ball", type: "ball", x: 4, y: 2, props: { radius: 0.5 } },
    { id: "post", type: "block", x: -4, y: 2, props: { width: 0.5, height: 2 } },
    { id: "spring", type: "spring", x: -4, y: 3, props: { a: "post", ax: 0, ay: 1, b: "", bx: -2, by: 5 } },
  ],
};

describe("select tool", () => {
  let game: Game;
  let camera: Camera;
  let canvas: HTMLCanvasElement;
  let editor: Editor;

  beforeEach(() => {
    game = new Game(structuredClone(level));
    camera = new Camera();
    camera.width = 800;
    camera.height = 600;
    camera.set({ x: 0, y: 1, zoom: 40 });
    canvas = fakeCanvas();
    editor = new Editor(game, camera, canvas);
  });

  /** Press, drag in a few steps and release, in world coordinates. */
  function drag(from: [number, number], to: [number, number], opts: { shiftKey?: boolean; pointerType?: string } = {}) {
    // Work out every screen point first, since panning moves the camera mid-drag.
    const points = [0, 1, 2, 3, 4].map((i) => camera.worldToScreen(from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4));
    const fire = (type: string, [sx, sy]: [number, number]) =>
      canvas.dispatchEvent(Object.assign(new Event(type), { clientX: sx, clientY: sy, button: 0, pointerId: 1, pointerType: "mouse", ...opts }));
    fire("pointerdown", points[0]);
    for (const p of points.slice(1)) fire("pointermove", p);
    fire("pointerup", points[4]);
  }
  const click = (at: [number, number], opts: { shiftKey?: boolean } = {}) => drag(at, at, opts);
  const pos = (id: string) => game.find(id)!;
  const key = (k: string, opts: Partial<KeyboardEvent> = {}) =>
    editor.handleKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...opts } as KeyboardEvent);

  it("drags a box to select what's inside it, and leaves the floor alone", () => {
    drag([-1.5, 0.3], [1.5, 1.6]);
    expect(editor.selection.sort()).toEqual(["cart", "jet", "wheel"]);
    // Shift+drag adds to it.
    drag([3, 1], [5, 3], { shiftKey: true });
    expect(editor.selection).toContain("ball");
    expect(editor.selection).toHaveLength(4);
    // A click on empty space clears it.
    click([0, 5]);
    expect(editor.selection).toEqual([]);
  });

  it("shift+click adds and removes things", () => {
    click([4, 2]);
    click([-4, 2], { shiftKey: true });
    expect(editor.selection).toEqual(["ball", "post"]);
    click([4, 2], { shiftKey: true });
    expect(editor.selection).toEqual(["post"]);
  });

  it("moves a whole selection together, parts and all, in one undo step", () => {
    editor.setSelection(["cart", "ball"]);
    drag([4, 2], [6, 3]);
    expect(pos("ball").x).toBeCloseTo(6);
    expect(pos("cart").x).toBeCloseTo(2);
    expect(pos("cart").y).toBeCloseTo(2);
    const wheel = (pos("wheel") as Connector).worldA();
    expect(wheel.x).toBeCloseTo(2.7);
    expect(editor.selection).toEqual(["cart", "ball"]);
    editor.undo();
    expect(pos("ball").x).toBeCloseTo(4);
    expect(pos("cart").x).toBeCloseTo(0);
  });

  it("clicking one of a group without dragging picks just that one", () => {
    editor.setSelection(["cart", "ball"]);
    click([4, 2]);
    expect(editor.selection).toEqual(["ball"]);
  });

  it("duplicates a cart with its parts attached to the copy", () => {
    editor.setSelection(["cart"]);
    const before = game.actors.length;
    editor.duplicateSelected();
    expect(game.actors.length).toBe(before + 3);
    expect(editor.selection).toHaveLength(3);
    const copy = game.find(editor.selection[0])!;
    const parts = game.dependentsOf(copy.id).map((a) => a.type).sort();
    expect(parts).toEqual(["thruster", "wheel"]);
    expect(game.dependentsOf("cart")).toHaveLength(2);
  });

  it("deletes everything selected", () => {
    editor.setSelection(["ball", "post"]);
    key("Delete");
    expect(game.find("ball")).toBeUndefined();
    expect(game.find("post")).toBeUndefined();
    expect(game.find("spring")).toBeUndefined();
    editor.undo();
    expect(game.find("spring")).toBeTruthy();
  });

  it("turns a group about its middle", () => {
    editor.setSelection(["ball", "post"]);
    key("q", { shiftKey: false });
    // 15° about the middle of the pair's box, (0.125, 2).
    const turn = (15 * Math.PI) / 180;
    expect(pos("ball").x).toBeCloseTo(0.125 + 3.875 * Math.cos(turn), 2);
    expect(pos("ball").y).toBeCloseTo(2 + 3.875 * Math.sin(turn), 2);
    expect(pos("post").angle).toBeCloseTo(turn, 3);
  });

  it("stretches a block from its right edge, keeping the left edge still", () => {
    editor.select(pos("cart"));
    // The right edge handle sits just right of x = 1, half way up.
    const handle = 1 + 5 / 40;
    drag([handle, 1], [2 + 5 / 40, 1]);
    expect(pos("cart").props.width).toBeCloseTo(3);
    expect(pos("cart").x).toBeCloseTo(0.5);
    // The wheel stays at the same spot on the stretched cart.
    expect(pos("wheel").props.ax).toBeCloseTo(0.7 * 1.5);
  });

  it("stretches a thin turned ramp from its end", () => {
    const ramp = editor.create({ type: "block", x: 0, y: 5, angle: Math.PI / 6, props: { width: 2, height: 0.2 } });
    const r = 1 + 5 / 40;
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    drag([c * r, 5 + s * r], [c * (r + 1), 5 + s * (r + 1)]);
    const after = game.find(ramp.id)!;
    expect(after.props.width).toBeCloseTo(3);
    // The far end stayed put.
    expect(after.x - c * 1.5).toBeCloseTo(-c, 2);
  });

  it("grows a ball evenly from a corner", () => {
    editor.select(pos("ball"));
    const pad = 5 / 40;
    drag([4.5 + pad, 2.5 + pad], [5 + pad, 3 + pad]);
    expect(pos("ball").props.radius).toBeCloseTo(0.75, 1);
    expect(pos("ball").x).toBeCloseTo(4.25, 1);
  });

  it("grows a group from a corner", () => {
    editor.setSelection(["ball", "post"]);
    // Bounds run from (-4.25, 1) to (4.5, 3); grab the top right corner and pull it out.
    const pad = 5 / 40;
    drag([4.5 + pad, 3 + pad], [4.5 + 8.75 + pad, 3 + 2 + pad]);
    expect(pos("ball").props.radius).toBeCloseTo(1, 1);
    expect(pos("post").props.height).toBeCloseTo(4, 1);
  });

  it("re-attaches a spring by dragging its end", () => {
    editor.select(pos("spring"));
    drag([-2, 5], [4, 2]);
    expect(pos("spring").props.b).toBe("ball");
    expect(pos("spring").props.a).toBe("post");
    // And drags the other end off into empty space, pinning it to the world.
    drag([-4, 3], [-6, 6]);
    expect(pos("spring").props.a).toBe("");
    expect(pos("spring").props.ax).toBeCloseTo(-6);
  });

  it("moves a thruster by dragging it, and onto something else", () => {
    drag([-0.5, 1], [0.3, 1.1]);
    expect(pos("jet").props.a).toBe("cart");
    expect(pos("jet").props.ax).toBeCloseTo(0.3);
    drag([0.3, 1.1], [-4, 2]);
    expect(pos("jet").props.a).toBe("post");
  });

  it("pans with a finger on empty space, and leaves the mouse alone while Space is held", () => {
    drag([0, 6], [2, 6], { pointerType: "touch" });
    expect(camera.x).toBeCloseTo(-2);
    editor.panKey = true;
    drag([4, 2], [6, 2]);
    expect(pos("ball").x).toBeCloseTo(4);
  });
});
