// Gamepad detection with automatic keyboard fallback (DMI-18).
//
// Scope is detection only: this module answers "which device is the player
// expected to use right now?" and notifies when that answer changes. Feeding
// input into the emulator core and letting the player rebind buttons are
// separate tickets (DMI-14 input sync, DMI-17 remapping UI, DMI-16 per-console
// profiles) — nothing here assumes how they'll do it.

export type InputSource = "gamepad" | "keyboard";

export interface ConnectedGamepad {
  index: number;
  id: string;
}

export interface InputSourceState {
  /** Gamepad when the browser reports at least one connected, keyboard otherwise. */
  active: InputSource;
  /** Every gamepad the browser currently reports as connected, lowest index first. */
  gamepads: ConnectedGamepad[];
}

export type InputSourceListener = (state: InputSourceState) => void;

/**
 * How often the connected-gamepad snapshot is reconciled, in ms. Slow enough to
 * be invisible next to the emulator's own frame loop, fast enough that a
 * connect/disconnect the player performs reads as immediate.
 */
const POLL_INTERVAL_MS = 250;

/**
 * Tracks which input device is available and notifies subscribers on change.
 *
 * Keyboard is the resting state: with no gamepad connected the active source is
 * always `"keyboard"`, so the fallback needs no separate trigger — it's what
 * the detector reports whenever the gamepad list is empty.
 */
export class InputSourceDetector {
  private readonly listeners = new Set<InputSourceListener>();
  private state: InputSourceState = { active: "keyboard", gamepads: [] };
  private pollTimer: number | undefined;
  private started = false;

  private readonly handleGamepadChange = (): void => {
    // The event only says "something changed"; the authoritative list is the
    // browser's own snapshot. Re-reading it instead of trusting the event's
    // payload keeps one source of truth and makes a missed event recoverable
    // by the poll in start().
    this.sync();
  };

  getState(): InputSourceState {
    return { active: this.state.active, gamepads: [...this.state.gamepads] };
  }

  /** Subscribes and immediately delivers the current state. Returns an unsubscribe fn. */
  subscribe(listener: InputSourceListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    window.addEventListener("gamepadconnected", this.handleGamepadChange);
    window.addEventListener("gamepaddisconnected", this.handleGamepadChange);

    // Events alone are not enough. `gamepadconnected` fires only while this
    // page is live, so a controller the browser already knew about (reload,
    // in-app navigation) never produces one — its first appearance is in
    // `navigator.getGamepads()`. The poll picks that up, and covers a dropped
    // disconnect event too.
    this.pollTimer = window.setInterval(() => this.sync(), POLL_INTERVAL_MS);

    this.sync();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    window.removeEventListener("gamepadconnected", this.handleGamepadChange);
    window.removeEventListener("gamepaddisconnected", this.handleGamepadChange);

    if (this.pollTimer !== undefined) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private sync(): void {
    const gamepads = readConnectedGamepads();
    const next: InputSourceState = {
      active: gamepads.length > 0 ? "gamepad" : "keyboard",
      gamepads,
    };

    if (signature(next) === signature(this.state)) return;

    this.state = next;
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function readConnectedGamepads(): ConnectedGamepad[] {
  // A browser without the Gamepad API isn't an error — "no gamepad" is a valid
  // answer, and the keyboard fallback is exactly what should happen there.
  if (typeof navigator.getGamepads !== "function") return [];

  return [...navigator.getGamepads()]
    .filter((pad): pad is Gamepad => pad !== null && pad.connected)
    .map((pad) => ({ index: pad.index, id: pad.id }))
    .sort((a, b) => a.index - b.index);
}

/** Change detection: only notify when the active source or the pad list really moved. */
function signature(state: InputSourceState): string {
  const pads = state.gamepads.map((pad) => `${pad.index}:${pad.id}`).join(",");
  return `${state.active}|${pads}`;
}
