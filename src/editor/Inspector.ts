import type { Actor } from "../core/Actor";
import type { PropField, PropValue } from "../core/types";
import type { Editor } from "./Editor";
import { tidy } from "./geometry";

const DEG = Math.PI / 180;

/**
 * The settings panel. For a selected actor it builds one control per entry in
 * its type's `props` list, so new actor types get a panel for free. With
 * nothing selected it shows the level's own settings.
 */
export class Inspector {
  private shownId: string | null | undefined = undefined;

  constructor(
    readonly root: HTMLElement,
    readonly editor: Editor,
  ) {
    editor.events.on("selection", (actor) => this.show(actor));
    editor.events.on("change", () => this.show(editor.selected, true));
    this.show(null);
  }

  show(actor: Actor | null, force = false): void {
    const id = actor?.id ?? null;
    // Rebuilding while someone drags a slider would steal focus, so only
    // rebuild when the selection really changes, or values need refreshing.
    if (!force && id === this.shownId && this.root.contains(document.activeElement)) return;
    this.shownId = id;
    this.root.replaceChildren(actor ? this.actorPanel(actor) : this.levelPanel());
  }

  private actorPanel(actor: Actor): HTMLElement {
    const panel = document.createElement("div");
    const def = actor.def;
    panel.append(heading(`${def.icon ?? ""} ${def.label}`.trim(), def.description));

    panel.append(
      this.numberRow("X", actor.x, { step: 0.05 }, (v, rec) => this.editor.updateSelected((d) => (d.x = v), rec)),
      this.numberRow("Y", actor.y, { step: 0.05 }, (v, rec) => this.editor.updateSelected((d) => (d.y = v), rec)),
      this.numberRow(
        "Angle°",
        tidy(actor.angle / DEG, 1),
        { min: -360, max: 360, step: 1, slider: true },
        (v, rec) => this.editor.updateSelected((d) => (d.angle = tidy(v * DEG, 4)), rec),
      ),
    );

    for (const field of def.props) {
      panel.append(this.fieldRow(field, actor.props[field.key]));
    }

    const actions = document.createElement("div");
    actions.className = "inspector-actions";
    actions.append(
      actionButton("Duplicate", "Ctrl+D", () => this.editor.duplicateSelected()),
      actionButton("Delete", "Del", () => this.editor.deleteSelected(), "danger"),
    );
    panel.append(actions);
    return panel;
  }

  private levelPanel(): HTMLElement {
    const panel = document.createElement("div");
    const game = this.editor.game;
    panel.append(heading("Level", "Pick a tool on the left to add things, or click something to change it."));

    const name = document.createElement("input");
    name.type = "text";
    name.value = game.level.name;
    name.addEventListener("change", () => {
      game.level.name = name.value || "Untitled";
      this.editor.commit();
    });
    panel.append(row("Name", name));

    panel.append(
      this.numberRow("Gravity", -game.level.gravity[1], { min: -30, max: 30, step: 0.5, slider: true }, (v, rec) => {
        game.level.gravity = [game.level.gravity[0], -v];
        game.world.setGravity({ x: game.level.gravity[0], y: -v });
        if (rec) this.editor.commit();
      }),
    );

    const count = document.createElement("p");
    count.className = "muted";
    count.textContent = `${game.actors.filter((a) => !a.transient).length} things in this level.`;
    panel.append(count);
    return panel;
  }

  private fieldRow(field: PropField, value: PropValue): HTMLElement {
    const set = (v: PropValue, record = true) =>
      this.editor.updateSelected((d) => {
        d.props = { ...d.props, [field.key]: v };
      }, record);

    switch (field.kind) {
      case "number":
        return this.numberRow(
          field.label,
          Number(value),
          { min: field.min, max: field.max, step: field.step, slider: field.min !== undefined && field.max !== undefined },
          set,
          field.help,
        );
      case "boolean": {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(value);
        input.addEventListener("change", () => set(input.checked));
        return row(field.label, input, field.help);
      }
      case "color": {
        const input = document.createElement("input");
        input.type = "color";
        input.value = String(value);
        input.addEventListener("input", () => set(input.value, false));
        input.addEventListener("change", () => this.editor.commit());
        return row(field.label, input, field.help);
      }
      case "string": {
        const input = document.createElement("input");
        input.type = "text";
        input.value = String(value);
        input.addEventListener("change", () => set(input.value));
        return row(field.label, input, field.help);
      }
      case "points": {
        const info = document.createElement("span");
        info.className = "muted";
        info.textContent = `${Array.isArray(value) ? value.length : 0} points (draw a new one to change the shape)`;
        return row(field.label, info, field.help);
      }
    }
  }

  /** A number box, plus a slider when the field has a range. */
  private numberRow(
    label: string,
    value: number,
    opts: { min?: number; max?: number; step?: number; slider?: boolean },
    onChange: (v: number, record: boolean) => void,
    help?: string,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "number-control";
    const box = document.createElement("input");
    box.type = "number";
    box.value = String(tidy(value));
    if (opts.step !== undefined) box.step = String(opts.step);
    if (opts.min !== undefined) box.min = String(opts.min);
    if (opts.max !== undefined) box.max = String(opts.max);
    box.addEventListener("change", () => {
      const v = Number(box.value);
      if (Number.isFinite(v)) onChange(clamp(v, opts.min, opts.max), true);
    });
    if (opts.slider) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(opts.min);
      slider.max = String(opts.max);
      slider.step = String(opts.step ?? 0.01);
      slider.value = String(value);
      slider.addEventListener("input", () => {
        box.value = slider.value;
        onChange(Number(slider.value), false);
      });
      slider.addEventListener("change", () => this.editor.commit());
      box.addEventListener("input", () => (slider.value = box.value));
      wrap.append(slider);
    }
    wrap.append(box);
    return row(label, wrap, help);
  }
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

function heading(title: string, description?: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "inspector-heading";
  const t = document.createElement("h2");
  t.textContent = title;
  h.append(t);
  if (description) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = description;
    h.append(p);
  }
  return h;
}

function row(label: string, control: HTMLElement, help?: string): HTMLElement {
  const r = document.createElement("label");
  r.className = "inspector-row";
  if (help) r.title = help;
  const l = document.createElement("span");
  l.className = "inspector-label";
  l.textContent = label;
  r.append(l, control);
  return r;
}

function actionButton(label: string, shortcut: string, onClick: () => void, variant?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = shortcut;
  if (variant) b.classList.add(variant);
  b.addEventListener("click", onClick);
  return b;
}
