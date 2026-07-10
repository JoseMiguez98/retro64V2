# DMI-2 — P2P transport decision

Status: **Decided** · Ticket: [DMI-2](https://linear.app/pawsy/issue/DMI-2) · Parent: DMI-1 (Decisiones de Arquitectura)

Decides how peers exchange netplay input once WebRTC connectivity is
established. Does **not** decide signaling architecture or STUN/TURN
provisioning — that's DMI-5. Does not decide the delay-based netcode
algorithm — that's DMI-6/DMI-14.

## Options considered

| Option | Control | Dependency weight | Fit |
|---|---|---|---|
| **Raw `RTCPeerConnection` + `RTCDataChannel`** | Full — we choose `ordered`/`maxRetransmits` per channel, own the SDP/ICE exchange | Zero extra deps, native `lib.dom` types | Chosen |
| **PeerJS** | Low — wraps signaling *and* transport behind its own protocol (PeerServer), data channel options are not first-class | Adds a signaling abstraction we don't need — we already built a Socket.io signaling server in DMI-4 | Rejected |
| **simple-peer** | Medium — thin wrapper over `RTCPeerConnection`, still bring-your-own-signaling | Pulls in Node stream/Buffer polyfills for the browser build; maintenance has slowed | Rejected |

## Decision

Use the browser's native **`RTCPeerConnection`** / **`RTCDataChannel`** APIs
directly. No P2P library.

**Why:**

- **Signaling is already ours.** DMI-4 picked a custom Socket.io server for
  signaling/lobby. PeerJS assumes it owns the signaling protocol (via
  PeerServer) — adopting it would mean running two overlapping signaling
  paths, or fighting the library to use ours. Raw `RTCPeerConnection` has no
  opinion on signaling transport; it slots directly onto the Socket.io relay
  DMI-21 will build out.
- **Data channel config matters for netcode.** DMI-6/DMI-14's delay-based
  netcode wants input packets sent `ordered: false, maxRetransmits: 0` (drop
  late frames rather than retransmit and stall). Both PeerJS and simple-peer
  either hide this option or make it awkward to set per-channel. Raw API
  exposes it directly on `createDataChannel(label, options)`.
- **No added dependency.** `RTCPeerConnection` ships in every target browser
  (Chrome/Firefox/Edge, desktop). Per AGENTS.md §3, we don't add a dependency
  the ticket doesn't require — the library options solve a boilerplate
  problem we don't have much of (one offer/answer + ICE relay loop), not a
  capability gap.
- **simple-peer's polyfill weight** (Node `Buffer`/`stream` shims bundled for
  browser use) plus slowed maintenance made it a worse fit than either raw
  API or PeerJS, and it doesn't solve the signaling-ownership problem PeerJS
  has anyway.

## POC

`packages/web/poc-p2p.html` + `packages/web/src/poc/p2p.ts` — a standalone
page (not linked from the landing scaffold, which is DMI-25 scope) that:

1. Connects to the signaling server via Socket.io and joins a pairing queue
   (`poc:join`).
2. Once two tabs are paired, the first exchanges SDP offer/answer and ICE
   candidates with the second over `poc:signal` (relayed 1:1 by the server —
   temporary POC-only relay in `packages/signaling`, not the real room
   protocol from DMI-19/20/21).
3. Opens an `RTCDataChannel` and exchanges typed text messages between the
   two tabs, logged on screen.

Run it: `pnpm dev`, then open `http://localhost:5173/poc-p2p.html` in two
tabs.

## Explicitly out of scope (owned by other tickets)

- Signaling architecture + STUN/TURN — **DMI-5**
- Real room/lobby protocol (join codes, presence) — **DMI-19/20/21**
- Delay-based netcode, frame buffering — **DMI-6/DMI-14**
- Rollback — **DMI-26** (fase 2, explicitly deferred)
