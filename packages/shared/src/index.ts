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
