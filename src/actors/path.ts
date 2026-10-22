import { Chain } from "planck";
import { Actor } from "../core/Actor";
import { colorField, materialFields } from "../core/fields";
import type { ActorDef } from "../core/registry";
import { scalePoints } from "../core/scaling";

interface PathProps extends Record<string, number | string | boolean | number[][]> {
  points: number[][];
  closed: boolean;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
}

/** A fixed line through a list of points, relative to the actor's position. Good for curves and funnels. */
export class Path extends Actor<PathProps> {
  build(): void {
    const p = this.props;
    if (p.points.length < 2) return;
    this.body = this.own(
      this.game.world.createBody({
        type: "static",
        position: { x: this.x, y: this.y },
        angle: this.angle,
      }),
    );
    const vertices = p.points.map(([x, y]) => ({ x, y }));
    this.body.createFixture(new Chain(vertices, p.closed), {
      friction: p.friction,
      restitution: p.bounciness,
    });
  }
}

const path: ActorDef = {
  type: "path",
  label: "Path",
  category: "Shapes",
  icon: "〰",
  placement: "draw-path",
  description: "A drawn line that things can roll along.",
  scale: scalePoints(),
  props: [
    {
      key: "points",
      label: "Points",
      kind: "points",
      default: [
        [-2, 0],
        [2, 0],
      ],
    },
    { key: "closed", label: "Closed loop", kind: "boolean", default: false },
    ...materialFields(),
    colorField("#5b4636"),
  ],
  create: (game, data) => new Path(game, data),
};

export default path;
