import { describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Camera } from "../src/core/Camera";
import { Game } from "../src/core/Game";
import type { LevelData } from "../src/core/types";
import { regularPolygon } from "../src/core/shapes";
import { Editor } from "../src/editor/Editor";
import { blankLevel } from "../src/levels/blank";
import { shapesHazardsGyros } from "../src/levels";

registerBuiltinActors();

function level(actors: LevelData["actors"]): LevelData {
  return { format: "tinkerlab/level", version: 1, name: "test", gravity: [0, -10], actors };
}

const floor = { id: "floor", type: "block", x: 0, y: -0.5, props: { width: 40, height: 1 } };

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) game.step();
}

describe("shapes", () => {
  it("makes regular polygons with flat bottoms", () => {
    const tri = regularPolygon(3, 1);
    expect(tri).toHaveLength(3);
    expect(tri[0].y).toBeCloseTo(tri[1].y);
    expect(regularPolygon(40, 1)).toHaveLength(12);
  });

  it("builds solid and hollow polygons, boxes and balls", () => {
    const game = new Game(
      level([
        floor,
        { id: "hex", type: "polygon", x: -4, y: 1, props: { sides: 6 } },
        { id: "hex-hollow", type: "polygon", x: -2, y: 1, props: { sides: 6, hollow: true } },
        { id: "box-hollow", type: "block", x: 0, y: 1, props: { width: 1, height: 1, dynamic: true, hollow: true } },
        { id: "ring", type: "ball", x: 2, y: 1, props: { radius: 0.5, dynamic: true, hollow: true } },
      ]),
    );
    const fixtures = (id: string) => {
      let n = 0;
      for (let f = game.find(id)!.body!.getFixtureList(); f; f = f.getNext()) n++;
      return n;
    };
    expect(fixtures("hex")).toBe(1);
    expect(fixtures("hex-hollow")).toBe(6);
    expect(fixtures("box-hollow")).toBe(4);
    expect(fixtures("ring")).toBeGreaterThan(8);
    // A hollow thing has a hole: a point in the middle isn't part of it.
    expect(game.find("hex")!.hitTest(-4, 1, 0)).toBe(true);
    expect(game.find("hex-hollow")!.hitTest(-2, 1, 0)).toBe(false);
    game.play();
    run(game, 2);
    for (const id of ["hex", "hex-hollow", "box-hollow", "ring"]) expect(game.find(id)!.body!.getPosition().y).toBeGreaterThan(0);
  });

  it("a marble can sit inside a hollow hexagon", () => {
    const game = new Game(
      level([
        floor,
        { id: "cup", type: "polygon", x: 0, y: 0.7, props: { sides: 6, size: 0.7, hollow: true, dynamic: false } },
        { id: "marble", type: "ball", x: 0, y: 0.7, props: { radius: 0.2, dynamic: true } },
      ]),
    );
    game.play();
    run(game, 2);
    const p = game.find("marble")!.body!.getPosition();
    expect(Math.hypot(p.x, p.y - 0.7)).toBeLessThan(0.7);
  });

  it("palette presets place a shape with their settings", () => {
    const game = new Game(blankLevel());
    const camera = new Camera();
    camera.width = 800;
    camera.height = 600;
    camera.set({ x: 0, y: 0, zoom: 40 });
    const canvas = Object.assign(new EventTarget(), {
      style: {},
      setPointerCapture: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    }) as unknown as HTMLCanvasElement;
    const editor = new Editor(game, camera, canvas);
    editor.setTool("place:polygon~0");
    const [sx, sy] = camera.worldToScreen(1, 3);
    for (const type of ["pointerdown", "pointerup"]) {
      canvas.dispatchEvent(Object.assign(new Event(type), { clientX: sx, clientY: sy, button: 0, pointerId: 1 }));
    }
    const placed = game.actors.find((a) => a.type === "polygon")!;
    expect(placed.props.sides).toBe(3);
    expect(placed.x).toBeCloseTo(1, 0);
  });
});

describe("hazard", () => {
  it("destroys marbles and sends the player back to the start", () => {
    const game = new Game(
      level([
        { id: "lava", type: "hazard", x: 0, y: 0, props: { width: 20, height: 1 } },
        { id: "start", type: "start", x: -3, y: 3, props: { count: 1 } },
        { id: "cart", type: "block", x: 3, y: 3, tags: ["player"], props: { width: 1, height: 0.5, dynamic: true } },
        { id: "wheel", type: "wheel", x: 3, y: 2.7, props: { a: "cart", ax: 0, ay: -0.3, radius: 0.3 } },
      ]),
    );
    const results: string[] = [];
    game.events.on("hazard", ({ actor, result }) => results.push(`${actor.id}:${result}`));
    game.play();
    run(game, 0.2);
    const marbles = () => game.actors.filter((a) => a.tags.has("marble")).length;
    expect(marbles()).toBe(1);
    // Fall in, and keep falling in: the cart respawns each time and the wheel comes with it.
    run(game, 1.2);
    expect(marbles()).toBe(0);
    expect(results.some((r) => r.endsWith(":removed"))).toBe(true);
    expect(results).toContain("cart:respawned");
    const cart = game.find("cart")!.body!.getPosition();
    expect(cart.y).toBeGreaterThan(0.5);
    expect(game.find("wheel")).toBeTruthy();
  });
});

