import type { CameraData } from "./types";

/** Maps world meters (y up) to screen pixels (y down). */
export class Camera {
  x = 0;
  y = 0;
  /** Pixels per meter. */
  zoom = 40;
  /** Rotation of the view in radians, for tilting a whole course. */
  rotation = 0;
  width = 1;
  height = 1;

  minZoom = 4;
  maxZoom = 400;

  set(data: CameraData): void {
    this.x = data.x;
    this.y = data.y;
    this.zoom = data.zoom;
  }

  toData(): CameraData {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    const dx = wx - this.x;
    const dy = wy - this.y;
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    return [
      this.width / 2 + (dx * c - dy * s) * this.zoom,
      this.height / 2 - (dx * s + dy * c) * this.zoom,
    ];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const rx = (sx - this.width / 2) / this.zoom;
    const ry = -(sy - this.height / 2) / this.zoom;
    const c = Math.cos(-this.rotation);
    const s = Math.sin(-this.rotation);
    return [this.x + rx * c - ry * s, this.y + rx * s + ry * c];
  }

  /** Move the view by a screen-space drag. */
  panBy(dxPixels: number, dyPixels: number): void {
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(dxPixels, dyPixels);
    this.x -= x1 - x0;
    this.y -= y1 - y0;
  }

  /** Zoom by a factor while keeping the world point under the cursor still. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.x += wx - nx;
    this.y += wy - ny;
  }
}
