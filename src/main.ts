import { registerBuiltinActors } from "./actors";
import { Camera } from "./core/Camera";
import { Game } from "./core/Game";
import { Renderer } from "./core/Renderer";
import { attachViewControls } from "./core/viewControls";
import type { LevelData } from "./core/types";
import { firstMarbleRun } from "./levels";

registerBuiltinActors();

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const hud = document.querySelector<HTMLDivElement>("#hud")!;
const playButton = document.querySelector<HTMLButtonElement>("#play")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const importInput = document.querySelector<HTMLInputElement>("#import")!;

const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const game = new Game(firstMarbleRun);
if (game.level.camera) camera.set(game.level.camera);

let finished = 0;
let lastFinishTime: number | null = null;
game.events.on("finish", ({ time }) => {
  finished++;
  lastFinishTime = time;
});
game.events.on("load", ({ level }) => {
  finished = 0;
  lastFinishTime = null;
  if (level.camera) camera.set(level.camera);
});

function togglePlay(): void {
  if (game.running) game.pause();
  else game.play();
}

function updateButtons(): void {
  playButton.textContent = game.running ? "⏸ Pause" : "▶ Play";
}
game.events.on("play", updateButtons);
game.events.on("pause", updateButtons);
game.events.on("load", updateButtons);

playButton.addEventListener("click", togglePlay);
resetButton.addEventListener("click", () => game.reset());

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.code === "KeyR") {
    game.reset();
  }
});

exportButton.addEventListener("click", () => {
  const level = game.serialize(camera.toData());
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${level.name.replace(/[^\w-]+/g, "-").toLowerCase() || "level"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    const level = JSON.parse(await file.text()) as LevelData;
    if (level.format !== "tinkerlab/level") throw new Error("This is not a TinkerLab level file.");
    game.load(level);
  } catch (err) {
    console.error(err);
    hud.textContent = `Could not open that file: ${(err as Error).message}`;
  }
  importInput.value = "";
});

attachViewControls(canvas, camera);

const resize = () => renderer.resize();
window.addEventListener("resize", resize);
resize();

let last = performance.now();
function frame(now: number): void {
  game.tick((now - last) / 1000);
  last = now;
  renderer.render(game);
  const timeText = lastFinishTime === null ? "" : ` · last at ${lastFinishTime.toFixed(1)}s`;
  hud.textContent = `${game.level.name} · ${game.time.toFixed(1)}s · finished ${finished}${timeText}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