describe("gyros", () => {
  it("an angle gyro keeps a stick upright, and steering tilts it", () => {
    const stick = { id: "stick", type: "block", x: 0, y: 1.5, props: { width: 0.2, height: 2, dynamic: true } };
    const gyro = { id: "g", type: "gyro-angle", x: 0, y: 1.5, props: { a: "stick", ax: 0, ay: 0, steer: "keys:ArrowLeft,ArrowRight", steerRange: 30 } };
    const free = new Game(level([floor, { ...stick, angle: 0.3 }]));
    const held = new Game(level([floor, { ...stick, angle: 0.3 }, gyro]));
    for (const g of [free, held]) {
      g.play();
      run(g, 3);
    }
    expect(Math.abs(free.find("stick")!.body!.getAngle())).toBeGreaterThan(1);
    expect(Math.abs(held.find("stick")!.body!.getAngle() - 0.3)).toBeLessThan(0.05);
    held.input.press("ArrowRight");
    run(held, 2);
    expect(held.find("stick")!.body!.getAngle()).toBeCloseTo(0.3 - (30 * Math.PI) / 180, 1);
  });

  it("a position gyro holds a block in the air, and can be switched off", () => {
    const game = new Game(
      level([
        floor,
        { id: "box", type: "block", x: 0, y: 4, props: { width: 1, height: 1, dynamic: true } },
        { id: "g", type: "gyro-position", x: 0, y: 4, props: { a: "box", ax: 0, ay: 0, control: "key:KeyG" } },
      ]),
    );
    game.input.press("KeyG");
    game.play();
    run(game, 3);
    const box = game.find("box")!.body!;
    expect(box.getPosition().y).toBeCloseTo(4, 1);
    box.applyLinearImpulse({ x: 3, y: 0 }, box.getPosition(), true);
    run(game, 3);
    expect(box.getPosition().x).toBeCloseTo(0, 1);
    game.input.release("KeyG");
    run(game, 2);
    expect(box.getPosition().y).toBeLessThan(1);
  });

  it("a hover gyro locked on Y only lets things slide sideways", () => {
    const game = new Game(
      level([
        { id: "box", type: "block", x: 0, y: 4, props: { width: 1, height: 1, dynamic: true } },
        { id: "g", type: "gyro-position", x: 0, y: 4, props: { a: "box", ax: 0, ay: 0, lockX: false } },
      ]),
    );
    game.play();
    const box = game.find("box")!.body!;
    box.setLinearVelocity({ x: 2, y: 0 });
    run(game, 1);
    expect(box.getPosition().x).toBeGreaterThan(1);
    expect(box.getPosition().y).toBeCloseTo(4, 1);
  });
});

describe("shapes, hazards and gyros level", () => {
  it("the lander flies across the pit to the finish", () => {
    const game = new Game(shapesHazardsGyros);
    let finished = false;
    let respawned = false;
    game.events.on("finish", ({ actor }) => (finished ||= actor.id === "lander"));
    game.events.on("hazard", ({ result }) => (respawned ||= result === "respawned"));
    game.play();
    const lander = game.find("lander")!;
    for (let i = 0; i < 60 * 30 && !finished; i++) {
      const p = lander.body!.getPosition();
      const v = lander.body!.getLinearVelocity();
      // A tiny autopilot: climb to about 3m, then steer right until over the pad, then drop.
      game.input.release("ArrowUp");
      game.input.release("ArrowRight");
      game.input.release("ArrowLeft");
      const wantY = p.x < 6 ? 3 : 0.5;
      if (p.y < wantY && v.y < 1.5) game.input.press("ArrowUp");
      if (p.y > 2 && p.x < 9 && v.x < 2) game.input.press("ArrowRight");
      if (p.x > 8 && v.x > 0.5) game.input.press("ArrowLeft");
      game.step();
    }
    expect(respawned).toBe(false);
    expect(finished).toBe(true);
  });

  it("marbles land on the hovering deck and roll off into the pit", () => {
    const game = new Game(shapesHazardsGyros);
    let removed = 0;
    game.events.on("hazard", ({ result }) => result === "removed" && removed++);
    game.play();
    run(game, 15);
    expect(removed).toBeGreaterThan(2);
    expect(game.find("hover-deck")!.body!.getPosition().y).toBeCloseTo(5.5, 0);
  });
});
