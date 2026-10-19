import { DistanceJoint } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { controlField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface MuscleProps extends ConnectorProps {
  control: string;
  contraction: number;
  strength: number;
  quickness: number;
}

/**
 * Pulls its two ends together while its control is held, and relaxes when let
 * go. A slider gives partial force. Pair two to make something that flexes.
 */
export class Muscle extends Connector<MuscleProps> {
  private joint: DistanceJoint | null = null;
  private rest = 1;
  private activation = 0;

  build(): void {
    const a = this.worldA();
    const b = this.worldB();
    this.rest = Math.max(0.05, Math.hypot(b.x - a.x, b.y - a.y));
    this.activation = 0;
    this.joint = this.addJoint(
      new DistanceJoint(
        { frequencyHz: this.props.strength, dampingRatio: 0.5, length: this.rest, collideConnected: true },
        this.bodyA,
        this.bodyB,
        a,
        b,
      ),
    );
    this.trackPosition();
  }

  update(dt: number): void {
    if (!this.joint) return;
    const target = Math.abs(this.game.input.axis(this.props.control));
    const rate = this.props.quickness * dt;
    this.activation += Math.max(-rate, Math.min(rate, target - this.activation));
    this.joint.setLength(this.rest * (1 - this.props.contraction * this.activation));
    if (target > 0 || this.activation > 0) {
      this.bodyA.setAwake(true);
      this.bodyB.setAwake(true);
    }
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const a = this.worldA();
    const b = this.worldB();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const nx = -dy / len;
    const ny = dx / len;
    // Bulges as it tightens.
    const bulge = 0.08 + 0.14 * this.activation;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx + nx * bulge * 2, my + ny * bulge * 2, b.x, b.y);
    ctx.quadraticCurveTo(mx - nx * bulge * 2, my - ny * bulge * 2, a.x, a.y);
    const shade = Math.round(150 + 80 * this.activation);
    ctx.fillStyle = `rgb(${shade}, 60, 70)`;
    ctx.fill();
    ctx.lineWidth = 1.2 * r.px;
    ctx.strokeStyle = "#7f1d1d";
    ctx.stroke();
  }
}

const muscle: ActorDef = {
  type: "muscle",
  label: "Muscle",
  category: "Machine",
  icon: "⟗",
  description: "Drag between two things. Holding its key pulls them together.",
  placement: "connect",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    controlField("key:KeyJ"),
    { key: "contraction", label: "Squeeze", kind: "number", default: 0.4, min: 0.05, max: 0.9, step: 0.05, help: "How much shorter it gets: 0.4 is 40%." },
    { key: "strength", label: "Strength", kind: "number", default: 4, min: 0.5, max: 30, step: 0.5 },
    { key: "quickness", label: "Quickness", kind: "number", default: 6, min: 0.5, max: 30, step: 0.5, help: "How fast it tightens and relaxes." },
  ],
  create: (game, data) => new Muscle(game, data),
};

export default muscle;
