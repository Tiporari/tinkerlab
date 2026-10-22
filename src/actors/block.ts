import { Box } from "planck";
import { Actor } from "../core/Actor";
import { colorField, dynamicField, materialFields } from "../core/fields";
import { addOutline, hollowFields, rectangle } from "../core/shapes";
import type { ActorDef } from "../core/registry";
import { scaleBox } from "../core/scaling";

interface BlockProps extends Record<string, number | string | boolean> {
  width: number;
  height: number;
  dynamic: boolean;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
  hollow: boolean;
  wall: number;
}

/** A rectangle. Fixed blocks make ramps, walls and floors; moving ones make crates and dominoes. */
export class Block extends Actor<BlockProps> {
  build(): void {
    const p = this.props;
    this.body = this.own(
      this.game.world.createBody({
        type: p.dynamic ? "dynamic" : "static",
        position: { x: this.x, y: this.y },
        angle: this.angle,
      }),
    );
    const material = { density: p.density, friction: p.friction, restitution: p.bounciness };
    if (p.hollow) addOutline(this.body, rectangle(p.width, p.height), p.wall, material);
    else this.body.createFixture(new Box(p.width / 2, p.height / 2), material);
  }
}

const block: ActorDef = {
  type: "block",
  label: "Block",
  category: "Shapes",
  icon: "▬",
  placement: "drag-line",
  description: "A rectangle. Drag to draw a ramp or wall.",
  scale: scaleBox(),
  props: [
    { key: "width", label: "Width", kind: "number", default: 4, min: 0.05, max: 200, step: 0.1 },
    { key: "height", label: "Height", kind: "number", default: 0.3, min: 0.05, max: 200, step: 0.1 },
    dynamicField(false),
    ...hollowFields(),
    ...materialFields(),
    colorField("#8b7355"),
  ],
  create: (game, data) => new Block(game, data),
};

export default block;
