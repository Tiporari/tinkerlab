import type { Game } from "../core/Game";
import { controlLabel, controlSlider } from "../core/input";

/**
 * While playing, lists which keys drive which parts, and shows a slider for
 * every slider channel a part uses.
 */
export class ControlPanel {
  constructor(
    readonly root: HTMLElement,
    readonly game: Game,
  ) {}

  /** Rebuild from the level's current parts. Call when play starts. */
  refresh(): void {
    const bindings = new Map<string, Map<string, number>>();
    for (const actor of this.game.actors) {
      for (const field of actor.def.props) {
        if (field.kind !== "control") continue;
        const control = String(actor.props[field.key] ?? "");
        if (!control || control === "always") continue;
        const parts = bindings.get(control) ?? new Map<string, number>();
        parts.set(actor.def.label, (parts.get(actor.def.label) ?? 0) + 1);
        bindings.set(control, parts);
      }
    }

    this.root.replaceChildren();
    this.root.hidden = bindings.size === 0;
    for (const [control, parts] of bindings) {
      const row = document.createElement("div");
      row.className = "control-row";
      const names = [...parts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
      const channel = controlSlider(control);
      if (channel !== null) {
        const label = document.createElement("label");
        label.textContent = `${controlLabel(control)}: ${names}`;
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "-1";
        slider.max = "1";
        slider.step = "0.01";
        slider.value = String(this.game.input.sliders.get(channel) ?? 0);
        slider.addEventListener("input", () => this.game.input.setSlider(channel, Number(slider.value)));
        slider.addEventListener("dblclick", () => {
          slider.value = "0";
          this.game.input.setSlider(channel, 0);
        });
        slider.title = "Double-click to centre";
        label.append(slider);
        row.append(label);
      } else {
        const key = document.createElement("kbd");
        key.textContent = controlLabel(control);
        row.append(key, ` ${names}`);
      }
      this.root.append(row);
    }
  }

  hide(): void {
    this.root.hidden = true;
  }
}
