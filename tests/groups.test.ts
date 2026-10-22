import { beforeEach, describe, expect, it } from "vitest";
import { registerBuiltinActors } from "../src/actors";
import { starterAssemblies } from "../src/assemblies";
import { Camera } from "../src/core/Camera";
import type { Connector } from "../src/core/Connector";
import { Game } from "../src/core/Game";
import { Group } from "../src/core/Group";
import type { ActorData, LevelData } from "../src/core/types";
import { Editor } from "../src/editor/Editor";
import { Inventory } from "../src/editor/Inventory";

registerBuiltinActors();

function fakeCanvas(): HTMLCanvasElement {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  target.style = {};
  target.setPointerCapture = () => {};
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  return target as unknown as HTMLCanvasElement;
}

function level(actors: ActorData[]): LevelData {
  return { format: "tinkerlab/level", version: 1, name: "groups", gravity: [0, -10], actors };
}

const floor: ActorData = { id: "floor", type: "block", x: 0, y: -0.5, props: { width: 60, height: 1, friction: 0.9 } };
const run = (game: Game, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) game.step();
};

const cart: ActorData[] = [
  { id: "body", type: "block", x: 0, y: 1, props: { width: 2, height: 0.4, dynamic: true } },
  { id: "cab", type: "block", x: 0.5, y: 1.4, props: { width: 0.6, height: 0.4, dynamic: true, color: "#f00" } },
  { id: "w1", type: "wheel", x: -0.7, y: 0.7, props: { a: "body", ax: -0.7, ay: -0.3, radius: 0.35 } },
  { id: "w2", type: "wheel", x: 0.7, y: 0.7, props: { a: "body", ax: 0.7, ay: -0.3, radius: 0.35 } },
];

