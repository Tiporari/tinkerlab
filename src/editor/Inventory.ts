import { starterAssemblies, type AssemblyFile } from "../assemblies";
import { EventBus } from "../core/events";
import type { ActorData } from "../core/types";

export interface InventoryItem extends AssemblyFile {
  /** "starter:<n>" for built-in ones, "saved:<n>" for yours. */
  key: string;
  starter: boolean;
}

const STORAGE_KEY = "tinkerlab.inventory";

/**
 * Saved assemblies you can drop into any level: the starters that come with
 * TinkerLab, plus your own, kept in this browser. Each one can also be
 * downloaded as a file and opened again elsewhere.
 */
export class Inventory {
  readonly events = new EventBus<{ change: InventoryItem[] }>();
  private saved: AssemblyFile[];

  constructor(private readonly starters: AssemblyFile[] = starterAssemblies) {
    this.saved = load();
  }

  items(): InventoryItem[] {
    return [
      ...this.starters.map((a, i) => ({ ...a, key: `starter:${i}`, starter: true })),
      ...this.saved.map((a, i) => ({ ...a, key: `saved:${i}`, starter: false })),
    ];
  }

  find(key: string): InventoryItem | undefined {
    return this.items().find((i) => i.key === key);
  }

  add(name: string, actors: ActorData[], description?: string): InventoryItem {
    this.saved.push({ format: "tinkerlab/assembly", version: 1, name, description, actors });
    this.store();
    return this.items()[this.items().length - 1];
  }

  remove(key: string): void {
    const index = key.startsWith("saved:") ? Number(key.slice(6)) : -1;
    if (index < 0 || index >= this.saved.length) return;
    this.saved.splice(index, 1);
    this.store();
  }

  /** Read an assembly file. Throws if it isn't one. */
  static parse(text: string): AssemblyFile {
    const data = JSON.parse(text) as AssemblyFile;
    if (data?.format !== "tinkerlab/assembly" || !Array.isArray(data.actors)) {
      throw new Error("This is not a TinkerLab assembly file.");
    }
    return data;
  }

  static toFile(item: AssemblyFile): string {
    const { format, version, name, description, actors } = item;
    return JSON.stringify({ format, version, name, description, actors }, null, 2);
  }

  private store(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      // Storage can be full or blocked; the inventory still works until the page closes.
    }
    this.events.emit("change", this.items());
  }
}

function load(): AssemblyFile[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as AssemblyFile[]) : [];
    return Array.isArray(list) ? list.filter((a) => a?.format === "tinkerlab/assembly") : [];
  } catch {
    return [];
  }
}
