import { randomInt } from "node:crypto";
import {
  ROOM_CAPACITY,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isRoomCode,
  normalizeRoomCode,
  type PeerId,
  type RoomCode,
  type RoomErrorReason,
} from "@retro64/shared";

// Room bookkeeping for DMI-20, kept free of Socket.io on purpose: this module
// owns *which peers are in which room and when a room dies*, and nothing about
// how bytes reach them. `server.ts` translates between the two.

export interface Room {
  code: RoomCode;
  /**
   * Peers in arrival order. `peers[0]` is the WebRTC initiator — derived from
   * position rather than pinned to the creator, so the role survives the
   * creator leaving and a new peer joining the still-live room.
   */
  peers: PeerId[];
  createdAt: number;
  /**
   * When the room last became empty, or `null` while it holds at least one peer.
   * This is the entire definition of "inactive" (see `expireStale`).
   */
  emptySince: number | null;
}

export type CreateOutcome =
  | { ok: true; room: Room }
  | { ok: false; reason: RoomErrorReason };

export type JoinOutcome =
  | { ok: true; room: Room; /** Room just reached capacity — both peers pair now. */ paired: boolean }
  | { ok: false; reason: RoomErrorReason };

export interface LeaveOutcome {
  room: Room;
  /** Peers still in the room after this one left. */
  remaining: PeerId[];
}

/**
 * A code collision would hand two sessions the same room, so generation retries
 * on a taken code. With a 31-symbol alphabet and 6 places there are ~887M codes;
 * this ceiling only exists so a pathologically full registry fails loudly
 * instead of spinning forever.
 */
const MAX_CODE_ATTEMPTS = 100;

export class RoomRegistry {
  private readonly rooms = new Map<RoomCode, Room>();
  /** Reverse index so per-message lookups don't scan every room. */
  private readonly peerRooms = new Map<PeerId, RoomCode>();

  /**
   * @param ttlMs How long an *empty* room keeps its code before being dropped.
   */
  constructor(private readonly ttlMs: number) {}

  get size(): number {
    return this.rooms.size;
  }

  roomOf(peerId: PeerId): Room | undefined {
    const code = this.peerRooms.get(peerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  get(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  create(peerId: PeerId): CreateOutcome {
    if (this.peerRooms.has(peerId)) return { ok: false, reason: "already-in-room" };

    const room: Room = {
      code: this.generateCode(),
      peers: [peerId],
      createdAt: Date.now(),
      emptySince: null,
    };
    this.rooms.set(room.code, room);
    this.peerRooms.set(peerId, room.code);
    return { ok: true, room };
  }

  /** `rawCode` is whatever the client sent — normalized and validated here. */
  join(peerId: PeerId, rawCode: string): JoinOutcome {
    if (this.peerRooms.has(peerId)) return { ok: false, reason: "already-in-room" };

    const code = normalizeRoomCode(rawCode);
    // Checked before the lookup so a malformed code can't be reported as
    // "not-found" — the two mean different things to whoever typed it.
    if (!isRoomCode(code)) return { ok: false, reason: "invalid-code" };

    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: "not-found" };
    if (room.peers.length >= ROOM_CAPACITY) return { ok: false, reason: "room-full" };

    room.peers.push(peerId);
    room.emptySince = null;
    this.peerRooms.set(peerId, code);
    return { ok: true, room, paired: room.peers.length === ROOM_CAPACITY };
  }

  /**
   * Removes a peer from whatever room it was in. The room itself is kept alive
   * even when it empties — its code stays claimable until the TTL elapses, which
   * is what lets a peer that reloaded rejoin the code it already shared.
   */
  leave(peerId: PeerId): LeaveOutcome | null {
    const code = this.peerRooms.get(peerId);
    if (code === undefined) return null;
    this.peerRooms.delete(peerId);

    const room = this.rooms.get(code);
    if (!room) return null;

    room.peers = room.peers.filter((id) => id !== peerId);
    if (room.peers.length === 0) room.emptySince = Date.now();

    return { room, remaining: [...room.peers] };
  }

  /**
   * Drops every room that has sat empty for longer than the TTL, returning the
   * codes freed so the caller can log them.
   *
   * **"Inactive" means "holds no peers"**, not "quiet". A room with a connected
   * peer waiting for a friend to type the code is doing exactly what it exists
   * for, and evicting it on a silence timer would break the primary flow. The
   * leak this guards against is the real one: a code created, shared, never
   * joined, and then abandoned when its creator closed the tab.
   */
  expireStale(): RoomCode[] {
    const cutoff = Date.now() - this.ttlMs;
    const expired: RoomCode[] = [];

    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && room.emptySince <= cutoff) {
        this.rooms.delete(code);
        expired.push(code);
      }
    }

    return expired;
  }

  private generateCode(): RoomCode {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      let code = "";
      // `randomInt` over the alphabet length, rather than mapping bytes with a
      // modulo — the latter skews toward the alphabet's first characters.
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }

    throw new Error(
      `Could not find a free room code in ${MAX_CODE_ATTEMPTS} attempts (${this.rooms.size} rooms live)`,
    );
  }
}