describe("groups", () => {
  let game: Game;
  let camera: Camera;
  let canvas: HTMLCanvasElement;
  let editor: Editor;

  function setup(actors: ActorData[]) {
    game = new Game(level(actors));
    camera = new Camera();
    camera.width = 800;
    camera.height = 600;
    camera.set({ x: 0, y: 1, zoom: 40 });
    canvas = fakeCanvas();
    editor = new Editor(game, camera, canvas);
  }
  const fire = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
    const [sx, sy] = camera.worldToScreen(x, y);
    canvas.dispatchEvent(Object.assign(new Event(type), { clientX: sx, clientY: sy, button: 0, pointerId: 1, pointerType: "mouse", ...extra }));
  };
  const click = (x: number, y: number) => {
    fire("pointerdown", x, y);
    fire("pointerup", x, y);
  };
  const doubleClick = (x: number, y: number) => {
    click(x, y);
    click(x, y);
    fire("dblclick", x, y);
  };

  beforeEach(() => setup([floor, ...structuredClone(cart)]));

  it("welds shapes into one body that falls as one, and saves as a nested tree", () => {
    editor.setSelection(["body", "cab"]);
    expect(editor.groupSelected("weld")).toBeNull();
    const weld = editor.selected as Group;
    expect(weld.type).toBe("weld");
    expect(weld.body).not.toBeNull();
    expect(game.find("body")!.body).toBeNull();
    let fixtures = 0;
    for (let f = weld.body!.getFixtureList(); f; f = f.getNext()) fixtures++;
    expect(fixtures).toBe(2);
    // The wheels moved onto the weld, at the same spot.
    const w1 = game.find("w1") as Connector;
    expect(w1.props.a).toBe(weld.id);
    expect(w1.worldA().x).toBeCloseTo(-0.7, 3);
    expect(w1.worldA().y).toBeCloseTo(0.7, 3);

    const saved = game.level.actors.find((a) => a.id === weld.id)!;
    expect(saved.children!.map((c) => c.id)).toEqual(["body", "cab"]);
    expect(game.level.actors.some((a) => a.id === "body")).toBe(false);

    // Reload from the saved level and drive it.
    const again = new Game(game.level);
    expect(again.find(weld.id)!.body).not.toBeNull();
    again.play();
    again.input.press("ArrowRight");
    run(again, 3);
    expect(again.find(weld.id)!.body!.getPosition().x).toBeGreaterThan(1);
  });

  it("can't weld parts, only shapes", () => {
    editor.setSelection(["body", "w1"]);
    expect(editor.groupSelected("weld")).toMatch(/can't be welded/);
    expect(game.actors.some((a) => a.type === "weld")).toBe(false);
  });

  it("ungrouping a weld gives the shapes their bodies back, and wheels go back onto them", () => {
    editor.setSelection(["body", "cab"]);
    editor.groupSelected("weld");
    editor.ungroupSelected();
    expect(game.actors.some((a) => a.type === "weld")).toBe(false);
    expect(game.find("body")!.body).not.toBeNull();
    expect(game.find("cab")!.body).not.toBeNull();
    expect(game.find("w1")!.props.a).toBe("body");
    expect((game.find("w1") as Connector).worldA().x).toBeCloseTo(-0.7, 3);
    expect(editor.selection.sort()).toEqual(["body", "cab"]);
  });

  it("an assembly picks as one, and double-click goes inside to pick a part", () => {
    editor.setSelection(["body"]);
    editor.groupSelected("assembly");
    const asm = editor.selected as Group;
    // The wheels came along because they only hang off the body.
    expect(asm.childIds.sort()).toEqual(["body", "w1", "w2"]);
    editor.select(null);
    click(0.5, 1.4); // the cab isn't in it
    expect(editor.selectedId).toBe("cab");
    click(-0.7, 0.7);
    expect(editor.selectedId).toBe(asm.id);
    doubleClick(-0.7, 0.7);
    expect(editor.scope).toBe(asm.id);
    click(-0.7, 0.7);
    expect(editor.selectedId).toBe("w1");
    // Parts inside keep their own settings.
    editor.updateSelected((d) => (d.props!.radius = 0.5));
    expect(game.find("w1")!.props.radius).toBe(0.5);
    expect(game.parentOf("w1")!.id).toBe(asm.id);
    // A click outside leaves the group.
    click(0.5, 1.4);
    expect(editor.scope).toBeNull();
    expect(editor.selectedId).toBe("cab");
  });

  it("moves a whole assembly by dragging it, in one undo step", () => {
    editor.setSelection(["body"]);
    editor.groupSelected("assembly");
    fire("pointerdown", -0.5, 1);
    fire("pointermove", 1, 2);
    fire("pointerup", 1.5, 2);
    expect(game.find("body")!.x).toBeCloseTo(2);
    expect((game.find("w2") as Connector).worldA().x).toBeCloseTo(2.7);
    editor.undo();
    expect(game.find("body")!.x).toBeCloseTo(0);
  });

  it("nests groups, and ungroup peels one layer at a time", () => {
    editor.setSelection(["body", "cab"]);
    editor.groupSelected("weld");
    const weld = editor.selected!;
    editor.setSelection([weld.id]);
    editor.groupSelected("assembly");
    const asm = editor.selected as Group;
    expect(asm.childIds).toContain(weld.id);
    expect(asm.childIds).toContain("w1");
    const saved = game.level.actors.find((a) => a.id === asm.id)!;
    expect(saved.children!.find((c) => c.id === weld.id)!.children).toHaveLength(2);

    editor.ungroupSelected();
    expect(game.find(asm.id)).toBeUndefined();
    expect(game.find(weld.id)!.body).not.toBeNull();
    editor.setSelection([weld.id]);
    editor.ungroupSelected();
    expect(game.find("body")!.body).not.toBeNull();
  });

  it("duplicates an assembly with fresh ids, its parts on the copy", () => {
    editor.setSelection(["body"]);
    editor.groupSelected("assembly");
    const before = game.actors.length;
    editor.duplicateSelected();
    expect(game.actors.length).toBe(before + 4);
    const copy = editor.selected as Group;
    expect(copy.type).toBe("assembly");
    const kids = copy.children();
    const body = kids.find((k) => k.type === "block")!;
    expect(body.id).not.toBe("body");
    for (const wheel of kids.filter((k) => k.type === "wheel")) expect(wheel.props.a).toBe(body.id);
  });

  it("deleting a part inside an assembly keeps the rest; deleting the last part removes it", () => {
    editor.setSelection(["body", "cab"]);
    editor.groupSelected("assembly");
    const asm = editor.selected as Group;
    editor.enterGroup(asm);
    editor.setSelection(["cab"]);
    editor.deleteSelected();
    expect(game.find(asm.id)).toBeTruthy();
    expect(asm.childIds).not.toContain("cab");
    editor.setSelection(["body"]);
    editor.deleteSelected();
    expect(game.find(asm.id)).toBeUndefined();
  });

  it("going inside a weld opens it up until you leave", () => {
    editor.setSelection(["body", "cab"]);
    editor.groupSelected("weld");
    const weld = editor.selected as Group;
    editor.enterGroup(weld);
    expect(game.find("body")!.body).not.toBeNull();
    expect(game.find(weld.id)!.body).toBeNull();
    // The wheels still hang off the right spot while it's open.
    expect((game.find("w1") as Connector).worldA().x).toBeCloseTo(-0.7, 3);
    editor.exitGroup();
    expect(game.find("body")!.body).toBeNull();
    expect(game.find(weld.id)!.body).not.toBeNull();
  });

  it("a player-tagged assembly finishes as one, and a hazard sends all of it back", () => {
    setup([
      floor,
      ...structuredClone(cart),
      { id: "goal", type: "finish", x: 6, y: 1, props: { counts: "player", width: 1, height: 2 } },
    ]);
    editor.setSelection(["body"]);
    editor.groupSelected("assembly");
    editor.updateSelected((d) => (d.tags = ["player"]));
    const asm = editor.selected!;
    let finished: string | null = null;
    game.events.on("finish", ({ actor }) => (finished = actor.id));
    game.play();
    game.input.press("ArrowRight");
    run(game, 6);
    expect(finished).toBe(asm.id);

    game.reset();
    const respawned: string[] = [];
    game.events.on("hazard", ({ actor }) => respawned.push(actor.id));
    game.add({ type: "hazard", x: -4, y: 0.5, props: { width: 1, height: 2 } });
    game.play();
    game.input.release("ArrowRight");
    game.input.press("ArrowLeft");
    run(game, 3);
    expect(respawned).toContain(asm.id);
    expect(game.find("body")!.body!.getPosition().x).toBeGreaterThan(-3.5);
  });
});

