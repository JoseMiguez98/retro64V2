import { expect, test, type Page } from "@playwright/test";
import { SIGNALING_URL, createRoom, createRoomCodes, createRoomPeer, roomState } from "./support/room-peer";

/**
 * DMI-20 — "Room creation and join with short code".
 *
 * Acceptance criteria this spec asserts, one `test()` per criterion:
 *   1. Generation of a short, unique room code (e.g. 6 alphanumeric characters)
 *   2. "Create room" and "join with code" flow working end-to-end
 *   3. Automatic expiration of inactive rooms (define TTL)
 *
 * Real browsers, real Socket.io connections, one real signaling server. Nothing
 * mocks the thing under test: AC2 is proven by a WebRTC DataChannel that only
 * opens if the room actually relayed the offer, answer and ICE candidates.
 */

/**
 * The code shape is asserted literally rather than imported from
 * `@retro64/shared`: a test that checks a value against the same constant the
 * implementation used would pass no matter what that constant became. "6
 * alphanumeric characters" is the criterion, so 6 and alphanumeric are spelled
 * out here — including the ambiguous glyphs a shared-out-loud code must avoid.
 */
const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const AMBIGUOUS_GLYPHS = ["I", "L", "O", "0", "1"];

async function newPeer(page: Page): Promise<Page> {
  await createRoomPeer(page);
  return page;
}

