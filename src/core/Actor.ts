import type { Body, Contact } from "planck";
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
  }

  /** Create physics bodies, fixtures and joints. Called once when added. */
  abstract build(): void;

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

  serialize(): ActorData {
    return {
      id: this.id,
      type: this.type,
      x: this.x,
      y: this.y,
      angle: this.angle,
      props: structuredClone(this.props),
    };
  }

  /** Attach this actor to a body so contacts can find their way back to it. */
  protected own(body: Body): Body {
    body.setUserData(this);
    return body;
  }
}

/** Ensure ids generated later never collide with ids loaded from a file. */
export function reserveId(id: string): void {
  const match = /-(\d+)$/.exec(id);
  if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
}
