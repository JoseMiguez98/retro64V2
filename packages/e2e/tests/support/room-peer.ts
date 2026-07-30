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
export interface RoomState {
  connected: boolean;
  /** Set from `room:created` — this peer hosts the room and owns the offer. */
  created: { code: string; peerId: string } | null;
  /** Set from `room:joined`. */
  joined: { code: string; peerId: string } | null;
  /** `null` until `room:paired` arrives; then this peer's initiator role. */
  paired: boolean | null;
  dataChannelOpen: boolean;
  received: string[];
  peerLeft: { reason: string } | null;
  /** Most recent `room:error`, the rejection path for create/join. */
  error: { reason: string; code: string | null } | null;
  errors: string[];
}

declare global {
  interface Window {
    __room: {
      state: RoomState;
      create(): void;
      join(code: string): void;
      send(text: string): void;
      dropSocket(): void;
    };
  }
}

/**
 * Turns a blank page on the web origin into a real lobby client: a Socket.io
 * connection speaking the DMI-20 `room:*` protocol plus a real
 * `RTCPeerConnection` wired to relay SDP/ICE through the room.
 *
 * Deliberately does NOT import app code — the point is to exercise the server's
 * wire contract, not a client abstraction over it. The lobby UI is DMI-25.
 *
 * Resolves once the socket is connected, so the caller decides when to
 * `create()` or `join()` and can sequence two peers deterministically.
 */
export async function createRoomPeer(page: Page): Promise<void> {
  await page.goto("/");
  await page.addScriptTag({ path: SOCKET_IO_CLIENT_UMD });

  await page.evaluate(async (signalingUrl) => {
    const state: Window["__room"]["state"] = {
      connected: false,
      created: null,
      joined: null,
      paired: null,
      dataChannelOpen: false,
      received: [],
      peerLeft: null,
      error: null,
      errors: [],
    };

    // Only the surface this harness actually touches. The real socket.io client
    // types aren't reachable from inside `page.evaluate` (this body is compiled
    // here but executed in the page against the injected UMD global).
    interface RoomSocket {
      connected: boolean;
      emit(event: string, payload?: unknown): void;
      on<T>(event: string, handler: (payload: T) => void | Promise<void>): void;
      once(event: string, handler: () => void): void;
      close(): void;
    }

    // The `room:signal` envelope, discriminated so each branch below gets the
    // right payload type without a cast.
    type RoomSignal =
      | { type: "offer" | "answer"; data: RTCSessionDescriptionInit }
      | { type: "ice-candidate"; data: RTCIceCandidateInit };

    // `io` comes from the injected UMD bundle.
    const socket = (
      window as unknown as { io: (url: string) => RoomSocket }
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
        socket.emit("room:signal", { type: "ice-candidate", data: event.candidate });
      }
    };
    pc.ondatachannel = (event) => wireChannel(event.channel);

    socket.on("connect", () => {
      state.connected = true;
    });

    socket.on("room:created", (payload: { code: string; peerId: string }) => {
      state.created = payload;
    });

    socket.on("room:joined", (payload: { code: string; peerId: string }) => {
      state.joined = payload;
    });

    socket.on("room:error", (payload: { reason: string; code: string | null }) => {
      state.error = payload;
    });

    socket.on("room:paired", async ({ initiator }: { initiator: boolean }) => {
      state.paired = initiator;
      if (!initiator) return;
      // Initiator owns channel creation and the offer.
      wireChannel(pc.createDataChannel("retro64"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("room:signal", { type: "offer", data: offer });
    });

    socket.on("room:signal", async (msg: RoomSignal) => {
      try {
        if (msg.type === "offer") {
          await pc.setRemoteDescription(msg.data);
          await flushCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("room:signal", { type: "answer", data: answer });
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

    socket.on("room:peer-left", (payload: { reason: string }) => {
      state.peerLeft = payload;
    });

    window.__room = {
      state,
      create: () => socket.emit("room:create"),
      join: (code: string) => socket.emit("room:join", { code }),
      send: (text: string) => channel?.send(text),
      dropSocket: () => socket.close(),
    };

    await new Promise<void>((resolve) => {
      if (socket.connected) return resolve();
      socket.once("connect", () => resolve());
    });
  }, SIGNALING_URL);

  await page.waitForFunction(() => window.__room?.state.connected === true);
}

export function roomState(page: Page): Promise<RoomState> {
  return page.evaluate(() => window.__room.state);
}

/** Creates a room and resolves with its code. */
export async function createRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.__room.create());
  await page.waitForFunction(() => window.__room.state.created !== null);
  const { created } = await roomState(page);
  if (!created) throw new Error("room:created never arrived");
  return created.code;
}

/**
 * Opens `count` independent sockets in one page, creates a room on each, and
 * returns every code. One page rather than `count` browser contexts because the
 * uniqueness criterion is about the generator, not about browsers — and the
 * server allows one room per socket, not per page.
 */
export async function createRoomCodes(page: Page, count: number): Promise<string[]> {
  await page.goto("/");
  await page.addScriptTag({ path: SOCKET_IO_CLIENT_UMD });

  return page.evaluate(
    async ({ signalingUrl, total }) => {
      interface RoomSocket {
        emit(event: string, payload?: unknown): void;
        on<T>(event: string, handler: (payload: T) => void) : void;
        close(): void;
      }
      const io = (window as unknown as { io: (url: string) => RoomSocket }).io;

      const codes = await Promise.all(
        Array.from({ length: total }, () => {
          const socket = io(signalingUrl);
          return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("room:created timed out")), 15_000);
            socket.on("connect", () => socket.emit("room:create"));
            socket.on("room:created", (payload: { code: string }) => {
              clearTimeout(timer);
              resolve(payload.code);
            });
            socket.on("room:error", (payload: { reason: string }) => {
              clearTimeout(timer);
              reject(new Error(`room:error ${payload.reason}`));
            });
          }).finally(() => socket.close());
        }),
      );

      return codes;
    },
    { signalingUrl: SIGNALING_URL, total: count },
  );
}
