import { beforeEach, describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Camera } from "../src/core/Camera";
import { Game } from "../src/core/Game";
import { listActorDefs } from "../src/core/registry";
import { Editor } from "../src/editor/Editor";
import { simplifyPath } from "../src/editor/geometry";
import { blankLevel } from "../src/levels/blank";

registerBuiltinActors();

/** Just enough of a canvas for the editor to listen to pointer events. */
function fakeCanvas(): HTMLCanvasElement {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  target.style = {};
  target.setPointerCapture = () => {};
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  return target as unknown as HTMLCanvasElement;
}

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  const e = Object.assign(new Event(type), { clientX: x, clientY: y, button: 0, pointerId: 1 });
  canvas.dispatchEvent(e);
}

describe("editor", () => {
  let game: Game;
  let camera: Camera;
  let canvas: HTMLCanvasElement;
  let editor: Editor;

  beforeEach(() => {
    game = new Game(blankLevel());
    camera = new Camera();
    camera.width = 800;
    camera.height = 600;
    camera.set({ x: 0, y: 0, zoom: 40 });
    canvas = fakeCanvas();
    editor = new Editor(game, camera, canvas);
  });

  const toScreen = (x: number, y: number) => camera.worldToScreen(x, y);

  it("drags out a ramp with the block tool", () => {
    editor.setTool("place:block");
    pointer(canvas, "pointerdown", ...toScreen(0, 0));
    pointer(canvas, "pointermove", ...toScreen(2, 2));
    pointer(canvas, "pointermove", ...toScreen(4, 3));
    pointer(canvas, "pointerup", ...toScreen(4, 3));
    const ramp = editor.selected!;
    expect(ramp.type).toBe("block");
    expect(ramp.x).toBeCloseTo(2);
    expect(ramp.y).toBeCloseTo(1.5);
    expect(ramp.props.width).toBeCloseTo(5);
    expect(ramp.angle).toBeCloseTo(Math.atan2(3, 4), 3);
    expect(game.level.actors).toHaveLength(4);
  });

  it("draws a path freehand", () => {
    editor.setTool("place:path");
    pointer(canvas, "pointerdown", ...toScreen(-2, 2));
    for (let i = 1; i <= 20; i++) pointer(canvas, "pointermove", ...toScreen(-2 + i * 0.2, 2 - Math.sin(i / 6)));
    pointer(canvas, "pointerup", ...toScreen(2, 2));
    const path = editor.selected!;
    expect(path.type).toBe("path");
    expect((path.props.points as number[][]).length).toBeGreaterThan(2);
  });

  it("selects and moves things, with undo and redo", () => {
    const finish = game.actors.find((a) => a.type === "finish")!;
    pointer(canvas, "pointerdown", ...toScreen(finish.x, finish.y));
    pointer(canvas, "pointermove", ...toScreen(finish.x - 3, finish.y + 2));
    pointer(canvas, "pointerup", ...toScreen(finish.x - 3, finish.y + 2));
    expect(editor.selected?.id).toBe(finish.id);
    expect(editor.selected!.x).toBeCloseTo(5);
    expect(editor.selected!.y).toBeCloseTo(2);

    editor.undo();
    expect(game.find(finish.id)!.x).toBeCloseTo(8);
    editor.redo();
    expect(game.find(finish.id)!.x).toBeCloseTo(5);
  });

  it("changes settings, duplicates and deletes", () => {
    const start = game.actors.find((a) => a.type === "start")!;
    editor.select(start);
    editor.updateSelected((d) => (d.props = { ...d.props, count: 7 }));
    expect(game.find(start.id)!.props.count).toBe(7);
    expect(game.level.actors.find((a) => a.id === start.id)!.props!.count).toBe(7);

    editor.duplicateSelected();
    expect(game.actors.filter((a) => a.type === "start")).toHaveLength(2);
    editor.deleteSelected();
    expect(game.actors.filter((a) => a.type === "start")).toHaveLength(1);
  });

  it("is locked while playing and returns to the built level on reset", () => {
    game.commit();
    game.play();
    for (let i = 0; i < 60; i++) game.step();
    editor.select(game.actors[0]);
    editor.deleteSelected();
    expect(game.actors.some((a) => a.transient)).toBe(true);
    game.reset();
    expect(game.actors).toHaveLength(3);
  });
});

describe("every actor type", () => {
  for (const def of listActorDefs()) {
    it(`${def.type} can be placed from its defaults and clicked on`, () => {
      const game = new Game({ ...blankLevel(), actors: [] });
      const actor = game.add({ type: def.type, x: 1, y: 2 });
      for (const field of def.props) expect(actor.props[field.key]).toEqual(field.default);
      expect(actor.hitTest(1, 2, 0.1)).toBe(true);
      expect(actor.getBounds()).not.toBeNull();
    });
  }
});

describe("simplifyPath", () => {
  it("drops points on a straight line", () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPath(pts, 0.01)).toEqual([pts[0], pts[9]]);
  });
});
