import { Box } from "planck";
import { Actor } from "../core/Actor";
import { gravityFromAngle, type Gravity, type GravitySource } from "../core/gravity";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { scaleBox } from "../core/scaling";

interface GravityZoneProps extends Record<string, number | string | boolean> {
  width: number;
  height: number;
  strength: number;
}

/**
 * An area with its own gravity. It pulls the way its arrows point, so turn
 * the zone to change the direction. Strength 0 makes it weightless.
 */
export class GravityZone extends Actor<GravityZoneProps> implements GravitySource {
  build(): void {
    this.body = this.own(
      this.game.world.createBody({ type: "static", position: { x: this.x, y: this.y }, angle: this.angle }),
    );
    this.body.createFixture(new Box(this.props.width / 2, this.props.height / 2), { isSensor: true });
  }

  bendGravity(x: number, y: number, g: Gravity): Gravity {
    // The point in the zone's own frame.
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const dx = x - this.x;
    const dy = y - this.y;
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    if (Math.abs(lx) > this.props.width / 2 || Math.abs(ly) > this.props.height / 2) return g;
    const [gx, gy] = gravityFromAngle(this.props.strength, this.angle);
    return { x: gx, y: gy };
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const { width: w, height: h, strength } = this.props;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    ctx.fillStyle = "rgba(139,92,246,0.12)";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (strength > 0) {
      // Arrows pointing the way it pulls, drifting faster for stronger gravity while playing.
      const gap = 1.2;
      const drift = (this.game.time * Math.min(strength, 30) * 0.15) % gap;
      ctx.strokeStyle = "rgba(109,40,217,0.45)";
      ctx.lineWidth = 0.06;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let ax = -w / 2 + gap / 2; ax < w / 2; ax += gap) {
        for (let ay = h / 2 + gap - drift; ay > -h / 2 - gap; ay -= gap) {
          ctx.moveTo(ax, ay + 0.3);
          ctx.lineTo(ax, ay - 0.3);
          ctx.moveTo(ax - 0.18, ay - 0.12);
          ctx.lineTo(ax, ay - 0.3);
          ctx.lineTo(ax + 0.18, ay - 0.12);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 1.5 * r.px;
    ctx.setLineDash([6 * r.px, 4 * r.px]);
    ctx.strokeStyle = "#7c3aed";
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    ctx.rotate(-this.angle);
    ctx.translate(-this.x, -this.y);
    if (strength === 0) r.drawLabel("NO GRAVITY", this.x, this.y, "#6d28d9", 11);
  }
}

const gravityZone: ActorDef = {
  type: "gravity-zone",
  label: "Gravity zone",
  category: "Course",
  icon: "⇩",
  description: "An area with its own gravity. Turn it to change which way is down; strength 0 floats.",
  scale: scaleBox(),
  props: [
    { key: "width", label: "Width", kind: "number", default: 4, min: 0.2, max: 200, step: 0.1 },
    { key: "height", label: "Height", kind: "number", default: 4, min: 0.2, max: 200, step: 0.1 },
    { key: "strength", label: "Strength", kind: "number", default: 10, min: 0, max: 40, step: 0.5, help: "10 is normal. 0 means weightless." },
  ],
  variants: [
    { label: "Upside down", icon: "⇧", angle: Math.PI },
    { label: "No gravity", icon: "◌", props: { strength: 0 } },
  ],
  create: (game, data) => new GravityZone(game, data),
};

export default gravityZone;
