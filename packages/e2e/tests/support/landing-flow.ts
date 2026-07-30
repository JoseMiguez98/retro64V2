import { expect, type Browser, type Page } from "@playwright/test";

// Helpers for driving the real landing → lobby → session UI (DMI-25).
//
// Unlike `room-peer.ts`, which speaks the `room:*` wire protocol directly to
// verify the server (DMI-20), everything here goes through the app's own
// controls: a click on the real button, a code typed into the real field. The
// thing under test in this ticket is the flow a person walks, so the test walks
// it the same way.

/**
 * A ROM the file picker accepts, built in memory.
 *
 * Only its *name* matters to this ticket: the landing gates the room actions on
 * a file whose extension matches the selected console, and nothing in DMI-25
 * boots the emulator. Launching a real core would pull a multi-megabyte WASM
 * build off a CDN to prove something that belongs to DMI-9's spec, not this one.
 */
export const FAKE_ROM = {
  name: "retro64-test.nes",
  mimeType: "application/octet-stream",
  buffer: Buffer.from("NES"),
};

/** Opens the app on a fresh context and waits until the room server is reachable. */
export async function openLanding(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await expect(page.getByTestId("signaling-chip")).toHaveAttribute("data-connection", "online");
  return page;
}

/** Picks a valid ROM, which is what unlocks the create/join actions. */
export async function selectRom(page: Page): Promise<void> {
  await page.locator("#rom-input").setInputFiles(FAKE_ROM);
  await expect(page.getByTestId("rom-status")).toContainText(FAKE_ROM.name);
}

/** Creates a room through the UI and returns the code shown in the lobby. */
export async function createRoom(page: Page): Promise<string> {
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("view-lobby")).toBeVisible();

  const code = (await page.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(code, "the lobby must show the code the host is meant to share").toMatch(
    /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
  );
  return code;
}

/** Types a code into the join field and submits it. */
export async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByTestId("join-code").fill(code);
  await page.getByTestId("join-room").click();
}

/**
 * Asserts a control can actually be operated at the current viewport size.
 *
 * Deliberately *not* "is above the fold": a landing page that scrolls
 * vertically on a 667px-tall phone is normal, and demanding otherwise would be
 * asserting a layout nobody asked for. What breaks on mobile is a control that
 * can't be reached or clicked at all — so this scrolls the way a user would,
 * then requires the element to be on screen and enabled.
 */
export async function expectReachable(page: Page, testId: string): Promise<void> {
  const control = page.getByTestId(testId);
  await control.scrollIntoViewIfNeeded();
  await expect(control, `${testId} is not reachable at this viewport`).toBeInViewport();
  await expect(control).toBeEnabled();
}

/**
 * True when the page needs a horizontal scroll to be read — the failure mode
 * "doesn't break on mobile" is really about.
 */
export function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/**
 * Every element that sticks out past the right edge of the viewport, by test id
 * or selector, so a failure names the offender instead of just the symptom.
 */
export function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders: string[] = [];

    for (const element of document.querySelectorAll<HTMLElement>(".app *")) {
      // Only elements actually on screen — the two hidden views are irrelevant.
      if (element.offsetParent === null && element.tagName !== "BODY") continue;
      const { right, width } = element.getBoundingClientRect();
      if (width > 0 && right > limit + 1) {
        const id = element.dataset.testid ?? element.id ?? element.className;
        offenders.push(`${element.tagName.toLowerCase()}[${id}] right=${Math.round(right)}`);
      }
    }

    return offenders;
  });
}
