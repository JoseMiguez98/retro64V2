import { io, type Socket } from "socket.io-client";
import type { RoomCreated, RoomError, RoomJoined, RoomPaired, RoomPeerLeft } from "@retro64/shared";

// Lobby client for the short-code room protocol (DMI-20). Owns the Socket.io
// connection and turns the `room:*` wire events into one observable state
// object, so the UI (DMI-25) renders from a single snapshot instead of tracking
// half a dozen event handlers itself.
//
// Codes are *not* validated here before being sent: the server already decides
// what a well-formed code is (`isRoomCode`), and a second copy of that rule in
// the client is a second thing to drift. The client's job is to surface the
// rejection it gets back.

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? "http://localhost:3001";

export type ConnectionStatus = "connecting" | "online" | "offline";

/** Which side of the room this peer is on — decided by how it got in. */
export type RoomRole = "host" | "guest";

export interface RoomMembership {
  code: string;
  peerId: string;
  role: RoomRole;
}

export interface RoomClientState {
  connection: ConnectionStatus;
  /** In-flight create/join, so the UI can disable the action that started it. */
  pending: "create" | "join" | null;
  /** The room this peer holds, once `room:created` or `room:joined` lands. */
  membership: RoomMembership | null;
  /** From `room:paired` — both seats taken. Null while the room is half-empty. */
  paired: RoomPaired | null;
  /** Most recent rejected create/join. Cleared when the next attempt starts. */
  error: RoomError | null;
  /** Set when the other peer drops out of a paired room. */
  peerLeft: RoomPeerLeft | null;
}

type Listener = (state: RoomClientState) => void;

function initialState(): RoomClientState {
  return {
    connection: "connecting",
    pending: null,
    membership: null,
    paired: null,
    error: null,
    peerLeft: null,
  };
}

export class RoomClient {
  private socket: Socket | undefined;
  private state: RoomClientState = initialState();
  private readonly listeners = new Set<Listener>();

  /** Current snapshot. Treat as read-only — mutate through the methods below. */
  get snapshot(): RoomClientState {
    return this.state;
  }

  /**
   * Fires immediately with the current state, so a subscriber renders correctly
   * on first paint instead of waiting for the first event.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    if (this.socket) return;

    const socket = io(SIGNALING_URL);
    this.socket = socket;

    socket.on("connect", () => this.patch({ connection: "online" }));
    socket.on("disconnect", () => this.patch({ connection: "offline" }));
    socket.on("connect_error", () => this.patch({ connection: "offline" }));

    socket.on("room:created", ({ code, peerId }: RoomCreated) => {
      this.patch({
        pending: null,
        membership: { code, peerId, role: "host" },
        error: null,
      });
    });

    socket.on("room:joined", ({ code, peerId }: RoomJoined) => {
      this.patch({
        pending: null,
        membership: { code, peerId, role: "guest" },
        error: null,
      });
    });

    socket.on("room:paired", (paired: RoomPaired) => {
      this.patch({ paired, peerLeft: null });
    });

    socket.on("room:peer-left", (peerLeft: RoomPeerLeft) => {
      // The room itself survives (its code stays claimable until the TTL), so
      // membership is kept and only the pairing is torn down. That's what lets
      // the surviving peer keep waiting on the same code instead of dead-ending.
      this.patch({ paired: null, peerLeft });
    });

    socket.on("room:error", (error: RoomError) => {
      this.patch({ pending: null, error });
    });
  }

  create(): void {
    if (!this.socket) return;
    this.patch({ pending: "create", error: null, peerLeft: null });
    this.socket.emit("room:create");
  }

  join(code: string): void {
    if (!this.socket) return;
    this.patch({ pending: "join", error: null, peerLeft: null });
    this.socket.emit("room:join", { code });
  }

  /**
   * Leave the current room and return to a clean, connected socket.
   *
   * The protocol has no `room:leave` event — the server frees a seat on
   * disconnect (`rooms.leave`), which is also what notifies the peer left
   * behind. So leaving is a reconnect: same code path the server already
   * handles, and no protocol change owned by another ticket.
   */
  leave(): void {
    const socket = this.socket;
    if (!socket) return;

    socket.disconnect();
    this.state = { ...initialState(), connection: "connecting" };
    this.emit();
    socket.connect();
  }

  private patch(partial: Partial<RoomClientState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

/** Human-readable copy for each rejection the server can send back. */
export function describeRoomError({ reason, code }: RoomError): string {
  switch (reason) {
    case "invalid-code":
      return "That doesn't look like a room code. Codes are 6 characters, A–Z and 2–9.";
    case "not-found":
      return `No room is using ${code ?? "that code"} right now — it may have expired. Ask your friend for a fresh one.`;
    case "room-full":
      return `Room ${code ?? "that room"} already has two players.`;
    case "already-in-room":
      return "You're already in a room. Leave it before opening another.";
    default:
      return "The room server rejected that request. Try again.";
  }
}
