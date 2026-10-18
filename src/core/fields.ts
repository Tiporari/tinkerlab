import type { PropField } from "./types";

/** Property fields shared by most solid actors. Spread these into a def's `props`. */
export function materialFields(defaults: { friction?: number; bounciness?: number; density?: number } = {}): PropField[] {
  return [
    { key: "friction", label: "Friction", kind: "number", default: defaults.friction ?? 0.4, min: 0, max: 2, step: 0.05 },
    {
      key: "bounciness",
      label: "Bounciness",
      kind: "number",
      default: defaults.bounciness ?? 0.2,
      min: 0,
      max: 1,
      step: 0.05,
      help: "0 is a lump of clay, 1 bounces forever.",
    },
    { key: "density", label: "Density", kind: "number", default: defaults.density ?? 1, min: 0.05, max: 20, step: 0.05 },
  ];
}

export function colorField(color: string): PropField {
  return { key: "color", label: "Color", kind: "color", default: color };
}

export function dynamicField(dynamic: boolean): PropField {
  return {
    key: "dynamic",
    label: "Moves",
    kind: "boolean",
    default: dynamic,
    help: "Off makes it a fixed part of the course.",
  };
}
