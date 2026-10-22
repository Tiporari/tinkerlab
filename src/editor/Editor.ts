import type { Actor, Bounds } from "../core/Actor";
import { unionBounds } from "../core/Actor";
import type { Camera } from "../core/Camera";
import { Connector } from "../core/Connector";
import { EventBus } from "../core/events";
import { Group } from "../core/Group";
import type { Game } from "../core/Game";
import type { Renderer } from "../core/Renderer";
import { getActorDef, listActorDefs, type ActorDef } from "../core/registry";
import { cloneTree, dataBounds } from "../core/tree";
import type { ActorData, LevelData } from "../core/types";
import { snap, simplifyPath, tidy, type Pt } from "./geometry";
import { History } from "./History";

/** "select", "place:<actor type>" while placing a new actor, or "stamp:<name>" while placing a saved assembly. */
export type ToolId = "select" | `place:${string}` | `stamp:${string}`;

export interface EditorEvents extends Record<string, unknown> {
  /** The selection changed, or a selected actor was rebuilt. Carries the actor when exactly one is selected. */
  selection: Actor | null;
  tool: ToolId;
  /** Went into or came out of a group. Carries the group's id, or null at the top level. */
  scope: string | null;
  /** The level changed in a way worth saving. */
  change: LevelData;
}

/** Saved data of everything a drag can change, so each step starts fresh from it and cancel can put it back. */
type Originals = Map<string, ActorData>;

/** Which end of a part is being dragged. "pin" moves both ends of a hinge together. */
type End = "a" | "b" | "pin";

/**
 * A box to put handles on: `box` is in a frame centred on (x, y) and turned
 * by `angle`. One actor uses its own body's frame; a group uses the world's.
 */
interface Frame {
  x: number;
  y: number;
  angle: number;
  box: Bounds;
}

type Handle =
  | { kind: "rotate"; at: Pt }
  /** sx / sy say which side it sits on: -1 left or bottom, 1 right or top, 0 the middle. */
  | { kind: "scale"; at: Pt; sx: -1 | 0 | 1; sy: -1 | 0 | 1 }
  | { kind: "end"; at: Pt; end: End };

type Gesture =
  | { kind: "move"; start: Pt; orig: Originals; lead: string; moved: boolean; pick: string | null }
  | { kind: "rotate"; center: Pt; from: number; orig: Originals; single: boolean }
  | { kind: "scale"; frame: Frame; handle: Extract<Handle, { kind: "scale" }>; grab: Pt; orig: Originals; id: string | null }
  | { kind: "end"; id: string; end: End; at: Pt }
  | { kind: "marquee"; a: Pt; b: Pt; add: boolean }
  | { kind: "pan"; last: Pt }
  | { kind: "click"; at: Pt }
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "connect"; a: Pt; b: Pt }
  | { kind: "path"; points: Pt[] };

const DEG = Math.PI / 180;
/** How close (in screen pixels) a click must be to count as touching something. */
const HIT_PIXELS = 6;
const HANDLE_PIXELS = 26;
/** How close (in screen pixels) a click must be to grab a handle. */
const GRAB_PIXELS = 9;
/** Space (in screen pixels) between a thing and its selection box. */
const PAD_PIXELS = 5;

/**
 * Turns pointer and keyboard input into changes to the level while the game is
 * in build mode. Every change goes through `commit()`, which updates the
 * level, records an undo step and tells the UI.
 */
export class Editor {
  readonly events = new EventBus<EditorEvents>();
  readonly history = new History();
  tool: ToolId = "select";
  /** Ids of everything selected, in the order they were picked. */
  selection: string[] = [];
  snapOn = true;
  grid = 0.25;
  /** While true (Space held), drags pan the view and the editor stays out of the way. */
  panKey = false;
  /** The group being edited from inside (after a double-click), or null at the top level. */
  scope: string | null = null;
  /** What the stamp tool drops: saved actors centred on 0, 0. */
  private stampActors: ActorData[] = [];

  private gesture: Gesture | null = null;
  private pointerId: number | null = null;

