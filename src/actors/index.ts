import { hasActorDef, registerActor, type ActorDef } from "../core/registry";

/*
 * Every file in this folder that default-exports an ActorDef is picked up
 * automatically. To add a new kind of actor, drop a new file here.
 */
const modules = import.meta.glob<{ default?: ActorDef }>(["./*.ts", "!./index.ts"], { eager: true });

export function registerBuiltinActors(): void {
  for (const mod of Object.values(modules)) {
    const def = mod.default;
    if (def && !hasActorDef(def.type)) registerActor(def);
  }
}
