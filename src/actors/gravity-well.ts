import { Circle } from "planck";
import { Actor } from "../core/Actor";
import { colorField } from "../core/fields";
import type { Gravity, GravitySource } from "../core/gravity";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { scaleUniform } from "../core/scaling";

interface GravityWellProps extends Record<string, number | string | boolean> {
  radius: number;
  strength: number;
  replace: boolean;
  planet: number;
  color: string;
}

/**
 * Pulls everything within reach toward its middle, like a little planet.
 * A negative strength pushes things away instead.
 */
export class GravityWell extends Actor<GravityWellProps> implements GravitySource {
  build(): void {
    const p = this.props;
    this.body = this.own(
      this.game.world.createBody({ type: "static", position: { x: this.x, y: this.y }, angle: this.angle }),
    );
    this.body.createFixture(new Circle(p.radius), { isSensor: true });
    if (p.planet > 0) this.body.createFixture(new Circle(Math.min(p.planet, p.radius)), { friction: 0.8, restitution: 0.1 });
  }

  bendGravity(x: number, y: number, g: Gravity): Gravity {
    const p = this.props;
    const dx = this.x - x;
    const dy = this.y - y;
    const d = Math.hypot(dx, dy);
    if (d > p.radius || d < 1e-6) return g;
    // Ease off right at the middle so nothing jitters back and forth across it.
    const pull = p.strength * Math.min(1, d / 0.5);
    const gx = (dx / d) * pull;
    const gy = (dy / d) * pull;
    return p.replace ? { x: gx, y: gy } : { x: g.x + gx, y: g.y + gy };
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const p = this.props;
    const away = p.strength < 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = away ? "rgba(249,115,22,0.08)" : "rgba(139,92,246,0.08)";
    ctx.fill();
    // Rings that shrink toward the middle (or grow outward for a push) while playing.
    const rings = Math.max(2, Math.round(p.radius / 1.2));
    const phase = (this.game.time * 0.4) % 1;
    ctx.strokeStyle = away ? "rgba(234,88,12,0.35)" : "rgba(109,40,217,0.3)";
    ctx.lineWidth = 1.5 * r.px;
    for (let i = 0; i < rings; i++) {
      const t = (i + (away ? phase : 1 - phase)) / rings;
      const rr = Math.max(p.planet, 0.2) + t * (p.radius - Math.max(p.planet, 0.2));
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([6 * r.px, 4 * r.px]);
    ctx.strokeStyle = away ? "#ea580c" : "#7c3aed";
    ctx.beginPath();
    ctx.arc(this.x, this.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (p.planet > 0 && this.body) {
      // Only the solid planet, not the sensor around it.
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.min(p.planet, p.radius), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = 1.5 * r.px;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
    }
  }
}

const gravityWell: ActorDef = {
  type: "gravity-well",
  label: "Planet",
  category: "Course",
  icon: "🪐",
  description: "Pulls things toward its middle, like a little planet. Negative strength pushes them away.",
  scale: scaleUniform("radius", "planet"),
  props: [
    { key: "radius", label: "Reach", kind: "number", default: 5, min: 0.5, max: 100, step: 0.1, help: "How far out it pulls." },
    { key: "strength", label: "Strength", kind: "number", default: 10, min: -40, max: 40, step: 0.5 },
    { key: "planet", label: "Planet size", kind: "number", default: 1.5, min: 0, max: 50, step: 0.1, help: "The solid ball in the middle. 0 for none." },
    {
      key: "replace",
      label: "Ignore other gravity",
      kind: "boolean",
      default: true,
      help: "On: inside its reach only the planet pulls. Off: it pulls on top of the level's gravity.",
    },
    colorField("#16a34a"),
  ],
  variants: [{ label: "Pusher", icon: "✺", props: { strength: -10, planet: 0, radius: 3, replace: false } }],
  create: (game, data) => new GravityWell(game, data),
};

export default gravityWell;