test.describe("DMI-20 short-code rooms", () => {
  test("AC1 — generates short, unique, unambiguous room codes", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();

    // 24 codes from 24 independent sockets. Enough that a generator stuck on a
    // constant, or one seeded per-connection, shows up as a duplicate.
    const codes = await createRoomCodes(page, 24);
    expect(codes).toHaveLength(24);

    for (const code of codes) {
      expect(code).toHaveLength(6);
      expect(code, `${code} is not 6 alphanumeric characters`).toMatch(ROOM_CODE_PATTERN);
      for (const glyph of AMBIGUOUS_GLYPHS) {
        expect(code, `${code} contains ambiguous glyph ${glyph}`).not.toContain(glyph);
      }
    }

    // Unique — the criterion's other half. A code that collides hands two
    // sessions the same room.
    expect(new Set(codes).size).toBe(codes.length);

    await page.context().close();
  });

  test("AC2 — create then join by code, until a DataChannel carries payload", async ({ browser }) => {
    const host = await newPeer(await (await browser.newContext()).newPage());
    const guest = await newPeer(await (await browser.newContext()).newPage());

    // Create: the host gets a code back, and nothing is paired yet — a room with
    // one peer is waiting, not ready.
    const code = await createRoom(host);
    expect(code).toMatch(ROOM_CODE_PATTERN);
    expect((await roomState(host)).paired).toBeNull();

    // Join by that code — lowercased on purpose: a code is read off a screen and
    // retyped, so the server normalizes before it looks anything up.
    await guest.evaluate((value) => window.__room.join(value.toLowerCase()), code);

    await guest.waitForFunction(() => window.__room.state.joined !== null);
    expect((await roomState(guest)).joined?.code).toBe(code);
    expect((await roomState(guest)).error).toBeNull();

    // Reaching capacity pairs both sides, with exactly one initiator — that role
    // assignment is the contract the WebRTC negotiation depends on.
    await host.waitForFunction(() => window.__room.state.paired !== null);
    await guest.waitForFunction(() => window.__room.state.paired !== null);
    expect(await host.evaluate(() => window.__room.state.paired)).toBe(true);
    expect(await guest.evaluate(() => window.__room.state.paired)).toBe(false);

    // The end-to-end assertion: a DataChannel only opens if the room relayed
    // offer, answer and every ICE candidate intact between these two peers.
    await host.waitForFunction(() => window.__room.state.dataChannelOpen === true);
    await guest.waitForFunction(() => window.__room.state.dataChannelOpen === true);

    // …and it carries payload, peer to peer, both directions.
    await host.evaluate(() => window.__room.send("ping from host"));
    await guest.waitForFunction(() => window.__room.state.received.includes("ping from host"));
    await guest.evaluate(() => window.__room.send("pong from guest"));
    await host.waitForFunction(() => window.__room.state.received.includes("pong from guest"));

    expect((await roomState(host)).errors).toEqual([]);
    expect((await roomState(guest)).errors).toEqual([]);

    await host.context().close();
    await guest.context().close();
  });

  test("AC2 — rejects a join the flow must not accept, each with its own reason", async ({ browser }) => {
    // A well-formed code nobody holds. Distinct from a malformed one: the person
    // who typed it needs to know whether to re-read it or ask for a new one.
    const unclaimed = await (await browser.newContext()).newPage();
    await newPeer(unclaimed);
    await unclaimed.evaluate(() => window.__room.join("ZZZZZZ"));
    await unclaimed.waitForFunction(() => window.__room.state.error !== null);
    expect((await roomState(unclaimed)).error).toEqual({ reason: "not-found", code: "ZZZZZZ" });
    expect((await roomState(unclaimed)).joined).toBeNull();

    // Malformed: wrong length, and a code carrying glyphs the alphabet excludes.
    for (const malformed of ["ABC", "ABCDEFG", "AEIOU0", "ABC1DE"]) {
      const page = await (await browser.newContext()).newPage();
      await newPeer(page);
      await page.evaluate((value) => window.__room.join(value), malformed);
      await page.waitForFunction(() => window.__room.state.error !== null);
      const state = await roomState(page);
      expect(state.error?.reason, `"${malformed}" should be invalid-code`).toBe("invalid-code");
      // Nothing to echo — it was never a code.
      expect(state.error?.code).toBeNull();
      await page.context().close();
    }

    // Capacity: a third peer cannot join a full room. Without this the "room" is
    // just a broadcast group.
    const host = await newPeer(await (await browser.newContext()).newPage());
    const guest = await newPeer(await (await browser.newContext()).newPage());
    const gatecrasher = await newPeer(await (await browser.newContext()).newPage());

    const code = await createRoom(host);
    await guest.evaluate((value) => window.__room.join(value), code);
    await guest.waitForFunction(() => window.__room.state.joined !== null);

    await gatecrasher.evaluate((value) => window.__room.join(value), code);
    await gatecrasher.waitForFunction(() => window.__room.state.error !== null);
    expect((await roomState(gatecrasher)).error).toEqual({ reason: "room-full", code });
    expect((await roomState(gatecrasher)).joined).toBeNull();

    await unclaimed.context().close();
    await host.context().close();
    await guest.context().close();
    await gatecrasher.context().close();
  });

  test("AC3 — an empty room expires on the TTL, and not before", async ({ browser, request }) => {
    // The TTL is read off the running server rather than assumed, so this test
    // measures the behaviour that is actually configured.
    const health = await (await request.get(`${SIGNALING_URL}/health`)).json();
    const ttlMs: number = health.roomTtlMs;
    const sweepMs: number = health.roomSweepIntervalMs;
    expect(typeof ttlMs, "GET /health must report roomTtlMs").toBe("number");
    // Not a skip: a long TTL means the harness is talking to a server that
    // wasn't started for this suite (a stale `reuseExistingServer` process), and
    // that is a broken environment to be fixed, not a criterion to wave through.
    expect(
      ttlMs,
      `roomTtlMs is ${ttlMs}ms — too long to assert. Restart the signaling server via the e2e webServer, which sets a short ROOM_TTL_MS.`,
    ).toBeLessThanOrEqual(10_000);

    const hostA = await newPeer(await (await browser.newContext()).newPage());
    const joinerA = await newPeer(await (await browser.newContext()).newPage());
    const hostB = await newPeer(await (await browser.newContext()).newPage());
    const joinerB = await newPeer(await (await browser.newContext()).newPage());

    // Control — "and not before". Emptying a room must not destroy it on the
    // spot: the code stays claimable, which is what lets a peer that reloaded
    // rejoin the code it already shared. Without this half, a server that
    // dropped rooms the instant they emptied would pass the expiry half too.
    const codeA = await createRoom(hostA);
    await hostA.evaluate(() => window.__room.dropSocket());
    await joinerA.evaluate((value) => window.__room.join(value), codeA);
    await joinerA.waitForFunction(() => window.__room.state.joined !== null);
    expect((await roomState(joinerA)).joined?.code).toBe(codeA);
    expect((await roomState(joinerA)).error).toBeNull();

    // Expiry — the identical sequence, with only the wait added.
    const codeB = await createRoom(hostB);
    await hostB.evaluate(() => window.__room.dropSocket());
    // TTL, plus one sweep interval for the reaper to come around, plus margin.
    await new Promise((resolve) => setTimeout(resolve, ttlMs + sweepMs + 500));

    await joinerB.evaluate((value) => window.__room.join(value), codeB);
    await joinerB.waitForFunction(() => window.__room.state.error !== null);
    expect((await roomState(joinerB)).error).toEqual({ reason: "not-found", code: codeB });
    expect((await roomState(joinerB)).joined).toBeNull();

    await hostA.context().close();
    await joinerA.context().close();
    await hostB.context().close();
    await joinerB.context().close();
  });

  test("AC2 — the surviving peer is told when its partner leaves the room", async ({ browser }) => {
    const host = await newPeer(await (await browser.newContext()).newPage());
    const guest = await newPeer(await (await browser.newContext()).newPage());

    const code = await createRoom(host);
    await guest.evaluate((value) => window.__room.join(value), code);
    await guest.waitForFunction(() => window.__room.state.dataChannelOpen === true);
    await host.waitForFunction(() => window.__room.state.dataChannelOpen === true);

    // The host vanishes. The guest must be told, not left waiting on a dead peer
    // — a room whose flow dead-ends on a disconnect is not working end-to-end.
    await host.evaluate(() => window.__room.dropSocket());

    await guest.waitForFunction(() => window.__room.state.peerLeft !== null);
    const { peerLeft } = await roomState(guest);
    expect(peerLeft).not.toBeNull();
    expect(typeof peerLeft!.reason).toBe("string");
    expect(peerLeft!.reason.length).toBeGreaterThan(0);

    await host.context().close();
    await guest.context().close();
  });
});
