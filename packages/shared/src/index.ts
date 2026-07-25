// Shared wire contract between @retro64/web and @retro64/signaling.
//
// Scaffolding only. The full room + signaling protocol is defined by the
// Signaling & Lobby epic (DMI-19 and children: DMI-20 room codes, DMI-21
// signaling server) and the P2P transport decision (DMI-2). Keep this file the
// single source of truth for message shapes so client and server never drift.

export const PROTOCOL_VERSION = 1 as const;

/** Short human-shareable room code (see DMI-20 for generation rules). */
export type RoomCode = string;

/** Opaque per-connection peer identifier assigned by the signaling server. */
export type PeerId = string;

// --- DMI-2 POC only ---------------------------------------------------
// Minimal pairing + SDP/ICE relay used by the P2P transport POC
// (packages/web/src/poc/p2p.ts). NOT the real room/signaling protocol —
// that's DMI-19/20/21. Keep this block small and delete it once the real
// protocol supersedes it.

export interface PocPaired {
  initiator: boolean;
}

// `data` is opaque JSON here (SDP/ICE payloads) — shared has no DOM lib since
// it's also consumed by the Node signaling server. The web side casts to
// RTCSessionDescriptionInit / RTCIceCandidateInit where it constructs these.
export type PocSignal =
  | { type: "offer"; data: unknown }
  | { type: "answer"; data: unknown }
  | { type: "ice-candidate"; data: unknown };

// --- DMI-21 signaling relay --------------------------------------------
// Real 2-peer SDP/ICE relay (server.ts's `poc:*` block stays untouched — it
// backs the standalone DMI-2 POC page and is superseded separately when the
// real lobby UI, DMI-25, lands). Still pairing-only, no room codes yet
// (DMI-20). `data` stays opaque JSON for the same reason as `PocSignal`.

export interface PeerPaired {
  initiator: boolean;
}

export type SignalMessage =
  | { type: "offer"; data: unknown }
  | { type: "answer"; data: unknown }
  | { type: "ice-candidate"; data: unknown };

/** Emitted to the remaining peer when its paired peer disconnects mid-exchange. */
export interface PeerLeft {
  reason: string;
}
