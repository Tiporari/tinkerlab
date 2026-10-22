import type { ScaleSpec } from "./registry";
import type { Props } from "./types";

const round = (v: number) => Math.round(v * 1000) / 1000;

function mul(props: Props, key: string, by: number): void {
  if (typeof props[key] === "number") props[key] = round((props[key] as number) * by);
}

/** Stretch separately in x and y, e.g. a block's width and height. */
export function scaleBox(widthKey = "width", heightKey = "height"): ScaleSpec {
  return {
    axes: "xy",
    apply(props, sx, sy) {
      mul(props, widthKey, sx);
      mul(props, heightKey, sy);
    },
  };
}

/** Grow every listed size together, e.g. a ball's radius. */
export function scaleUniform(...keys: string[]): ScaleSpec {
  return {
    axes: "uniform",
    apply(props, s) {
      for (const key of keys) mul(props, key, s);
    },
  };
}

/** Stretch a list of [x, y] points, e.g. a drawn path. */
export function scalePoints(key = "points"): ScaleSpec {
  return {
    axes: "xy",
    apply(props, sx, sy) {
      const points = props[key];
      if (Array.isArray(points)) props[key] = (points as number[][]).map(([x, y]) => [round(x * sx), round(y * sy)]);
    },
  };
}
