import { expect, test } from "@playwright/test";
import { connectGamepad, disconnectGamepad, installGamepadHarness } from "./support/gamepad-harness";

/**
 * DMI-18 — "Gamepad detection + keyboard fallback".
 *
 * Acceptance criteria this spec asserts:
 *   1. The Gamepad API detects controller connect/disconnect in real time
 *   2. Automatic fallback to the keyboard when no gamepad is connected
 *   3. Works in Chrome and Firefox at minimum
 *
 * Criterion 3 isn't a `test()` — it's a matrix. `playwright.config.ts` runs this
 * file under both the `chromium` and `firefox` projects, so every assertion below
 * is executed twice, once per engine. A single-browser green run does *not*
 * satisfy it; the second project passing is the evidence.
 *
 * "Real time" is asserted with tight per-expectation timeouts rather than the
 * suite default (15s): an event-driven update that took ten seconds would still
 * pass a default assertion while plainly failing the criterion.
 *
 * What's simulated and what isn't: see the note in `support/gamepad-harness.ts`.
 * The device is faked because CI has no controller; the detector, the fallback
 * and the DOM under assertion are the real app.
 */

const CHIP = "#input-source-chip";
const DETAIL = "#input-source-detail";

/** An event-driven update should be near-instant; this is generous, not lax. */
const REALTIME_MS = 2_000;
/** The detector reconciles the snapshot every 250ms — a few cycles of headroom. */
const POLL_MS = 3_000;

test.describe("DMI-18 gamepad detection + keyboard fallback", () => {
  test.beforeEach(async ({ page }) => {
    // Before goto: the detector reads the gamepad list during module init.
    await installGamepadHarness(page);
    await page.goto("/");
  });

  test("AC1 — detects a controller connecting, in real time", async ({ page }) => {
    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "keyboard");

    await connectGamepad(page, { index: 0, id: "Retro64 Test Pad" });

    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "gamepad", {
      timeout: REALTIME_MS,
    });
    await expect(page.locator(CHIP)).toHaveText("GAMEPAD");
    // The identity of the pad, not just its presence — this is what a remapping
    // UI (DMI-17) will need to key off.
    await expect(page.locator(DETAIL)).toContainText("Retro64 Test Pad");
  });

  test("AC1 — detects that same controller disconnecting, in real time", async ({ page }) => {
    await connectGamepad(page, { index: 0, id: "Retro64 Test Pad" });
    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "gamepad", {
      timeout: REALTIME_MS,
    });

    await disconnectGamepad(page, 0);

    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "keyboard", {
      timeout: REALTIME_MS,
    });
    await expect(page.locator(DETAIL)).toContainText("keyboard controls active");
  });

  test("AC1 — notices a controller that arrives with no event at all", async ({ page }) => {
    // The case events can't cover: a controller the browser already knew about
    // before this page loaded never fires `gamepadconnected`. Only the
    // detector's poll closes that gap, so this asserts the poll specifically.
    await connectGamepad(page, { index: 0, id: "Silent Pad" }, { dispatchEvent: false });

    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "gamepad", {
      timeout: POLL_MS,
    });
    await expect(page.locator(DETAIL)).toContainText("Silent Pad");
  });

  test("AC2 — falls back to the keyboard when no gamepad is connected", async ({ page }) => {
    // Fresh load, empty gamepad list: keyboard is the resting state, reached
    // without any user action or prior gamepad ever being present.
    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "keyboard");
    await expect(page.locator(CHIP)).toHaveText("KEYBOARD");
    await expect(page.locator(DETAIL)).toHaveText("No gamepad detected — keyboard controls active.");

    // And it's a fallback, not just an initial value: losing the only pad
    // returns to it on its own.
    await connectGamepad(page, { index: 0, id: "Retro64 Test Pad" });
    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "gamepad", {
      timeout: REALTIME_MS,
    });

    await disconnectGamepad(page, 0);
    await expect(page.locator(CHIP)).toHaveAttribute("data-input-source", "keyboard", {
      timeout: REALTIME_MS,
    });
  });
});
