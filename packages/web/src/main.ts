import { acceptedExtensions, isRomExtensionSupported, SUPPORTED_CONSOLES } from "./emulator/consoles";
import { EmulatorEngine } from "./emulator/engine";
import { InputSourceDetector, type InputSourceState } from "./input/input-source";
import { describeRoomError, RoomClient, type RoomClientState } from "./lobby/room-client";
import { appShellMarkup } from "./ui/app-shell";
import "./style.css";

// App shell entrypoint. Wires the landing → lobby → session flow (DMI-25) on
// top of the pieces that already existed: the emulator engine (DMI-9), local
// ROM upload (DMI-8), input-device detection (DMI-18) and the short-code room
// protocol (DMI-20).
//
// The ROM is read entirely client-side via the File API and handed straight to
// the emulator — it is never uploaded anywhere, room or not.

type View = "landing" | "lobby" | "session";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = appShellMarkup();

const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`${selector} not found in the app shell`);
  return element;
};

const shell = $<HTMLDivElement>(".app");

// Landing
const consoleSelect = $<HTMLSelectElement>("#console-select");
const romInput = $<HTMLInputElement>("#rom-input");
const romStatusEl = $<HTMLParagraphElement>("#rom-status");
const createRoomButton = $<HTMLButtonElement>("#create-room");
const joinForm = $<HTMLFormElement>("#join-form");
const joinCodeInput = $<HTMLInputElement>("#join-code");
const joinRoomButton = $<HTMLButtonElement>("#join-room");
const roomHintEl = $<HTMLParagraphElement>("#room-hint");
const roomErrorEl = $<HTMLParagraphElement>("#room-error");

// Lobby
const roomCodeEl = $<HTMLParagraphElement>("#room-code");
const copyCodeButton = $<HTMLButtonElement>("#copy-code");
const leaveLobbyButton = $<HTMLButtonElement>("#leave-lobby");
const lobbyStatusEl = $<HTMLParagraphElement>("#lobby-status");
const lobbyRomEl = $<HTMLSpanElement>("#lobby-rom");

// Session
const sessionCodeEl = $<HTMLSpanElement>("#session-code");
const sessionRoleEl = $<HTMLSpanElement>("#session-role");
const leaveSessionButton = $<HTMLButtonElement>("#leave-session");
const sessionAlertEl = $<HTMLParagraphElement>("#session-alert");
const statusEl = $<HTMLParagraphElement>("#status");
const loadButton = $<HTMLButtonElement>("#load");
const pauseButton = $<HTMLButtonElement>("#pause");
const resumeButton = $<HTMLButtonElement>("#resume");
const stopButton = $<HTMLButtonElement>("#stop");
// Nostalgist/Emscripten renames the canvas element's id (to "canvas") once the
// emulator launches, so a later re-lookup by the original "#emulator-canvas"
// selector fails on relaunch. Capture the element once and reuse the reference.
const canvasEl = $<HTMLCanvasElement>("#emulator-canvas");

// Status bar
const signalingChipEl = $<HTMLSpanElement>("#signaling-chip");
const inputChipEl = $<HTMLSpanElement>("#input-source-chip");
const inputDetailEl = $<HTMLSpanElement>("#input-source-detail");

const engine = new EmulatorEngine();
const room = new RoomClient();

let view: View = "landing";
/** The file the user picked, valid for the current console or not. */
let pickedRom: File | undefined;
/** `pickedRom`, once it's valid for the selected console. Gates the room actions. */
let selectedRom: File | undefined;

const defaultConsoleId = SUPPORTED_CONSOLES[0]?.id;
if (defaultConsoleId) consoleSelect.value = defaultConsoleId;

// --- Views ---------------------------------------------------------------

function setView(next: View): void {
  if (view === next) return;
  view = next;
  shell.dataset.view = next;
  // Focus the code field as soon as the landing is the screen being looked at,
  // since typing a code is the only reason to come back to it mid-flow.
  if (next === "landing" && room.snapshot.membership === null) joinCodeInput.blur();
}

/**
 * Derives the visible view from the room state.
 *
 * The one rule that isn't a pure mapping: once the session is on screen it
 * stays on screen until the peer explicitly leaves. A partner disconnecting
 * clears `paired`, but yanking someone out of a running game to a lobby screen
 * would throw away their emulator session — they get a banner instead.
 */
function syncView(state: RoomClientState): void {
  if (!state.membership) return setView("landing");
  if (state.paired || view === "session") return setView("session");
  setView("lobby");
}

// --- Room state rendering ------------------------------------------------

room.subscribe(renderRoom);
room.connect();

function renderRoom(state: RoomClientState): void {
  renderConnection(state);
  renderRoomError(state);
  renderLobby(state);
  renderSession(state);
  renderRoomActions(state);
  syncView(state);
}

function renderConnection({ connection }: RoomClientState): void {
  signalingChipEl.dataset.connection = connection;
  signalingChipEl.textContent =
    connection === "online" ? "SIGNALING ONLINE" : connection === "connecting" ? "SIGNALING…" : "SIGNALING OFFLINE";
}

