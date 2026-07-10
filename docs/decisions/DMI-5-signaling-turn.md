# DMI-5 — Signaling architecture & STUN/TURN decision

Status: **Decided** · Ticket: [DMI-5](https://linear.app/pawsy/issue/DMI-5) · Parent: DMI-1 (Decisiones de Arquitectura) · Blocks: DMI-21

Decides two connectivity concerns for the WebRTC netplay path:

1. **Signaling** — how peers exchange SDP offers/answers and ICE candidates
   before a direct connection exists.
2. **STUN/TURN** — how peers discover their public address (STUN) and, when a
   direct path is impossible (symmetric NAT, restrictive firewalls), relay
   traffic through a middlebox (TURN).

It does **not** decide the P2P transport itself (raw `RTCPeerConnection` —
**DMI-2**), the room/lobby protocol (**DMI-19/20/21**), or the netcode
(**DMI-6/DMI-14/DMI-26**). It is constrained by DMI-2: because we use the
native `RTCPeerConnection` API, the ICE layer only needs a standard
`RTCIceServer[]` list — any RFC-compliant STUN/TURN provider fits with zero
client-side lock-in.

---

## 1. Signaling transport

Peers cannot talk directly until ICE completes, so the SDP/ICE handshake needs
an out-of-band channel. The options are our own server vs. a third-party
signaling service.

| Option | Cost | Ops complexity | Fit |
|---|---|---|---|
| **Self-hosted Socket.io server** (`packages/signaling`) | Just the host it already runs on — no extra service | Already built and booted in DMI-4; rooms/heartbeat/reconnect are first-class | **Chosen** |
| Managed signaling (PeerServer, Ably, Pusher, Supabase Realtime) | Per-message / per-connection billing on top of what we host | A second realtime backend to configure, secure, and reason about | Rejected |

**Decision:** keep signaling on the **self-hosted Node + TypeScript + Socket.io
server** already chosen in [DMI-4](./DMI-4-stack.md) and scaffolded in
`packages/signaling`. DMI-2 explicitly rejected PeerJS partly because it wants
to own signaling via its own PeerServer — adopting any third-party signaling
service would reintroduce exactly that conflict (two overlapping signaling
paths). The SDP/ICE relay is one small message loop that rides on the same
Socket.io connection the lobby already uses; a managed service adds cost and a
second backend for no capability we lack. The real relay/room wiring is
**DMI-21** (which this ticket blocks); a throwaway 2-peer relay already exists
for the DMI-2 POC.

---

## 2. STUN/TURN

STUN is cheap and almost always free; TURN relays real media/data bytes, so it
is the cost- and ops-bearing decision. In practice STUN alone connects the
large majority of peers — TURN is the fallback for restrictive networks.

| Option | Cost (STUN / TURN) | Ops complexity | Fit |
|---|---|---|---|
| **Cloudflare Realtime TURN** | STUN free · TURN **$0.05/GB egress, first 1,000 GB/mo free** | Zero — managed anycast; server mints short-lived creds via REST | **Chosen (TURN)** |
| **Google public STUN** (`stun.l.google.com:19302`) | Free · (STUN only, no TURN) | Zero — no account, no setup | **Chosen (dev STUN)** |
| Twilio Network Traversal Service | STUN free · TURN **$0.40/GB** (US/DE), up to $0.80/GB (AU/BR), **no free tier** | Low — managed, REST token API | Rejected — 8× Cloudflare's rate and no free allowance |
| Metered.ca / Open Relay | Free tier **500 MB/mo** · next tier **$99/mo for 150 GB** | Low — managed, API key | Rejected — tiny free tier, steep step-up vs Cloudflare's 1,000 GB free |
| Self-hosted **coturn** | Free software · VPS + bandwidth (~$5–20/mo) | **High** — provision a UDP-heavy box, TLS certs (Let's Encrypt + renewal), relay port-range + firewall config, an ephemeral-credential backend, and ongoing CVE patching (coturn shipped fixes through 4.14 in 2026) | Rejected — real ops the project convention tells us to avoid |

### Decision

- **STUN (dev):** use **Google's public STUN** servers. No account, no setup —
  enough to gather server-reflexive candidates for local/LAN dev, where two
  tabs or same-network peers connect on host/STUN candidates alone and never
  touch a relay.
- **TURN:** use **Cloudflare Realtime TURN** as the relay fallback, provisioned
  lazily. It is a standard `turn:`/`turns:` endpoint that drops straight into
  the `RTCIceServer[]` list DMI-2's native `RTCPeerConnection` consumes.

### Justification

- **Free through the entire dev phase.** Cloudflare's 1,000 GB/mo free tier
  means TURN costs **$0** at dev volume. Twilio bills $0.40/GB from the first
  byte; Metered's free tier is only 500 MB and jumps to $99/mo. For a
  single-stage dev project, Cloudflare is the only option that is both managed
  *and* free at our scale.
- **Zero ops, which the convention demands.** AGENTS.md §3 says the
  environment is deliberately kept simple. Self-hosting coturn contradicts that
  directly: a public UDP relay to patch, TLS certs to rotate, a port range to
  open, and a credential backend to run — all to solve the minority
  restrictive-NAT case. Cloudflare removes every one of those chores.
- **No client lock-in, consistent with DMI-2.** All four managed options and
  coturn expose the same standard STUN/TURN protocol; the browser only ever
  sees an `RTCIceServer[]`. Nothing here contradicts DMI-2's raw
  `RTCPeerConnection` choice, and switching TURN providers later is a
  server-side credential change, not a code change.
- **Cheapest paid path if we ever scale.** At $0.05/GB Cloudflare is ~8×
  cheaper than Twilio's cheapest region, so the free-tier choice does not paint
  us into an expensive corner post-dev.

---

## 3. Hosting — where it lives relative to `packages/signaling`

**STUN/TURN is a separate managed service, not co-hosted with the signaling
server.** The two are decoupled and talk over a credential-minting boundary:

- **Signaling** stays a self-hosted process (`packages/signaling`), deployed
  wherever DMI-4's hosting note lands it (Fly.io / Railway — a stateful WS host
  with sticky sessions). It owns no relay bytes.
- **STUN/TURN** is Cloudflare Realtime, a distinct product accessed over the
  network. If the web app is later hosted on Cloudflare Pages (a DMI-4 option),
  TURN is the *same vendor account* but still a *separate service* from the
  signaling process — never bundled into it.

**Credential flow (wiring path, implemented by DMI-21 — not this ticket):**

1. The Cloudflare TURN **Token ID** and **API token** live only as
   server-side env secrets on the signaling host — never in the browser
   bundle. Proposed vars:
   - `CLOUDFLARE_TURN_TOKEN_ID`
   - `CLOUDFLARE_TURN_API_TOKEN`
2. On join, the signaling server calls Cloudflare's REST endpoint to mint a
   **short-lived** ICE credential and returns the resulting `RTCIceServer[]`
   (Google STUN + Cloudflare `turns:` entry) to the client over the existing
   Socket.io connection — e.g. an `ice:config` message added to
   `packages/shared` by DMI-21.
3. The web client feeds that list straight into
   `new RTCPeerConnection({ iceServers })` (DMI-2).

This keeps the long-lived API key server-side, hands the browser only
ephemeral credentials, and means the client needs **no** Cloudflare SDK — just
the standard ICE config it already expects.

**Dev default:** until DMI-21 wires credential minting, dev runs with STUN-only
(`iceServers: [{ urls: "stun:stun.l.google.com:19302" }]`); TURN is provisioned
only when a real restrictive-NAT test needs it. No provisioning is required to
land this decision.

---

## 4. Summary

| Concern | Choice | Hosting |
|---|---|---|
| Signaling | Self-hosted Node + Socket.io (`packages/signaling`) | Own process (Fly.io/Railway per DMI-4) |
| STUN (dev) | Google public STUN | None — public endpoint |
| TURN | Cloudflare Realtime TURN | Separate managed service; creds minted by signaling |

---

## Explicitly out of scope (owned by other tickets)

- P2P transport / `RTCPeerConnection` API — **DMI-2**
- Real room/lobby protocol, SDP/ICE relay wiring, `ice:config` message,
  Cloudflare credential minting — **DMI-19 / DMI-20 / DMI-21**
- Delay-based netcode, frame buffering — **DMI-6 / DMI-14**
- Rollback — **DMI-26** (fase 2, deferred)
- Actual provisioning of a Cloudflare account / production TURN — deferred
  until the product deploys beyond single-stage dev (AGENTS.md §3)

## Sources

Pricing verified July 2026:

- [Cloudflare Realtime TURN — pricing & free tier](https://developers.cloudflare.com/realtime/turn/)
- [Twilio Network Traversal Service — pricing](https://www.twilio.com/en-us/stun-turn/pricing)
- [Metered.ca — pricing / Open Relay](https://www.metered.ca/pricing)
- [coturn project](https://github.com/coturn/coturn) · [self-hosted STUN/TURN setup (WebRTC.ventures, 2025)](https://webrtc.ventures/2025/01/how-to-set-up-self-hosted-stun-turn-servers-for-webrtc-applications/)
