import { describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { Game } from "../src/core/Game";
import { firstMarbleRun as level } from "../src/levels";

registerBuiltinActors();

describe("first marble run", () => {
  it("gets every marble from the start to the finish", () => {
    const game = new Game(level);
    const finished: string[] = [];
    game.events.on("finish", ({ actor }) => finished.push(actor.id));
    game.play();
    for (let i = 0; i < 60 * 40 && finished.length < 4; i++) game.step();
    expect(finished).toHaveLength(4);
  });

  it("saves back to the same actors it loaded", () => {
    const game = new Game(level);
    game.play();
    for (let i = 0; i < 120; i++) game.step();
    const saved = game.serialize();
    expect(saved.actors.map((a) => a.id)).toEqual(level.actors.map((a) => a.id));
  });

  it("reset clears spawned marbles", () => {
    const game = new Game(level);
    game.play();
    for (let i = 0; i < 120; i++) game.step();
    expect(game.actors.some((a) => a.transient)).toBe(true);
    game.reset();
    expect(game.actors.some((a) => a.transient)).toBe(false);
  });
});