function renderRoomError({ error }: RoomClientState): void {
  if (!error) {
    roomErrorEl.hidden = true;
    roomErrorEl.textContent = "";
    return;
  }
  roomErrorEl.hidden = false;
  roomErrorEl.textContent = describeRoomError(error);
}

function renderLobby({ membership }: RoomClientState): void {
  roomCodeEl.textContent = membership?.code ?? "------";
  lobbyRomEl.textContent = selectedRom?.name ?? "—";
}

function renderSession({ membership, paired, peerLeft }: RoomClientState): void {
  sessionCodeEl.textContent = membership?.code ?? "------";
  sessionRoleEl.textContent = membership?.role === "guest" ? "GUEST" : "HOST";

  // Only meaningful in the session view: the lobby's own status line already
  // says "waiting", so a peer that never arrived isn't an alert there.
  if (peerLeft && !paired) {
    sessionAlertEl.hidden = false;
    sessionAlertEl.textContent = `The other player left. Room ${
      membership?.code ?? ""
    } is still open — they can rejoin with the same code, or you can leave.`;
  } else {
    sessionAlertEl.hidden = true;
    sessionAlertEl.textContent = "";
  }
}

/**
 * The two landing actions are gated on a ROM being selected: a peer that joins
 * without one lands in a session with nothing to run, which is exactly the
 * dead-end this ticket's second criterion rules out. The hint says why the
 * buttons are off, so the gate reads as a next step rather than a broken
 * control.
 */
function renderRoomActions({ connection, pending, membership }: RoomClientState): void {
  const online = connection === "online";
  const ready = online && Boolean(selectedRom) && !membership;

  createRoomButton.disabled = !ready || pending !== null;
  joinRoomButton.disabled = !ready || pending !== null;
  joinCodeInput.disabled = !ready || pending !== null;

  if (pending === "create") {
    roomHintEl.textContent = "Opening a room…";
  } else if (pending === "join") {
    roomHintEl.textContent = "Joining…";
  } else if (!online) {
    roomHintEl.textContent = "Connecting to the room server…";
  } else if (!selectedRom) {
    roomHintEl.textContent = "Load a ROM first — both players need one before a room is any use.";
  } else {
    roomHintEl.textContent = `Ready to play "${selectedRom.name}".`;
  }
}

// --- Landing: ROM selection ----------------------------------------------

consoleSelect.addEventListener("change", () => {
  // The accepted formats depend on the console, so re-validate the picked file
  // against the newly selected console. This re-reads `pickedRom` rather than
  // `selectedRom` on purpose: a file rejected a moment ago is usually a file
  // picked with the wrong console still selected, and dropping it would make
  // correcting the console impossible without re-opening the file picker.
  if (pickedRom) validatePickedRom(pickedRom);
});

romInput.addEventListener("change", () => {
  const file = romInput.files?.[0];
  if (file) validatePickedRom(file);
});

function validatePickedRom(file: File): void {
  pickedRom = file;

  if (!isRomExtensionSupported(file.name, consoleSelect.value)) {
    selectedRom = undefined;
    romStatusEl.textContent = `Unsupported file for the selected console. Expected: ${acceptedExtensions(
      consoleSelect.value,
    ).join(", ")}. Pick another file, or switch the console above.`;
  } else {
    selectedRom = file;
    romStatusEl.textContent = `Ready to load "${file.name}".`;
  }

  setControlsForStatus("idle");
  renderRoom(room.snapshot);
}

// --- Landing: room actions -----------------------------------------------

createRoomButton.addEventListener("click", () => room.create());

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = joinCodeInput.value.trim();
  if (!code) return;
  room.join(code);
});

// Codes are uppercase (ROOM_CODE_ALPHABET); normalising as the user types keeps
// what's on screen identical to what the server will look up.
joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase();
});

// --- Lobby ---------------------------------------------------------------

copyCodeButton.addEventListener("click", () => void copyRoomCode());

async function copyRoomCode(): Promise<void> {
  const code = room.snapshot.membership?.code;
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    lobbyStatusEl.textContent = `Code ${code} copied — waiting for player 2…`;
  } catch {
    // Clipboard access is permission-gated and can simply be refused. The code
    // is on screen either way, so this is a nicety failing, not the flow.
    lobbyStatusEl.textContent = `Couldn't reach the clipboard — read the code out instead. Waiting for player 2…`;
  }
}

leaveLobbyButton.addEventListener("click", leaveRoom);
leaveSessionButton.addEventListener("click", leaveRoom);

function leaveRoom(): void {
  engine.stop();
  statusEl.textContent = "Ready when you are.";
  setControlsForStatus("idle");
  lobbyStatusEl.textContent = "Waiting for player 2…";
  joinCodeInput.value = "";
  // Force the view back before the reconnect lands, so leaving is instant
  // rather than waiting on a socket round-trip.
  view = "session";
  setView("landing");
  room.leave();
}

// --- Session: emulator controls ------------------------------------------

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

// --- Input devices (DMI-18) ----------------------------------------------

// `subscribe` fires immediately with the current state, so the chip is correct
// on first paint rather than after the first connect/disconnect.
const inputDetector = new InputSourceDetector();
inputDetector.subscribe(renderInputSource);
inputDetector.start();

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
