import { createServer } from "node:http";
import { Server } from "socket.io";
import { PROTOCOL_VERSION } from "@retro64/shared";

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

io.on("connection", (socket) => {
  console.log(`[signaling] peer connected: ${socket.id}`);
  socket.on("disconnect", (reason) => {
    console.log(`[signaling] peer disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[signaling] listening on :${PORT} (protocol v${PROTOCOL_VERSION})`);
});
