import { Box } from "planck";
import { Actor } from "../core/Actor";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { scaleBox } from "../core/scaling";

interface FinishProps extends Record<string, number | string | boolean> {
  width: number;
  height: number;
  collect: boolean;
  counts: string;
}

/** A goal zone. Anything with the tag named in `counts` (normally "marble") that enters it counts as finished. */
export class Finish extends Actor<FinishProps> {
  readonly finished = new Set<string>();
  private flash = 0;

  build(): void {
    this.body = this.own(
      this.game.world.createBody({ type: "static", position: { x: this.x, y: this.y }, angle: this.angle }),
    );
    this.body.createFixture(new Box(this.props.width / 2, this.props.height / 2), { isSensor: true });
  }

  onContact(other: Actor | null): void {
    // A wheel of a cart tagged "player" counts as the cart.
    const owner = other ? this.game.tagged(other, this.props.counts) : null;
    if (!owner || this.finished.has(owner.id)) return;
    this.finished.add(owner.id);
    this.flash = 0.6;
    this.game.events.emit("finish", { finish: this, actor: owner, time: this.game.time });
    if (this.props.collect) this.game.remove(owner);
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const { width: w, height: h } = this.props;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // Checkered flag pattern.
    const cell = Math.min(w, h) / 4;
    for (let i = 0; i * cell < w; i++) {
      for (let j = 0; j * cell < h; j++) {
        ctx.fillStyle = (i + j) % 2 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.5)";
        ctx.fillRect(-w / 2 + i * cell, -h / 2 + j * cell, Math.min(cell, w - i * cell), Math.min(cell, h - j * cell));
      }
    }
    ctx.lineWidth = 2 * r.px;
    ctx.strokeStyle = this.flash > 0 ? "#f59e0b" : "#111";
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.rotate(-this.angle);
    ctx.translate(-this.x, -this.y);
    r.drawLabel(`FINISH ${this.finished.size || ""}`.trim(), this.x, this.y + h / 2 + 14 * r.px, "#111");
  }
}

const finish: ActorDef = {
  type: "finish",
  label: "Finish",
  category: "Course",
  icon: "⚑",
  description: "Counts marbles that reach it.",
  scale: scaleBox(),
  props: [
    { key: "width", label: "Width", kind: "number", default: 2, min: 0.2, max: 100, step: 0.1 },
    { key: "height", label: "Height", kind: "number", default: 1.5, min: 0.2, max: 100, step: 0.1 },
    { key: "collect", label: "Remove marbles that finish", kind: "boolean", default: false },
    {
      key: "counts",
      label: "Counts tag",
      kind: "string",
      default: "marble",
      help: 'What reaches this finish: anything with this tag. Marbles from a start are tagged "marble"; tag your vehicle "player".',
    },
  ],
  create: (game, data) => new Finish(game, data),
};

export default finish;
