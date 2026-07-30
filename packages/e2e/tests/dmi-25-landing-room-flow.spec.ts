import { expect, test } from "@playwright/test";
import {
  createRoom,
  expectReachable,
  hasHorizontalOverflow,
  joinRoom,
  openLanding,
  overflowingElements,
  selectRom,
} from "./support/landing-flow";

/**
 * DMI-25 — "Landing and room creation/join flow".
 *
 * Acceptance criteria this spec asserts, one or more `test()` per criterion:
 *   1. Landing shows the option to load a ROM + create or join a room
 *   2. Full flow navigable with no dead-ends
 *   3. Basic responsive (works on desktop, doesn't break on mobile)
 *
 * Every assertion drives the real UI against the real signaling server — the
 * codes here are the ones the server actually minted, and the second peer joins
 * by typing one into the real field. Nothing stubs the room protocol.
 *
 * Criterion 2 is the one that needs the most tests, because "no dead-ends" is a
 * claim about *every* state, not about the happy path: a screen with no way
 * back, a rejected join that leaves the form unusable, and a partner who
 * disappears mid-session are all dead-ends, and each gets its own test below.
 *
 * What this spec does not do is boot the emulator — a libretro core is DMI-9's
 * surface, and pulling one over the network would make this suite's result
 * depend on a CDN rather than on the flow.
 */

