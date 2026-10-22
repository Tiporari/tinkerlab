import { listActorDefs } from "../core/registry";
import type { Editor, ToolId } from "./Editor";

/** The tool strip: a select tool plus one button for every actor type in the registry. */
export class Palette {
  private buttons = new Map<ToolId, HTMLButtonElement>();

  constructor(
    readonly root: HTMLElement,
    readonly editor: Editor,
  ) {
    this.build();
    editor.events.on("tool", () => this.refresh());
  }

  private build(): void {
    this.root.replaceChildren();
    this.root.append(this.button("select", "↖", "Select", "Pick, move, turn and resize things. Drag a box around several to pick them all; Shift+click adds or removes one."));

    const groups = new Map<string, HTMLElement[]>();
    for (const def of listActorDefs()) {
      if (def.palette === false) continue;
      const list = groups.get(def.category) ?? [];
      list.push(this.button(`place:${def.type}`, def.icon ?? "◆", def.label, def.description ?? ""));
      def.variants?.forEach((v, i) =>
        list.push(this.button(`place:${def.type}~${i}`, v.icon ?? def.icon ?? "◆", v.label, def.description ?? "")),
      );
      groups.set(def.category, list);
    }
    for (const [category, buttons] of groups) {
      const heading = document.createElement("div");
      heading.className = "palette-heading";
      heading.textContent = category;
      this.root.append(heading, ...buttons);
    }

    const snap = document.createElement("label");
    snap.className = "palette-snap";
    snap.title = "Snap to a grid (G)";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = "snap-toggle";
    box.addEventListener("change", () => {
      this.editor.snapOn = box.checked;
    });
    snap.append(box, " Snap");
    this.root.append(snap);
    this.refresh();
  }

  private button(tool: ToolId, icon: string, label: string, help: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tool";
    b.title = help ? `${label}: ${help}` : label;
    const i = document.createElement("span");
    i.className = "tool-icon";
    i.textContent = icon;
    const l = document.createElement("span");
    l.textContent = label;
    b.append(i, l);
    b.addEventListener("click", () => this.editor.setTool(this.editor.tool === tool ? "select" : tool));
    this.buttons.set(tool, b);
    return b;
  }

  private refresh(): void {
    for (const [tool, b] of this.buttons) b.classList.toggle("active", tool === this.editor.tool);
    const box = this.root.querySelector<HTMLInputElement>("#snap-toggle");
    if (box) box.checked = this.editor.snapOn;
  }
}
