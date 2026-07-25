import { expect, test } from "@playwright/test";
import { createSignalPeer, peerState } from "./support/signal-peer";

/**
 * DMI-21 — "Servidor de signaling".
 *
 * Acceptance criteria this spec asserts, one `test()` per criterion:
 *   1. Server receives and relays SDP offer/answer + ICE candidates between 2 peers
 *   2. Handles one peer disconnecting during the exchange
 *
 * (The third criterion — "deploy working in a staging environment" — is not
 * verifiable here and was escalated on PR #17 rather than invented; see the
 * ticket. AGENTS.md §1.4 requires that split to be explicit, not silent.)
 *
 * Two independent browser contexts, two real `RTCPeerConnection`s, one real
 * signaling server. If the relay drops or reorders anything, the DataChannel
 * never opens and this fails.
 */
test.describe("DMI-21 signaling relay", () => {
  test("relays SDP + ICE between two peers until a DataChannel opens", async ({ browser }) => {
    const alice = await (await browser.newContext()).newPage();
    const bob = await (await browser.newContext()).newPage();

    // Sequenced, not raced: the server pairs FIFO, so joining Alice first
    // makes her the initiator deterministically.
    await createSignalPeer(alice);
    await createSignalPeer(bob);

    await alice.waitForFunction(() => window.__peer.state.paired !== null);
    await bob.waitForFunction(() => window.__peer.state.paired !== null);

    // Exactly one initiator — the role assignment is the pairing contract.
    expect(await alice.evaluate(() => window.__peer.state.paired)).toBe(true);
    expect(await bob.evaluate(() => window.__peer.state.paired)).toBe(false);

    // The real assertion: a DataChannel only opens if offer, answer and ICE
    // candidates all made it across intact.
    await alice.waitForFunction(() => window.__peer.state.dataChannelOpen === true);
    await bob.waitForFunction(() => window.__peer.state.dataChannelOpen === true);

    // …and it actually carries payload end to end, peer to peer.
    await alice.evaluate(() => window.__peer.send("ping from alice"));
    await bob.waitForFunction(() => window.__peer.state.received.includes("ping from alice"));

    await bob.evaluate(() => window.__peer.send("pong from bob"));
    await alice.waitForFunction(() => window.__peer.state.received.includes("pong from bob"));

    expect((await peerState(alice)).errors).toEqual([]);
    expect((await peerState(bob)).errors).toEqual([]);

    await alice.context().close();
    await bob.context().close();
  });

  test("tells the surviving peer when its partner drops mid-exchange", async ({ browser }) => {
    const alice = await (await browser.newContext()).newPage();
    const bob = await (await browser.newContext()).newPage();

    await createSignalPeer(alice);
    await createSignalPeer(bob);

    await alice.waitForFunction(() => window.__peer.state.dataChannelOpen === true);
    await bob.waitForFunction(() => window.__peer.state.dataChannelOpen === true);

    // Alice vanishes. Bob must be told, not left hanging on a dead peer.
    await alice.evaluate(() => window.__peer.dropSocket());

    await bob.waitForFunction(() => window.__peer.state.peerLeft !== null);
    const left = (await peerState(bob)).peerLeft;
    expect(left).not.toBeNull();
    expect(typeof left!.reason).toBe("string");
    expect(left!.reason.length).toBeGreaterThan(0);

    await alice.context().close();
    await bob.context().close();
  });
});
