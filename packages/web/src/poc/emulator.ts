import { Nostalgist } from "nostalgist";
import "../style.css";

// Throwaway POC for DMI-3 — proves a single ROM loads and runs in-browser
// via a libretro WASM core through Nostalgist.js. Not production code;
// real integration into the app shell is DMI-9.

const romPath = import.meta.env.VITE_ROM_PATH as string | undefined;
const coreId = import.meta.env.VITE_ROM_CORE as string | undefined;

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main>
      <h1>RETRO64 — emulator engine POC (DMI-3)</h1>
      <p id="status">${
        romPath && coreId
          ? "Ready. Click Load ROM to launch it."
          : "Set VITE_ROM_PATH and VITE_ROM_CORE in packages/web/.env.local, then reload."
      }</p>
      <button id="load" ${romPath && coreId ? "" : "disabled"}>Load ROM</button>
      <canvas id="emulator-canvas" style="display: block; width: min(90vw, 640px); aspect-ratio: 4 / 3;"></canvas>
    </main>
  `;
}

const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const loadButton = document.querySelector<HTMLButtonElement>("#load");

loadButton?.addEventListener("click", () => {
  void launchRom();
});

async function launchRom(): Promise<void> {
  if (!romPath || !coreId || !statusEl || !loadButton) {
    return;
  }

  loadButton.disabled = true;
  statusEl.textContent = "Loading…";

  try {
    await Nostalgist.launch({
      core: coreId,
      rom: romPath,
      element: "#emulator-canvas",
    });
    statusEl.textContent = "Running.";
  } catch (error) {
    statusEl.textContent = `Failed to load: ${error instanceof Error ? error.message : String(error)}`;
    loadButton.disabled = false;
  }
}
