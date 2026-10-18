import { Circle } from "planck";
import { Actor } from "../core/Actor";
import { colorField, dynamicField, materialFields } from "../core/fields";
import type { ActorDef } from "../core/registry";

interface BallProps extends Record<string, number | string | boolean> {
  radius: number;
  dynamic: boolean;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
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
    this.body.createFixture(new Circle(p.radius), {
      density: p.density,
      friction: p.friction,
      restitution: p.bounciness,
    });
  }
}

const ball: ActorDef = {
  type: "ball",
  label: "Ball",
  category: "Shapes",
  description: "A round object. Leave it moving for marbles, fix it in place for pegs.",
  props: [
    { key: "radius", label: "Radius", kind: "number", default: 0.25, min: 0.05, max: 10, step: 0.05 },
    dynamicField(true),
    ...materialFields({ friction: 0.3, bounciness: 0.3, density: 2 }),
    colorField("#3b82f6"),
  ],
  create: (game, data) => new Ball(game, data),
};

export default ball;
