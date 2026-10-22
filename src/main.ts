import { registerBuiltinActors } from "./actors";
import { Camera } from "./core/Camera";
import { Game } from "./core/Game";
import { Group } from "./core/Group";
import { Renderer } from "./core/Renderer";
import { attachViewControls } from "./core/viewControls";
import type { LevelData } from "./core/types";
import { Editor } from "./editor/Editor";
import { Inspector } from "./editor/Inspector";
import { Inventory } from "./editor/Inventory";
import { Palette } from "./editor/Palette";
import { builtinLevels, firstMarbleRun } from "./levels";
import { blankLevel } from "./levels/blank";
import { ControlPanel } from "./ui/ControlPanel";

registerBuiltinActors();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#view");
const hud = $<HTMLDivElement>("#hud");
const hint = $<HTMLDivElement>("#hint");
const playButton = $<HTMLButtonElement>("#play");
const stopButton = $<HTMLButtonElement>("#stop");
const undoButton = $<HTMLButtonElement>("#undo");
const redoButton = $<HTMLButtonElement>("#redo");
const examples = $<HTMLSelectElement>("#examples");
const importInput = $<HTMLInputElement>("#import");

// ---- Autosave (per browser, so a refresh never loses work) ------------------

const AUTOSAVE_KEY = "tinkerlab.autosave";

function loadAutosave(): LevelData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    const level = raw ? (JSON.parse(raw) as LevelData) : null;
    return level?.format === "tinkerlab/level" ? level : null;
  } catch {
    return null;
  }
}

function autosave(level: LevelData): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...level, camera: camera.toData() }));
  } catch {
    // Storage can be full or blocked; autosave is a convenience, so carry on.
  }
}

// ---- Setup -------------------------------------------------------------------

const camera = new Camera();
const renderer = new Renderer(canvas, camera);
function createGame(): Game {
  const saved = loadAutosave();
  if (saved) {
    try {
      return new Game(saved);
    } catch (err) {
      console.warn("The autosaved level could not be loaded, so the example is shown instead.", err);
    }
  }
  return new Game(firstMarbleRun);
}
const game = createGame();
if (game.level.camera) camera.set(game.level.camera);

const editor = new Editor(game, camera, canvas);
const inventory = new Inventory();
new Palette($("#palette"), editor, inventory);
new Inspector($("#inspector"), editor, inventory);
const controlPanel = new ControlPanel($("#controls"), game);
attachViewControls(canvas, camera, (e) => !editor.enabled || e.button === 1 || e.button === 2 || editor.panKey);

// While building, holding Space and dragging pans. A quick tap of Space still plays.
let pannedWithSpace = false;
canvas.addEventListener("pointerdown", () => {
  if (editor.panKey) pannedWithSpace = true;
});
function setPanKey(on: boolean): void {
  editor.panKey = on;
  canvas.style.cursor = on ? "grab" : editor.tool === "select" ? "" : "crosshair";
}

editor.events.on("change", (level) => {
  autosave(level);
  updateButtons();
});

function openLevel(level: LevelData): void {
  editor.loadLevel(level);
  if (level.camera) camera.set(level.camera);
  updateButtons();
}

for (const [i, level] of builtinLevels.entries()) {
  const option = document.createElement("option");
  option.value = String(i);
  option.textContent = level.name;
  examples.append(option);
}
examples.addEventListener("change", () => {
  const level = builtinLevels[Number(examples.value)];
  examples.value = "";
  if (level && confirmReplace()) openLevel(level);
});

$("#new").addEventListener("click", () => {
  if (confirmReplace()) openLevel(blankLevel());
});

function confirmReplace(): boolean {
  return editor.history.canUndo ? window.confirm("Replace the current level? Save it to a file first if you want to keep it.") : true;
}

// ---- Play / build ------------------------------------------------------------

let finished = 0;
let lastFinishTime: number | null = null;
game.events.on("finish", ({ time }) => {
  finished++;
  lastFinishTime = time;
});
game.events.on("load", () => {
  finished = 0;
  lastFinishTime = null;
});