test.describe("DMI-25 landing → lobby → session", () => {
  test("AC1 — the landing offers a ROM to load and both ways into a room", async ({ browser }) => {
    const page = await openLanding(browser);

    await expect(page.getByTestId("view-landing")).toBeVisible();

    // Load a ROM: console picker + file input, both on the landing itself.
    await expect(page.locator("#console-select")).toBeVisible();
    await expect(page.locator("#rom-input")).toBeVisible();

    // …and the two ways into a room, side by side.
    await expect(page.getByTestId("create-room")).toBeVisible();
    await expect(page.getByTestId("join-code")).toBeVisible();
    await expect(page.getByTestId("join-room")).toBeVisible();

    // Before a ROM is picked the room actions are inert — and the landing says
    // why, so a disabled button reads as "next step", not as a broken control.
    // An enabled "Create room" here would take a peer to a session with nothing
    // to run, which is precisely the dead-end AC2 rules out.
    await expect(page.getByTestId("create-room")).toBeDisabled();
    await expect(page.getByTestId("join-room")).toBeDisabled();
    await expect(page.getByTestId("room-hint")).toContainText("Load a ROM first");

    await selectRom(page);

    await expect(page.getByTestId("create-room")).toBeEnabled();
    await expect(page.getByTestId("join-room")).toBeEnabled();
    await expect(page.getByTestId("room-hint")).toContainText("retro64-test.nes");

    await page.context().close();
  });

  test("AC1 — a file the chosen console can't run is refused, and unlocks nothing", async ({
    browser,
  }) => {
    const page = await openLanding(browser);

    // NES is the default console; a .gba is a real ROM, just not for this one.
    await page.locator("#rom-input").setInputFiles({
      name: "wrong-console.gba",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("GBA"),
    });

    await expect(page.getByTestId("rom-status")).toContainText("Unsupported file");
    await expect(page.getByTestId("create-room")).toBeDisabled();
    await expect(page.getByTestId("join-room")).toBeDisabled();

    // Not a dead-end either: switching to the console that *can* run it is
    // enough, without re-picking the file.
    await page.locator("#console-select").selectOption("gba");
    await expect(page.getByTestId("rom-status")).toContainText("wrong-console.gba");
    await expect(page.getByTestId("create-room")).toBeEnabled();

    await page.context().close();
  });

  test("AC2 — host creates, guest joins by code, both land in the session", async ({ browser }) => {
    const host = await openLanding(browser);
    const guest = await openLanding(browser);
    await selectRom(host);
    await selectRom(guest);

    const code = await createRoom(host);

    // The host waits in the lobby with the code on screen — not paired yet.
    await expect(host.getByTestId("lobby-status")).toContainText("Waiting for player 2");
    await expect(host.getByTestId("view-session")).toBeHidden();

    // Typed lowercase on purpose: a code is read off someone else's screen and
    // retyped, so the flow has to survive the case being wrong.
    await joinRoom(guest, code.toLowerCase());

    await expect(guest.getByTestId("view-session")).toBeVisible();
    await expect(host.getByTestId("view-session")).toBeVisible();

    // Both sides agree on which room they're in and who hosts it.
    await expect(host.getByTestId("session-code")).toContainText(code);
    await expect(guest.getByTestId("session-code")).toContainText(code);
    await expect(host.getByTestId("session-role")).toHaveText("HOST");
    await expect(guest.getByTestId("session-role")).toHaveText("GUEST");

    // The session is where the game gets started — the control exists and is
    // usable, which is what makes this screen an arrival rather than a dead-end.
    await expect(host.getByTestId("start-game")).toBeEnabled();

    await host.context().close();
    await guest.context().close();
  });

  test("AC2 — every screen has a way back, and leaving returns you ready to start over", async ({
    browser,
  }) => {
    const host = await openLanding(browser);
    await selectRom(host);

    // Lobby → landing.
    const firstCode = await createRoom(host);
    await host.getByTestId("leave-lobby").click();
    await expect(host.getByTestId("view-landing")).toBeVisible();

    // …and the landing is usable again, not a husk: the ROM survived and a
    // second room can be opened. A different code proves the first one was
    // really given up rather than re-displayed.
    await expect(host.getByTestId("create-room")).toBeEnabled();
    const secondCode = await createRoom(host);
    expect(secondCode).not.toBe(firstCode);

    // Session → landing, for both peers.
    const guest = await openLanding(browser);
    await selectRom(guest);
    await joinRoom(guest, secondCode);
    await expect(guest.getByTestId("view-session")).toBeVisible();
    await expect(host.getByTestId("view-session")).toBeVisible();

    await guest.getByTestId("leave-session").click();
    await expect(guest.getByTestId("view-landing")).toBeVisible();
    await expect(guest.getByTestId("create-room")).toBeEnabled();

    await host.getByTestId("leave-session").click();
    await expect(host.getByTestId("view-landing")).toBeVisible();
    await expect(host.getByTestId("create-room")).toBeEnabled();

    await host.context().close();
    await guest.context().close();
  });

  test("AC2 — a rejected join explains itself and the same form still works", async ({
    browser,
  }) => {
    const host = await openLanding(browser);
    const guest = await openLanding(browser);
    await selectRom(host);
    await selectRom(guest);

    // Well-formed but unclaimed. The distinction matters to the person typing:
    // re-read the code, or ask for a new one?
    await joinRoom(guest, "ZZZZZZ");
    await expect(guest.getByTestId("room-error")).toBeVisible();
    await expect(guest.getByTestId("room-error")).toContainText("ZZZZZZ");
    await expect(guest.getByTestId("view-landing")).toBeVisible();

    // Malformed — a different message, because it's a different mistake.
    await joinRoom(guest, "ABC");
    await expect(guest.getByTestId("room-error")).toContainText("6 characters");

    // The recovery: the form was never taken away, so the real code works with
    // no reload and no re-picking the ROM.
    const code = await createRoom(host);
    await joinRoom(guest, code);
    await expect(guest.getByTestId("view-session")).toBeVisible();
    await expect(guest.getByTestId("room-error")).toBeHidden();

    await host.context().close();
    await guest.context().close();
  });

  test("AC2 — a third player can't crash the party, and is told why", async ({ browser }) => {
    const host = await openLanding(browser);
    const guest = await openLanding(browser);
    const gatecrasher = await openLanding(browser);
    for (const page of [host, guest, gatecrasher]) await selectRom(page);

    const code = await createRoom(host);
    await joinRoom(guest, code);
    await expect(guest.getByTestId("view-session")).toBeVisible();

    await joinRoom(gatecrasher, code);
    await expect(gatecrasher.getByTestId("room-error")).toContainText("two players");
    // Still on the landing, still able to try another code — rejected, not stuck.
    await expect(gatecrasher.getByTestId("view-landing")).toBeVisible();
    await expect(gatecrasher.getByTestId("join-room")).toBeEnabled();

    await host.context().close();
    await guest.context().close();
    await gatecrasher.context().close();
  });

  test("AC2 — losing the other player leaves the session usable, not stranded", async ({
    browser,
  }) => {
    const host = await openLanding(browser);
    const guest = await openLanding(browser);
    await selectRom(host);
    await selectRom(guest);

    const code = await createRoom(host);
    await joinRoom(guest, code);
    await expect(guest.getByTestId("view-session")).toBeVisible();

    // The host vanishes — closed tab, dead wifi, same thing on the wire.
    await host.context().close();

    // The guest is told, on the screen they're already looking at. Being
    // silently bounced back to the landing mid-game would also be a dead-end,
    // just a faster one, so the session has to stay put.
    await expect(guest.getByTestId("session-alert")).toBeVisible();
    await expect(guest.getByTestId("session-alert")).toContainText("left");
    await expect(guest.getByTestId("view-session")).toBeVisible();

    // And the way out is still there.
    await guest.getByTestId("leave-session").click();
    await expect(guest.getByTestId("view-landing")).toBeVisible();
    await expect(guest.getByTestId("create-room")).toBeEnabled();

    await guest.context().close();
  });

  test("AC3 — desktop and mobile both fit, on every screen of the flow", async ({ browser }) => {
    // iPhone SE — the narrowest viewport worth supporting. Mobile isn't the
    // focus, so the bar is "nothing overflows and every control is reachable",
    // not a bespoke mobile layout.
    const viewports = [
      { label: "mobile", width: 375, height: 667 },
      { label: "desktop", width: 1280, height: 800 },
    ];

    for (const viewport of viewports) {
      const host = await openLanding(browser);
      const guest = await openLanding(browser);
      await host.setViewportSize({ width: viewport.width, height: viewport.height });
      await guest.setViewportSize({ width: viewport.width, height: viewport.height });
      await selectRom(host);
      await selectRom(guest);

      // Landing.
      await expectReachable(host, "create-room");
      expect(await overflowingElements(host), `${viewport.label} landing overflows`).toEqual([]);
      expect(await hasHorizontalOverflow(host), `${viewport.label} landing scrolls sideways`).toBe(
        false,
      );

      // Lobby — the widest single element in the app is the room code.
      const code = await createRoom(host);
      expect(await overflowingElements(host), `${viewport.label} lobby overflows`).toEqual([]);
      expect(await hasHorizontalOverflow(host), `${viewport.label} lobby scrolls sideways`).toBe(
        false,
      );
      await expectReachable(host, "leave-lobby");

      // Session — the emulator stage has a fixed aspect ratio, the usual thing
      // to blow out a narrow viewport.
      await joinRoom(guest, code);
      await expect(host.getByTestId("view-session")).toBeVisible();
      expect(await overflowingElements(host), `${viewport.label} session overflows`).toEqual([]);
      expect(await hasHorizontalOverflow(host), `${viewport.label} session scrolls sideways`).toBe(
        false,
      );
      await expectReachable(host, "leave-session");

      await host.context().close();
      await guest.context().close();
    }
  });
});