describe("inventory", () => {
  it("has starter assemblies that drop into a level and run", () => {
    expect(starterAssemblies.map((a) => a.name).sort()).toEqual(["Bucket", "Cart", "Rocket", "Seesaw"]);
    for (const asm of starterAssemblies) {
      const game = new Game(level([floor]));
      const editor = new Editor(game, new Camera(), fakeCanvas());
      editor.startStamp("x", asm.actors);
      const [root] = editor.stampAt({ x: 3, y: 2 });
      expect(root.getBounds()).not.toBeNull();
      const b = root.getBounds()!;
      expect((b.minX + b.maxX) / 2).toBeCloseTo(3, 0);
      game.play();
      game.input.press("ArrowUp");
      run(game, 2);
      for (const a of game.actors) {
        const p = a.body?.getPosition();
        if (p) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it("the rocket flies up with its engine on a welded hull", () => {
    const game = new Game(level([floor]));
    const editor = new Editor(game, new Camera(), fakeCanvas());
    editor.startStamp("rocket", starterAssemblies.find((a) => a.name === "Rocket")!.actors);
    const [rocket] = editor.stampAt({ x: 0, y: 1 });
    const hull = (rocket as Group).children().find((c) => c.type === "weld")!;
    expect(hull.body).not.toBeNull();
    game.play();
    game.input.press("ArrowUp");
    run(game, 2);
    expect(hull.body!.getPosition().y).toBeGreaterThan(3);
    expect(Math.abs(hull.body!.getAngle())).toBeLessThan(0.2);
  });

  it("saves a selection centred, and stamps copies with fresh ids", () => {
    const game = new Game(level([floor, ...cart.map((a) => ({ ...a, x: a.x + 10 }))]));
    const editor = new Editor(game, new Camera(), fakeCanvas());
    editor.setSelection(["body", "cab"]);
    const data = editor.selectionData()!;
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("assembly");
    expect(data[0].children!.length).toBe(4);
    const body = data[0].children!.find((c) => c.type === "block" && c.props!.width === 2)!;
    expect(Math.abs(body.x)).toBeLessThan(0.5);

    const inventory = new Inventory([]);
    const item = inventory.add("My cart", data);
    expect(inventory.items()).toHaveLength(1);
    const parsed = Inventory.parse(Inventory.toFile(item));
    editor.startStamp(item.key, parsed.actors);
    const [one] = editor.stampAt({ x: -5, y: 2 });
    const [two] = editor.stampAt({ x: 5, y: 2 });
    expect(one.id).not.toBe(two.id);
    const wheelsOnTwo = (two as Group).children().filter((c) => c.type === "wheel");
    const bodyTwo = (two as Group).children().find((c) => c.type === "block" && c.props.width === 2)!;
    for (const w of wheelsOnTwo) expect(w.props.a).toBe(bodyTwo.id);
    inventory.remove(item.key);
    expect(inventory.items()).toHaveLength(0);
    expect(() => Inventory.parse('{"format":"tinkerlab/level"}')).toThrow();
  });
});
