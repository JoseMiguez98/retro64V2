import type { Page } from "@playwright/test";

/**
 * In-page control over what the Gamepad API reports.
 *
 * **What this substitutes, and what it doesn't.** A CI runner has no physical
 * controller and no browser exposes a way to fake one, so this replaces the
 * *device* — `navigator.getGamepads()` and the connect/disconnect events — the
 * same way `page.keyboard.press()` replaces fingers. Everything under test is
 * still the real thing: the real browser, the real app bundle, the real
 * `InputSourceDetector`, the real DOM it renders. Nothing about the detector or
 * the fallback logic is mocked.
 *
 * The one thing it therefore cannot prove is that a real controller's HID
 * plumbing reaches the browser — that's the platform's job, not the app's.
 */

export interface FakeGamepad {
  index: number;
  id: string;
}

export interface DispatchOptions {
  /**
   * Whether to fire the corresponding `gamepad{connected,disconnected}` event.
   *
   * `false` leaves only the `navigator.getGamepads()` snapshot changed, which is
   * the real situation the detector's poll exists for: a controller the browser
   * already knew about before this page existed never produces an event.
   */
  dispatchEvent: boolean;
}

declare global {
  interface Window {
    __gamepads: {
      /** Exactly what the patched `navigator.getGamepads()` returns. */
      pads: Gamepad[];
      connect(pad: FakeGamepad, options: DispatchOptions): void;
      disconnect(index: number, options: DispatchOptions): void;
    };
  }
}

/**
 * Installs the harness so it is in place *before* any app script runs — the
 * detector reads the gamepad list during module init, so patching afterwards
 * would race the first paint.
 *
 * Must be called before `page.goto()`.
 */
export async function installGamepadHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pads: Gamepad[] = [];

    const makePad = ({ index, id }: { index: number; id: string }): Gamepad =>
      // Only the fields the app reads are meaningful; the rest exist to satisfy
      // the shape of a Gamepad.
      ({
        index,
        id,
        connected: true,
        mapping: "standard",
        axes: [],
        buttons: [],
        timestamp: 0,
      }) as unknown as Gamepad;

    // A plain `Event`, not a `GamepadEvent`: the constructor of the latter
    // rejects anything that isn't a genuine `Gamepad`. This is faithful for the
    // app's purposes because the detector deliberately ignores the event payload
    // and re-reads `navigator.getGamepads()` — the event only means "something
    // changed", which is exactly what this carries.
    const fire = (type: "gamepadconnected" | "gamepaddisconnected") => {
      window.dispatchEvent(new Event(type));
    };

    window.__gamepads = {
      pads,
      connect(pad, { dispatchEvent }) {
        pads.push(makePad(pad));
        if (dispatchEvent) fire("gamepadconnected");
      },
      disconnect(index, { dispatchEvent }) {
        const at = pads.findIndex((pad) => pad.index === index);
        if (at >= 0) pads.splice(at, 1);
        if (dispatchEvent) fire("gamepaddisconnected");
      },
    };

    // `defineProperty` rather than plain assignment: `getGamepads` lives on
    // `Navigator.prototype`, and Firefox won't let a bare assignment shadow it.
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => window.__gamepads.pads,
    });
  });
}

export function connectGamepad(
  page: Page,
  pad: FakeGamepad,
  options: DispatchOptions = { dispatchEvent: true },
): Promise<void> {
  return page.evaluate(
    ({ pad, options }) => window.__gamepads.connect(pad, options),
    { pad, options },
  );
}

export function disconnectGamepad(
  page: Page,
  index: number,
  options: DispatchOptions = { dispatchEvent: true },
): Promise<void> {
  return page.evaluate(
    ({ index, options }) => window.__gamepads.disconnect(index, options),
    { index, options },
  );
}
