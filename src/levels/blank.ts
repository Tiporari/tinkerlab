import type { LevelData } from "../core/types";

/** A fresh level: a floor, a start and a finish, ready to build between. */
export function blankLevel(): LevelData {
  return {
    format: "tinkerlab/level",
    version: 1,
    name: "My level",
    gravity: [0, -10],
    camera: { x: 0, y: 4, zoom: 40 },
    actors: [
      { type: "block", x: 0, y: -1, props: { width: 24, height: 0.5 } },
      { type: "start", x: -8, y: 9 },
      { type: "finish", x: 8, y: 0 },
    ],
  };
}
