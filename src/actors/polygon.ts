import { Actor } from "../core/Actor";
import { colorField, dynamicField, materialFields } from "../core/fields";
import type { ActorDef } from "../core/registry";
import { addOutline, addSolid, hollowFields, regularPolygon } from "../core/shapes";
import { scaleUniform } from "../core/scaling";

interface PolygonProps extends Record<string, number | string | boolean> {
  sides: number;
  size: number;
  dynamic: boolean;
  hollow: boolean;
  wall: number;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
}

/** A regular shape with 3 to 12 equal sides: triangles, hexagons and so on. */
export class RegularPolygon extends Actor<PolygonProps> {
  build(): void {
    const p = this.props;
    this.body = this.own(
      this.game.world.createBody({
        type: p.dynamic ? "dynamic" : "static",
        position: { x: this.x, y: this.y },
        angle: this.angle,
      }),
    );
    const points = regularPolygon(p.sides, p.size);
    const material = { density: p.density, friction: p.friction, restitution: p.bounciness };
    if (p.hollow) addOutline(this.body, points, p.wall, material);
    else addSolid(this.body, points, material);
  }
}

const polygon: ActorDef = {
  type: "polygon",
  label: "Polygon",
  category: "Shapes",
  icon: "⬟",
  description: "A shape with equal sides. Change Sides to get any shape from a triangle to a 12-sided one.",
  variants: [
    { label: "Triangle", icon: "▲", props: { sides: 3 } },
    { label: "Hexagon", icon: "⬢", props: { sides: 6 } },
  ],
  scale: scaleUniform("size"),
  props: [
    { key: "sides", label: "Sides", kind: "number", default: 5, min: 3, max: 12, step: 1 },
    { key: "size", label: "Size", kind: "number", default: 0.6, min: 0.05, max: 20, step: 0.05, help: "Distance from the middle to a corner." },
    dynamicField(true),
    ...hollowFields(),
    ...materialFields(),
    colorField("#0ea5e9"),
  ],
  create: (game, data) => new RegularPolygon(game, data),
};

export default polygon;
