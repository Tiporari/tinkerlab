import { listActorDefs } from "../core/registry";
import type { Editor, ToolId } from "./Editor";
import { Inventory, type InventoryItem } from "./Inventory";

/**
 * The tool strip: a select tool, one button for every actor type in the
 * registry, and the inventory of saved assemblies.
 */
export class Palette {
  private buttons = new Map<ToolId, HTMLButtonElement>();

  constructor(
    readonly root: HTMLElement,
    readonly editor: Editor,
    readonly inventory?: Inventory,
  ) {
    this.build();
    editor.events.on("tool", () => this.refresh());
    inventory?.events.on("change", () => this.build());
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

    if (this.inventory) this.buildInventory(this.inventory);

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

  private buildInventory(inventory: Inventory): void {
    const heading = document.createElement("div");
    heading.className = "palette-heading";
    heading.textContent = "Inventory";
    this.root.append(heading);
    for (const item of inventory.items()) {
      const b = this.button(`stamp:${item.key}`, item.starter ? "★" : "▣", item.name, `${item.description ?? "Your saved assembly."} Click, then click where to put it.`, () =>
        this.editor.startStamp(item.key, item.actors),
      );
      const row = document.createElement("div");
      row.className = "tool-row";
      // Small buttons that show up when you point at it.
      const minis = document.createElement("span");
      minis.className = "tool-minis";
      minis.append(mini("⤓", "Download as a file", () => download(item)));
      if (!item.starter) {
        minis.append(
          mini("×", "Remove from the inventory", () => {
            if (window.confirm(`Remove "${item.name}" from the inventory?`)) inventory.remove(item.key);
          }),
        );
      }
      row.append(b, minis);
      this.root.append(row);
    }
    const open = document.createElement("label");
    open.className = "button tool-open";
    open.title = "Add an assembly file to the inventory";
    open.textContent = "Open assembly file…";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        const asm = Inventory.parse(await file.text());
        inventory.add(asm.name, asm.actors, asm.description);
      } catch (err) {
        window.alert(`Could not open that file: ${(err as Error).message}`);
      }
    });
    open.append(input);
    this.root.append(open);
  }

  private button(tool: ToolId, icon: string, label: string, help: string, pick?: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tool";
    b.title = help ? `${label}: ${help}` : label;
    const i = document.createElement("span");
    i.className = "tool-icon";
    i.textContent = icon;
    const l = document.createElement("span");
    l.textContent = label;
    b.append(i, l);
    b.addEventListener("click", () => {
      if (this.editor.tool === tool) this.editor.setTool("select");
      else if (pick) pick();
      else this.editor.setTool(tool);
    });
    this.buttons.set(tool, b);
    return b;
  }

  private refresh(): void {
    for (const [tool, b] of this.buttons) b.classList.toggle("active", tool === this.editor.tool);
    const box = this.root.querySelector<HTMLInputElement>("#snap-toggle");
    if (box) box.checked = this.editor.snapOn;
  }
}

function mini(icon: string, help: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tool-mini";
  b.title = help;
  b.textContent = icon;
  b.addEventListener("click", onClick);
  return b;
}

function download(item: InventoryItem): void {
  const blob = new Blob([Inventory.toFile(item)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${item.name.replace(/[^\w-]+/g, "-").toLowerCase() || "assembly"}.assembly.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
