import { World, Vec2, type Contact } from "planck";
import { Actor, reserveId } from "./Actor";
import { EventBus } from "./events";
import { getActorDef } from "./registry";
import type { ActorData, CameraData, LevelData } from "./types";

export interface GameEvents extends Record<string, unknown> {
  /** A marble (or anything tagged "marble") reached a finish. */
  finish: { finish: Actor; actor: Actor; time: number };
  spawn: { actor: Actor };
  play: undefined;
  pause: undefined;
  reset: undefined;
  load: { level: LevelData };
}

export const STEP = 1 / 60;

/**
 * Owns the physics world and every actor in it. Knows nothing about drawing
 * or input, so it also runs headless in tests.
 */
export class Game {
  world!: World;
  actors: Actor[] = [];
  readonly events = new EventBus<GameEvents>();
  level!: LevelData;
  /** Seconds of simulated time since play started. */
  time = 0;
  running = false;
  /** True once play has started since the last reset. */
  started = false;

  private accumulator = 0;
  private pendingRemoval = new Set<Actor>();

  constructor(level: LevelData) {
    this.load(level);
  }

  /** Replace the whole world with the contents of a level. */
  load(level: LevelData): void {
    this.clear();
    this.level = structuredClone(level);
    this.world = new World({ gravity: Vec2(level.gravity[0], level.gravity[1]) });
    this.world.on("begin-contact", (c) => this.handleContact(c));
    for (const data of level.actors) this.add(data);
    this.events.emit("load", { level: this.level });
  }

  /** Throw away the running simulation and rebuild from the level. */
  reset(): void {
    this.load(this.level);
    this.events.emit("reset", undefined);
  }

  play(): void {
    if (this.running) return;
    this.running = true;
    if (!this.started) {
      this.started = true;
      for (const actor of [...this.actors]) actor.onPlay?.();
    }
    this.events.emit("play", undefined);
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.events.emit("pause", undefined);
  }

  /** Add a saved actor to the level. */
  add(data: ActorData): Actor {
    const actor = getActorDef(data.type).create(this, data);
    reserveId(actor.id);
    actor.build();
    this.actors.push(actor);
    return actor;
  }

  /** Add an actor that exists only while playing. */
  spawn(data: ActorData): Actor {
    const actor = this.add(data);
    actor.transient = true;
    this.events.emit("spawn", { actor });
    if (this.started) actor.onPlay?.();
    return actor;
  }

  /** Remove an actor. Safe to call from inside contact callbacks. */
  remove(actor: Actor): void {
    this.pendingRemoval.add(actor);
  }

  find(id: string): Actor | undefined {
    return this.actors.find((a) => a.id === id);
  }

  /** Advance by real elapsed time, running as many fixed steps as needed. */
  tick(dt: number): void {
    if (!this.running) return;
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= STEP) {
      this.step();
      this.accumulator -= STEP;
    }
  }

  /** Run exactly one fixed physics step. */
  step(): void {
    for (const actor of this.actors) actor.update?.(STEP);
    this.world.step(STEP);
    this.time += STEP;
    this.flushRemovals();
  }

  /** The level as it should be saved: only non-transient actors. */
  serialize(camera?: CameraData): LevelData {
    return {
      ...structuredClone(this.level),
      camera: camera ?? this.level.camera,
      actors: this.actors.filter((a) => !a.transient).map((a) => a.serialize()),
    };
  }

  private handleContact(contact: Contact): void {
    const a = contact.getFixtureA().getBody().getUserData() as Actor | null;
    const b = contact.getFixtureB().getBody().getUserData() as Actor | null;
    a?.onContact?.(b, contact);
    b?.onContact?.(a, contact);
  }

  private flushRemovals(): void {
    if (this.pendingRemoval.size === 0) return;
    for (const actor of this.pendingRemoval) {
      actor.destroy();
      this.actors = this.actors.filter((a) => a !== actor);
    }
    this.pendingRemoval.clear();
  }

  private clear(): void {
    for (const actor of this.actors) actor.destroy();
    this.actors = [];
    this.pendingRemoval.clear();
    this.time = 0;
    this.accumulator = 0;
    this.running = false;
    this.started = false;
  }
}
