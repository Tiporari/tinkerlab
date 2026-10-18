import type { Actor } from "./Actor";
import type { Game } from "./Game";
import type { ActorData, PropField, Props } from "./types";

/**
 * Everything the engine and editor need to know about a kind of actor.
 * Adding a new actor to the game means writing one of these and nothing else.
 */
export interface ActorDef {
  /** Unique id used in level files, e.g. "ball". */
  type: string;
  /** Name shown in the editor. */
  label: string;
  /** Groups actors in the editor palette, e.g. "Shapes" or "Course". */
  category: string;
  description?: string;
  /** A short symbol or emoji for the editor palette. */
  icon?: string;
  /**
   * How the editor creates one:
   * - "click" (default): click to drop it where you click
   * - "drag-line": drag from one end to the other; sets `width` and `angle` (ramps, walls)
   * - "draw-path": draw freehand; sets `points` (curves, funnels)
   */
  placement?: Placement;
  /** Set false to hide it from the editor palette. */
  palette?: boolean;
  props: PropField[];
  create(game: Game, data: ActorData): Actor;
}

export type Placement = "click" | "drag-line" | "draw-path";

const defs = new Map<string, ActorDef>();

export function registerActor(def: ActorDef): void {
  if (defs.has(def.type)) {
    throw new Error(`Actor type "${def.type}" is registered twice`);
  }
  defs.set(def.type, def);
}

export function getActorDef(type: string): ActorDef {
  const def = defs.get(type);
  if (!def) throw new Error(`Unknown actor type "${type}"`);
  return def;
}

export function hasActorDef(type: string): boolean {
  return defs.has(type);
}

export function listActorDefs(): ActorDef[] {
  return [...defs.values()];
}

/** The property defaults for a type, overlaid with whatever the level supplied. */
export function resolveProps(def: ActorDef, given: Props | undefined): Props {
  const props: Props = {};
  for (const field of def.props) {
    props[field.key] = structuredClone(field.default);
  }
  return { ...props, ...structuredClone(given ?? {}) };
}
