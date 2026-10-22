import { Box, Chain, Vec2 } from "planck";
import { Actor, type Bounds } from "../core/Actor";
import { dynamicField, materialFields } from "../core/fields";
import { importPicture, pixels, traced, visibleCanvas, type Traced } from "../core/images";
import type { Renderer } from "../core/Renderer";
import type { ActorDef } from "../core/registry";
import { scaleBox } from "../core/scaling";
import type { SeeThrough } from "../core/trace";

interface PictureProps extends Record<string, number | string | boolean> {
  src: string;
  width: number;
  height: number;
  solid: boolean;
  seeThrough: string;
  useSeeThrough: boolean;
  tolerance: number;
  detail: number;
  inFront: boolean;
  dynamic: boolean;
  friction: number;
  bounciness: number;
  density: number;
}

/** Imported pictures start at this many pixels per meter, the editor's starting zoom, so they look their real size. */
const PIXELS_PER_METER = 40;
/** Most boxes a moving picture is made of; past this its shape gets coarser. */
const MAX_BOXES = 200;

/**
 * An imported picture. Its see-through parts (PNG transparency, plus one
 * color, white by default) are empty; everything else is solid. Draw a whole
 * level in a paint program and it becomes a course.
 */
export class Picture extends Actor<PictureProps> {
  private shape: Traced | null = null;

  get see(): SeeThrough {
    const p = this.props;
    return { color: p.useSeeThrough ? p.seeThrough : "", tolerance: p.tolerance };
  }

  /** Pictures draw behind everything else unless they're set to be in front. */
  get behind(): boolean {
    return !this.props.inFront;
  }

  build(): void {
    const p = this.props;
    this.body = this.own(
      this.game.world.createBody({
        type: p.dynamic && p.solid ? "dynamic" : "static",
        position: { x: this.x, y: this.y },
        angle: this.angle,
      }),
    );
    // Pictures load in the background; build again once this one has.
    if (!pixels(p.src, () => this.reload())) return;
    this.shape = traced(p.src, this.see, p.detail);
    if (!this.shape || !p.solid) return;
    const material = { friction: p.friction, restitution: p.bounciness, density: p.density };
    if (p.dynamic) {
      let shape = this.shape;
      for (let detail = p.detail; shape.rects.length > MAX_BOXES && detail > 8; ) {
        detail = Math.floor(detail / 1.5);
        shape = traced(p.src, this.see, detail) ?? shape;
      }
      const { cw, ch } = this.cellSize(shape);
      for (const r of shape.rects) {
        const c = this.toLocal(shape, r.x + r.w / 2, r.y + r.h / 2);
        this.body.createFixture(new Box((r.w * cw) / 2, (r.h * ch) / 2, Vec2(c.x, c.y), 0), material);
      }
    } else {
      for (const loop of this.shape.loops) {
        this.body.createFixture(new Chain(loop.map(([gx, gy]) => Vec2(this.toLocal(this.shape!, gx, gy))), true), material);
      }
    }
  }

  private reload(): void {
    if (this.game.actors.includes(this)) this.game.replace(this, this.serialize());
  }

  private cellSize(shape: Traced) {
    return { cw: this.props.width / shape.mask.cols, ch: this.props.height / shape.mask.rows };
  }

  /** A grid corner (cells from the top left) in the body's own frame. */
  private toLocal(shape: Traced, gx: number, gy: number) {
    const { cw, ch } = this.cellSize(shape);
    return { x: -this.props.width / 2 + gx * cw, y: this.props.height / 2 - gy * ch };
  }

  /** The picture's corners in the world. */
  private corners() {
    const b = this.body;
    const pos = b ? b.getPosition() : { x: this.x, y: this.y };
    const angle = b ? b.getAngle() : this.angle;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const w = this.props.width / 2;
    const h = this.props.height / 2;
    return [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ].map(([x, y]) => ({ x: pos.x + x * c - y * s, y: pos.y + x * s + y * c }));
  }

