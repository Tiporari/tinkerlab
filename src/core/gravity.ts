/** A gravity vector, in meters per second squared (y up). */
export interface Gravity {
  x: number;
  y: number;
}

/**
 * Gravity as a strength and a direction. Direction is in radians, measured
 * counter-clockwise from straight down, the same way actors turn: 0 is down,
 * a quarter turn points right, a half turn points up.
 */
export function gravityFromAngle(strength: number, direction: number): [number, number] {
  return [tidy(strength * Math.sin(direction)), tidy(-strength * Math.cos(direction))];
}

export function gravityStrength(g: Gravity | [number, number]): number {
  const [x, y] = Array.isArray(g) ? g : [g.x, g.y];
  return Math.hypot(x, y);
}

/** The direction of a gravity vector, as `gravityFromAngle` takes it. Straight down when there's none. */
export function gravityDirection(g: Gravity | [number, number]): number {
  const [x, y] = Array.isArray(g) ? g : [g.x, g.y];
  if (Math.hypot(x, y) < 1e-9) return 0;
  return Math.atan2(x, -y);
}

/** The view rotation that makes this gravity point down the screen. */
export function viewRotationFor(g: Gravity): number {
  return -gravityDirection(g);
}

/**
 * Something that changes gravity where it is, like a gravity zone or a
 * planet. Actors with a `bendGravity` method are asked, in level order, for
 * every moving body on every step.
 */
export interface GravitySource {
  /** Given the gravity at a world point so far, return the gravity there. */
  bendGravity(x: number, y: number, g: Gravity): Gravity;
}

function tidy(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}
