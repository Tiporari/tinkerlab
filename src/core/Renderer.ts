import type { Body, Shape } from "planck";
import type { Camera } from "./Camera";
import type { Game } from "./Game";

/**
 * Canvas 2D drawing in world coordinates. Actors call these helpers from
 * their `draw()` hook, so they never deal with pixels or the y flip.
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly camera: Camera,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
  }

  /** Match the canvas to its on-screen size, including high-DPI screens. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.camera.width = rect.width;
    this.camera.height = rect.height;
  }

  /** Draw a frame. `overlay` runs last, still in world coordinates (the editor uses it). */
  render(game: Game, overlay?: (r: Renderer) => void): void {
    const { ctx, camera } = this;
    const dpr = this.canvas.width / Math.max(1, camera.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f7f4ec";
    ctx.fillRect(0, 0, camera.width, camera.height);

    this.applyWorldTransform(dpr);
    this.drawGrid();
    for (const actor of game.layered()) {
      ctx.save();
      actor.draw(this);
      ctx.restore();
    }
    if (overlay) {
      ctx.save();
      overlay(this);
      ctx.restore();
    }
  }

  /** Pixels per meter, for line widths that should look the same at any zoom. */
  get px(): number {
    return 1 / this.camera.zoom;
  }

  drawBody(body: Body, fill: string, stroke = "rgba(0,0,0,0.55)"): void {
    const { ctx } = this;
    const p = body.getPosition();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.getAngle());
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      this.drawShape(f.getShape(), f.isSensor() ? "transparent" : fill, stroke);
    }
    ctx.restore();
  }

  drawShape(shape: Shape, fill: string, stroke: string): void {
    const { ctx } = this;
    ctx.lineWidth = 1.5 * this.px;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    switch (shape.getType()) {
      case "circle": {
        const c = shape as unknown as { m_p: { x: number; y: number }; m_radius: number };
        ctx.arc(c.m_p.x, c.m_p.y, c.m_radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // A spoke so you can see it roll.
        ctx.beginPath();
        ctx.moveTo(c.m_p.x, c.m_p.y);
        ctx.lineTo(c.m_p.x + c.m_radius, c.m_p.y);
        ctx.stroke();
        return;
      }
      case "polygon": {
        const poly = shape as unknown as { m_vertices: { x: number; y: number }[] };
        poly.m_vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        return;
      }
      case "edge": {
        const e = shape as unknown as { m_vertex1: { x: number; y: number }; m_vertex2: { x: number; y: number } };
        ctx.moveTo(e.m_vertex1.x, e.m_vertex1.y);
        ctx.lineTo(e.m_vertex2.x, e.m_vertex2.y);
        ctx.lineWidth = 3 * this.px;
        ctx.strokeStyle = fill;
        ctx.stroke();
        return;
      }
      case "chain": {
        const ch = shape as unknown as { m_vertices: { x: number; y: number }[] };
        ch.m_vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
        ctx.lineWidth = 4 * this.px;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = fill;
        ctx.stroke();
        return;
      }
    }
  }

  /** Text drawn upright at a world position, sized in screen pixels. */
  drawLabel(text: string, x: number, y: number, color = "#333", sizePx = 13): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(this.px, -this.px);
    ctx.rotate(this.camera.rotation);
    ctx.fillStyle = color;
    ctx.font = `600 ${sizePx}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  private applyWorldTransform(dpr: number): void {
    const { ctx, camera } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(camera.width / 2, camera.height / 2);
    ctx.scale(camera.zoom, -camera.zoom);
    ctx.rotate(camera.rotation);
    ctx.translate(-camera.x, -camera.y);
  }

  private drawGrid(): void {
    const { ctx, camera } = this;
    const corners = [
      camera.screenToWorld(0, 0),
      camera.screenToWorld(camera.width, 0),
      camera.screenToWorld(0, camera.height),
      camera.screenToWorld(camera.width, camera.height),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const spacing = camera.zoom < 15 ? 5 : 1;
    const x0 = Math.floor(Math.min(...xs) / spacing) * spacing;
    const x1 = Math.ceil(Math.max(...xs) / spacing) * spacing;
    const y0 = Math.floor(Math.min(...ys) / spacing) * spacing;
    const y1 = Math.ceil(Math.max(...ys) / spacing) * spacing;
    ctx.lineWidth = this.px;
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.beginPath();
    for (let x = x0; x <= x1; x += spacing) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y += spacing) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }
}
