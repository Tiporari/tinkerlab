import type { LevelData } from "../core/types";
import firstMarbleRunJson from "./first-marble-run.json";

// JSON imports lose tuple types, so cast once here.
export const firstMarbleRun = firstMarbleRunJson as unknown as LevelData;

export const builtinLevels: LevelData[] = [firstMarbleRun];
