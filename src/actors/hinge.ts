import { RevoluteJoint } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { controlField, reverseField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface HingeProps extends ConnectorProps {
  control: string;
  speed: number;
  torque: number;
  reverse: boolean;
}

/** Pins two things together so they can only turn around one point. With a control it becomes a motor. */
export class Hinge extends Connector<HingeProps> {
  private joint: RevoluteJoint | null = null;

  build(): void {
    const p = this.props;
    this.joint = this.addJoint(
      new RevoluteJoint(
        { enableMotor: p.control !== "", maxMotorTorque: p.torque, motorSpeed: 0 },
        this.bodyA,
        this.bodyB,
        this.worldA(),
      ),
    );
    this.trackPosition();
  }

  update(): void {
    if (!this.joint || this.props.control === "") return;
    const throttle = this.game.input.axis(this.props.control) * (this.props.reverse ? -1 : 1);
    // Positive throttle turns clockwise, which reads as "forward" for wheels and arms.
    this.joint.setMotorSpeed(-throttle * this.props.speed * Math.PI * 2);
    this.bodyA.setAwake(true);
    this.bodyB.setAwake(true);
  }

  protected outline() {
    return [this.worldA()];
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const p = this.worldA();
    const radius = Math.max(0.1, 7 * r.px);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = this.props.control ? "#f59e0b" : "#e5e7eb";
    ctx.fill();
    ctx.lineWidth = 1.5 * r.px;
    ctx.strokeStyle = "#374151";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "#374151";
    ctx.fill();
  }
}

const hinge: ActorDef = {
  type: "hinge",
  label: "Hinge",
  category: "Machine",
  icon: "◉",
  description: "Click where two things overlap to pin them together. Give it a control to make it a motor.",
  placement: "pin",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    controlField(""),
    { key: "speed", label: "Motor speed", kind: "number", default: 0.5, min: 0, max: 5, step: 0.05, help: "Turns per second." },
    { key: "torque", label: "Motor strength", kind: "number", default: 100, min: 1, max: 2000, step: 1 },
    reverseField(),
  ],
  create: (game, data) => new Hinge(game, data),
};

export default hinge;