function togglePlay(): void {
  if (game.running) game.pause();
  else {
    editor.setTool("select");
    // Welds that were opened for editing close up again before anything moves.
    editor.exitGroup(true);
    game.commit();
    game.play();
    controlPanel.refresh();
  }
  updateButtons();
}

function stop(): void {
  game.input.clear();
  controlPanel.hide();
  game.reset();
  editor.select(editor.selected);
  updateButtons();
}

function updateButtons(): void {
  playButton.textContent = game.running ? "⏸ Pause" : game.started ? "▶ Resume" : "▶ Play";
  stopButton.disabled = !game.started;
  undoButton.disabled = game.started || !editor.history.canUndo;
  redoButton.disabled = game.started || !editor.history.canRedo;
  document.body.classList.toggle("playing", game.started);
  hint.textContent = game.started
    ? "Playing · drag to pan · scroll to zoom · Space pauses · R stops and goes back to building"
    : "Building · drag a box to select several · Ctrl+G groups · double-click a group to go inside · Q/E rotate · Ctrl+Z undoes · right-drag or Space+drag pans · Space plays";
}

playButton.addEventListener("click", togglePlay);
stopButton.addEventListener("click", stop);
undoButton.addEventListener("click", () => editor.undo());
redoButton.addEventListener("click", () => editor.redo());

/** Keys the page would otherwise use to scroll. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) {
    if (!(t instanceof HTMLInputElement && t.type === "range" && game.started)) return;
  }
  if (game.started && !e.ctrlKey && !e.metaKey && e.code !== "Space" && e.code !== "KeyR") {
    game.input.press(e.code);
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (game.started) togglePlay();
    else if (!e.repeat) {
      pannedWithSpace = false;
      setPanKey(true);
    }
  } else if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey && game.started) {
    stop();
  } else if (editor.handleKey(e)) {
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  game.input.release(e.code);
  if (e.code === "Space" && editor.panKey) {
    setPanKey(false);
    if (!pannedWithSpace) togglePlay();
  }
});
window.addEventListener("blur", () => {
  game.input.keys.clear();
  setPanKey(false);
});

// ---- Files -------------------------------------------------------------------

$("#export").addEventListener("click", () => {
  game.commit();
  const level = { ...game.level, camera: camera.toData() };
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${level.name.replace(/[^\w-]+/g, "-").toLowerCase() || "level"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (!file) return;
  try {
    const level = JSON.parse(await file.text()) as LevelData;
    if (level.format !== "tinkerlab/level") throw new Error("This is not a TinkerLab level file.");
    if (game.started) stop();
    openLevel(level);
  } catch (err) {
    console.error(err);
    window.alert(`Could not open that file: ${(err as Error).message}`);
  }
});

/** While playing, keep anything tagged "player" in view. */
function followPlayer(dt: number): void {
  const tagged = game.actors.find((a) => a.tags.has("player"));
  // An assembly has no body of its own, so follow the first piece that does.
  const player = tagged instanceof Group ? [tagged, ...tagged.descendants()].find((a) => a.body) : tagged;
  if (!player?.body) return;
  const p = player.body.getPosition();
  const ease = 1 - Math.exp(-dt * 4);
  camera.x += (p.x - camera.x) * ease;
  camera.y += (p.y + 1 - camera.y) * ease;
}

// ---- Loop --------------------------------------------------------------------

const resize = () => renderer.resize();
window.addEventListener("resize", resize);
resize();
updateButtons();

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  game.tick(dt);
  last = now;
  if (game.started) followPlayer(dt);
  renderer.render(game, (r) => editor.drawOverlay(r));
  if (game.started) {
    const timeText = lastFinishTime === null ? "" : ` · last at ${lastFinishTime.toFixed(1)}s`;
    hud.textContent = `${game.level.name} · ${game.time.toFixed(1)}s · finished ${finished}${timeText}`;
  } else {
    hud.textContent = `${game.level.name} · building`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
