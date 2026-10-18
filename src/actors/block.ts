import { Box } from "planck";
import { Actor } from "../core/Actor";
import { colorField, dynamicField, materialFields } from "../core/fields";
import type { ActorDef } from "../core/registry";

interface BlockProps extends Record<string, number | string | boolean> {
  width: number;
  height: number;
  dynamic: boolean;
  friction: number;
  bounciness: number;
  density: number;
  color: string;
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
    this.body.createFixture(new Box(p.width / 2, p.height / 2), {
      density: p.density,
      friction: p.friction,
      restitution: p.bounciness,
    });
  }
}

const block: ActorDef = {
  type: "block",
  label: "Block",
  category: "Shapes",
  icon: "▬",
  placement: "drag-line",
  description: "A rectangle. Drag to draw a ramp or wall.",
  props: [
    { key: "width", label: "Width", kind: "number", default: 4, min: 0.05, max: 200, step: 0.1 },
    { key: "height", label: "Height", kind: "number", default: 0.3, min: 0.05, max: 200, step: 0.1 },
    dynamicField(false),
    ...materialFields(),
    colorField("#8b7355"),
  ],
  create: (game, data) => new Block(game, data),
};

export default block;
