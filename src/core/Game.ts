import { World, Vec2, type Body, type Contact } from "planck";
import { Actor, reserveId } from "./Actor";
import { Connector } from "./Connector";
import { EventBus } from "./events";
import { Group } from "./Group";
import { Input } from "./input";
import { getActorDef } from "./registry";
import type { ActorData, CameraData, LevelData } from "./types";

export interface GameEvents extends Record<string, unknown> {
  /** A marble (or anything tagged "marble") reached a finish. */
  finish: { finish: Actor; actor: Actor; time: number };
  /** Something touched a hazard and was removed or sent back to its start. */
  hazard: { hazard: Actor; actor: Actor; result: "removed" | "respawned" };
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

  /**
   * Welded shapes the editor has opened to change their pieces. An open
   * weld leaves its pieces as separate bodies until it's closed again.
   */
  readonly openGroups = new Set<string>();

  private accumulator = 0;
  private pendingRemoval = new Set<Actor>();
  private pendingRespawn = new Set<string>();

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
    this.addTree(level.actors);
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

  /** Add a saved actor (and, for a group, everything in it) to the level. */
  add(data: ActorData): Actor {
    return this.addTree([data])[0];
  }

  /**
   * Add actors, with any groups' children, and build them all. The actor list
   * keeps the given order (it's the drawing order), with each group just
   * before its children; building goes in dependency order so parts find the
   * bodies they join and welds find their pieces. Returns the top-level actors.
   */
  addTree(list: ActorData[]): Actor[] {
    const made: Actor[] = [];
    const roots = this.instantiate(list, made);
    this.actors.push(...made);
    for (const actor of this.buildOrder(made)) actor.build();
    return roots;
  }

  private instantiate(list: ActorData[], out: Actor[]): Actor[] {
    return list.map((data) => {
      const { children, ...own } = data;
      const slot = out.length;
      out.push(null as unknown as Actor);
      const kids = children ? this.instantiate(children, out) : [];
      const stubs = kids.map((k) => ({ id: k.id, type: k.type, x: k.x, y: k.y }));
      const actor = getActorDef(own.type).create(this, children ? { ...own, children: stubs } : own);
      reserveId(actor.id);
      out[slot] = actor;
      return actor;
    });
  }

