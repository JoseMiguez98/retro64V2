import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

// UMD build of socket.io-client — exposes a global `io` once injected into the
// page. Resolved by path rather than `require.resolve`, because the package's
// `exports` map doesn't publish the `./dist/*` subpath.
const SOCKET_IO_CLIENT_UMD = fileURLToPath(
  new URL("../../node_modules/socket.io-client/dist/socket.io.min.js", import.meta.url),
);

export const SIGNALING_URL = "http://localhost:3001";

/**
 * State the in-page harness exposes back to the test. Kept flat and
 * JSON-serialisable so it can cross the `page.evaluate` boundary.
 */
export interface PeerState {
  connected: boolean;
  /** `null` until `signal:paired` arrives; then this peer's initiator role. */
  paired: boolean | null;
  dataChannelOpen: boolean;
  received: string[];
  peerLeft: { reason: string } | null;
  errors: string[];
}

declare global {
  interface Window {
    __peer: {
      state: PeerState;
      send(text: string): void;
      dropSocket(): void;
    };
  }
}

/**
 * Turns a blank page on the web origin into a real signaling client: a
 * Socket.io connection speaking the DMI-21 `signal:*` protocol plus a real
 * `RTCPeerConnection`. Deliberately does NOT import app code — the point is to
 * exercise the server's wire contract, not a client abstraction over it.
 *
 * Resolves once the socket is connected and has emitted `signal:join`, so the
 * caller can sequence two peers deterministically (the server pairs FIFO, so
 * whoever joins first becomes the initiator).
 */
export async function createSignalPeer(page: Page): Promise<void> {
  await page.goto("/");
  await page.addScriptTag({ path: SOCKET_IO_CLIENT_UMD });

  await page.evaluate(async (signalingUrl) => {
    const state: Window["__peer"]["state"] = {
      connected: false,
      paired: null,
      dataChannelOpen: false,
      received: [],
      peerLeft: null,
      errors: [],
    };

    // Only the surface this harness actually touches. The real socket.io client
    // types aren't reachable from inside `page.evaluate` (this body is compiled
    // here but executed in the page against the injected UMD global).
    interface SignalSocket {
      connected: boolean;
      emit(event: string, payload?: unknown): void;
      on<T>(event: string, handler: (payload: T) => void | Promise<void>): void;
      once(event: string, handler: () => void): void;
      close(): void;
    }

    // The `signal:message` envelope, discriminated so each branch below gets the
    // right payload type without a cast.
    type SignalMessage =
      | { type: "offer" | "answer"; data: RTCSessionDescriptionInit }
      | { type: "ice-candidate"; data: RTCIceCandidateInit };

    // `io` comes from the injected UMD bundle.
    const socket = (
      window as unknown as { io: (url: string) => SignalSocket }
    ).io(signalingUrl);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    let channel: RTCDataChannel | undefined;
    let remoteDescriptionSet = false;
    // ICE can arrive before the offer/answer it belongs to; addIceCandidate
    // throws in that window, so hold candidates until the description lands.
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const wireChannel = (dc: RTCDataChannel) => {
      channel = dc;
      dc.onopen = () => {
        state.dataChannelOpen = true;
      };
      dc.onclose = () => {
        state.dataChannelOpen = false;
      };
      dc.onmessage = (event) => {
        state.received.push(String(event.data));
      };
    };

    const flushCandidates = async () => {
      remoteDescriptionSet = true;
      while (pendingCandidates.length) {
        const candidate = pendingCandidates.shift()!;
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          state.errors.push(`addIceCandidate: ${(err as Error).message}`);
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal:message", { type: "ice-candidate", data: event.candidate });
      }
    };
    pc.ondatachannel = (event) => wireChannel(event.channel);

    socket.on("connect", () => {
      state.connected = true;
      socket.emit("signal:join");
    });

    socket.on("signal:paired", async ({ initiator }: { initiator: boolean }) => {
      state.paired = initiator;
      if (!initiator) return;
      // Initiator owns channel creation and the offer.
      wireChannel(pc.createDataChannel("retro64"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal:message", { type: "offer", data: offer });
    });

    socket.on("signal:message", async (msg: SignalMessage) => {
      try {
        if (msg.type === "offer") {
          await pc.setRemoteDescription(msg.data);
          await flushCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal:message", { type: "answer", data: answer });
        } else if (msg.type === "answer") {
          await pc.setRemoteDescription(msg.data);
          await flushCandidates();
        } else if (msg.type === "ice-candidate") {
          if (remoteDescriptionSet) {
            await pc.addIceCandidate(msg.data);
          } else {
            pendingCandidates.push(msg.data);
          }
        }
      } catch (err) {
        state.errors.push(`${msg.type}: ${(err as Error).message}`);
      }
    });

    socket.on("signal:peer-left", (payload: { reason: string }) => {
      state.peerLeft = payload;
    });

    window.__peer = {
      state,
      send: (text: string) => channel?.send(text),
      dropSocket: () => socket.close(),
    };

    await new Promise<void>((resolve) => {
      if (socket.connected) return resolve();
      socket.once("connect", () => resolve());
    });
  }, SIGNALING_URL);

  await page.waitForFunction(() => window.__peer?.state.connected === true);
}

export function peerState(page: Page): Promise<PeerState> {
  return page.evaluate(() => window.__peer.state);
}
