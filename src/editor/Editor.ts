import type { Actor } from "../core/Actor";
import type { Camera } from "../core/Camera";
import { Connector } from "../core/Connector";
import { EventBus } from "../core/events";
import type { Game } from "../core/Game";
import type { Renderer } from "../core/Renderer";
import { getActorDef } from "../core/registry";
import type { ActorData, LevelData } from "../core/types";
import { snap, simplifyPath, tidy, type Pt } from "./geometry";
import { History } from "./History";

/** "select", or "place:<actor type>" while placing a new actor. */
export type ToolId = "select" | `place:${string}`;

export interface EditorEvents extends Record<string, unknown> {
  /** The selected actor changed, or the selected actor was rebuilt. */
  selection: Actor | null;
  tool: ToolId;
  /** The level changed in a way worth saving. */
  change: LevelData;
}

type Gesture =
  | { kind: "move"; id: string; start: Pt; orig: Pt; moved: boolean }
  | { kind: "rotate"; id: string; origAngle: number }
  | { kind: "pan"; last: Pt }
  | { kind: "click"; at: Pt }
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "connect"; a: Pt; b: Pt }
  | { kind: "path"; points: Pt[] };

const DEG = Math.PI / 180;
/** How close (in screen pixels) a click must be to count as touching something. */
const HIT_PIXELS = 6;
const HANDLE_PIXELS = 26;

/**
 * Turns pointer and keyboard input into changes to the level while the game is
 * in build mode. Every change goes through `commit()`, which updates the
 * level, records an undo step and tells the UI.
 */
