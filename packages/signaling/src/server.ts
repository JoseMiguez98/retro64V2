import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  DEFAULT_ROOM_TTL_MS,
  PROTOCOL_VERSION,
  isRoomCode,
  normalizeRoomCode,
  type PocSignal,
  type RoomCreated,
  type RoomError,
  type RoomJoined,
  type RoomPaired,
  type RoomPeerLeft,
  type RoomSignal,
  type SignalMessage,
} from "@retro64/shared";
// `.js` extension per nodenext module resolution — this resolves to `./rooms.ts`.
import { RoomRegistry } from "./rooms.js";

// Signaling + lobby server: short-code rooms (DMI-20) on top of the 2-peer
// SDP/ICE relay (DMI-21), plus an HTTP health endpoint.

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// How long an empty room keeps its code (DMI-20). Overridable so the e2e suite
// can assert the expiry criterion without a 15-minute wait — `/health` reports
// the effective value so a test derives its wait from the server instead of
// assuming one.
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS ?? DEFAULT_ROOM_TTL_MS);
// Sweeping at a quarter of the TTL bounds how long an expired room lingers to
// TTL + 25%, without a timer that spins on a short test TTL.
const ROOM_SWEEP_INTERVAL_MS = Number(
  process.env.ROOM_SWEEP_INTERVAL_MS ?? Math.max(Math.min(ROOM_TTL_MS / 4, 30_000), 50),
);

const rooms = new RoomRegistry(ROOM_TTL_MS);

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        protocol: PROTOCOL_VERSION,
        roomTtlMs: ROOM_TTL_MS,
        roomSweepIntervalMs: ROOM_SWEEP_INTERVAL_MS,
        rooms: rooms.size,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN },
});

// --- DMI-2 POC only -----------------------------------------------------
// Naive 2-peer pairing + SDP/ICE relay for the P2P transport POC. NOT the
// real room/signaling protocol — that's DMI-19/20/21. Delete this block once
// the real protocol supersedes it.
let pocWaiting: Socket | null = null;
const pocPairs = new Map<string, string>();

io.on("connection", (socket) => {
  console.log(`[signaling] peer connected: ${socket.id}`);

  socket.on("poc:join", () => {
    if (pocWaiting && pocWaiting.connected) {
      const other = pocWaiting;
      pocPairs.set(socket.id, other.id);
      pocPairs.set(other.id, socket.id);
      pocWaiting = null;
      other.emit("poc:paired", { initiator: true });
      socket.emit("poc:paired", { initiator: false });
    } else {
      pocWaiting = socket;
    }
  });

  socket.on("poc:signal", (payload: PocSignal) => {
    const otherId = pocPairs.get(socket.id);
    if (otherId) io.to(otherId).emit("poc:signal", payload);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[signaling] peer disconnected: ${socket.id} (${reason})`);
    if (pocWaiting?.id === socket.id) pocWaiting = null;
    const otherId = pocPairs.get(socket.id);
    pocPairs.delete(socket.id);
    if (otherId) pocPairs.delete(otherId);
  });
});

// --- DMI-21 signaling relay ---------------------------------------------
// Real 2-peer SDP/ICE relay: pairs the first two callers of `signal:join`
// FIFO, relays offer/answer/ICE between them, and tells the surviving peer
// when its partner disconnects mid-exchange. No room codes yet (DMI-20) —
// that layers on top of this pairing primitive in a follow-up ticket.
let signalWaiting: Socket | null = null;
const signalPairs = new Map<string, string>();

function unpairSignal(socket: Socket, reason: string) {
  if (signalWaiting?.id === socket.id) signalWaiting = null;
  const otherId = signalPairs.get(socket.id);
  signalPairs.delete(socket.id);
  if (otherId) {
    signalPairs.delete(otherId);
    io.to(otherId).emit("signal:peer-left", { reason });
  }
}

io.on("connection", (socket) => {
  socket.on("signal:join", () => {
    if (signalWaiting && signalWaiting.connected) {
      const other = signalWaiting;
      signalPairs.set(socket.id, other.id);
      signalPairs.set(other.id, socket.id);
      signalWaiting = null;
      other.emit("signal:paired", { initiator: true });
      socket.emit("signal:paired", { initiator: false });
    } else {
      signalWaiting = socket;
    }
  });

  socket.on("signal:message", (payload: SignalMessage) => {
    const otherId = signalPairs.get(socket.id);
    if (otherId) io.to(otherId).emit("signal:message", payload);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[signaling] peer disconnected: ${socket.id} (${reason})`);
    unpairSignal(socket, reason);
  });
});

