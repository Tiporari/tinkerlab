import type { ActorData } from "../core/types";

/** A saved assembly: a few actors centred on 0, 0, ready to drop into any level. */
export interface AssemblyFile {
  format: "tinkerlab/assembly";
  version: 1;
  name: string;
  description?: string;
  actors: ActorData[];
}

/**
 * The starter assemblies in the inventory: every JSON file in this folder.
 * Add a file here and it shows up, the same way new actor types do.
 */
const files = import.meta.glob<AssemblyFile>("./*.json", { eager: true, import: "default" });

export const starterAssemblies: AssemblyFile[] = Object.keys(files)
  .sort()
  .map((path) => files[path]);
