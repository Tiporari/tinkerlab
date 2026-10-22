import { Circle } from "planck";
import { Actor } from "../core/Actor";
import { colorField, dynamicField, materialFields } from "../core/fields";
import { addOutline, circlePoints, hollowFields } from "../core/shapes";
import type { ActorDef } from "../core/registry";
import { scaleUniform } from "../core/scaling";

interface BallProps extends Record<string, number | string | boolean> {
  radius: number;
  dynamic: boolean;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
  hollow: boolean;
  wall: number;
}

export class Ball extends Actor<BallProps> {
  build(): void {
    const p = this.props;
    this.body = this.own(
      this.game.world.createBody({
        type: p.dynamic ? "dynamic" : "static",
        position: { x: this.x, y: this.y },
        angle: this.angle,
        bullet: p.dynamic && p.radius < 0.3,
        angularDamping: 0.05,
      }),
    );
    const material = { density: p.density, friction: p.friction, restitution: p.bounciness };
    if (p.hollow) addOutline(this.body, circlePoints(p.radius, Math.max(12, Math.min(48, Math.round(p.radius * 24)))), p.wall, material);
    else this.body.createFixture(new Circle(p.radius), material);
  }
}

const ball: ActorDef = {
  type: "ball",
  label: "Ball",
  category: "Shapes",
  icon: "●",
  description: "A round object. Leave it moving for marbles, fix it in place for pegs.",
  scale: scaleUniform("radius"),
  props: [
    { key: "radius", label: "Radius", kind: "number", default: 0.25, min: 0.05, max: 10, step: 0.05 },
    dynamicField(true),
    ...hollowFields(),
    ...materialFields({ friction: 0.3, bounciness: 0.3, density: 2 }),
    colorField("#3b82f6"),
  ],
  create: (game, data) => new Ball(game, data),
};

export default ball;
