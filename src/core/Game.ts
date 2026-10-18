import { World, Vec2, type Body, type Contact } from "planck";
import { Actor, reserveId } from "./Actor";
import { EventBus } from "./events";
import { Input } from "./input";
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
  /** A fixed body for parts attached to "the world" rather than to another actor. */
  ground!: Body;
  /** Keys and sliders the player is using. Shared across reloads. */
  readonly input = new Input();
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
    this.ground = this.world.createBody({ type: "static" });
    // Build in layer order so connectors find the bodies they join, but keep
    // the level's own order in the actor list (it's the drawing order).
    const built = new Map<ActorData, Actor>();
    const order = [...level.actors].sort((a, b) => layerOf(a) - layerOf(b));
    for (const data of order) built.set(data, this.add(data));
    this.actors = level.actors.map((data) => built.get(data)!);
    // Store it back with every id and default filled in, so undo, reset and
    // saving all refer to the same actors.
    this.level = this.serialize();
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

  /**
   * Rebuild an actor from new data, keeping its place in the list and its id.
   * The editor uses this whenever a setting changes.
   */
  replace(actor: Actor, data: ActorData): Actor {
    const index = this.actors.indexOf(actor);
    if (index < 0) throw new Error(`Actor ${actor.id} is not in this game`);
    const dependents = this.collectDependents(actor);
    for (const d of [...dependents].reverse()) d.destroy();
    actor.destroy();
    const next = getActorDef(data.type).create(this, { ...data, id: actor.id });
    next.build();
    this.actors[index] = next;
    this.rebuildAll(dependents);
    return next;
  }

  /**
   * Rebuild everything attached to an actor (and everything attached to
   * those), so joints follow it after it moves.
   */
  rebuildDependents(actor: Actor): void {
    const dependents = this.collectDependents(actor);
    for (const d of [...dependents].reverse()) d.destroy();
    this.rebuildAll(dependents);
  }

  /** Everything attached to an actor, directly or through other parts, in build order. */
  private collectDependents(actor: Actor): Actor[] {
    const found: Actor[] = [];
    const seen = new Set([actor.id]);
    const visit = (id: string) => {
      for (const other of this.dependentsOf(id)) {
        if (seen.has(other.id)) continue;
        seen.add(other.id);
        found.push(other);
        visit(other.id);
      }
    };
    visit(actor.id);
    return found;
  }

  private rebuildAll(destroyed: Actor[]): void {
    for (const old of destroyed) {
      const next = getActorDef(old.type).create(this, old.serialize());
      next.transient = old.transient;
      next.build();
      this.actors[this.actors.indexOf(old)] = next;
    }
  }

  dependentsOf(id: string): Actor[] {
    return this.actors.filter((a) => a.dependsOn().includes(id));
  }

  /** Remove an actor right away, along with anything attached to it. Only safe outside of a physics step. */
  removeNow(actor: Actor): void {
    if (!this.actors.includes(actor)) return;
    this.actors = this.actors.filter((a) => a !== actor);
    for (const dependent of this.dependentsOf(actor.id)) this.removeNow(dependent);
    actor.destroy();
  }

  /**
   * Make the current actors the level's saved state, so reset returns here.
   * The editor calls this after every change. Ignored once play has started.
   */
  commit(): void {
    if (this.started) return;
    this.level = this.serialize();
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
    for (const actor of this.pendingRemoval) this.removeNow(actor);
    this.pendingRemoval.clear();
  }

  private clear(): void {
    // The old world is simply dropped, which frees every body and joint in it.
    this.actors = [];
    this.pendingRemoval.clear();
    this.time = 0;
    this.accumulator = 0;
    this.running = false;
    this.started = false;
  }
}

function layerOf(data: ActorData): number {
  return getActorDef(data.type).layer ?? 0;
}
