import { DistanceJoint } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { colorField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface SpringProps extends ConnectorProps {
  stiffness: number;
  damping: number;
  length: number;
  color: string;
}

/** A springy link between two points. Squash it or stretch it and it pushes back. */
export class Spring extends Connector<SpringProps> {
  build(): void {
    const p = this.props;
    const a = this.worldA();
    const b = this.worldB();
    const built = Math.hypot(b.x - a.x, b.y - a.y);
    this.addJoint(
      new DistanceJoint(
        {
          frequencyHz: p.stiffness,
          dampingRatio: p.damping,
          length: p.length > 0 ? p.length : built,
          collideConnected: true,
        },
        this.bodyA,
        this.bodyB,
        a,
        b,
      ),
    );
    this.trackPosition();
  }

  draw(r: Renderer): void {
    const a = this.worldA();
    const b = this.worldB();
    drawZigzag(r, a, b, this.props.color, 0.18);
  }
}

/** A coil drawn between two points; shared with other spring-like parts. */
export function drawZigzag(
  r: Renderer,
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
  width: number,
): void {
  const { ctx } = r;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / len;
  const ny = dx / len;
  const coils = 10;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  for (let i = 1; i < coils * 2; i++) {
    const t = i / (coils * 2);
    const side = i % 2 ? 1 : -1;
    const edge = t < 0.08 || t > 0.92 ? 0 : side * width;
    ctx.lineTo(a.x + dx * t + nx * edge, a.y + dy * t + ny * edge);
  }
  ctx.lineTo(b.x, b.y);
  ctx.lineWidth = 2 * r.px;
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.stroke();
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * r.px, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

const spring: ActorDef = {
  type: "spring",
  label: "Spring",
  category: "Machine",
  icon: "≋",
  description: "Drag from one thing to another (or to empty space) to join them with a spring.",
  placement: "connect",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    { key: "stiffness", label: "Stiffness", kind: "number", default: 3, min: 0.2, max: 20, step: 0.1, help: "How fast it bounces back (times per second)." },
    { key: "damping", label: "Damping", kind: "number", default: 0.2, min: 0, max: 1, step: 0.05, help: "0 wobbles for ages, 1 settles straight away." },
    { key: "length", label: "Rest length", kind: "number", default: 0, min: 0, max: 50, step: 0.05, help: "0 means the length you drew it." },
    colorField("#0f766e"),
  ],
  create: (game, data) => new Spring(game, data),
};

export default spring;
