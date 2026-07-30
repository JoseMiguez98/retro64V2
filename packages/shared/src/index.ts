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

// --- DMI-20 short-code rooms -------------------------------------------
// Layers named rooms on top of DMI-21's pairing primitive: instead of being
// matched FIFO with whoever else is waiting, a peer creates a room, shares its
// code out of band, and the second peer joins that specific room. The `signal:*`
// FIFO events stay as they are — they back the DMI-21 spec and the DMI-2 POC
// page, and nothing here supersedes them yet.
//
// The lobby UI that will drive these events is DMI-25.

/**
 * Room codes are read aloud and re-typed, so the alphabet drops every glyph
 * pair that is ambiguous in that round trip: `I`/`1`/`L`, `O`/`0`. What's left
 * is 31 symbols, uppercase-only, still within "6 alphanumeric characters".
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const ROOM_CODE_LENGTH = 6;

/** Two peers per room — the netplay session this exists for is 1v1 (DMI-2). */
export const ROOM_CAPACITY = 2;

/**
 * How long a room survives with nobody connected to it before the server drops
 * it and frees its code. A room that still holds a peer is by definition not
 * inactive, so this clock only runs while the room is empty — see
 * `packages/signaling/src/rooms.ts` for why that's the definition used.
 *
 * Overridable per process via `ROOM_TTL_MS` (the e2e suite shortens it so the
 * expiry criterion is testable without a 15-minute wait).
 */
export const DEFAULT_ROOM_TTL_MS = 15 * 60 * 1000;

/** Uppercase and trim a human-typed code before validating or looking it up. */
export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** True when `value` is exactly a well-formed room code (already normalized). */
export function isRoomCode(value: string): boolean {
  return (
    value.length === ROOM_CODE_LENGTH &&
    [...value].every((char) => ROOM_CODE_ALPHABET.includes(char))
  );
}

/** Ack for `room:create` — this peer is the host, and owns the WebRTC offer. */
export interface RoomCreated {
  code: RoomCode;
  peerId: PeerId;
}

/** Ack for a successful `room:join`. */
export interface RoomJoined {
  code: RoomCode;
  peerId: PeerId;
}

/**
 * Sent to **both** peers once a room reaches `ROOM_CAPACITY`: the cue to start
 * the WebRTC negotiation. `initiator` is true for the host, so exactly one side
 * creates the DataChannel and the offer.
 */
export interface RoomPaired {
  initiator: boolean;
}

export type RoomErrorReason =
  /** Not `ROOM_CODE_LENGTH` chars from `ROOM_CODE_ALPHABET`. */
  | "invalid-code"
  /** Well-formed, but no live room holds it — never created, or expired. */
  | "not-found"
  /** The room already holds `ROOM_CAPACITY` peers. */
  | "room-full"
  /** This peer is already in a room; leave it before creating or joining another. */
  | "already-in-room";

export interface RoomError {
  reason: RoomErrorReason;
  /** The code the peer asked for, or `null` when it wasn't well-formed enough to echo. */
  code: RoomCode | null;
}

/**
 * SDP/ICE relayed between the two peers of a room. Same envelope as
 * `SignalMessage` — deliberately a separate event so a socket can never have
 * its room traffic confused with the FIFO pairing traffic.
 */
export type RoomSignal = SignalMessage;

/** Sent to whoever is left when the other peer of the room disconnects. */
export interface RoomPeerLeft {
  reason: string;
}
