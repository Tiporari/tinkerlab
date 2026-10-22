import { Circle, RevoluteJoint } from "planck";
import { Actor, type Bounds } from "../core/Actor";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { colorField, controlField, reverseField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { scaleUniform } from "../core/scaling";

interface WheelProps extends ConnectorProps {
  radius: number;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
  control: string;
  speed: number;
  torque: number;
  reverse: boolean;
}

/** A wheel on an axle, bolted to whatever you click. With a control it's driven by a motor. */
export class Wheel extends Connector<WheelProps> {
  private joint: RevoluteJoint | null = null;

  build(): void {
    const p = this.props;
    const center = this.worldA();
    this.body = this.own(
      this.game.world.createBody({ type: "dynamic", position: center, angularDamping: 0.1 }),
    );
    this.body.createFixture(new Circle(p.radius), {
      density: p.density,
      friction: p.friction,
      restitution: p.bounciness,
    });
    this.joint = this.addJoint(
      new RevoluteJoint(
        { enableMotor: p.control !== "", maxMotorTorque: p.torque, motorSpeed: 0 },
        this.bodyA,
        this.body,
        center,
      ),
    );
    this.trackPosition();
  }

  update(): void {
    if (!this.joint || this.props.control === "") return;
    const throttle = this.game.input.axis(this.props.control) * (this.props.reverse ? -1 : 1);
    // Clockwise spin rolls a wheel to the right, so "right" on the control means clockwise.
    this.joint.setMotorSpeed(-throttle * this.props.speed * Math.PI * 2);
    this.body?.setAwake(true);
  }

  protected outline() {
    return [this.worldA()];
  }

  hitTest(x: number, y: number, tolerance = 0): boolean {
    return Actor.prototype.hitTest.call(this, x, y, tolerance);
  }

  getBounds(): Bounds | null {
    return Actor.prototype.getBounds.call(this);
  }

  draw(r: Renderer): void {
    if (!this.body) return;
    r.drawBody(this.body, this.props.color);
    const { ctx } = r;
    const c = this.body.getPosition();
    const a = this.body.getAngle();
    const rr = this.props.radius;
    ctx.lineWidth = 1.5 * r.px;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const t = a + (i * Math.PI) / 3;
      ctx.moveTo(c.x - Math.cos(t) * rr * 0.7, c.y - Math.sin(t) * rr * 0.7);
      ctx.lineTo(c.x + Math.cos(t) * rr * 0.7, c.y + Math.sin(t) * rr * 0.7);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.min(rr * 0.25, 0.12), 0, Math.PI * 2);
    ctx.fillStyle = this.props.control ? "#f59e0b" : "#d1d5db";
    ctx.fill();
  }
}

const wheel: ActorDef = {
  type: "wheel",
  label: "Wheel",
  category: "Machine",
  icon: "⊛",
  description: "Click on something to put a wheel there. Set a control to drive it.",
  placement: "attach",
  layer: 1,
  poseFields: [],
  scale: scaleUniform("radius"),
  props: [
    ...connectorFields(),
    { key: "radius", label: "Radius", kind: "number", default: 0.45, min: 0.05, max: 5, step: 0.05 },
    controlField("keys:ArrowLeft,ArrowRight"),
    { key: "speed", label: "Motor speed", kind: "number", default: 2, min: 0, max: 10, step: 0.1, help: "Turns per second." },
    { key: "torque", label: "Motor strength", kind: "number", default: 30, min: 1, max: 1000, step: 1 },
    reverseField(),
    { key: "friction", label: "Grip", kind: "number", default: 0.9, min: 0, max: 2, step: 0.05 },
    { key: "bounciness", label: "Bounciness", kind: "number", default: 0.1, min: 0, max: 1, step: 0.05 },
    { key: "density", label: "Density", kind: "number", default: 1, min: 0.05, max: 20, step: 0.05 },
    colorField("#374151"),
  ],
  create: (game, data) => new Wheel(game, data),
};

export default wheel;