// --- DMI-20 short-code rooms --------------------------------------------
// Named rooms instead of FIFO matchmaking: a peer creates a room and shares its
// code out of band, and the second peer joins that specific code. The `signal:*`
// block above is left untouched — it backs the DMI-21 spec and the DMI-2 POC
// page, and neither is superseded until the lobby UI (DMI-25) replaces them.
//
// Membership and expiry live in `rooms.ts`; this block only translates between
// that registry and the wire. Socket.io's own room primitive is used for the
// fan-out, keyed by the same code, so relaying never hand-rolls a peer list.

io.on("connection", (socket) => {
  socket.on("room:create", () => {
    const outcome = rooms.create(socket.id);
    if (!outcome.ok) {
      socket.emit("room:error", { reason: outcome.reason, code: null } satisfies RoomError);
      return;
    }

    void socket.join(outcome.room.code);
    console.log(`[signaling] room ${outcome.room.code} created by ${socket.id}`);
    socket.emit("room:created", {
      code: outcome.room.code,
      peerId: socket.id,
    } satisfies RoomCreated);
  });

  socket.on("room:join", (payload: { code?: unknown }) => {
    const raw = typeof payload?.code === "string" ? payload.code : "";
    const normalized = normalizeRoomCode(raw);
    // Only echo a code back when it was well-formed; a malformed one isn't a
    // code, and reflecting arbitrary client input would be noise.
    const echo = isRoomCode(normalized) ? normalized : null;

    const outcome = rooms.join(socket.id, raw);
    if (!outcome.ok) {
      socket.emit("room:error", { reason: outcome.reason, code: echo } satisfies RoomError);
      return;
    }

    void socket.join(outcome.room.code);
    socket.emit("room:joined", {
      code: outcome.room.code,
      peerId: socket.id,
    } satisfies RoomJoined);

    if (!outcome.paired) return;

    // Full room → both sides start negotiating. `peers[0]` is the initiator, so
    // exactly one of them creates the DataChannel and the offer.
    const [initiatorId, ...followers] = outcome.room.peers;
    console.log(`[signaling] room ${outcome.room.code} paired (initiator ${initiatorId})`);
    io.to(initiatorId!).emit("room:paired", { initiator: true } satisfies RoomPaired);
    for (const peerId of followers) {
      io.to(peerId).emit("room:paired", { initiator: false } satisfies RoomPaired);
    }
  });

  socket.on("room:signal", (payload: RoomSignal) => {
    const room = rooms.roomOf(socket.id);
    if (!room) return;
    // `socket.to` excludes the sender, which is what a 2-peer relay wants.
    socket.to(room.code).emit("room:signal", payload);
  });

  socket.on("disconnect", (reason) => {
    const outcome = rooms.leave(socket.id);
    if (!outcome) return;

    for (const peerId of outcome.remaining) {
      io.to(peerId).emit("room:peer-left", { reason } satisfies RoomPeerLeft);
    }
    if (outcome.remaining.length === 0) {
      console.log(`[signaling] room ${outcome.room.code} is empty, expires in ${ROOM_TTL_MS}ms`);
    }
  });
});

// Reap abandoned rooms so their codes become available again. `unref` keeps the
// timer from being a reason the process stays alive.
const roomSweep = setInterval(() => {
  const expired = rooms.expireStale();
  if (expired.length > 0) {
    console.log(`[signaling] expired ${expired.length} idle room(s): ${expired.join(", ")}`);
  }
}, ROOM_SWEEP_INTERVAL_MS);
roomSweep.unref();

httpServer.listen(PORT, () => {
  console.log(
    `[signaling] listening on :${PORT} (protocol v${PROTOCOL_VERSION}, room TTL ${ROOM_TTL_MS}ms)`,
  );
});
