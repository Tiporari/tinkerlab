import { gravityDirection, gravityStrength } from "../core/gravity";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import type { PropField } from "../core/types";

interface AngleGyroProps extends ConnectorProps {
  control: string;
  steer: string;
  steerRange: number;
  hold: number;
  kp: number;
  ki: number;
  kd: number;
  maxTorque: number;
  followGravity: boolean;
}

const DEG = Math.PI / 180;

/**
 * Keeps whatever it's bolted to at a set angle, like a gyroscope. It's a PID
 * controller: P pulls toward the target, D calms wobbling, I fixes a steady lean.
 * A steer control turns the target angle for steering.
 */
export class AngleGyro extends Connector<AngleGyroProps> {
  private base = 0;
  private integral = 0;
  private target = 0;
  private active = false;
  /** Which way gravity pointed where it was placed, and how far it has turned since. */
  private placedDown = 0;
  private downTurn = 0;

  build(): void {
    this.base = this.bodyA.getAngle();
    this.placedDown = this.downHere() ?? 0;
    this.downTurn = 0;
    this.target = this.base + this.props.hold * DEG;
    this.integral = 0;
    this.trackPosition();
  }

  update(dt: number): void {
    const p = this.props;
    const body = this.bodyA;
    this.active = Math.abs(this.game.input.axis(p.control)) > 0;
    if (p.followGravity) {
      // Around a planet or in a gravity zone, "upright" turns with gravity. Floating, it keeps the last one.
      const down = this.downHere();
      if (down !== null) this.downTurn = wrapAngle(down - this.placedDown);
    }
    // Steering right turns clockwise, so it's negative in maths terms.
    this.target = this.base + this.downTurn + (p.hold - this.game.input.axis(p.steer) * p.steerRange) * DEG;
    if (!this.active || body.getType() !== "dynamic") {
      this.integral = 0;
      return;
    }
    const error = wrapAngle(this.target - body.getAngle());
    this.integral = clamp(this.integral + error * dt, -10, 10);
    // Scale by the body's inertia so the same settings feel alike on big and small things.
    const inertia = Math.max(body.getInertia(), 1e-3);
    const torque = inertia * (p.kp * error + p.ki * this.integral - p.kd * body.getAngularVelocity());
    body.applyTorque(clamp(torque, -p.maxTorque, p.maxTorque), true);
  }

  /** The direction of gravity where it's bolted on, or null if there's hardly any. */
  private downHere(): number | null {
    const at = this.worldA();
    const g = this.game.gravityAt(at.x, at.y);
    return gravityStrength(g) < 0.5 ? null : gravityDirection(g);
  }

  protected outline() {
    return [this.worldA()];
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const c = this.worldA();
    const radius = Math.max(0.18, 10 * r.px);
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = this.active ? "rgba(124,58,237,0.25)" : "rgba(156,163,175,0.25)";
    ctx.fill();
    ctx.lineWidth = 1.5 * r.px;
    ctx.strokeStyle = "#6d28d9";
    ctx.stroke();
    // Where it's trying to point, and where it points now.
    const now = this.bodyA.getAngle() + Math.PI / 2;
    const want = this.target + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(want) * radius * 1.4, c.y + Math.sin(want) * radius * 1.4);
    ctx.setLineDash([3 * r.px, 2 * r.px]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(now) * radius, c.y + Math.sin(now) * radius);
    ctx.lineWidth = 2.5 * r.px;
    ctx.stroke();
  }
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** P, I and D settings shared by both gyros. */
export function pidFields(kp: number, ki: number, kd: number): PropField[] {
  return [
    { key: "kp", label: "Strength (P)", kind: "number", default: kp, min: 0, max: 1000, step: 1, help: "How hard it pulls back toward the target." },
    { key: "kd", label: "Calming (D)", kind: "number", default: kd, min: 0, max: 200, step: 0.5, help: "Slows it as it gets close, so it doesn't overshoot and wobble." },
    { key: "ki", label: "Catch-up (I)", kind: "number", default: ki, min: 0, max: 200, step: 0.5, help: "Slowly adds force when something keeps pushing it off target." },
  ];
}

const angleGyro: ActorDef = {
  type: "gyro-angle",
  label: "Angle gyro",
  category: "Machine",
  icon: "⟳",
  description: "Click on something to keep it upright (or at any angle). Add a steer control to turn it.",
  placement: "attach",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    { key: "control", label: "Active", kind: "control", default: "always", help: "When it works. Pick a key to make it work only while held." },
    { key: "hold", label: "Hold angle°", kind: "number", default: 0, min: -180, max: 180, step: 1, help: "Extra turn from how it was placed." },
    { key: "steer", label: "Steer", kind: "control", default: "", help: "A control that turns the target angle." },
    { key: "steerRange", label: "Steer range°", kind: "number", default: 45, min: 0, max: 180, step: 1 },
    ...pidFields(200, 20, 25),
    {
      key: "followGravity",
      label: "Turn with gravity",
      kind: "boolean",
      default: true,
      help: "Where gravity points another way, like around a planet, it stays upright compared with the new down.",
    },
    { key: "maxTorque", label: "Max twist", kind: "number", default: 300, min: 1, max: 10000, step: 1, help: "The most turning force it can use." },
  ],
  create: (game, data) => new AngleGyro(game, data),
};

export default angleGyro;
