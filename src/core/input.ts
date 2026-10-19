/**
 * What the player is pressing. Active parts (motors, thrusters, muscles...)
 * have a `control` setting naming what drives them, and ask `axis()` for its
 * value each step.
 *
 * A control is a short string:
 * - ""                          not controlled (off)
 * - "always"                    always fully on
 * - "key:KeyW"                  one key: 1 while held, else 0
 * - "keys:ArrowLeft,ArrowRight" two keys: -1 for the first, +1 for the second
 * - "slider:1"                  on-screen slider 1, from -1 to 1
 *
 * Key names are KeyboardEvent.code values, so they don't depend on keyboard layout.
 */
export class Input {
  readonly keys = new Set<string>();
  readonly sliders = new Map<number, number>();

  press(code: string): void {
    this.keys.add(code);
  }

  release(code: string): void {
    this.keys.delete(code);
  }

  setSlider(channel: number, value: number): void {
    this.sliders.set(channel, Math.max(-1, Math.min(1, value)));
  }

  clear(): void {
    this.keys.clear();
    this.sliders.clear();
  }

  /** The value of a control right now, from -1 to 1. */
  axis(control: string): number {
    const [kind, arg = ""] = splitControl(control);
    switch (kind) {
      case "always":
        return 1;
      case "key":
        return this.keys.has(arg) ? 1 : 0;
      case "keys": {
        const [neg, pos] = arg.split(",");
        return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
      }
      case "slider":
        return this.sliders.get(Number(arg)) ?? 0;
      default:
        return 0;
    }
  }
}

function splitControl(control: string): [string, string?] {
  const i = control.indexOf(":");
  return i < 0 ? [control] : [control.slice(0, i), control.slice(i + 1)];
}

/** Every key code a control string listens to. */
export function controlKeys(control: string): string[] {
  const [kind, arg = ""] = splitControl(control);
  if (kind === "key") return [arg];
  if (kind === "keys") return arg.split(",");
  return [];
}

/** The slider channel a control uses, if any. */
export function controlSlider(control: string): number | null {
  const [kind, arg] = splitControl(control);
  return kind === "slider" ? Number(arg) : null;
}

export interface ControlPreset {
  value: string;
  label: string;
}

/** The choices offered in the editor. Any valid control string also works in a level file. */
export const CONTROL_PRESETS: ControlPreset[] = [
  { value: "", label: "Off" },
  { value: "always", label: "Always on" },
  { value: "keys:ArrowLeft,ArrowRight", label: "← / →" },
  { value: "keys:ArrowDown,ArrowUp", label: "↓ / ↑" },
  { value: "keys:KeyA,KeyD", label: "A / D" },
  { value: "keys:KeyS,KeyW", label: "S / W" },
  { value: "keys:KeyJ,KeyL", label: "J / L" },
  { value: "keys:KeyK,KeyI", label: "K / I" },
  { value: "key:ArrowUp", label: "↑ held" },
  { value: "key:KeyW", label: "W held" },
  { value: "key:KeyF", label: "F held" },
  { value: "key:KeyJ", label: "J held" },
  { value: "key:ShiftLeft", label: "Shift held" },
  { value: "slider:1", label: "Slider 1" },
  { value: "slider:2", label: "Slider 2" },
  { value: "slider:3", label: "Slider 3" },
  { value: "slider:4", label: "Slider 4" },
];

export function controlLabel(control: string): string {
  return CONTROL_PRESETS.find((p) => p.value === control)?.label ?? control;
}
