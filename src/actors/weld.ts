import type { Fixture } from "planck";
import { Group } from "../core/Group";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { copyFixture } from "../core/shapes";

/**
 * Shapes joined into one solid thing, so they move as a single body. Its
 * pieces keep their own shape, colour and material. Double-clicking it in
 * the editor opens it up to change a piece.
 */
export class Weld extends Group {
  get merges(): boolean {
    return !this.game.openGroups.has(this.id);
  }

  build(): void {
    const pieces = this.children();
    // Fresh bodies for every piece, at their saved spots.
    for (const piece of pieces) {
      piece.destroy();
      piece.build();
    }
    this.centerOnChildren();
    if (!this.merges) return;
    const bodies = pieces.map((p) => p.body).filter((b) => !!b);
    if (!bodies.length) return;
    this.body = this.own(
      this.game.world.createBody({
        type: bodies.some((b) => b.getType() === "dynamic") ? "dynamic" : "static",
        position: { x: this.x, y: this.y },
      }),
    );
    for (const piece of pieces) {
      if (!piece.body) continue;
      const color = String(piece.props.color ?? "#888");
      const fixtures: Fixture[] = [];
      for (let f = piece.body.getFixtureList(); f; f = f.getNext()) fixtures.push(f);
      // A piece that's a weld itself already knows each shape's colour.
      for (const f of fixtures) copyFixture(f, piece.body, this.body, f.getUserData() ?? { color });
      // The piece lives on inside the weld's body now.
      piece.destroy();
    }
  }

  draw(r: Renderer): void {
    const body = this.body;
    if (!body) return;
    const { ctx } = r;
    const p = body.getPosition();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.getAngle());
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      const color = (f.getUserData() as { color?: string } | null)?.color ?? "#888";
      r.drawShape(f.getShape(), f.isSensor() ? "transparent" : color, "rgba(0,0,0,0.55)");
    }
    ctx.restore();
  }
}

const weld: ActorDef = {
  type: "weld",
  label: "Welded shape",
  category: "Groups",
  icon: "⬚",
  description: "Shapes stuck together into one solid thing. Double-click it to change a piece.",
  palette: false,
  poseFields: [],
  props: [{ key: "name", label: "Name", kind: "string", default: "Welded shape" }],
  create: (game, data) => new Weld(game, data),
};

export default weld;
