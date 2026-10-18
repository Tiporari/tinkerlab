import { Actor, type Bounds } from "../core/Actor";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface StartProps extends Record<string, number | string | boolean> {
  count: number;
  interval: number;
  radius: number;
  bounciness: number;
  colors: string;
}

/** Where the run begins. When play starts it drops marbles, one every `interval` seconds. */
export class Start extends Actor<StartProps> {
  private spawned = 0;
  private timer = 0;
  private active = false;

  build(): void {
    // A marker only: nothing for marbles to hit.
  }

  onPlay(): void {
    this.active = true;
    this.spawned = 0;
    this.timer = 0;
    this.dropMarble();
  }

  update(dt: number): void {
    if (!this.active || this.spawned >= this.props.count) return;
    this.timer += dt;
    if (this.timer >= this.props.interval) {
      this.timer -= this.props.interval;
      this.dropMarble();
    }
  }

  hitTest(x: number, y: number, tolerance = 0): boolean {
    return Math.hypot(x - this.x, y - this.y) <= this.markerRadius + tolerance;
  }

  getBounds(): Bounds {
    const r = this.markerRadius;
    return { minX: this.x - r, minY: this.y - r, maxX: this.x + r, maxY: this.y + r };
  }

  private get markerRadius(): number {
    return Math.max(0.3, this.props.radius * 1.8);
  }

  private dropMarble(): void {
    const colors = this.props.colors.split(",").map((c) => c.trim()).filter(Boolean);
    const marble = this.game.spawn({
      type: "ball",
      x: this.x,
      y: this.y,
      props: {
        radius: this.props.radius,
        bounciness: this.props.bounciness,
        color: colors[this.spawned % Math.max(1, colors.length)] ?? "#3b82f6",
      },
    });
    marble.tags.add("marble");
    this.spawned++;
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const radius = this.markerRadius;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.setLineDash([6 * r.px, 4 * r.px]);
    ctx.lineWidth = 2 * r.px;
    ctx.strokeStyle = "#16a34a";
    ctx.stroke();
    ctx.setLineDash([]);
    r.drawLabel("START", this.x, this.y + radius + 14 * r.px, "#16a34a");
  }
}

const start: ActorDef = {
  type: "start",
  label: "Start",
  category: "Course",
  icon: "▶",
  description: "Drops marbles when you press play.",
  props: [
    { key: "count", label: "Marbles", kind: "number", default: 1, min: 1, max: 100, step: 1 },
    { key: "interval", label: "Seconds apart", kind: "number", default: 1, min: 0.1, max: 30, step: 0.1 },
    { key: "radius", label: "Marble size", kind: "number", default: 0.25, min: 0.05, max: 2, step: 0.05 },
    { key: "bounciness", label: "Marble bounciness", kind: "number", default: 0.3, min: 0, max: 1, step: 0.05 },
    { key: "colors", label: "Marble colors", kind: "string", default: "#3b82f6,#ef4444,#f59e0b,#10b981" },
  ],
  create: (game, data) => new Start(game, data),
};

export default start;
