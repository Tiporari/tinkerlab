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
   * - "connect": drag from one thing to another; sets `a`, `b` and the anchor points (springs, ropes, pistons)
   * - "pin": click where two things overlap; joins them at that point (hinges)
   * - "attach": click on a thing to bolt this onto it (wheels, thrusters)
   */
  placement?: Placement;
  /**
   * Build order. Things that connect other things (springs, wheels, hinges)
   * use a higher layer so the bodies they join exist first. Default 0.
   */
  layer?: number;
  /**
   * Which of x, y and angle the editor shows and lets you drag. Parts that
   * hang off another actor work out their own position. Default: all three.
   */
  poseFields?: ("x" | "y" | "angle")[];
  /**
   * Extra palette buttons that place this type with some settings preset,
   * e.g. a Polygon with 3 sides labelled "Triangle".
   */
  variants?: ActorVariant[];
  /**
   * Lets the select tool's handles resize it. Without this it can only be
   * moved and turned. See `core/scaling.ts` for ready-made ones.
   */
  scale?: ScaleSpec;
  /** Set false to hide it from the editor palette. */
  palette?: boolean;
  props: PropField[];
  create(game: Game, data: ActorData): Actor;
}

export interface ActorVariant {
  label: string;
  icon?: string;
  props?: Props;
  /** Placed turned by this much, in radians. */
  angle?: number;
}

export interface ScaleSpec {
  /** "xy" can stretch width and height separately; "uniform" keeps its shape. */
  axes: "xy" | "uniform";
  /**
   * Grow the props by `sx` along the actor's own x axis and `sy` along its y,
   * about its own origin. For "uniform", sx and sy are the same.
   */
  apply(props: Props, sx: number, sy: number): void;
}

export type Placement = "click" | "drag-line" | "draw-path" | "connect" | "pin" | "attach";

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
