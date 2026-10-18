import { Box, RevoluteJoint, RopeJoint, Vec2, type Body } from "planck";
import { Connector, connectorFields, type ConnectorProps } from "../core/Connector";
import { colorField } from "../core/fields";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";

interface RopeProps extends ConnectorProps {
  segment: number;
  thickness: number;
  density: number;
  color: string;
}

let ropeGroup = 0;

/**
 * A rope made of short linked pieces, so it can hang, swing and drape over
 * things. Its length is however far apart its ends were when you drew it.
 */
export class Rope extends Connector<RopeProps> {
  private segments: Body[] = [];

  build(): void {
    const p = this.props;
    const a = this.worldA();
    const b = this.worldB();
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(2, Math.ceil(length / p.segment));
    const step = length / count;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // Pieces of the same rope never collide with each other.
    const group = -(++ropeGroup % 30000) - 1;

    let prev = this.bodyA;
    let joint = Vec2(a.x, a.y);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const seg = this.game.world.createBody({
        type: "dynamic",
        position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        angle,
        angularDamping: 0.3,
        linearDamping: 0.05,
      });
      seg.setUserData(this);
      seg.createFixture(new Box(step / 2, p.thickness / 2), {
        density: p.density,
        friction: 0.5,
        filterGroupIndex: group,
      });
      this.addJoint(new RevoluteJoint({}, prev, seg, joint));
      this.extraBodies.push(seg);
      this.segments.push(seg);
      prev = seg;
      joint = Vec2(a.x + (b.x - a.x) * ((i + 1) / count), a.y + (b.y - a.y) * ((i + 1) / count));
    }
    this.addJoint(new RevoluteJoint({}, prev, this.bodyB, Vec2(b.x, b.y)));
    // Chains of light links stretch under heavy loads, so also cap the
    // distance between the two ends at the rope's length.
    this.addJoint(
      new RopeJoint({
        bodyA: this.bodyA,
        bodyB: this.bodyB,
        maxLength: length,
        localAnchorA: this.bodyA.getLocalPoint(Vec2(a.x, a.y)),
        localAnchorB: this.bodyB.getLocalPoint(Vec2(b.x, b.y)),
      }),
    );
    this.trackPosition();
  }

  destroy(): void {
    this.segments = [];
    super.destroy();
  }

  /** The rope's current shape: its end anchors and every link in between. */
  protected outline() {
    const pts = [this.worldA()];
    for (const seg of this.segments) {
      const half = this.segmentHalf(seg);
      pts.push(seg.getWorldPoint(Vec2(half, 0)));
    }
    if (this.segments.length === 0) pts.push(this.worldB());
    return pts;
  }

  private segmentHalf(seg: Body): number {
    const shape = seg.getFixtureList()?.getShape() as unknown as { m_vertices: { x: number }[] } | undefined;
    return shape ? Math.max(...shape.m_vertices.map((v) => v.x)) : 0;
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const pts = this.outline();
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineWidth = Math.max(this.props.thickness, 2.5 * r.px);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = this.props.color;
    ctx.stroke();
  }
}

const rope: ActorDef = {
  type: "rope",
  label: "Rope",
  category: "Machine",
  icon: "∿",
  description: "Drag from one thing to another (or to empty space) to tie them with a rope.",
  placement: "connect",
  layer: 2,
  poseFields: [],
  props: [
    ...connectorFields(),
    { key: "thickness", label: "Thickness", kind: "number", default: 0.06, min: 0.02, max: 0.5, step: 0.01 },
    { key: "segment", label: "Link length", kind: "number", default: 0.3, min: 0.1, max: 2, step: 0.05, help: "Shorter links bend more smoothly but cost more to simulate." },
    { key: "density", label: "Weight", kind: "number", default: 1, min: 0.05, max: 10, step: 0.05 },
    colorField("#a16207"),
  ],
  create: (game, data) => new Rope(game, data),
};

export default rope;
