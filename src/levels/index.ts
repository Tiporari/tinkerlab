import type { LevelData } from "../core/types";
import cartJson from "./cart.json";
import drawnJson from "./drawn-level.json";
import firstMarbleRunJson from "./first-marble-run.json";
import machinePartsJson from "./machine-parts.json";
import shapesJson from "./shapes-hazards-gyros.json";
import planetJson from "./little-planet.json";
import gravityJson from "./which-way-is-down.json";

// JSON imports lose tuple types, so cast once here.
export const firstMarbleRun = firstMarbleRunJson as unknown as LevelData;

export const cart = cartJson as unknown as LevelData;
export const machineParts = machinePartsJson as unknown as LevelData;
export const shapesHazardsGyros = shapesJson as unknown as LevelData;
export const gravityLevel = gravityJson as unknown as LevelData;
export const littlePlanet = planetJson as unknown as LevelData;
export const drawnLevel = drawnJson as unknown as LevelData;

export const builtinLevels: LevelData[] = [firstMarbleRun, cart, machineParts, shapesHazardsGyros, gravityLevel, littlePlanet, drawnLevel];
