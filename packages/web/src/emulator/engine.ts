import { Nostalgist } from "nostalgist";
import { findConsole } from "./consoles";

// Real integration of the libretro/Nostalgist.js engine into the app shell
// (DMI-9). Supersedes the throwaway POC from DMI-3 (packages/web/src/poc/emulator.ts,
// now removed) with a typed, reusable wrapper the rest of the app can drive.

export type EmulatorStatus = "idle" | "loading" | "running" | "paused" | "error";

export interface LaunchOptions {
  /** Id from packages/web/src/emulator/consoles.ts (e.g. "nes", "n64", "ps1"). */
  consoleId: string;
  /** ROM file, URL, or File object — anything Nostalgist's `rom` option accepts. */
  rom: string | File;
  /** Canvas element (or selector) the emulator renders into. */
  element: HTMLCanvasElement | string;
}

export class UnsupportedConsoleError extends Error {
  constructor(consoleId: string) {
    super(`No libretro core mapped for console "${consoleId}" — see packages/web/src/emulator/consoles.ts`);
    this.name = "UnsupportedConsoleError";
  }
}

/**
 * Thin lifecycle wrapper around a single Nostalgist emulator instance.
 * One EmulatorEngine instance manages at most one running ROM at a time —
 * call `stop()` before `launch()`-ing a different ROM.
 */
export class EmulatorEngine {
  private instance: Nostalgist | undefined;

  getStatus(): EmulatorStatus {
    if (!this.instance) return "idle";
    switch (this.instance.getStatus()) {
      case "running":
        return "running";
      case "paused":
        return "paused";
      case "terminated":
        return "idle";
      case "initial":
      default:
        return "loading";
    }
  }

  async launch({ consoleId, rom, element }: LaunchOptions): Promise<void> {
    const definition = findConsole(consoleId);
    if (!definition) {
      throw new UnsupportedConsoleError(consoleId);
    }

    if (this.instance) {
      this.stop();
    }

    this.instance = await Nostalgist.launch({
      core: definition.core,
      rom,
      element,
      bios: definition.bios ? [...definition.bios] : undefined,
    });
  }

  pause(): void {
    this.instance?.pause();
  }

  resume(): void {
    this.instance?.resume();
  }

  /** Exits the running emulator and releases the canvas. Safe to call when idle. */
  stop(): void {
    this.instance?.exit({ removeCanvas: false });
    this.instance = undefined;
  }
}