export class Editor {
  readonly events = new EventBus<EditorEvents>();
  readonly history = new History();
  tool: ToolId = "select";
  selectedId: string | null = null;
  snapOn = true;
  grid = 0.25;

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
  }

  /** Editing is only allowed before play starts. */
  get enabled(): boolean {
    return !this.game.started;
  }

  get selected(): Actor | null {
    if (!this.selectedId) return null;
    return this.game.find(this.selectedId) ?? null;
  }

  setTool(tool: ToolId): void {
    this.cancelGesture();
    this.tool = tool;
    this.canvas.style.cursor = tool === "select" ? "" : "crosshair";
    this.events.emit("tool", tool);
  }

  select(actor: Actor | null): void {
    this.selectedId = actor?.id ?? null;
    this.events.emit("selection", actor);
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
    this.game.load(level);
    this.history.reset(this.game.level);
    this.select(null);
    this.events.emit("change", this.game.level);
  }

  create(data: ActorData): Actor {
    const actor = this.game.add(data);
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
    const actor = this.selected;
    if (!actor || !this.enabled) return;
    this.game.removeNow(actor);
    this.select(null);
    this.commit();
  }

  duplicateSelected(): void {
    const actor = this.selected;
    if (!actor || !this.enabled) return;
    const data = actor.serialize();
    delete data.id;
    data.x = tidy(data.x + 0.5);
    data.y = tidy(data.y - 0.5);
    this.create(data);
  }

  rotateSelected(delta: number): void {
    if (!this.canTurn(this.selected)) return;
    this.updateSelected((d) => {
      d.angle = tidy((d.angle ?? 0) + delta, 4);
    });
  }

  nudgeSelected(dx: number, dy: number): void {
    if (!this.canMove(this.selected)) return;
    this.updateSelected((d) => {
      d.x = tidy(d.x + dx);
      d.y = tidy(d.y + dy);
    });
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
    const keep = this.selectedId;
    this.game.load(level);
    this.select(keep ? (this.game.find(keep) ?? null) : null);
    this.events.emit("change", this.game.level);
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
    if (mod) return false;
    const step = e.shiftKey ? 1 : 15;
    const nudge = e.shiftKey ? 0.05 : this.snapOn ? this.grid : 0.1;
    switch (e.key) {
      case "Delete":
      case "Backspace":
        this.deleteSelected();
        return true;
      case "Escape":
        if (this.tool !== "select") this.setTool("select");
        else this.select(null);
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
        return !!this.selected;
      case "ArrowRight":
        this.nudgeSelected(nudge, 0);
        return !!this.selected;
      case "ArrowUp":
        this.nudgeSelected(0, nudge);
        return !!this.selected;
      case "ArrowDown":
        this.nudgeSelected(0, -nudge);
        return !!this.selected;
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

  /** The topmost saved actor under a world point. */
  actorAt(p: Pt): Actor | null {
    const tolerance = HIT_PIXELS / this.camera.zoom;
    for (let i = this.game.actors.length - 1; i >= 0; i--) {
      const actor = this.game.actors[i];
      if (!actor.transient && actor.hitTest(p.x, p.y, tolerance)) return actor;
    }
    return null;
  }

  /** The topmost things with a physics body under a point, for attaching parts to. */
  bodiesAt(p: Pt): Actor[] {
    const tolerance = HIT_PIXELS / this.camera.zoom;
    return this.game.actors
      .filter((a) => a.body && !a.transient && a.hitTest(p.x, p.y, tolerance))
      .reverse();
  }

  canMove(actor: Actor | null): boolean {
    return !!actor && (actor.def.poseFields ?? ["x", "y", "angle"]).includes("x");
  }

  canTurn(actor: Actor | null): boolean {
    return !!actor && (actor.def.poseFields ?? ["x", "y", "angle"]).includes("angle");
  }

  private handlePosition(actor: Actor): Pt | null {
    if (!this.canTurn(actor)) return null;
    const b = actor.getBounds();
    if (!b) return null;
    return { x: actor.x, y: b.maxY + HANDLE_PIXELS / this.camera.zoom };
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
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
      const sel = this.selected;
      const handle = sel ? this.handlePosition(sel) : null;
      if (sel && handle && Math.hypot(p.x - handle.x, p.y - handle.y) * this.camera.zoom < 10) {
        this.gesture = { kind: "rotate", id: sel.id, origAngle: sel.angle };
        return;
      }
      const hit = this.actorAt(p);
      if (hit) {
        this.select(hit);
        this.gesture = this.canMove(hit)
          ? { kind: "move", id: hit.id, start: p, orig: { x: hit.x, y: hit.y }, moved: false }
          : null;
      } else {
        this.select(null);
        this.gesture = { kind: "pan", last: this.screen(e) };
      }
      return;
    }

    const def = getActorDef(this.tool.slice("place:".length));
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

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.gesture) return;
    const g = this.gesture;
    const p = this.world(e);
    switch (g.kind) {
      case "move": {
        const actor = this.game.find(g.id);
        if (!actor) return;
        const target = this.snapPt({ x: g.orig.x + p.x - g.start.x, y: g.orig.y + p.y - g.start.y });
        if (target.x !== actor.x || target.y !== actor.y) {
          g.moved = true;
          actor.setPose(target.x, target.y);
          this.game.rebuildDependents(actor);
        }
        break;
      }
      case "rotate": {
        const actor = this.game.find(g.id);
        if (!actor) return;
        let angle = Math.atan2(p.y - actor.y, p.x - actor.x) - Math.PI / 2;
        // A part's angle is measured on the thing it's attached to.
        if (actor instanceof Connector) angle -= actor.bodyA.getAngle();
        if (this.snapOn && !e.shiftKey) angle = Math.round(angle / (15 * DEG)) * 15 * DEG;
        actor.setPose(actor.x, actor.y, tidy(angle, 4));
        this.game.rebuildDependents(actor);
        break;
      }
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
        if (g.moved) this.commitPose(g.id);
        break;
      case "rotate":
        this.commitPose(g.id);
        break;
      case "click": {
        const placement = getActorDef(this.placingType()).placement ?? "click";
        if (placement === "pin") this.finishPin(g.at);
        else if (placement === "attach") this.finishAttach(g.at);
        else this.create({ type: this.placingType(), x: g.at.x, y: g.at.y });
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

  /** Rebuild after a drag so the change is saved and undoable. */
  private commitPose(id: string): void {
    const actor = this.game.find(id);
    if (!actor) return;
    const next = this.game.replace(actor, actor.serialize());
    this.commit();
    this.events.emit("selection", next);
  }

  private finishLine(a: Pt, b: Pt): void {
    const type = this.placingType();
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.2) {
      this.create({ type, x: a.x, y: a.y });
      return;
    }
    this.create({
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
    this.create({
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
    this.create({
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
    this.create({
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
    this.create({
      type: this.placingType(),
      x: tidy(p.x),
      y: tidy(p.y),
      props: { a: target?.id ?? "", ax: anchor.x, ay: anchor.y },
    });
  }

  private placingType(): string {
    return this.tool.slice("place:".length);
  }

  private cancelGesture(): void {
    const g = this.gesture;
    if (g && (g.kind === "move" || g.kind === "rotate")) {
      // Put it back where it was.
      const actor = this.game.find(g.id);
      if (actor) {
        if (g.kind === "move") actor.setPose(g.orig.x, g.orig.y);
        else actor.setPose(actor.x, actor.y, g.origAngle);
        this.game.rebuildDependents(actor);
      }
    }
    this.gesture = null;
    this.pointerId = null;
  }

  // ---- Drawing -----------------------------------------------------------

  drawOverlay(r: Renderer): void {
    if (!this.enabled) return;
    const { ctx } = r;
    const px = r.px;

    const sel = this.selected;
    if (sel) {
      const b = sel.getBounds();
      if (b) {
        const pad = 4 * px;
        ctx.setLineDash([5 * px, 4 * px]);
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = "#2563eb";
        ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
        ctx.setLineDash([]);
        const h = this.handlePosition(sel);
        if (h) {
          ctx.beginPath();
          ctx.moveTo(h.x, b.maxY + pad);
          ctx.lineTo(h.x, h.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(h.x, h.y, 6 * px, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    const g = this.gesture;
    if (g?.kind === "line") {
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
        r.drawLabel(`${length.toFixed(2)} m`, (g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2 + 18 * px, "#2563eb", 12);
      }
    } else if (g?.kind === "connect") {
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = "#2563eb";
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const end of [g.a, g.b]) {
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4 * px, 0, Math.PI * 2);
        ctx.fillStyle = this.bodiesAt(end).length ? "#2563eb" : "#fff";
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
