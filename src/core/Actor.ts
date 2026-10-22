import { AABB, Transform, Vec2, type Body, type Contact } from "planck";
import type { Game } from "./Game";
import type { Renderer } from "./Renderer";
import { getActorDef, resolveProps, type ActorDef } from "./registry";
import type { ActorData, Props } from "./types";

let nextId = 1;

/**
 * Base class for everything that lives in a level. Subclasses build their
 * physics bodies in `build()` and may override any of the optional hooks.
 */
export abstract class Actor<P extends Props = Props> {
  readonly id: string;
  readonly type: string;
  readonly def: ActorDef;
  x: number;
  y: number;
  angle: number;
  props: P;
  /** The main physics body, if this actor has one. */
  body: Body | null = null;
  /** Spawned while playing (like marbles from a start point), so never saved. */
  transient = false;
  /** Free-form labels other actors can check, e.g. "marble". */
  readonly tags = new Set<string>();

  constructor(
    readonly game: Game,
    data: ActorData,
  ) {
    this.def = getActorDef(data.type);
    this.id = data.id ?? `${data.type}-${nextId++}`;
    this.type = data.type;
    this.x = data.x;
    this.y = data.y;
    this.angle = data.angle ?? 0;
    this.props = resolveProps(this.def, data.props) as P;
    for (const tag of data.tags ?? []) this.tags.add(tag);
  }

  /** Ids of other actors this one is attached to. They are rebuilt or removed together. */
  dependsOn(): string[] {
    return [];
  }

  /** Create physics bodies, fixtures and joints. Called once when added. */
  abstract build(): void;

  /** Drawn (and picked) behind everything else, like a background picture. */
  get behind(): boolean {
    return false;
  }

  /** Called when the simulation starts playing. */
  onPlay?(): void;

  /** Called every physics step while playing. `dt` is in seconds. */
  update?(dt: number): void;

  /** Called when one of this actor's fixtures starts touching another's. */
  onContact?(other: Actor | null, contact: Contact): void;

  /** Draw this actor. The default draws its main body's shapes. */
  draw(r: Renderer): void {
    if (this.body) {
      r.drawBody(this.body, String(this.props.color ?? "#888"));
    }
  }

  /** Remove bodies from the world. Subclasses with extra bodies should extend this. */
  destroy(): void {
    if (this.body) {
      this.game.world.destroyBody(this.body);
      this.body = null;
    }
  }

  /**
   * Is the world point (x, y) on this actor? `tolerance` is in meters and
   * makes thin shapes like paths easier to click. Used by the editor.
   */
  hitTest(x: number, y: number, tolerance = 0): boolean {
    if (!this.body) return false;
    const point = Vec2(x, y);
    const local = this.body.getLocalPoint(point);
    for (let f = this.body.getFixtureList(); f; f = f.getNext()) {
      if (f.testPoint(point)) return true;
      if (tolerance <= 0) continue;
      const shape = f.getShape() as unknown as ShapeInternals;
      switch (f.getShape().getType()) {
        case "circle":
          if (Math.hypot(local.x - shape.m_p!.x, local.y - shape.m_p!.y) <= shape.m_radius + tolerance) return true;
          break;
        case "edge":
          if (distanceToSegment(local, shape.m_vertex1!, shape.m_vertex2!) <= tolerance) return true;
          break;
        case "polygon":
        case "chain": {
          const v = shape.m_vertices!;
          const closed = f.getShape().getType() === "polygon";
          for (let i = 0; i < v.length - (closed ? 0 : 1); i++) {
            if (distanceToSegment(local, v[i], v[(i + 1) % v.length]) <= tolerance) return true;
          }
          break;
        }
      }
    }
    return false;
  }

  /** World-space box around the actor, for the editor's selection outline. */
  getBounds(): Bounds | null {
    if (!this.body) return null;
    let bounds: Bounds | null = null;
    for (let f = this.body.getFixtureList(); f; f = f.getNext()) {
      const childCount = f.getShape().getChildCount();
      for (let i = 0; i < childCount; i++) {
        const aabb = f.getAABB(i);
        bounds = unionBounds(bounds, {
          minX: aabb.lowerBound.x,
          minY: aabb.lowerBound.y,
          maxX: aabb.upperBound.x,
          maxY: aabb.upperBound.y,
        });
      }
    }
    return bounds;
  }

  /** Box around the actor in its body's own frame, as if it weren't turned. Used for scale handles. */
  localBounds(): Bounds | null {
    if (!this.body) return null;
    const identity = Transform.identity();
    const aabb = new AABB();
    let bounds: Bounds | null = null;
    for (let f = this.body.getFixtureList(); f; f = f.getNext()) {
      const shape = f.getShape();
      for (let i = 0; i < shape.getChildCount(); i++) {
        shape.computeAABB(aabb, identity, i);
        // Polygons carry a thin skin; leave it out so a 2 m block measures 2 m.
        const skin = shape.getType() === "circle" ? 0 : shape.getRadius();
        bounds = unionBounds(bounds, {
          minX: aabb.lowerBound.x + skin,
          minY: aabb.lowerBound.y + skin,
          maxX: aabb.upperBound.x - skin,
          maxY: aabb.upperBound.y - skin,
        });
      }
    }
    return bounds;
  }

  /** Move to a new spot without rebuilding. Used while dragging in the editor. */
  setPose(x: number, y: number, angle = this.angle): void {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.body?.setTransform(Vec2(x, y), angle);
    this.body?.setAwake(true);
  }

  serialize(): ActorData {
    const data: ActorData = {
      id: this.id,
      type: this.type,
      x: this.x,
      y: this.y,
      angle: this.angle,
      props: structuredClone(this.props),
    };
    if (this.savedTags.length) data.tags = [...this.savedTags];
    return data;
  }

  /** Tags that belong in the level file. Runtime tags like "marble" on spawned marbles are left out. */
  get savedTags(): string[] {
    return this.transient ? [] : [...this.tags];
  }

  /** Attach this actor to a body so contacts can find their way back to it. */
  protected own(body: Body): Body {
    body.setUserData(this);
    return body;
  }
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function unionBounds(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

type Point = { x: number; y: number };

/** Planck keeps shape geometry in these fields; the public API has no getters for them. */
interface ShapeInternals {
  m_radius: number;
  m_p?: Point;
  m_vertex1?: Point;
  m_vertex2?: Point;
  m_vertices?: Point[];
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ensure ids generated later never collide with ids loaded from a file. */
/** A new id that no actor has used yet, like "block-12". */
export function freshId(type: string): string {
  return `${type}-${nextId++}`;
}

export function reserveId(id: string): void {
  const match = /-(\d+)$/.exec(id);
  if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
}
