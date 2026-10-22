import { describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Camera } from "../src/core/Camera";
import { Game } from "../src/core/Game";
import { wrapAngle } from "../src/actors/gyro-angle";
import { gravityDirection, gravityFromAngle, viewRotationFor } from "../src/core/gravity";
import type { LevelData } from "../src/core/types";
import { gravityLevel, littlePlanet } from "../src/levels";

registerBuiltinActors();

function level(actors: LevelData["actors"], gravity: [number, number] = [0, -10]): LevelData {
  return { format: "tinkerlab/level", version: 1, name: "test", gravity, actors };
}

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) game.step();
}

const pos = (game: Game, id: string) => {
  const p = game.find(id)!.body!.getPosition();
  return { x: p.x, y: p.y };
};

describe("gravity", () => {
  it("turns a strength and direction into a vector and back", () => {
    expect(gravityFromAngle(10, 0)).toEqual([0, -10]);
    expect(gravityFromAngle(10, Math.PI / 2)).toEqual([10, 0]);
    expect(gravityFromAngle(10, Math.PI)).toEqual([0, 10]);
    expect(gravityDirection([10, 0])).toBeCloseTo(Math.PI / 2);
    expect(gravityDirection([0, 0])).toBe(0);
  });

  it("turns the view so gravity points down the screen", () => {
    const camera = new Camera();
    camera.width = camera.height = 100;
    for (const g of [{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: -3, y: 4 }]) {
      camera.rotation = viewRotationFor(g);
      const [sx0, sy0] = camera.worldToScreen(0, 0);
      const [sx1, sy1] = camera.worldToScreen(g.x, g.y);
      expect(sx1 - sx0).toBeCloseTo(0);
      expect(sy1 - sy0).toBeGreaterThan(0);
    }
  });

  it("lets a level's gravity point sideways", () => {
    const game = new Game(level([{ id: "ball", type: "ball", x: 0, y: 0 }], [10, 0]));
    run(game, 1);
    expect(pos(game, "ball").x).toBeGreaterThan(3);
    expect(pos(game, "ball").y).toBeCloseTo(0, 3);
  });

  it("pulls the way a gravity zone points, only inside it", () => {
    const game = new Game(
      level([
        { type: "gravity-zone", x: 0, y: 0, angle: Math.PI, props: { width: 4, height: 40 } },
        { id: "inside", type: "ball", x: 0, y: 0 },
        { id: "outside", type: "ball", x: 6, y: 0 },
      ]),
    );
    run(game, 1);
    expect(pos(game, "inside").y).toBeGreaterThan(3);
    expect(pos(game, "outside").y).toBeLessThan(-3);
  });

  it("floats things in a zone with no gravity", () => {
    const game = new Game(
      level([
        { type: "gravity-zone", x: 0, y: 0, props: { width: 4, height: 4, strength: 0 } },
        { id: "ball", type: "ball", x: 0, y: 0 },
      ]),
    );
    run(game, 2);
    expect(pos(game, "ball").y).toBeCloseTo(0, 3);
  });

  it("pulls things onto a planet from any side", () => {
    const game = new Game(
      level(
        [
          { type: "gravity-well", x: 0, y: 0, props: { radius: 5, planet: 1.5 } },
          { id: "left", type: "ball", x: -3, y: 0 },
          { id: "under", type: "ball", x: 0, y: -3 },
        ],
        [0, 0],
      ),
    );
    run(game, 3);
    for (const id of ["left", "under"]) {
      const p = pos(game, id);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1.75, 1);
    }
  });

  it("adds a planet's pull to the level's gravity when it doesn't replace it", () => {
    const game = new Game(
      level([
        { type: "gravity-well", x: 0, y: 0, props: { radius: 5, planet: 0, strength: -10, replace: false } },
        { id: "ball", type: "ball", x: 0, y: 1 },
      ]),
    );
    // Pushing up as hard as gravity pulls down: it hangs there.
    expect(game.gravityAt(0, 1).y).toBeCloseTo(0);
    run(game, 1);
    expect(pos(game, "ball").y).toBeCloseTo(1, 1);
  });

  it("hovers against gravity that points sideways", () => {
    const game = new Game(
      level(
        [
          { id: "box", type: "block", x: 0, y: 0, props: { width: 1, height: 1, dynamic: true } },
          { type: "gyro-position", x: 0, y: 0, props: { a: "box", ax: 0, ay: 0, lockX: false, lockY: true } },
        ],
        [10, 0],
      ),
    );
    run(game, 2);
    // Up and down follow gravity, so it holds its x and is free along y.
    expect(pos(game, "box").x).toBeCloseTo(0, 1);
  });

  it("plays the gravity level: the marbles reach the finish", () => {
    const game = new Game(gravityLevel);
    let finished = 0;
    game.events.on("finish", () => finished++);
    game.play();
    run(game, 25);
    expect(finished).toBeGreaterThan(0);
  });
});

describe("little planet", () => {
  it("keeps the rocket standing on the planet until it flies", () => {
    const game = new Game(littlePlanet);
    game.play();
    run(game, 3);
    const p = pos(game, "rocket-hull");
    expect(p.y).toBeGreaterThan(4.5);
    expect(Math.abs(p.x)).toBeLessThan(0.1);
    game.input.keys.add("ArrowUp");
    run(game, 1);
    expect(pos(game, "rocket-hull").y).toBeGreaterThan(p.y + 1);
  });

  it("turns a gyro's upright with gravity around a planet", () => {
    const game = new Game(
      level(
        [
          { type: "gravity-well", x: 0, y: 0, props: { radius: 6, planet: 2 } },
          { id: "box", type: "block", x: 0, y: 2.3, props: { width: 1, height: 0.6, dynamic: true, friction: 0 } },
          { type: "gyro-angle", x: 0, y: 2.3, props: { a: "box", ax: 0, ay: 0 } },
        ],
        [0, 0],
      ),
    );
    // Slide it around the planet: it should stay standing on the surface the whole way.
    const body = game.find("box")!.body!;
    body.setLinearVelocity({ x: -4, y: 0 });
    run(game, 1);
    const p = body.getPosition();
    const around = Math.atan2(p.y, p.x) - Math.PI / 2;
    expect(Math.abs(around)).toBeGreaterThan(0.5);
    expect(Math.abs(wrapAngle(body.getAngle() - around))).toBeLessThan(0.2);
  });
});
