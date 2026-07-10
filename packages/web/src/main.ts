import { PROTOCOL_VERSION } from "@retro64/shared";
import { acceptedExtensions, isRomExtensionSupported, SUPPORTED_CONSOLES } from "./emulator/consoles";
import { EmulatorEngine } from "./emulator/engine";
import "./style.css";

// App shell entrypoint. Wires the real emulator engine integration (DMI-9)
// and local ROM upload (DMI-8) into the page. The landing/lobby flow
// (DMI-25) lands in a later ticket. The ROM file is read entirely
// client-side via the File API and handed straight to the emulator engine —
// it is never uploaded to a server.

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

if (defaultConsoleId) consoleSelect.value = defaultConsoleId;

const engine = new EmulatorEngine();
let selectedRom: File | undefined;

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
