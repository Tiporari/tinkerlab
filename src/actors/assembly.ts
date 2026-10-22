import { Group } from "../core/Group";
import type { ActorDef } from "../core/registry";

/**
 * A machine made of separate parts, like a cart with wheels or a box with
 * thrusters. The parts still move on their own and keep their own settings;
 * the assembly lets you pick, move, copy and save them as one thing.
 */
export class Assembly extends Group {
  build(): void {
    this.centerOnChildren();
  }
}

const assembly: ActorDef = {
  type: "assembly",
  label: "Assembly",
  category: "Groups",
  icon: "▣",
  description: "Parts kept together. Double-click it to change one part.",
  palette: false,
  poseFields: [],
  props: [{ key: "name", label: "Name", kind: "string", default: "Assembly" }],
  create: (game, data) => new Assembly(game, data),
};

export default assembly;
