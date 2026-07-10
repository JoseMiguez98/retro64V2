import { PROTOCOL_VERSION } from "@retro64/shared";
import { SUPPORTED_CONSOLES } from "./emulator/consoles";
import { EmulatorEngine } from "./emulator/engine";
import "./style.css";

// App shell entrypoint. Wires the real emulator engine integration (DMI-9)
// into the page. ROM upload UI (DMI-8) and the landing/lobby flow (DMI-25)
// land in later tickets — until then, the ROM source is read from
// VITE_ROM_PATH so the engine integration can be exercised end to end.

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

const romPath = import.meta.env.VITE_ROM_PATH as string | undefined;
const defaultConsoleId = (import.meta.env.VITE_ROM_CONSOLE as string | undefined) ?? SUPPORTED_CONSOLES[0]?.id;

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
      <div id="controls">
        <button id="load" ${romPath ? "" : "disabled"}>Load ROM</button>
        <button id="pause" disabled>Pause</button>
        <button id="resume" disabled>Resume</button>
        <button id="stop" disabled>Stop</button>
      </div>
      <p id="status">${
        romPath ? "Ready." : "Set VITE_ROM_PATH in packages/web/.env.local, then reload."
      }</p>
      <canvas id="emulator-canvas"></canvas>
    </section>
  </main>
`;

const consoleSelect = document.querySelector<HTMLSelectElement>("#console-select")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const loadButton = document.querySelector<HTMLButtonElement>("#load")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;

if (defaultConsoleId) consoleSelect.value = defaultConsoleId;

const engine = new EmulatorEngine();

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

async function loadRom(): Promise<void> {
  if (!romPath) return;

  setControlsForStatus("loading");
  statusEl.textContent = "Loading…";

  try {
    await engine.launch({
      consoleId: consoleSelect.value,
      rom: romPath,
      element: "#emulator-canvas",
    });
    statusEl.textContent = "Running.";
    setControlsForStatus("running");
  } catch (error) {
    statusEl.textContent = `Failed to load: ${error instanceof Error ? error.message : String(error)}`;
    setControlsForStatus("idle");
  }
}

function setControlsForStatus(status: "idle" | "loading" | "running" | "paused"): void {
  loadButton.disabled = !romPath || status === "loading" || status === "running" || status === "paused";
  pauseButton.disabled = status !== "running";
  resumeButton.disabled = status !== "paused";
  stopButton.disabled = status === "idle" || status === "loading";
  consoleSelect.disabled = status !== "idle";
}