  /** Clicks land on the picture's solid (or, for decoration, visible) parts, so empty space around a drawn level stays empty. */
  hitTest(x: number, y: number, tolerance = 0): boolean {
    if (!this.body) return false;
    const local = this.body.getLocalPoint(Vec2(x, y));
    const w = this.props.width / 2;
    const h = this.props.height / 2;
    if (Math.abs(local.x) > w + tolerance || Math.abs(local.y) > h + tolerance) return false;
    const shape = this.shape;
    if (!shape) return true;
    const { cols, rows, cells } = shape.mask;
    const { cw, ch } = this.cellSize(shape);
    const reach = Math.ceil(tolerance / Math.min(cw, ch));
    const c0 = Math.floor((local.x + w) / cw);
    const r0 = Math.floor((h - local.y) / ch);
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (r >= 0 && c >= 0 && r < rows && c < cols && cells[r * cols + c]) return true;
      }
    }
    return false;
  }

  getBounds(): Bounds | null {
    const pts = this.corners();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  localBounds(): Bounds | null {
    const w = this.props.width / 2;
    const h = this.props.height / 2;
    return { minX: -w, minY: -h, maxX: w, maxY: h };
  }

  draw(r: Renderer): void {
    const { ctx } = r;
    const p = this.props;
    const b = this.body;
    if (!b) return;
    const pos = b.getPosition();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(b.getAngle());
    const canvas = visibleCanvas(p.src, this.see);
    if (canvas) {
      ctx.save();
      ctx.scale(1, -1);
      ctx.drawImage(canvas, -p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    } else {
      ctx.setLineDash([4 * r.px, 3 * r.px]);
      ctx.lineWidth = 1.5 * r.px;
      ctx.strokeStyle = "#94a3b8";
      ctx.strokeRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.setLineDash([]);
    }
    // While building, show what's solid.
    if (!this.game.started && p.solid) {
      ctx.lineWidth = r.px;
      ctx.strokeStyle = "rgba(37,99,235,0.55)";
      ctx.setLineDash([4 * r.px, 3 * r.px]);
      ctx.beginPath();
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        // Chains (fixed pictures) and boxes (moving ones) both keep their corners in m_vertices.
        const v = (f.getShape() as unknown as { m_vertices?: { x: number; y: number }[] }).m_vertices ?? [];
        v.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.closePath();
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.rotate(-b.getAngle());
    ctx.translate(-pos.x, -pos.y);
    if (!canvas) r.drawLabel(p.src ? "Loading picture…" : "No picture", pos.x, pos.y, "#64748b", 12);
  }
}

const picture: ActorDef = {
  type: "picture",
  label: "Picture",
  category: "Shapes",
  icon: "🖼",
  description:
    "Bring in a picture. White and see-through parts are empty, everything else is solid, so you can draw a whole level in a paint program. You can also drop a picture file onto the level.",
  scale: scaleBox(),
  importFile: {
    accept: "image/*",
    async read(file) {
      const { src, width, height } = await importPicture(file);
      const round = (v: number) => Math.round(v * 100) / 100;
      return { src, width: round(width / PIXELS_PER_METER), height: round(height / PIXELS_PER_METER) };
    },
  },
  props: [
    { key: "src", label: "Picture", kind: "string", default: "", hidden: true },
    { key: "width", label: "Width", kind: "number", default: 4, min: 0.1, max: 500, step: 0.1 },
    { key: "height", label: "Height", kind: "number", default: 3, min: 0.1, max: 500, step: 0.1 },
    { key: "solid", label: "Solid", kind: "boolean", default: true, help: "Off makes it just a picture, with nothing to bump into." },
    { key: "useSeeThrough", label: "See-through color", kind: "boolean", default: true, help: "Treat one color as empty space, as well as any transparent parts." },
    { key: "seeThrough", label: "That color", kind: "color", default: "#ffffff", help: "White, like a paint program's eraser, unless you pick another." },
    { key: "tolerance", label: "Closeness", kind: "number", default: 12, min: 0, max: 100, step: 1, help: "How close to that color still counts as empty. Raise it if a light background still shows up as solid." },
    { key: "detail", label: "Detail", kind: "number", default: 128, min: 8, max: 400, step: 1, help: "How finely the solid shape follows the picture. Lower is smoother and faster." },
    { key: "inFront", label: "In front", kind: "boolean", default: false, help: "Draw it on top of other things instead of behind them." },
    dynamicField(false),
    ...materialFields({ friction: 0.5, bounciness: 0.1 }),
  ],
  create: (game, data) => new Picture(game, data),
};

export default picture;