  /** Sort so everything comes after what it depends on, keeping layer order otherwise. */
  private buildOrder(list: Actor[]): Actor[] {
    const byId = new Map(list.map((a) => [a.id, a]));
    const done = new Set<string>();
    const order: Actor[] = [];
    const visit = (actor: Actor, path: Set<string>) => {
      if (done.has(actor.id) || path.has(actor.id)) return;
      path.add(actor.id);
      for (const id of actor.dependsOn()) {
        const dep = byId.get(id);
        if (dep) visit(dep, path);
      }
      path.delete(actor.id);
      done.add(actor.id);
      order.push(actor);
    };
    for (const actor of [...list].sort((a, b) => (a.def.layer ?? 0) - (b.def.layer ?? 0))) visit(actor, new Set());
    return order;
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
    for (const old of this.buildOrder(destroyed)) {
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
    // A group takes its children with it.
    if (actor instanceof Group) for (const child of actor.children()) this.removeNow(child);
    for (const dependent of this.dependentsOf(actor.id)) {
      // A group that held it just lets go; parts attached to it go too.
      if (dependent instanceof Group) this.forgetChild(dependent, actor.id);
      else this.removeNow(dependent);
    }
    actor.destroy();
  }

  private forgetChild(group: Group, id: string): void {
    group.childIds = group.childIds.filter((c) => c !== id);
    if (group.childIds.length === 0) this.removeNow(group);
    else this.replace(group, group.serialize());
  }

  // ---- Groups ----------------------------------------------------------------

  /** The group directly holding an actor, if any. */
  parentOf(id: string): Group | null {
    return (this.actors.find((a) => a instanceof Group && a.childIds.includes(id)) as Group | undefined) ?? null;
  }

  /**
   * The first of an actor, the groups holding it and the things it's attached
   * to that has a tag. A wheel on a cart counts as the cart; a block in an
   * assembly tagged "player" counts as the assembly.
   */
  tagged(actor: Actor, tag: string): Actor | null {
    if (!tag) return null;
    const seen = new Set<string>();
    const queue = [actor];
    while (queue.length) {
      const a = queue.shift()!;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      if (a.tags.has(tag)) return a;
      const parent = this.parentOf(a.id);
      if (parent) queue.push(parent);
      if (!(a instanceof Group)) {
        for (const id of a.dependsOn()) {
          const target = this.find(id);
          if (target) queue.push(target);
        }
      }
    }
    return null;
  }

  /**
   * Put actors into a new group of the given type ("assembly" or "weld"),
   * in the place of the first of them. Parts attached to shapes that get
   * welded are moved onto the weld, at the same spot.
   */
  makeGroup(type: string, ids: string[], props?: ActorData["props"]): Group {
    const members = this.actors.filter((a) => ids.includes(a.id));
    if (!members.length) throw new Error("Nothing to group");
    const parent = this.parentOf(members[0].id);
    const attached = this.attachedEnds(members);
    const group = getActorDef(type).create(this, {
      type,
      x: 0,
      y: 0,
      props,
      children: members.map((m) => ({ id: m.id, type: m.type, x: m.x, y: m.y })),
    });
    if (!(group instanceof Group)) throw new Error(`${type} is not a kind of group`);
    this.actors.splice(this.actors.indexOf(members[0]), 0, group);
    if (parent) parent.childIds = swapIds(parent.childIds, ids, [group.id]);
    group.build();
    this.reattach(attached, [group]);
    if (parent) this.replace(parent, parent.serialize());
    return group;
  }

  /** Take a group apart one level: its children take its place. Returns them. */
  ungroup(group: Group): Actor[] {
    const kids = group.children();
    const parent = this.parentOf(group.id);
    const attached = this.attachedEnds([group]);
    this.actors = this.actors.filter((a) => a !== group);
    group.destroy();
    this.openGroups.delete(group.id);
    if (parent) parent.childIds = swapIds(parent.childIds, [group.id], kids.map((k) => k.id));
    // Pieces of a weld get their own bodies back.
    for (const kid of kids) {
      if (!kid.body && !(kid instanceof Connector)) {
        kid.destroy();
        kid.build();
      }
    }
    this.reattach(attached, kids);
    if (parent) this.replace(parent, parent.serialize());
    return kids.map((k) => this.find(k.id) ?? k);
  }

  /** Ends of parts outside `members` that are attached to one of them, and where they are in the world. */
  private attachedEnds(members: Actor[]): { id: string; end: "a" | "b"; at: { x: number; y: number } }[] {
    const ids = new Set(members.map((m) => m.id));
    const ends: { id: string; end: "a" | "b"; at: { x: number; y: number } }[] = [];
    for (const a of this.actors) {
      if (!(a instanceof Connector) || ids.has(a.id)) continue;
      if (ids.has(a.props.a)) ends.push({ id: a.id, end: "a", at: a.worldA() });
      if (ids.has(a.props.b)) ends.push({ id: a.id, end: "b", at: a.worldB() });
    }
    return ends;
  }

  /**
   * Re-attach part ends whose body went away (welded in, or a weld taken
   * apart) to whichever of `onto` is under them, or the nearest.
   */
  private reattach(ends: { id: string; end: "a" | "b"; at: { x: number; y: number } }[], onto: Actor[]): void {
    for (const { id, end, at } of ends) {
      const part = this.find(id);
      const current = part ? this.find(String(part.props[end])) : undefined;
      if (!part || current?.body) continue;
      const candidates = onto.filter((o) => o.body);
      const target =
        candidates.find((o) => o.hitTest(at.x, at.y, 0.01)) ??
        candidates.sort((p, q) => dist(p.body!.getPosition(), at) - dist(q.body!.getPosition(), at))[0];
      if (!target?.body) continue;
      const local = target.body.getLocalPoint(at);
      const data = part.serialize();
      data.props = { ...data.props, [end]: target.id, [`${end}x`]: round(local.x), [`${end}y`]: round(local.y) };
      this.replace(part, data);
    }
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
    for (const actor of [...this.actors]) actor.update?.(STEP);
    this.world.step(STEP);
    this.time += STEP;
    this.flushRemovals();
    this.flushRespawns();
  }

  /**
   * Put an actor (and everything attached to it) back where the level starts
   * it, standing still. Safe to call from inside contact callbacks.
   */
  respawn(actor: Actor): void {
    this.pendingRespawn.add(actor.id);
  }

  /** The level as it should be saved: only non-transient actors. */
  serialize(camera?: CameraData): LevelData {
    return {
      ...structuredClone(this.level),
      camera: camera ?? this.level.camera,
      // Children are saved inside their groups.
      actors: this.actors.filter((a) => !a.transient && !this.parentOf(a.id)).map((a) => a.serialize()),
    };
  }

  private handleContact(contact: Contact): void {
    const a = contact.getFixtureA().getBody().getUserData() as Actor | null;
    const b = contact.getFixtureB().getBody().getUserData() as Actor | null;
    a?.onContact?.(b, contact);
    b?.onContact?.(a, contact);
  }

  private flushRespawns(): void {
    if (this.pendingRespawn.size === 0) return;
    for (const id of this.pendingRespawn) {
      const actor = this.find(id);
      const original = findData(this.level.actors, id);
      if (!actor || !original) continue;
      // A group goes back by putting each of its pieces back.
      for (const data of flattenData([original])) {
        const piece = data.children ? null : this.find(data.id!);
        if (piece) this.replace(piece, structuredClone(data));
      }
    }
    this.pendingRespawn.clear();
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
    this.pendingRespawn.clear();
    this.time = 0;
    this.accumulator = 0;
    this.running = false;
    this.started = false;
  }
}

/** Find an actor's saved data anywhere in a level, including inside groups. */
export function findData(list: ActorData[], id: string): ActorData | null {
  for (const data of list) {
    if (data.id === id) return data;
    const inside = data.children ? findData(data.children, id) : null;
    if (inside) return inside;
  }
  return null;
}

/** Every actor's data in a list, with groups' children after their group. */
export function flattenData(list: ActorData[]): ActorData[] {
  return list.flatMap((d) => [d, ...(d.children ? flattenData(d.children) : [])]);
}

function swapIds(list: string[], remove: string[], insert: string[]): string[] {
  const at = list.findIndex((id) => remove.includes(id));
  const kept = list.filter((id) => !remove.includes(id));
  kept.splice(at < 0 ? kept.length : Math.min(at, kept.length), 0, ...insert);
  return kept;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
