import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { PROTOCOL_VERSION, type PocSignal } from "@retro64/shared";

// Scaffolding entrypoint for the signaling + lobby server.
// Room management, code generation, and SDP/ICE relay are implemented by the
// Signaling & Lobby epic (DMI-19 → DMI-20, DMI-21). This file just proves the
// stack boots: an HTTP health endpoint plus a Socket.io server.

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", protocol: PROTOCOL_VERSION }));
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

httpServer.listen(PORT, () => {
  console.log(`[signaling] listening on :${PORT} (protocol v${PROTOCOL_VERSION})`);
});
