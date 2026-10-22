import { Vec2, type Body, type Joint } from "planck";
import { Actor, unionBounds, type Bounds } from "./Actor";
import type { PropField, Props } from "./types";

/** Props every connector has: the two actors it joins and where, in each one's own frame. */
export interface ConnectorProps extends Props {
  /** Id of the first actor, or "" for the world. */
  a: string;
  /** Id of the second actor, or "" for the world. Unused by single-target parts. */
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Hidden fields that store what a connector is attached to. Spread into a def's `props`. */
export function connectorFields(): PropField[] {
  return [
    { key: "a", label: "Attached to", kind: "string", default: "", hidden: true },
    { key: "b", label: "Attached to", kind: "string", default: "", hidden: true },
    { key: "ax", label: "Anchor A x", kind: "number", default: 0, hidden: true },
    { key: "ay", label: "Anchor A y", kind: "number", default: 0, hidden: true },
    { key: "bx", label: "Anchor B x", kind: "number", default: 0, hidden: true },
    { key: "by", label: "Anchor B y", kind: "number", default: 0, hidden: true },
  ];
}

type Point = { x: number; y: number };

/**
 * Base class for parts that hang off other actors: springs, ropes, hinges,
 * wheels, thrusters. Anchors are stored in each target's own frame, so when
 * a target moves in the editor, its parts move with it.
 */
export abstract class Connector<P extends ConnectorProps = ConnectorProps> extends Actor<P> {
  protected joints: Joint[] = [];
  /** Bodies this part made besides `body`, like rope segments. */
  protected extraBodies: Body[] = [];

  /** The body of the actor with this id, or the world's ground body. */
  bodyOf(id: string): Body {
    return this.resolve(id, 0, 0).body;
  }

  /**
   * The body an end really hangs on, and the anchor on it. Usually that's the
   * target's own body; a piece of a welded shape has none of its own, so the
   * end hangs on the weld at the same spot.
   */
  private resolve(id: string, x: number, y: number): { body: Body; local: Point } {
    const target = id ? this.game.find(id) : undefined;
    if (!target) return { body: this.game.ground, local: { x, y } };
    if (target.body) return { body: target.body, local: { x, y } };
    const holder = this.holderOf(target);
    if (!holder?.body) return { body: this.game.ground, local: { x, y } };
    // Where the anchor sits on the piece, measured from the weld's body (which is never turned when built).
    const c = Math.cos(target.angle);
    const s = Math.sin(target.angle);
    return {
      body: holder.body,
      local: { x: target.x + x * c - y * s - holder.x, y: target.y + x * s + y * c - holder.y },
    };
  }

  /** The outermost closed weld a piece is part of, which holds the piece's shapes in its body. */
  private holderOf(target: Actor): Actor | null {
    let holder: Actor | null = null;
    for (let g = this.game.parentOf(target.id); g; g = this.game.parentOf(g.id)) if (g.merges) holder = g;
    return holder;
  }

  get bodyA(): Body {
    return this.bodyOf(this.props.a);
  }

  get bodyB(): Body {
    return this.bodyOf(this.props.b);
  }

  /** Anchor A in world coordinates, following its body as it moves. */
  worldA(): Point {
    const { body, local } = this.resolve(this.props.a, this.props.ax, this.props.ay);
    return body.getWorldPoint(Vec2(local.x, local.y));
  }

  worldB(): Point {
    const { body, local } = this.resolve(this.props.b, this.props.bx, this.props.by);
    return body.getWorldPoint(Vec2(local.x, local.y));
  }

  /** What it's attached to, and the weld holding a piece it's attached to (so it's rebuilt after the weld). */
  dependsOn(): string[] {
    const ids = [this.props.a, this.props.b].filter(Boolean);
    for (const id of [...ids]) {
      const target = this.game.find(id);
      const holder = target ? this.holderOf(target) : null;
      if (holder) ids.push(holder.id);
    }
    return ids;
  }

  /** Remember where anchor A is, so saved files show roughly where the part sits. */
  protected trackPosition(): void {
    const p = this.worldA();
    this.x = Math.round(p.x * 1000) / 1000;
    this.y = Math.round(p.y * 1000) / 1000;
  }

  protected addJoint<T extends Joint>(joint: T): T {
    const made = this.game.world.createJoint(joint);
    if (!made) throw new Error(`${this.type} could not create its joint`);
    this.joints.push(made);
    return made;
  }

  /** Parts follow their targets, so the editor can only turn them, not move them. */
  setPose(_x: number, _y: number, angle = this.angle): void {
    if (this.def.poseFields?.includes("angle")) this.angle = angle;
  }

  destroy(): void {
    for (const joint of this.joints) this.game.world.destroyJoint(joint);
    this.joints = [];
    for (const body of this.extraBodies) this.game.world.destroyBody(body);
    this.extraBodies = [];
    super.destroy();
  }

  /** The line this part is drawn along, for clicking on it in the editor. */
  protected outline(): Point[] {
    return [this.worldA(), this.worldB()];
  }

  hitTest(x: number, y: number, tolerance = 0): boolean {
    if (this.body && super.hitTest(x, y, tolerance)) return true;
    const pts = this.outline();
    const reach = tolerance + 0.12;
    if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= reach;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (segmentDistance({ x, y }, pts[i], pts[i + 1]) <= reach) return true;
    }
    return false;
  }

  getBounds(): Bounds | null {
    let bounds = this.body ? super.getBounds() : null;
    for (const p of this.outline()) {
      bounds = unionBounds(bounds, { minX: p.x - 0.15, minY: p.y - 0.15, maxX: p.x + 0.15, maxY: p.y + 0.15 });
    }
    return bounds;
  }
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
