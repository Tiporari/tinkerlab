/** A plain value an actor property can hold. Everything in a level is JSON. */
export type PropValue = number | string | boolean | number[] | number[][];

export type Props = Record<string, PropValue>;

/**
 * Describes one editable property of an actor type. The editor builds its
 * inspector from these, and the defaults fill in anything a level leaves out.
 */
export interface PropField {
  key: string;
  label: string;
  kind: "number" | "boolean" | "color" | "string" | "points";
  default: PropValue;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

/** One actor as it is stored in a level file. */
export interface ActorData {
  id?: string;
  type: string;
  x: number;
  y: number;
  /** Radians, counter-clockwise. */
  angle?: number;
  props?: Props;
}

export interface CameraData {
  x: number;
  y: number;
  /** Pixels per meter. */
  zoom: number;
}

/** A whole level, exactly as saved to and loaded from JSON. */
export interface LevelData {
  format: "tinkerlab/level";
  version: 1;
  name: string;
  /** Meters per second squared; y points up. */
  gravity: [number, number];
  camera?: CameraData;
  actors: ActorData[];
}