  constructor(
    readonly game: Game,
    readonly camera: Camera,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.history.reset(game.level);
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("pointercancel", () => this.cancelGesture());
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e as PointerEvent));
  }

  /** Editing is only allowed before play starts. */
  get enabled(): boolean {
    return !this.game.started;
  }

  /** The selected actor's id when exactly one thing is selected. */
  get selectedId(): string | null {
    return this.selection.length === 1 ? this.selection[0] : null;
  }

  /** The selected actor when exactly one thing is selected. */
  get selected(): Actor | null {
    const id = this.selectedId;
    return id ? (this.game.find(id) ?? null) : null;
  }

  get selectedActors(): Actor[] {
    return this.selection.map((id) => this.game.find(id)).filter((a): a is Actor => !!a);
  }

  /** The selected actor when exactly one thing that isn't a group is selected. Handles treat a group like several things. */
  private solo(): Actor | null {
    const one = this.selected;
    return one instanceof Group ? null : one;
  }

  /** The selection with everything inside selected groups. */
  private expanded(): Actor[] {
    return this.selectedActors.flatMap((a) => (a instanceof Group ? [a, ...a.descendants()] : [a]));
  }

  /** Is this actor directly inside the group being edited (or at the top level, when none is)? */
  inScope(actor: Actor): boolean {
    return (this.game.parentOf(actor.id)?.id ?? null) === this.scope;
  }

  /**
   * The thing a click on `actor` picks at the current level: the actor itself,
   * or the group around it that sits at this level. Null if it's outside the
   * group being edited.
   */
  private lift(actor: Actor): Actor | null {
    let current: Actor = actor;
    for (;;) {
      if (this.inScope(current)) return current;
      const parent = this.game.parentOf(current.id);
      if (!parent) return null;
      current = parent;
    }
  }

  setTool(tool: ToolId): void {
    this.cancelGesture();
    this.tool = tool;
    this.canvas.style.cursor = tool === "select" ? "" : "crosshair";
    this.events.emit("tool", tool);
  }

  select(actor: Actor | null): void {
    this.setSelection(actor ? [actor.id] : []);
  }

  setSelection(ids: string[]): void {
    this.selection = [...new Set(ids)].filter((id) => this.game.find(id));
    this.events.emit("selection", this.selected);
  }

  selectAll(): void {
    this.setSelection(this.game.actors.filter((a) => !a.transient && this.inScope(a)).map((a) => a.id));
  }

  // ---- Groups --------------------------------------------------------------

  /**
   * Group the selection. "assembly" keeps parts separate (each still has its
   * own settings); "weld" fuses shapes into one solid body. Parts that only
   * hang off the selected things join an assembly too. Returns a reason it
   * can't be done, or null when it worked.
   */
  groupSelected(type: "assembly" | "weld"): string | null {
    if (!this.enabled) return null;
    const ids = type === "assembly" ? this.withParts(this.selection) : new Set(this.selection);
    const members = this.game.actors.filter((a) => ids.has(a.id));
    if (type === "weld") {
      if (members.length < 2) return "Pick two or more shapes to weld together.";
      const bad = members.find((a) => a instanceof Connector || (!a.body && !(a instanceof Group && a.merges)));
      if (bad) return `${bad.def.label} can't be welded. Only shapes like blocks, balls and paths can.`;
    } else if (!members.length) {
      return "Pick something to group first.";
    }
    const group = this.game.makeGroup(type, members.map((m) => m.id));
    this.commit();
    this.select(group);
    return null;
  }

  /** Take apart the selected groups, one level. Their pieces stay selected. */
  ungroupSelected(): void {
    if (!this.enabled) return;
    const groups = this.selectedActors.filter((a): a is Group => a instanceof Group);
    if (!groups.length) return;
    const freed = groups.flatMap((g) => this.game.ungroup(g).map((a) => a.id));
    this.commit();
    this.setSelection([...this.selection.filter((id) => this.game.find(id)), ...freed]);
  }

  /** Go inside a group to pick and change its pieces. A weld comes apart until you leave. */
  enterGroup(group: Group): void {
    if (!this.enabled) return;
    this.cancelGesture();
    if (group.merges) {
      this.game.openGroups.add(group.id);
      this.game.replace(group, group.serialize());
    }
    this.scope = group.id;
    this.select(null);
    this.events.emit("scope", this.scope);
  }

  /** Come out of the group being edited, one level; or all the way with `all`. */
  exitGroup(all = false): void {
    if (!this.scope) return;
    while (this.scope) {
      const group = this.game.find(this.scope);
      const id = this.scope;
      this.scope = group ? (this.game.parentOf(group.id)?.id ?? null) : null;
      if (group && this.game.openGroups.delete(id)) this.game.replace(group, group.serialize());
      if (!all) {
        this.select(group ?? null);
        break;
      }
    }
    if (all) this.select(null);
    this.events.emit("scope", this.scope);
  }

  /** Ids plus every part that only hangs off things among them, like a cart's wheels. */
  private withParts(ids: string[]): Set<string> {
    const set = new Set(ids);
    const inside = (id: string) => {
      for (let g = this.game.parentOf(id); g; g = this.game.parentOf(g.id)) if (set.has(g.id)) return true;
      return set.has(id);
    };
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of this.game.actors) {
        if (set.has(a.id) || a.transient || !(a instanceof Connector) || !this.inScope(a)) continue;
        const targets = [a.props.a, a.props.b].filter(Boolean);
        if (targets.length && targets.every(inside)) {
          set.add(a.id);
          grew = true;
        }
      }
    }
    return set;
  }

  /**
   * The selection as saved data, ready for the inventory: centred on 0, 0,
   * and wrapped in an assembly if it's more than one thing.
   */
  selectionData(): ActorData[] | null {
    const ids = this.withParts(this.selection);
    const top = this.game.actors.filter((a) => ids.has(a.id) && !a.transient);
    if (!top.length) return null;
    let list = top.map((a) => a.serialize());
    if (list.length > 1) list = [{ type: "assembly", x: 0, y: 0, props: { name: "Assembly" }, children: list }];
    const b = dataBounds(list);
    const center = b ? { x: tidy(snap((b.minX + b.maxX) / 2, 0.05)), y: tidy(snap((b.minY + b.maxY) / 2, 0.05)) } : { x: 0, y: 0 };
    return cloneTree(list, { x: -center.x, y: -center.y });
  }

  /** Get ready to drop copies of saved actors (centred on 0, 0) wherever the next click is. */
  startStamp(name: string, actors: ActorData[]): void {
    this.stampActors = structuredClone(actors);
    this.setTool(`stamp:${name}`);
  }

  /** Drop a copy of the stamp tool's actors centred on a point. */
  stampAt(p: Pt): Actor[] {
    const roots = this.game.addTree(cloneTree(this.stampActors, p));
    this.adopt(roots);
    this.commit();
    this.setSelection(roots.map((r) => r.id));
    return roots;
  }

  /** New things made while inside a group go into that group, if they can. */
  private adopt(actors: Actor[]): void {
    const group = this.scope ? this.game.find(this.scope) : null;
    if (!(group instanceof Group)) return;
    const fits = actors.filter((a) => group.type !== "weld" || (!(a instanceof Connector) && (a.body || a instanceof Group)));
    if (!fits.length) return;
    group.childIds.push(...fits.map((a) => a.id));
    this.game.replace(group, group.serialize());
  }

  // ---- Changes -----------------------------------------------------------

  /** Save the current state as the level and record an undo step. */
  commit(): void {
    this.game.commit();
    this.history.push(this.game.level);
    this.events.emit("change", this.game.level);
  }

  /** Replace the whole level, e.g. when opening a file. Clears undo. */
  loadLevel(level: LevelData): void {
    this.cancelGesture();
    this.scope = null;
    this.game.openGroups.clear();
    this.events.emit("scope", null);
    this.game.load(level);
    this.history.reset(this.game.level);
    this.select(null);
    this.events.emit("change", this.game.level);
  }

  /**
   * Make an actor from a file, like a picture, with its middle at `at` (the
   * middle of the view if not given), and select it.
   */
  async importFile(file: File, at?: Pt): Promise<Actor> {
    if (!this.enabled) throw new Error("Stop playing first, then add it.");
    const def = importerFor(file);
    if (!def?.importFile) throw new Error("TinkerLab doesn't know what to do with that kind of file.");
    const props = await def.importFile.read(file);
    const p = at ?? { x: this.camera.x, y: this.camera.y };
    this.setTool("select");
    return this.create({ type: def.type, x: tidy(p.x), y: tidy(p.y), props });
  }

  create(data: ActorData): Actor {
    const actor = this.game.add(data);
    this.adopt([actor]);
    this.commit();
    this.select(actor);
    return actor;
  }

  /**
   * Change the selected actor's data and rebuild it. Pass `record: false` for
   * continuous changes like dragging a slider, then call `commit()` at the end.
   */
  updateSelected(change: (data: ActorData) => void, record = true): void {
    const actor = this.selected;
    if (!actor || !this.enabled) return;
    const data = actor.serialize();
    change(data);
    const next = this.game.replace(actor, data);
    if (record) this.commit();
    this.events.emit("selection", next);
  }

  deleteSelected(): void {
    const actors = this.selectedActors;
    if (!actors.length || !this.enabled) return;
    for (const actor of actors) this.game.removeNow(actor);
    this.select(null);
    this.commit();
  }

  /**
   * Copy everything selected, a little down and to the right. Parts that only
   * hang off copied things come too, so copying a cart copies its wheels, and
   * copied parts attach to the copies.
   */
  duplicateSelected(): void {
    if (!this.selection.length || !this.enabled) return;
    const ids = this.withParts(this.selection);
    const originals = this.game.actors.filter((a) => ids.has(a.id) && this.inScope(a)).map((a) => a.serialize());
    const roots = this.game.addTree(cloneTree(originals, { x: 0.5, y: -0.5 }));
    this.adopt(roots);
    this.commit();
    this.setSelection(roots.map((r) => r.id));
  }

  /** Turn the selection by `delta` radians: one thing about itself, several about their middle. */
  rotateSelected(delta: number): void {
    if (!this.enabled) return;
    const single = this.solo();
    if (single) {
      if (!this.canTurn(single)) return;
      this.updateSelected((d) => {
        d.angle = tidy((d.angle ?? 0) + delta, 4);
      });
      return;
    }
    const bounds = this.selectionBounds();
    if (!bounds) return;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    this.transformGroup(this.capture(), { center, turn: delta });
    this.commit();
  }

  nudgeSelected(dx: number, dy: number): void {
    if (!this.enabled || !this.movers().length) return;
    this.transformGroup(this.capture(), { shift: { x: dx, y: dy } });
    this.commit();
  }

  undo(): void {
    const level = this.enabled ? this.history.undo() : null;
    if (level) this.restore(level);
  }

  redo(): void {
    const level = this.enabled ? this.history.redo() : null;
    if (level) this.restore(level);
  }

  private restore(level: LevelData): void {
    const keep = this.selection;
    this.game.load(level);
    if (this.scope && !this.game.find(this.scope)) {
      this.scope = null;
      this.events.emit("scope", null);
    }
    this.setSelection(keep);
    this.events.emit("change", this.game.level);
  }

  // ---- Moving, turning and scaling many things ----------------------------

  canMove(actor: Actor | null): boolean {
    return !!actor && (actor.def.poseFields ?? ["x", "y", "angle"]).includes("x");
  }

  canTurn(actor: Actor | null): boolean {
    return !!actor && (actor.def.poseFields ?? ["x", "y", "angle"]).includes("angle");
  }

  /** Selected things (and things inside selected groups) that have their own position. Parts on them follow along. */
  private movers(): Actor[] {
    return this.expanded().filter((a) => !(a instanceof Group) && this.canMove(a));
  }

  /**
   * Snapshot everything a move, turn or scale of the selection changes: the
   * selection itself and every part attached to the things being moved.
   */
  private capture(): Originals {
    // Groups rebuild by themselves when their pieces do.
    const ids = new Set(this.expanded().filter((a) => !(a instanceof Group)).map((a) => a.id));
    for (const mover of this.movers()) {
      for (const part of this.game.dependentsOf(mover.id)) if (!(part instanceof Group)) ids.add(part.id);
    }
    const orig: Originals = new Map();
    for (const actor of this.game.actors) if (ids.has(actor.id)) orig.set(actor.id, actor.serialize());
    return orig;
  }

  /** Rebuild each captured actor from a changed copy of its original data, parents first. */
  private rebuildFrom(orig: Originals, change: (data: ActorData, actor: Actor) => void): void {
    const order = [...orig.values()].sort((a, b) => (getActorDef(a.type).layer ?? 0) - (getActorDef(b.type).layer ?? 0));
    for (const original of order) {
      const actor = this.game.find(original.id!);
      if (!actor) continue;
      const data = structuredClone(original);
      change(data, actor);
      this.game.replace(actor, data);
    }
  }

  /**
   * Move, turn (about `center`) and grow (about `center`) the selection from
   * its captured state. Parts follow their bodies; ends of selected parts that
   * are pinned to the world move with everything else.
   */
  private transformGroup(orig: Originals, t: { shift?: Pt; center?: Pt; turn?: number; grow?: number }): void {
    const shift = t.shift ?? { x: 0, y: 0 };
    const center = t.center ?? { x: 0, y: 0 };
    const turn = t.turn ?? 0;
    const grow = t.grow ?? 1;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const point = (p: Pt): Pt => {
      const dx = (p.x - center.x) * grow;
      const dy = (p.y - center.y) * grow;
      return { x: center.x + dx * cos - dy * sin + shift.x, y: center.y + dx * sin + dy * cos + shift.y };
    };
    const selected = new Set(this.expanded().map((a) => a.id));
    const movers = new Set(this.movers().map((a) => a.id));
    this.rebuildFrom(orig, (data, actor) => {
      const def = actor.def;
      if (movers.has(actor.id)) {
        const p = point(data);
        data.x = tidy(p.x);
        data.y = tidy(p.y);
        if (turn && this.canTurn(actor)) data.angle = tidy((data.angle ?? 0) + turn, 4);
        if (grow !== 1 && data.props) scaleProps(def, data, grow, grow);
      }
      if (actor instanceof Connector && data.props) {
        for (const end of ["a", "b"] as const) {
          const target = data.props[end] as string;
          if (!target && selected.has(actor.id)) this.moveWorldAnchor(data, end, point);
          else if (movers.has(target) && grow !== 1) scaleAnchor(data, end, grow, grow);
        }
        if (selected.has(actor.id) && grow !== 1) scaleProps(def, data, grow, grow);
      }
    });
  }

  /** Change the world point a part's end is pinned to. */
  private moveWorldAnchor(data: ActorData, end: "a" | "b", move: (p: Pt) => Pt): void {
    const props = data.props!;
    const p = move({ x: Number(props[`${end}x`] ?? 0), y: Number(props[`${end}y`] ?? 0) });
    props[`${end}x`] = tidy(p.x);
    props[`${end}y`] = tidy(p.y);
  }

  selectionBounds(): Bounds | null {
    let bounds: Bounds | null = null;
    for (const actor of this.selectedActors) {
      const b = actor.getBounds();
      if (b) bounds = unionBounds(bounds, b);
    }
    return bounds;
  }

  // ---- Handles -------------------------------------------------------------

  /** The box the scale handles sit on, or null if the selection can't be scaled. */
  private scaleFrame(): Frame | null {
    const single = this.solo();
    if (single) {
      const box = single.def.scale ? single.localBounds() : null;
      if (!box || !single.body) return null;
      const p = single.body.getPosition();
      return { x: p.x, y: p.y, angle: single.body.getAngle(), box };
    }
    if (!this.movers().length) return null;
    const box = this.selectionBounds();
    return box ? { x: 0, y: 0, angle: 0, box } : null;
  }

  private handles(): Handle[] {
    if (!this.selection.length) return [];
    const zoom = this.camera.zoom;
    const pad = PAD_PIXELS / zoom;
    const list: Handle[] = [];
    const single = this.solo();

    if (single instanceof Connector) {
      const placement = single.def.placement;
      if (placement === "connect") {
        list.push({ kind: "end", at: single.worldA(), end: "a" }, { kind: "end", at: single.worldB(), end: "b" });
      } else if (placement === "attach") {
        list.push({ kind: "end", at: single.worldA(), end: "a" });
      } else if (placement === "pin") {
        list.push({ kind: "end", at: single.worldA(), end: "pin" });
      }
    }

    const frame = this.scaleFrame();
    if (frame) {
      const uniform = single ? single.def.scale?.axes === "uniform" : true;
      const b = frame.box;
      // On a thin thing like a ramp, the corners crowd together, so it gets edge handles only.
      const thinX = (b.maxX - b.minX) * zoom < 20;
      const thinY = (b.maxY - b.minY) * zoom < 20;
      for (const sx of [-1, 0, 1] as const) {
        for (const sy of [-1, 0, 1] as const) {
          if (sx === 0 && sy === 0) continue;
          const edge = sx === 0 || sy === 0;
          // Middle-of-edge handles stretch one way only, so shapes that keep their proportions don't get them.
          if (edge && (uniform || (thinX && thinY))) continue;
          if (!edge && !uniform && thinX !== thinY) continue;
          const local = {
            x: sx < 0 ? b.minX - pad : sx > 0 ? b.maxX + pad : (b.minX + b.maxX) / 2,
            y: sy < 0 ? b.minY - pad : sy > 0 ? b.maxY + pad : (b.minY + b.maxY) / 2,
          };
          list.push({ kind: "scale", at: toWorld(frame, local), sx, sy });
        }
      }
    }

    const rotate = this.rotateHandle();
    if (rotate) list.push({ kind: "rotate", at: rotate });
    return list;
  }

  private rotateHandle(): Pt | null {
    const single = this.solo();
    if (single && !this.canTurn(single)) return null;
    if (!single && !this.movers().some((a) => this.canTurn(a))) return null;
    const b = single ? single.getBounds() : this.selectionBounds();
    if (!b) return null;
    const x = single ? single.x : (b.minX + b.maxX) / 2;
    return { x, y: b.maxY + HANDLE_PIXELS / this.camera.zoom };
  }

  private handleAt(p: Pt): Handle | null {
    const reach = GRAB_PIXELS / this.camera.zoom;
    for (const h of this.handles()) {
      if (Math.hypot(p.x - h.at.x, p.y - h.at.y) <= reach) return h;
    }
    return null;
  }

  // ---- Keyboard ----------------------------------------------------------

  /** Returns true if the key did something, so the caller can stop it. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && key === "y") {
      this.redo();
      return true;
    }
    if (mod && key === "d") {
      this.duplicateSelected();
      return true;
    }
    if (mod && key === "a") {
      this.selectAll();
      return true;
    }
    if (mod && key === "g") {
      if (e.shiftKey) this.ungroupSelected();
      else this.groupSelected("assembly");
      return true;
    }
    if (!mod && e.key === "Enter" && this.selected instanceof Group) {
      this.enterGroup(this.selected);
      return true;
    }
    if (mod) return false;
    const step = e.shiftKey ? 1 : 15;
    const nudge = e.shiftKey ? 0.05 : this.snapOn ? this.grid : 0.1;
    const any = this.selection.length > 0;
    switch (e.key) {
      case "Delete":
      case "Backspace":
        this.deleteSelected();
        return true;
      case "Escape":
        if (this.gesture) this.cancelGesture();
        else if (this.tool !== "select") this.setTool("select");
        else if (this.selection.length || !this.scope) this.select(null);
        else this.exitGroup();
        return true;
      case "q":
      case "Q":
        this.rotateSelected(step * DEG);
        return true;
      case "e":
      case "E":
        this.rotateSelected(-step * DEG);
        return true;
      case "g":
      case "G":
        this.snapOn = !this.snapOn;
        this.events.emit("tool", this.tool);
        return true;
      case "ArrowLeft":
        this.nudgeSelected(-nudge, 0);
        return any;
      case "ArrowRight":
        this.nudgeSelected(nudge, 0);
        return any;
      case "ArrowUp":
        this.nudgeSelected(0, nudge);
        return any;
      case "ArrowDown":
        this.nudgeSelected(0, -nudge);
        return any;
    }
    return false;
  }

  // ---- Pointer -----------------------------------------------------------

  private world(e: PointerEvent): Pt {
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    return { x, y };
  }

  private screen(e: PointerEvent): Pt {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private snapPt(p: Pt): Pt {
    const g = this.snapOn ? this.grid : 0;
    return { x: tidy(snap(p.x, g)), y: tidy(snap(p.y, g)) };
  }

  /**
   * The topmost saved thing under a world point, at the level being edited:
   * a click on a piece of a group picks the group, unless you're inside it.
   * Things outside the group being edited count as nothing.
   */
  actorAt(p: Pt): Actor | null {
    return this.hitAt(p).actor;
  }

  private hitAt(p: Pt): { actor: Actor | null; outside: boolean } {
    const tolerance = HIT_PIXELS / this.camera.zoom;
    let outside = false;
    // Topmost first, the way they're drawn.
    const actors = this.game.layered();
    for (let i = actors.length - 1; i >= 0; i--) {
      const actor = actors[i];
      if (actor.transient || actor instanceof Group || !actor.hitTest(p.x, p.y, tolerance)) continue;
      const picked = this.lift(actor);
      if (picked) return { actor: picked, outside: false };
      outside = true;
    }
    // A closed weld's pieces have no body of their own, so the weld itself is what gets hit.
    for (let i = actors.length - 1; i >= 0; i--) {
      const actor = actors[i];
      if (!(actor instanceof Group) || !actor.body || !actor.hitTest(p.x, p.y, tolerance)) continue;
      const picked = this.lift(actor);
      if (picked) return { actor: picked, outside: false };
      outside = true;
    }
    return { actor: null, outside };
  }

  private onDoubleClick(e: PointerEvent): void {
    if (!this.enabled || this.tool !== "select") return;
    const hit = this.hitAt(this.world(e));
    if (hit.actor instanceof Group) this.enterGroup(hit.actor);
    else if (!hit.actor && this.scope) this.exitGroup();
  }

  /** The topmost things with a physics body under a point, for attaching parts to. */
  bodiesAt(p: Pt): Actor[] {
    const tolerance = HIT_PIXELS / this.camera.zoom;
    return this.game
      .layered()
      .filter((a) => a.body && !a.transient && a.hitTest(p.x, p.y, tolerance))
      .reverse();
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled || this.panKey) return;
    if (this.pointerId !== null) {
      // A second finger means pinch-zoom, so drop whatever the first started.
      this.cancelGesture();
      return;
    }
    if (e.button !== 0) return;
    const p = this.world(e);
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    if (this.tool === "select") {
      this.gesture = this.startSelectGesture(e, p);
      return;
    }
    if (this.tool.startsWith("stamp:")) {
      this.gesture = { kind: "click", at: this.snapPt(p) };
      return;
    }

    const def = getActorDef(this.placingType());
    switch (def.placement ?? "click") {
      case "click":
        this.gesture = { kind: "click", at: this.snapPt(p) };
        break;
      case "drag-line": {
        const a = this.snapPt(p);
        this.gesture = { kind: "line", a, b: a };
        break;
      }
      case "draw-path":
        this.gesture = { kind: "path", points: [p] };
        break;
      case "connect": {
        const a = this.bodiesAt(p).length ? p : this.snapPt(p);
        this.gesture = { kind: "connect", a, b: a };
        break;
      }
      case "pin":
      case "attach":
        this.gesture = { kind: "click", at: this.bodiesAt(p).length ? p : this.snapPt(p) };
        break;
    }
  }

  private startSelectGesture(e: PointerEvent, p: Pt): Gesture | null {
    const handle = this.handleAt(p);
    if (handle?.kind === "end") return { kind: "end", id: this.selection[0], end: handle.end, at: p };
    if (handle?.kind === "rotate") {
      const single = this.solo();
      const b = this.selectionBounds()!;
      const center = single ? { x: single.x, y: single.y } : { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      return { kind: "rotate", center, from: Math.atan2(p.y - center.y, p.x - center.x), orig: this.capture(), single: !!single };
    }
    if (handle?.kind === "scale") {
      const frame = this.scaleFrame()!;
      return { kind: "scale", frame, handle, grab: toLocal(frame, p), orig: this.capture(), id: this.solo()?.id ?? null };
    }

    let found = this.hitAt(p);
    if (found.outside && !found.actor && this.scope) {
      // A click outside the group being edited leaves it.
      this.exitGroup(true);
      found = this.hitAt(p);
    }
    const hit = found.actor;
    if (!hit) {
      if (e.pointerType === "touch") return { kind: "pan", last: this.screen(e) };
      if (!e.shiftKey) this.select(null);
      return { kind: "marquee", a: p, b: p, add: e.shiftKey };
    }
    if (e.shiftKey) {
      const has = this.selection.includes(hit.id);
      this.setSelection(has ? this.selection.filter((id) => id !== hit.id) : [...this.selection, hit.id]);
      return null;
    }
    const inGroup = this.selection.length > 1 && this.selection.includes(hit.id);
    if (!inGroup) this.select(hit);
    // Dragging a part that's bolted on moves where it's bolted.
    if (!inGroup && hit instanceof Connector) {
      const placement = hit.def.placement;
      if (placement === "attach") return { kind: "end", id: hit.id, end: "a", at: p };
      if (placement === "pin") return { kind: "end", id: hit.id, end: "pin", at: p };
    }
    if (!this.movers().length) return null;
    const lead = this.canMove(hit) ? hit : this.movers()[0];
    return { kind: "move", start: p, orig: this.capture(), lead: lead.id, moved: false, pick: inGroup ? hit.id : null };
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.gesture) return;
    const g = this.gesture;
    const p = this.world(e);
    switch (g.kind) {
      case "move": {
        const lead = g.orig.get(g.lead)!;
        // Snap the thing that was grabbed, and move everything else by the same amount.
        const target = this.snapPt({ x: lead.x + p.x - g.start.x, y: lead.y + p.y - g.start.y });
        const shift = { x: target.x - lead.x, y: target.y - lead.y };
        const current = this.game.find(g.lead);
        if (!current || (current.x === target.x && current.y === target.y)) break;
        if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) * this.camera.zoom < 3) break;
        g.moved = true;
        this.transformGroup(g.orig, { shift });
        break;
      }
      case "rotate": {
        let turn = Math.atan2(p.y - g.center.y, p.x - g.center.x) - g.from;
        const snapTurn = this.snapOn && !e.shiftKey;
        if (g.single) {
          const data = [...g.orig.values()].find((d) => d.id === this.selectedId)!;
          let angle = (data.angle ?? 0) + turn;
          if (snapTurn) angle = Math.round(angle / (15 * DEG)) * 15 * DEG;
          const actor = this.game.find(data.id!);
          if (actor) this.game.replace(actor, { ...structuredClone(data), angle: tidy(wrap(angle), 4) });
        } else {
          if (snapTurn) turn = Math.round(turn / (15 * DEG)) * 15 * DEG;
          this.transformGroup(g.orig, { center: g.center, turn });
        }
        break;
      }
      case "scale":
        this.dragScale(g, p, e.shiftKey);
        break;
      case "end":
        g.at = this.bodiesAt(p).length ? p : this.snapPt(p);
        break;
      case "marquee":
        g.b = p;
        break;
      case "pan": {
        const s = this.screen(e);
        this.camera.panBy(s.x - g.last.x, s.y - g.last.y);
        g.last = s;
        break;
      }
      case "line":
        g.b = this.snapPt(p);
        break;
      case "connect":
        g.b = this.bodiesAt(p).length ? p : this.snapPt(p);
        break;
      case "path": {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * this.camera.zoom > 4) g.points.push(p);
        break;
      }
      case "click":
        break;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    // The release point counts too, in case it moved since the last move event.
    this.onPointerMove(e);
    const g = this.gesture;
    this.gesture = null;
    this.pointerId = null;
    if (!g) return;
    switch (g.kind) {
      case "move":
        if (g.moved) this.finishTransform();
        else if (g.pick) this.setSelection([g.pick]);
        break;
      case "rotate":
      case "scale":
        this.finishTransform();
        break;
      case "end":
        this.finishEnd(g.id, g.end, g.at);
        break;
      case "marquee":
        this.finishMarquee(g.a, g.b, g.add);
        break;
      case "click": {
        if (this.tool.startsWith("stamp:")) {
          this.stampAt(g.at);
          break;
        }
        const placement = getActorDef(this.placingType()).placement ?? "click";
        if (placement === "pin") this.finishPin(g.at);
        else if (placement === "attach") this.finishAttach(g.at);
        else this.place({ type: this.placingType(), x: g.at.x, y: g.at.y });
        break;
      }
      case "connect":
        this.finishConnect(g.a, g.b);
        break;
      case "line":
        this.finishLine(g.a, g.b);
        break;
      case "path":
        this.finishPath(g.points);
        break;
      case "pan":
        break;
    }
  }

  /** Save a drag so it's undoable, and refresh the panel for the rebuilt actors. */
  private finishTransform(): void {
    this.commit();
    this.events.emit("selection", this.selected);
  }

  /**
   * Stretch from a scale handle. The opposite side stays put. One thing
   * stretches along its own turned axes; a group grows evenly.
   */
  private dragScale(g: Extract<Gesture, { kind: "scale" }>, p: Pt, keepShape: boolean): void {
    const { frame, handle } = g;
    const b = frame.box;
    // Measure from the box's edge, not from where on the handle it was grabbed.
    const edge = {
      x: handle.sx > 0 ? b.maxX : handle.sx < 0 ? b.minX : 0,
      y: handle.sy > 0 ? b.maxY : handle.sy < 0 ? b.minY : 0,
    };
    const local = toLocal(frame, p);
    const q = {
      x: local.x - (handle.sx ? g.grab.x - edge.x : 0),
      y: local.y - (handle.sy ? g.grab.y - edge.y : 0),
    };
    const single = g.id ? this.game.find(g.id) : null;
    const def = single?.def;
    // A part (like a wheel) grows about its own middle; everything else about the opposite side.
    const aboutMiddle = single instanceof Connector;
    const fixed = {
      x: aboutMiddle ? 0 : handle.sx > 0 ? b.minX : handle.sx < 0 ? b.maxX : 0,
      y: aboutMiddle ? 0 : handle.sy > 0 ? b.minY : handle.sy < 0 ? b.maxY : 0,
    };
    const corner = { x: handle.sx > 0 ? b.maxX : b.minX, y: handle.sy > 0 ? b.maxY : b.minY };
    let sx = 1;
    let sy = 1;
    const uniform = !single || def?.scale?.axes === "uniform" || (keepShape && handle.sx !== 0 && handle.sy !== 0);
    if (uniform) {
      const dx = corner.x - fixed.x;
      const dy = corner.y - fixed.y;
      const s = ((q.x - fixed.x) * dx + (q.y - fixed.y) * dy) / (dx * dx + dy * dy || 1);
      sx = sy = Math.max(0.05, s);
    } else {
      const stretch = (side: number, lo: number, hi: number, at: number, from: number) => {
        if (side === 0) return 1;
        let size = (at - from) * side;
        if (this.snapOn) size = snap(size, this.grid);
        return Math.max(Math.min(this.grid, hi - lo) / 2, size) / (hi - lo || 1);
      };
      sx = stretch(handle.sx, b.minX, b.maxX, q.x, fixed.x);
      sy = stretch(handle.sy, b.minY, b.maxY, q.y, fixed.y);
    }

    if (!single) {
      const center = toWorld(frame, fixed);
      this.transformGroup(g.orig, { center, grow: sx });
      return;
    }
    // Growing about the actor's own origin moves the fixed side, so shift it back.
    const back = toWorld({ ...frame, x: 0, y: 0 }, { x: fixed.x * (1 - sx), y: fixed.y * (1 - sy) });
    this.rebuildFrom(g.orig, (data, actor) => {
      if (actor.id === single.id) {
        if (!aboutMiddle) {
          data.x = tidy(data.x + back.x);
          data.y = tidy(data.y + back.y);
        }
        scaleProps(actor.def, data, sx, sy);
      } else if (actor instanceof Connector && data.props) {
        // Parts bolted to it stay at the same spot on it.
        for (const end of ["a", "b"] as const) if (data.props[end] === single.id) scaleAnchor(data, end, sx, sy);
      }
    });
  }

  /** Box select: everything that fits inside the box. */
  private finishMarquee(a: Pt, b: Pt, add: boolean): void {
    const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    if ((box.maxX - box.minX) * this.camera.zoom < 4 && (box.maxY - box.minY) * this.camera.zoom < 4) return;
    const inside = this.game.actors
      .filter((actor) => {
        const bb = actor.transient || !this.inScope(actor) ? null : actor.getBounds();
        return !!bb && bb.minX >= box.minX && bb.maxX <= box.maxX && bb.minY >= box.minY && bb.maxY <= box.maxY;
      })
      .map((actor) => actor.id);
    this.setSelection(add ? [...this.selection, ...inside] : inside);
  }

  /** Things a part's end could attach to at a point: not itself, and nothing that hangs off it. */
  private targetsAt(part: Actor, p: Pt): Actor[] {
    const off = new Set([part.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of this.game.actors) {
        if (!off.has(a.id) && a.dependsOn().some((id) => off.has(id))) {
          off.add(a.id);
          grew = true;
        }
      }
    }
    return this.bodiesAt(p).filter((a) => !off.has(a.id));
  }

  /** Drop a dragged part end: it attaches to whatever is under it now, or to the world. */
  private finishEnd(id: string, end: End, p: Pt): void {
    const part = this.game.find(id);
    if (!(part instanceof Connector)) return;
    const props = part.props;
    const targets = this.targetsAt(part, p);
    this.updateSelected((d) => {
      const next = d.props!;
      if (end === "pin") {
        // A hinge keeps joining the same things, at the new spot.
        const a = this.game.find(props.a);
        const b = this.game.find(props.b);
        const onA = a && targets.includes(a) ? a : targets[0];
        const onB = b && targets.includes(b) && b !== onA ? b : targets.find((t) => t !== onA);
        const anchorA = this.anchorOn(onA, p);
        const anchorB = this.anchorOn(onB, p);
        Object.assign(next, { a: onA?.id ?? "", b: onB?.id ?? "", ax: anchorA.x, ay: anchorA.y, bx: anchorB.x, by: anchorB.y });
        return;
      }
      const other = end === "a" ? props.b : props.a;
      const current = this.game.find(props[end]);
      // Stay on the same thing if it's still under the pointer; never join a part's two ends to one thing.
      const target = current && targets.includes(current) ? current : targets.find((t) => !other || t.id !== other);
      const anchor = this.anchorOn(target, p);
      next[end] = target?.id ?? "";
      next[`${end}x`] = anchor.x;
      next[`${end}y`] = anchor.y;
    });
  }

  private finishLine(a: Pt, b: Pt): void {
    const type = this.placingType();
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.2) {
      this.place({ type, x: a.x, y: a.y });
      return;
    }
    this.place({
      type,
      x: tidy((a.x + b.x) / 2),
      y: tidy((a.y + b.y) / 2),
      angle: tidy(Math.atan2(b.y - a.y, b.x - a.x), 4),
      props: { width: tidy(length) },
    });
  }

  private finishPath(raw: Pt[]): void {
    const points = simplifyPath(raw, 2 / this.camera.zoom);
    if (points.length < 2 || Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) < 0.05) return;
    const origin = { x: tidy(points[0].x), y: tidy(points[0].y) };
    this.place({
      type: this.placingType(),
      x: origin.x,
      y: origin.y,
      props: { points: points.map((p) => [tidy(p.x - origin.x), tidy(p.y - origin.y)]) },
    });
  }

  /** Where a world point sits on an actor's body, or the point itself for the world. */
  private anchorOn(actor: Actor | undefined, p: Pt): Pt {
    if (!actor?.body) return { x: tidy(p.x), y: tidy(p.y) };
    const local = actor.body.getLocalPoint(p);
    return { x: tidy(local.x), y: tidy(local.y) };
  }

  /** Join whatever is under each end of the drag (or the world) with a connector. */
  private finishConnect(a: Pt, b: Pt): void {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.1) return;
    const targetA = this.bodiesAt(a)[0];
    const targetB = this.bodiesAt(b).find((t) => t !== targetA);
    if (!targetA && !targetB) return; // two points on the world would do nothing
    const anchorA = this.anchorOn(targetA, a);
    const anchorB = this.anchorOn(targetB, b);
    this.place({
      type: this.placingType(),
      x: tidy(a.x),
      y: tidy(a.y),
      props: { a: targetA?.id ?? "", b: targetB?.id ?? "", ax: anchorA.x, ay: anchorA.y, bx: anchorB.x, by: anchorB.y },
    });
  }

  /** Pin the top two things under the point together (or the top one to the world). */
  private finishPin(p: Pt): void {
    const [top, below] = this.bodiesAt(p);
    if (!top) return;
    const anchorA = this.anchorOn(top, p);
    const anchorB = this.anchorOn(below, p);
    this.place({
      type: this.placingType(),
      x: tidy(p.x),
      y: tidy(p.y),
      props: { a: top.id, b: below?.id ?? "", ax: anchorA.x, ay: anchorA.y, bx: anchorB.x, by: anchorB.y },
    });
  }

  /** Bolt a part onto the top thing under the point, or onto the world. */
  private finishAttach(p: Pt): void {
    const target = this.bodiesAt(p)[0];
    const anchor = this.anchorOn(target, p);
    this.place({
      type: this.placingType(),
      x: tidy(p.x),
      y: tidy(p.y),
      props: { a: target?.id ?? "", ax: anchor.x, ay: anchor.y },
    });
  }

  /** The actor type being placed. Tool ids look like "place:polygon" or, for a palette preset, "place:polygon~0". */
  private placingType(): string {
    return this.tool.slice("place:".length).split("~")[0];
  }

  /** Create an actor from the current tool, with the palette preset's settings if there is one. */
  private place(data: ActorData): Actor {
    const variant = Number(this.tool.split("~")[1]);
    const preset = Number.isInteger(variant) ? getActorDef(data.type).variants?.[variant] : undefined;
    if (!preset) return this.create(data);
    return this.create({
      ...data,
      angle: data.angle ?? preset.angle,
      props: { ...preset.props, ...data.props },
    });
  }

  private cancelGesture(): void {
    const g = this.gesture;
    if (g && (g.kind === "move" || g.kind === "rotate" || g.kind === "scale")) {
      // Put everything back where it was.
      this.rebuildFrom(g.orig, () => {});
      this.events.emit("selection", this.selected);
    }
    this.gesture = null;
    this.pointerId = null;
  }

  // ---- Drawing -----------------------------------------------------------

  drawOverlay(r: Renderer): void {
    if (!this.enabled) return;
    const { ctx } = r;
    const px = r.px;
    const pad = PAD_PIXELS * px;
    const blue = "#2563eb";

    // The group being edited from inside.
    const scope = this.scope ? this.game.find(this.scope) : null;
    const sb = scope?.getBounds();
    if (scope && sb) {
      const big = 10 * px;
      ctx.setLineDash([8 * px, 5 * px]);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = "#d97706";
      ctx.strokeRect(sb.minX - big, sb.minY - big, sb.maxX - sb.minX + 2 * big, sb.maxY - sb.minY + 2 * big);
      ctx.setLineDash([]);
      const name = String(scope.props.name ?? scope.def.label);
      r.drawLabel(`Inside ${name} · Esc to leave`, (sb.minX + sb.maxX) / 2, sb.maxY + big + 12 * px, "#b45309", 12);
    }

    const actors = this.selectedActors;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = blue;
    ctx.setLineDash([5 * px, 4 * px]);
    for (const actor of actors) {
      const b = actor.getBounds();
      if (b) ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
    }
    ctx.setLineDash([]);

    // The box the handles sit on: the actor's own turned box, or one around the whole group.
    const frame = this.scaleFrame();
    if (frame) {
      const b = frame.box;
      const corners = [
        { x: b.minX - pad, y: b.minY - pad },
        { x: b.maxX + pad, y: b.minY - pad },
        { x: b.maxX + pad, y: b.maxY + pad },
        { x: b.minX - pad, y: b.maxY + pad },
      ].map((c) => toWorld(frame, c));
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
      ctx.closePath();
      ctx.lineWidth = px;
      ctx.stroke();
    }

    const rotate = this.rotateHandle();
    if (rotate) {
      const b = this.solo()?.getBounds() ?? this.selectionBounds();
      if (b) {
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(rotate.x, b.maxY + pad);
        ctx.lineTo(rotate.x, rotate.y);
        ctx.stroke();
      }
    }
    for (const h of this.handles()) {
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = blue;
      ctx.beginPath();
      if (h.kind === "scale") {
        const s = 4 * px;
        ctx.rect(h.at.x - s, h.at.y - s, 2 * s, 2 * s);
        ctx.fillStyle = "#fff";
      } else if (h.kind === "rotate") {
        ctx.arc(h.at.x, h.at.y, 6 * px, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
      } else {
        ctx.arc(h.at.x, h.at.y, 5 * px, 0, Math.PI * 2);
        ctx.fillStyle = "#f97316";
        ctx.strokeStyle = "#9a3412";
      }
      ctx.fill();
      ctx.stroke();
    }

    const g = this.gesture;
    if (g?.kind === "marquee") {
      ctx.fillStyle = "rgba(37,99,235,0.08)";
      ctx.fillRect(Math.min(g.a.x, g.b.x), Math.min(g.a.y, g.b.y), Math.abs(g.b.x - g.a.x), Math.abs(g.b.y - g.a.y));
      ctx.lineWidth = px;
      ctx.strokeStyle = blue;
      ctx.strokeRect(Math.min(g.a.x, g.b.x), Math.min(g.a.y, g.b.y), Math.abs(g.b.x - g.a.x), Math.abs(g.b.y - g.a.y));
    } else if (g?.kind === "end") {
      const part = this.game.find(g.id);
      if (part instanceof Connector) {
        const from = g.end === "a" && part.def.placement === "connect" ? part.worldB() : g.end === "b" ? part.worldA() : null;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = "#f97316";
        if (from) {
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(g.at.x, g.at.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(g.at.x, g.at.y, 5 * px, 0, Math.PI * 2);
        ctx.fillStyle = this.targetsAt(part, g.at).length ? "#f97316" : "#fff";
        ctx.fill();
        ctx.stroke();
      }
    } else if (g?.kind === "line") {
      const def = getActorDef(this.placingType());
      const thickness = Number(def.props.find((f) => f.key === "height")?.default ?? 0.3);
      ctx.lineWidth = thickness;
      ctx.lineCap = "butt";
      ctx.strokeStyle = "rgba(37,99,235,0.45)";
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      ctx.stroke();
      const length = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
      if (length > 0.2) {
        r.drawLabel(`${length.toFixed(2)} m`, (g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2 + 18 * px, blue, 12);
      }
    } else if (g?.kind === "connect") {
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = blue;
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const end of [g.a, g.b]) {
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4 * px, 0, Math.PI * 2);
        ctx.fillStyle = this.bodiesAt(end).length ? blue : "#fff";
        ctx.fill();
        ctx.stroke();
      }
    } else if (g?.kind === "path") {
      ctx.lineWidth = 4 * px;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(37,99,235,0.6)";
      ctx.beginPath();
      g.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
  }
}

function toWorld(f: Pick<Frame, "x" | "y" | "angle">, p: Pt): Pt {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return { x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c };
}

function toLocal(f: Frame, p: Pt): Pt {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Resize an actor's props with its type's scale rule, kept within each setting's limits. */
function scaleProps(def: ActorDef, data: ActorData, sx: number, sy: number): void {
  if (!def.scale || !data.props) return;
  const props = { ...Object.fromEntries(def.props.map((f) => [f.key, f.default])), ...data.props };
  def.scale.apply(props, sx, sy);
  for (const field of def.props) {
    const v = props[field.key];
    if (field.kind !== "number" || typeof v !== "number") continue;
    if (field.min !== undefined && v < field.min) props[field.key] = field.min;
    if (field.max !== undefined && v > field.max) props[field.key] = field.max;
  }
  data.props = props;
}

/** Keep a part's end at the same spot on a body that was resized. */
function scaleAnchor(data: ActorData, end: "a" | "b", sx: number, sy: number): void {
  const props = data.props!;
  props[`${end}x`] = tidy(Number(props[`${end}x`] ?? 0) * sx);
  props[`${end}y`] = tidy(Number(props[`${end}y`] ?? 0) * sy);
}

/** The actor type that can be made from this file, going by its type (e.g. image/png matches "image/*"). */
export function importerFor(file: { type: string }): ActorDef | undefined {
  return listActorDefs().find((def) =>
    def.importFile?.accept.split(",").some((pattern) => {
      const want = pattern.trim();
      return want.endsWith("/*") ? file.type.startsWith(want.slice(0, -1)) : file.type === want;
    }),
  );
}
