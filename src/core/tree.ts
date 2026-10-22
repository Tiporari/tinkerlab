import { freshId, unionBounds, type Bounds } from "./Actor";
import { flattenData } from "./Game";
import { getActorDef } from "./registry";
import type { ActorData } from "./types";

const round = (v: number) => Math.round(v * 1000) / 1000;

/** True for a part whose `a` / `b` props name what it's attached to. */
function isConnectorData(data: ActorData): boolean {
  return getActorDef(data.type).props.some((f) => f.key === "ax");
}

/**
 * Copy some actors (with any groups' children) under new ids, moved by
 * `shift`. Parts attached to something inside the copy are attached to the
 * copy; parts attached to something outside it stay attached to that.
 */
export function cloneTree(list: ActorData[], shift = { x: 0, y: 0 }): ActorData[] {
  const copy = structuredClone(list);
  const renamed = new Map<string, string>();
  for (const data of flattenData(copy)) {
    const next = freshId(data.type);
    if (data.id) renamed.set(data.id, next);
    data.id = next;
  }
  for (const data of flattenData(copy)) {
    data.x = round(data.x + shift.x);
    data.y = round(data.y + shift.y);
    if (!data.props || !isConnectorData(data)) continue;
    for (const end of ["a", "b"] as const) {
      const target = String(data.props[end] ?? "");
      if (renamed.has(target)) data.props[end] = renamed.get(target)!;
      else if (!target) {
        // An end pinned to the world moves with everything else.
        data.props[`${end}x`] = round(Number(data.props[`${end}x`] ?? 0) + shift.x);
        data.props[`${end}y`] = round(Number(data.props[`${end}y`] ?? 0) + shift.y);
      }
    }
  }
  return copy;
}

/** A rough box around saved actors, from their positions and sizes. Good enough for centring a drop. */
export function dataBounds(list: ActorData[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const d of flattenData(list)) {
    if (d.children) continue;
    const p = d.props ?? {};
    const rx = Number(p.width ?? 0) / 2 || Number(p.radius ?? p.size ?? 0.1);
    const ry = Number(p.height ?? 0) / 2 || Number(p.radius ?? p.size ?? 0.1);
    bounds = unionBounds(bounds, { minX: d.x - rx, minY: d.y - ry, maxX: d.x + rx, maxY: d.y + ry });
  }
  return bounds;
}
