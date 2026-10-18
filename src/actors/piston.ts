import { DistanceJoint } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { colorField, controlField, reverseField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface PistonProps extends ConnectorProps {
  control: string;
  speed: number;
  extend: number;
  retract: number;
  strength: number;
  reverse: boolean;
  color: string;
}

/**
 * A simplified hydraulic ram between two points. It pivots at both ends,
 * grows or shrinks while its control is held, and holds still when let go.
 */
export class Piston extends Connector<PistonProps> {
  private joint: DistanceJoint | null = null;
  private built = 1;
  private length = 1;

  build(): void {
    const a = this.worldA();
    const b = this.worldB();
    this.built = Math.max(0.05, Math.hypot(b.x - a.x, b.y - a.y));
    this.length = this.built;
    this.joint = this.addJoint(
      new DistanceJoint(
        { frequencyHz: this.props.strength, dampingRatio: 0.9, length: this.length, collideConnected: true },
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
    const p = this.props;
    const throttle = this.game.input.axis(p.control) * (p.reverse ? -1 : 1);
    if (throttle === 0) return;
    const min = Math.max(0.05, this.built - p.retract);
    const max = this.built + p.extend;
    this.length = Math.min(max, Math.max(min, this.length + throttle * p.speed * dt));
    this.joint.setLength(this.length);
    this.bodyA.setAwake(true);
    this.bodyB.setAwake(true);
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const a = this.worldA();
    const b = this.worldB();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    // The barrel is as long as the shortest the piston can get; the rod slides out of it.
    const barrel = Math.min(len, Math.max(0.05, this.built - this.props.retract));
    const ex = a.x + (dx / len) * barrel;
    const ey = a.y + (dy / len) * barrel;
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = this.props.color;
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.08, 0, Math.PI * 2);
      ctx.fillStyle = "#374151";
      ctx.fill();
    }
  }
}

const piston: ActorDef = {
  type: "piston",
  label: "Piston",
  category: "Machine",
  icon: "⇔",
  description: "Drag from one thing to another to put a pusher between them. Hold its keys to push or pull.",
  placement: "connect",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    controlField("keys:ArrowDown,ArrowUp"),
    { key: "speed", label: "Speed", kind: "number", default: 1.5, min: 0.05, max: 10, step: 0.05, help: "Meters per second." },
    { key: "extend", label: "Can grow by", kind: "number", default: 1.5, min: 0, max: 20, step: 0.05 },
    { key: "retract", label: "Can shrink by", kind: "number", default: 0.5, min: 0, max: 20, step: 0.05 },
    { key: "strength", label: "Strength", kind: "number", default: 8, min: 0.5, max: 30, step: 0.5, help: "Higher is stiffer and harder to stop." },
    reverseField(),
    colorField("#64748b"),
  ],
  create: (game, data) => new Piston(game, data),
};

export default piston;
