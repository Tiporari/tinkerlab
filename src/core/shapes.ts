import { Box, Polygon, type Body, type FixtureOpt } from "planck";
import type { PropField } from "./types";

export type Pt = { x: number; y: number };

/** Corners of a regular polygon centred on 0,0, with one flat side at the bottom. */
export function regularPolygon(sides: number, radius: number): Pt[] {
  const n = Math.max(3, Math.min(12, Math.round(sides)));
  const start = -Math.PI / 2 - Math.PI / n;
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i * 2 * Math.PI) / n;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

/** Corners of a w × h rectangle centred on 0,0. */
export function rectangle(w: number, h: number): Pt[] {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
}

/** Points around a circle, for building a hollow ring. */
export function circlePoints(radius: number, segments = 24): Pt[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i * 2 * Math.PI) / segments;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

/**
 * Add a closed outline to a body as a ring of thin walls. Walls are solid
 * boxes, so hollow shapes can move, have weight and collide with anything.
 */
export function addOutline(body: Body, points: Pt[], thickness: number, opt: FixtureOpt): void {
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-4) continue;
    // Stretch each wall by its thickness so the corners overlap without gaps.
    body.createFixture(
      new Box(len / 2 + thickness / 2, thickness / 2, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.atan2(b.y - a.y, b.x - a.x)),
      opt,
    );
  }
}

/** Add a solid convex shape to a body. */
export function addSolid(body: Body, points: Pt[], opt: FixtureOpt): void {
  body.createFixture(new Polygon(points), opt);
}

/** Is a point inside a closed polygon? Works for any simple polygon, convex or not. */
export function pointInPolygon(p: Pt, points: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The "Hollow" and "Wall thickness" settings shared by shapes that can be outlines. */
export function hollowFields(): PropField[] {
  return [
    { key: "hollow", label: "Hollow", kind: "boolean", default: false, help: "Make it an outline you can put things inside." },
    { key: "wall", label: "Wall thickness", kind: "number", default: 0.1, min: 0.02, max: 2, step: 0.01 },
  ];
}
