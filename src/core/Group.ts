import { Actor, unionBounds, type Bounds } from "./Actor";
import type { Game } from "./Game";
import type { ActorData, Props } from "./types";

/**
 * Base class for actors made of other actors: assemblies and welded shapes.
 * Its children are ordinary actors in the game with their own ids, so parts
 * can still attach to them; the group just remembers which ones it holds.
 * In a level file the children are nested inside the group's data.
 */
export abstract class Group<P extends Props = Props> extends Actor<P> {
  /** Ids of the actors directly inside this group, in order. */
  childIds: string[];
  /** True for a group that merges its pieces into its own body (a weld), unless it's open in the editor. */
  get merges(): boolean {
    return false;
  }

  constructor(game: Game, data: ActorData) {
    super(game, data);
    this.childIds = (data.children ?? []).map((c) => c.id).filter((id): id is string => !!id);
  }

  children(): Actor[] {
    return this.childIds.map((id) => this.game.find(id)).filter((a): a is Actor => !!a);
  }

  /** Everything inside, at any depth, outermost first. */
  descendants(): Actor[] {
    const out: Actor[] = [];
    for (const child of this.children()) {
      out.push(child);
      if (child instanceof Group) out.push(...child.descendants());
    }
    return out;
  }

  /** A group is rebuilt whenever one of its children is. */
  dependsOn(): string[] {
    return [...this.childIds];
  }

  /** Put the group's position in the middle of what it holds, for the panel and for saved files. */
  protected centerOnChildren(): void {
    const b = this.getBounds();
    if (!b) return;
    this.x = Math.round(((b.minX + b.maxX) / 2) * 1000) / 1000;
    this.y = Math.round(((b.minY + b.maxY) / 2) * 1000) / 1000;
  }

  hitTest(x: number, y: number, tolerance = 0): boolean {
    if (this.body) return super.hitTest(x, y, tolerance);
    return this.children().some((c) => c.hitTest(x, y, tolerance));
  }

  getBounds(): Bounds | null {
    if (this.body) return super.getBounds();
    let bounds: Bounds | null = null;
    for (const child of this.children()) {
      const b = child.getBounds();
      if (b) bounds = unionBounds(bounds, b);
    }
    return bounds;
  }

  serialize(): ActorData {
    const data = super.serialize();
    data.children = this.children().map((c) => c.serialize());
    return data;
  }
}
