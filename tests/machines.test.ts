import { describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Camera } from "../src/core/Camera";
import { Game } from "../src/core/Game";
import { Input } from "../src/core/input";
import { Editor } from "../src/editor/Editor";
import { blankLevel } from "../src/levels/blank";
import { cart, machineParts } from "../src/levels";

registerBuiltinActors();

const pos = (game: Game, id: string) => game.find(id)!.body!.getPosition();

describe("controls", () => {
  it("reads keys, key pairs and sliders", () => {
    const input = new Input();
    expect(input.axis("keys:ArrowLeft,ArrowRight")).toBe(0);
    input.press("ArrowRight");
    expect(input.axis("keys:ArrowLeft,ArrowRight")).toBe(1);
    input.press("ArrowLeft");
    expect(input.axis("keys:ArrowLeft,ArrowRight")).toBe(0);
    expect(input.axis("key:KeyW")).toBe(0);
    input.press("KeyW");
    expect(input.axis("key:KeyW")).toBe(1);
    input.setSlider(2, 0.5);
    expect(input.axis("slider:2")).toBe(0.5);
    expect(input.axis("always")).toBe(1);
    expect(input.axis("")).toBe(0);
  });
});

describe("cart level", () => {
  it("drives to the finish when holding right", () => {
    const game = new Game(cart);
    let finished = false;
    game.events.on("finish", ({ actor }) => (finished ||= actor.id === "cart-body"));
    game.play();
    game.input.press("ArrowRight");
    for (let i = 0; i < 60 * 30 && !finished; i++) game.step();
    expect(finished).toBe(true);
  });

  it("stays put with no keys held", () => {
    const game = new Game(cart);
    game.play();
    for (let i = 0; i < 120; i++) game.step();
    expect(Math.abs(pos(game, "cart-body").x)).toBeLessThan(0.2);
  });
});

describe("machine parts playground", () => {
  it("runs, and each part does its job", () => {
    const game = new Game(machineParts);
    const start = {
      rocket: pos(game, "rocket").y,
      plate: pos(game, "pusher-plate").x,
      arm: game.find("windmill-arm")!.body!.getAngle(),
    };
    game.play();
    game.input.press("KeyW");
    game.input.press("ArrowRight");
    for (let i = 0; i < 60 * 2; i++) game.step();
    for (const a of game.actors) {
      const p = a.body?.getPosition();
      if (p) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    expect(pos(game, "rocket").y).toBeGreaterThan(start.rocket + 2);
    expect(pos(game, "pusher-plate").x).toBeGreaterThan(start.plate + 1);
    expect(Math.abs(game.find("windmill-arm")!.body!.getAngle() - start.arm)).toBeGreaterThan(1);
  });
});

/** Just enough of a canvas for the editor to listen to pointer events. */
function fakeCanvas(): HTMLCanvasElement {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  target.style = {};
  target.setPointerCapture = () => {};
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  return target as unknown as HTMLCanvasElement;
}

describe("editing machines", () => {
  function setup() {
    const game = new Game(blankLevel());
    const camera = new Camera();
    camera.width = 800;
    camera.height = 600;
    camera.set({ x: 0, y: 0, zoom: 40 });
    const canvas = fakeCanvas();
    const editor = new Editor(game, camera, canvas);
    const at = (type: string, x: number, y: number) => {
      const [sx, sy] = camera.worldToScreen(x, y);
      canvas.dispatchEvent(Object.assign(new Event(type), { clientX: sx, clientY: sy, button: 0, pointerId: 1 }));
    };
    return { game, editor, at };
  }

  it("bolts wheels on, moves them with their body, and deletes them with it", () => {
    const { game, editor, at } = setup();
    const body = editor.create({ type: "block", x: 0, y: 3, props: { width: 3, height: 0.5, dynamic: true } });
    editor.setTool("place:wheel");
    at("pointerdown", -1, 3);
    at("pointerup", -1, 3);
    at("pointerdown", 1, 3);
    at("pointerup", 1, 3);
    const wheels = game.actors.filter((a) => a.type === "wheel");
    expect(wheels).toHaveLength(2);
    expect(wheels[0].props.a).toBe(body.id);

    // Drag the body: the wheels come along.
    editor.setTool("select");
    at("pointerdown", 0, 3);
    at("pointermove", 4, 5);
    at("pointerup", 4, 5);
    const moved = game.actors.filter((a) => a.type === "wheel").map((w) => w.body!.getPosition());
    expect(moved[0].x).toBeCloseTo(3);
    expect(moved[0].y).toBeCloseTo(5);

    editor.select(game.find(body.id)!);
    editor.deleteSelected();
    expect(game.actors.filter((a) => a.type === "wheel")).toHaveLength(0);
    editor.undo();
    expect(game.actors.filter((a) => a.type === "wheel")).toHaveLength(2);
  });

  it("connects a spring by dragging between two things", () => {
    const { game, editor, at } = setup();
    const a = editor.create({ type: "ball", x: -2, y: 4, props: { radius: 0.5 } });
    const b = editor.create({ type: "ball", x: 2, y: 4, props: { radius: 0.5 } });
    editor.setTool("place:spring");
    at("pointerdown", -2, 4);
    at("pointermove", 0, 4);
    at("pointerup", 2, 4);
    const spring = game.actors.find((x) => x.type === "spring")!;
    expect(spring.props.a).toBe(a.id);
    expect(spring.props.b).toBe(b.id);
  });

  it("pins a hinge to the world when nothing is underneath", () => {
    const { game, editor, at } = setup();
    const arm = editor.create({ type: "block", x: 0, y: 5, props: { width: 3, height: 0.3, dynamic: true } });
    editor.setTool("place:hinge");
    at("pointerdown", -1, 5);
    at("pointerup", -1, 5);
    const hinge = game.actors.find((x) => x.type === "hinge")!;
    expect(hinge.props.a).toBe(arm.id);
    expect(hinge.props.b).toBe("");
    game.commit();
    game.play();
    for (let i = 0; i < 60; i++) game.step();
    // Swung down around the pin, which stayed put.
    expect(game.find(arm.id)!.body!.getPosition().y).toBeLessThan(5);
    const pin = game.find(arm.id)!.body!.getWorldPoint({ x: -1, y: 0 });
    expect(pin.x).toBeCloseTo(-1, 1);
    expect(pin.y).toBeCloseTo(5, 1);
  });
});

describe("rope", () => {
  it("holds a heavy weight without stretching", () => {
    const game = new Game(machineParts);
    game.play();
    for (let i = 0; i < 60 * 3; i++) game.step();
    const bob = pos(game, "pendulum-bob");
    const length = Math.hypot(-9 - -12, 5 - 8);
    expect(Math.hypot(bob.x - -12, bob.y - 8)).toBeLessThan(length * 1.02);
  });
});
