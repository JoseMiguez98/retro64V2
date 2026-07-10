import { PROTOCOL_VERSION } from "@retro64/shared";
import "./style.css";

// Scaffolding entrypoint. Landing, lobby, and the emulator/netplay views are
// built by later tickets (DMI-25 landing, DMI-7 emulation core, DMI-11 netplay).

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <main>
      <h1>RETRO64</h1>
      <p>Play retro games online with friends. Rebuild in progress.</p>
      <small>protocol v${PROTOCOL_VERSION}</small>
    </main>
  `;
}
