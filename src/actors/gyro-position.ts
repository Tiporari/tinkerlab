import { Vec2 } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { clamp, pidFields } from "./gyro-angle";

interface PositionGyroProps extends ConnectorProps {
  control: string;
  lockX: boolean;
  lockY: boolean;
  kp: number;
  ki: number;
  kd: number;
  maxForce: number;
}

/**
 * Holds the point it's bolted to where it was placed, pushing back when it's
 * moved. Lock only Y for something that hovers but can slide sideways.
 */
export class PositionGyro extends Connector<PositionGyroProps> {
  private home = { x: 0, y: 0 };
  private integral = { x: 0, y: 0 };
  private active = false;

  build(): void {
    const p = this.worldA();
    this.home = { x: p.x, y: p.y };
    this.integral = { x: 0, y: 0 };
    this.trackPosition();
  }

  update(dt: number): void {
    const p = this.props;
    const body = this.bodyA;
    this.active = Math.abs(this.game.input.axis(p.control)) > 0;
    if (!this.active || body.getType() !== "dynamic") {
      this.integral = { x: 0, y: 0 };
      return;
    }
    const at = this.worldA();
    const v = body.getLinearVelocityFromWorldPoint(Vec2(at.x, at.y));
    // "Up and down" and "sideways" follow gravity, so a hover still hovers in a level turned on its side.
    const g = this.game.gravityAt(at.x, at.y);
    const { up, side } = this.axes(g);
    const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
    const err = { x: this.home.x - at.x, y: this.home.y - at.y };
    // Scale by mass so the same settings feel alike on light and heavy things.
    const m = body.getMass();
    const axis = (e: number, vel: number, key: "x" | "y", on: boolean) => {
      if (!on) return 0;
      this.integral[key] = clamp(this.integral[key] + e * dt, -5, 5);
      return m * (p.kp * e + p.ki * this.integral[key] - p.kd * vel);
    };
    let fs = axis(dot(err, side), dot(v, side), "x", p.lockX);
    let fu = axis(dot(err, up), dot(v, up), "y", p.lockY);
    // Holding against gravity is part of the job.
    const scale = body.getGravityScale();
    if (p.lockY) fu -= m * dot(g, up) * scale;
    if (p.lockX) fs -= m * dot(g, side) * scale;
    let fx = side.x * fs + up.x * fu;
    let fy = side.y * fs + up.y * fu;
    const size = Math.hypot(fx, fy);
    if (size > p.maxForce) {
      fx *= p.maxForce / size;
      fy *= p.maxForce / size;
    }
    body.applyForce(Vec2(fx, fy), Vec2(at.x, at.y), true);
  }

  /** Unit vectors for "up" (against gravity) and "sideways". Normal up and right when there's no gravity. */
  private axes(g: { x: number; y: number }) {
    const n = Math.hypot(g.x, g.y);
    const up = n < 1e-6 ? { x: 0, y: 1 } : { x: -g.x / n, y: -g.y / n };
    return { up, side: { x: up.y, y: -up.x } };
  }

  protected outline() {
    return [this.worldA()];
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const at = this.worldA();
    const s = Math.max(0.15, 8 * r.px);
    ctx.lineWidth = 1.5 * r.px;
    ctx.strokeStyle = this.active ? "#0d9488" : "#9ca3af";
    // A crosshair on the spot it holds, joined to where its body is now.
    const { up, side } = this.axes(this.game.gravityAt(this.home.x, this.home.y));
    ctx.beginPath();
    if (this.props.lockX) {
      ctx.moveTo(this.home.x - side.x * s, this.home.y - side.y * s);
      ctx.lineTo(this.home.x + side.x * s, this.home.y + side.y * s);
    }
    if (this.props.lockY) {
      ctx.moveTo(this.home.x - up.x * s, this.home.y - up.y * s);
      ctx.lineTo(this.home.x + up.x * s, this.home.y + up.y * s);
    }
    ctx.stroke();
    ctx.setLineDash([3 * r.px, 2 * r.px]);
    ctx.beginPath();
    ctx.moveTo(this.home.x, this.home.y);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(at.x - s / 2, at.y - s / 2, s, s);
    ctx.fillStyle = this.active ? "rgba(13,148,136,0.35)" : "rgba(156,163,175,0.35)";
    ctx.fill();
    ctx.stroke();
  }
}

const positionGyro: ActorDef = {
  type: "gyro-position",
  label: "Position gyro",
  category: "Machine",
  icon: "⌖",
  description: "Click on something to hold that spot in place, even against gravity. Untick Hold sideways to make it hover.",
  placement: "attach",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    { key: "control", label: "Active", kind: "control", default: "always", help: "When it works. Pick a key to make it work only while held." },
    { key: "lockX", label: "Hold sideways", kind: "boolean", default: true },
    { key: "lockY", label: "Hold up and down", kind: "boolean", default: true },
    ...pidFields(20, 0, 8),
    { key: "maxForce", label: "Max force", kind: "number", default: 300, min: 1, max: 10000, step: 1 },
  ],
  create: (game, data) => new PositionGyro(game, data),
};

export default positionGyro;
