import { Vec2 } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { controlField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface ThrusterProps extends ConnectorProps {
  control: string;
  force: number;
  reversible: boolean;
}

/**
 * A little rocket engine bolted to something. It pushes in the direction it
 * points (its angle, measured on the thing it's attached to).
 */
export class Thruster extends Connector<ThrusterProps> {
  private throttle = 0;

  build(): void {
    this.throttle = 0;
    this.trackPosition();
  }

  /** The direction of push in world space: "up" on the target, turned by this thruster's angle. */
  private direction(): { x: number; y: number } {
    const local = Vec2(-Math.sin(this.angle), Math.cos(this.angle));
    return this.bodyA.getWorldVector(local);
  }

  update(): void {
    let t = this.game.input.axis(this.props.control);
    if (!this.props.reversible) t = Math.max(0, t);
    this.throttle = t;
    if (t === 0) return;
    const body = this.bodyA;
    if (body.getType() !== "dynamic") return;
    const d = this.direction();
    body.applyForce(Vec2(d.x * this.props.force * t, d.y * this.props.force * t), Vec2(this.worldA()), true);
  }

  protected outline() {
    return [this.worldA()];
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const p = this.worldA();
    const d = this.direction();
    const turn = Math.atan2(d.y, d.x) - Math.PI / 2;
    ctx.translate(p.x, p.y);
    ctx.rotate(turn);
    // Flame first, out of the back of the nozzle.
    if (this.throttle !== 0) {
      const len = 0.25 + 0.5 * Math.abs(this.throttle) * (0.8 + Math.random() * 0.4);
      const dir = this.throttle > 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(-0.09, dir * 0.12);
      ctx.lineTo(0, dir * (0.12 + len));
      ctx.lineTo(0.09, dir * 0.12);
      ctx.fillStyle = "rgba(249,115,22,0.85)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-0.07, 0.12);
    ctx.lineTo(0.07, 0.12);
    ctx.lineTo(0.12, -0.12);
    ctx.lineTo(-0.12, -0.12);
    ctx.closePath();
    ctx.fillStyle = "#475569";
    ctx.fill();
    ctx.lineWidth = 1.2 * r.px;
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();
  }
}

const thruster: ActorDef = {
  type: "thruster",
  label: "Thruster",
  category: "Machine",
  icon: "▲",
  description: "Click on something to bolt on a rocket. It pushes the way it points; rotate it with Q/E.",
  placement: "attach",
  layer: 2,
  poseFields: ["angle"],
  props: [
    ...connectorFields(),
    controlField("key:ArrowUp"),
    { key: "force", label: "Force", kind: "number", default: 40, min: 1, max: 1000, step: 1 },
    { key: "reversible", label: "Can push backwards", kind: "boolean", default: false, help: "Let a two-key control fire it in reverse too." },
  ],
  create: (game, data) => new Thruster(game, data),
};

export default thruster;
