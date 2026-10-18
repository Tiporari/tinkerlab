import type { LevelData } from "../core/types";

/** Undo and redo as a list of level snapshots. Levels are small, so whole copies are fine. */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  private current: string | null = null;

  constructor(private readonly limit = 200) {}

  /** Start over from this level, forgetting all undo steps. */
  reset(level: LevelData): void {
    this.past = [];
    this.future = [];
    this.current = JSON.stringify(level);
  }

  /** Record a new state. Does nothing if nothing actually changed. */
  push(level: LevelData): void {
    const next = JSON.stringify(level);
    if (next === this.current) return;
    if (this.current !== null) this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }

  undo(): LevelData | null {
    const prev = this.past.pop();
    if (prev === undefined || this.current === null) return null;
    this.future.push(this.current);
    this.current = prev;
    return JSON.parse(prev) as LevelData;
  }

  redo(): LevelData | null {
    const next = this.future.pop();
    if (next === undefined || this.current === null) return null;
    this.past.push(this.current);
    this.current = next;
    return JSON.parse(next) as LevelData;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
