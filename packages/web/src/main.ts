import { PROTOCOL_VERSION } from "@retro64/shared";
import { acceptedExtensions, isRomExtensionSupported, SUPPORTED_CONSOLES } from "./emulator/consoles";
import { EmulatorEngine } from "./emulator/engine";
import { InputSourceDetector, type InputSourceState } from "./input/input-source";
import "./style.css";

// App shell entrypoint. Wires the real emulator engine integration (DMI-9),
// local ROM upload (DMI-8) and input-device detection (DMI-18) into the page.
// The landing/lobby flow (DMI-25) lands in a later ticket. The ROM file is read
// entirely client-side via the File API and handed straight to the emulator
// engine — it is never uploaded to a server.

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

const defaultConsoleId = SUPPORTED_CONSOLES[0]?.id;

app.innerHTML = `
  <main>
    <h1>RETRO64</h1>
    <p>Play retro games online with friends. Rebuild in progress.</p>
    <small>protocol v${PROTOCOL_VERSION}</small>

    <section id="emulator">
      <label for="console-select">Console</label>
      <select id="console-select">
        ${SUPPORTED_CONSOLES.map(
          (console) => `<option value="${console.id}">${console.label}</option>`,
        ).join("")}
      </select>
      <label for="rom-input">ROM file</label>
      <input type="file" id="rom-input" accept="${[...new Set(SUPPORTED_CONSOLES.flatMap((console) => acceptedExtensions(console.id)))].join(",")}" />
      <div id="controls">
        <button id="load" disabled>Load ROM</button>
        <button id="pause" disabled>Pause</button>
        <button id="resume" disabled>Resume</button>
        <button id="stop" disabled>Stop</button>
      </div>
      <p id="status">Choose a ROM file for the selected console.</p>
      <canvas id="emulator-canvas" style="display: block; width: min(90vw, 640px); aspect-ratio: 4 / 3;"></canvas>
    </section>

    <section id="input-status" aria-live="polite">
      <span id="input-source-chip" data-input-source="keyboard">KEYBOARD</span>
      <span id="input-source-detail">No gamepad detected — keyboard controls active.</span>
    </section>
  </main>
`;

const consoleSelect = document.querySelector<HTMLSelectElement>("#console-select")!;
const romInput = document.querySelector<HTMLInputElement>("#rom-input")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const loadButton = document.querySelector<HTMLButtonElement>("#load")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
// Nostalgist/Emscripten renames the canvas element's id (to "canvas") once the
// emulator launches, so a later re-lookup by the original "#emulator-canvas"
// selector fails on relaunch. Capture the element once and reuse the reference.
const canvasEl = document.querySelector<HTMLCanvasElement>("#emulator-canvas")!;
const inputChipEl = document.querySelector<HTMLSpanElement>("#input-source-chip")!;
const inputDetailEl = document.querySelector<HTMLSpanElement>("#input-source-detail")!;

if (defaultConsoleId) consoleSelect.value = defaultConsoleId;

const engine = new EmulatorEngine();
let selectedRom: File | undefined;

// Input-device detection (DMI-18). `subscribe` fires immediately with the
// current state, so the chip is correct on first paint rather than after the
// first connect/disconnect.
const inputDetector = new InputSourceDetector();
inputDetector.subscribe(renderInputSource);
inputDetector.start();

consoleSelect.addEventListener("change", () => {
  // The accepted formats depend on the console, so re-validate the already
  // chosen file (if any) against the newly selected console.
  if (selectedRom) validateSelectedRom(selectedRom);
});
romInput.addEventListener("change", () => {
  const file = romInput.files?.[0];
  if (file) validateSelectedRom(file);
});
loadButton.addEventListener("click", () => void loadRom());
pauseButton.addEventListener("click", () => {
  engine.pause();
  setControlsForStatus("paused");
});
resumeButton.addEventListener("click", () => {
  engine.resume();
  setControlsForStatus("running");
});
stopButton.addEventListener("click", () => {
  engine.stop();
  statusEl.textContent = "Stopped.";
  setControlsForStatus("idle");
});

function renderInputSource(state: InputSourceState): void {
  inputChipEl.dataset.inputSource = state.active;
  inputChipEl.textContent = state.active === "gamepad" ? "GAMEPAD" : "KEYBOARD";
  inputDetailEl.textContent = describeInputSource(state);
}

function describeInputSource({ gamepads }: InputSourceState): string {
  const [first, ...others] = gamepads;
  if (!first) return "No gamepad detected — keyboard controls active.";

  const extra = others.length > 0 ? ` (+${others.length} more)` : "";
  return `Gamepad connected: ${first.id}${extra}.`;
}

function validateSelectedRom(file: File): void {
  if (!isRomExtensionSupported(file.name, consoleSelect.value)) {
    selectedRom = undefined;
    statusEl.textContent = `Unsupported file for the selected console. Expected: ${acceptedExtensions(
      consoleSelect.value,
    ).join(", ")}.`;
    setControlsForStatus("idle");
    return;
  }

  selectedRom = file;
  statusEl.textContent = `Ready to load "${file.name}".`;
  setControlsForStatus("idle");
}

async function loadRom(): Promise<void> {
  if (!selectedRom) return;

  setControlsForStatus("loading");
  statusEl.textContent = "Loading…";

  try {
    await engine.launch({
      consoleId: consoleSelect.value,
      rom: selectedRom,
      element: canvasEl,
    });
    statusEl.textContent = "Running.";
    setControlsForStatus("running");
  } catch (error) {
    statusEl.textContent = `Failed to load: ${error instanceof Error ? error.message : String(error)}`;
    setControlsForStatus("idle");
  }
}

function setControlsForStatus(status: "idle" | "loading" | "running" | "paused"): void {
  loadButton.disabled = !selectedRom || status === "loading" || status === "running" || status === "paused";
  pauseButton.disabled = status !== "running";
  resumeButton.disabled = status !== "paused";
  stopButton.disabled = status === "idle" || status === "loading";
  consoleSelect.disabled = status !== "idle";
  romInput.disabled = status !== "idle";
}
