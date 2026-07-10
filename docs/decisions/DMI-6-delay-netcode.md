# DMI-6 — Delay-based netcode strategy

Status: **Decided** · Ticket: [DMI-6](https://linear.app/pawsy/issue/DMI-6) · Parent: DMI-1 (Decisiones de Arquitectura) · Blocks: DMI-14

Defines the delay-based netcode *strategy* for RETRO64 v2: the default frame
delay, the formula/table that maps measured round-trip time (RTT) to input
delay in frames, how RTT is measured between peers, and how the system reacts
when the connection degrades mid-match.

This is a **decision ticket** — it produces the strategy DMI-14
("Sincronización de input") implements, not the implementation itself. It does
**not** write the input-sync loop, the ping/pong wire types, or the
`RTCDataChannel` plumbing (that is DMI-14, blocked by this ticket), and it does
**not** open or configure the P2P connection (DMI-12/DMI-2). It is constrained
by two prior decisions:

- **DMI-2** — transport is the native `RTCPeerConnection` / `RTCDataChannel`,
  and the input channel is `ordered: false, maxRetransmits: 0` (unreliable,
  unordered — late frames are dropped, never retransmitted). Every mechanism
  here must ride on that channel and tolerate loss and reordering.
- **DMI-3** — the emulator is `nostalgist` (libretro WASM cores) spanning
  consoles that run at different frame rates. The formula is therefore
  expressed in terms of a **frame duration `F` (ms)**, not hardcoded to 60 fps.

---

## 1. Background — what delay-based netcode is

In delay-based (lockstep) netcode, both emulators run the **same simulation in
the same order**: a given frame is advanced only when *both* players' inputs
for that frame are known. To hide network latency, each peer **delays applying
its own local input by `D` frames**. Local input sampled at frame `N` is
scheduled to take effect at frame `N + D` on *both* machines; that `D`-frame
window is the budget within which the input packet must reach the remote peer.

Two invariants follow, both of which DMI-14 must uphold:

1. **`D` is identical on both peers.** Asymmetric delay desynchronizes the
   simulation. Any delay change is a negotiated, scheduled event (§5).
2. **If a remote input for the current frame is missing, the emulator must
   stall (wait), not guess.** Pure delay-based netcode does not predict — that
   is what rollback (DMI-26, deferred) adds. A well-chosen `D` makes stalls
   rare; §5 defines what happens when they stop being rare.

This directly serves DMI-14's acceptance criteria: local input sent and applied
with the calculated delay, both emulators advancing synchronized frames (same
input on the same frame on both sides).

---

## 2. Frame-delay formula and table

### 2.1 Formula

Delay must cover the **one-way** network latency (≈ `RTT / 2`) plus a jitter
safety margin, converted to frames at the emulator's frame duration `F`:

```
D = clamp( ceil( (RTT_smoothed / 2) / F ) + 1 , D_min , D_max )
```

- `RTT_smoothed` — the EMA-smoothed round-trip time in ms (§3), *not* a raw
  sample. Smoothing is what stops `D` from flapping on every noisy packet.
- `F` — frame duration in ms, read from the core's reported frame rate
  (libretro `av_info` fps; `nostalgist` exposes this). NTSC 60 fps → `F ≈ 16.67`;
  PAL 50 fps → `F = 20`.
- `ceil(halfRTT / F)` — the whole frames needed to cover one-way latency.
- `+ 1` — **one frame of jitter headroom.** The channel is unreliable/unordered
  (DMI-2), so packets arrive late or out of order. One extra frame absorbs
  ordinary jitter without a stall; it is the difference between "smooth" and
  "occasional hitch" at a given RTT.
- `clamp(…, D_min, D_max)` with **`D_min = 2`, `D_max = 8`** (see §2.3).

### 2.2 Table (dev-phase target: 60 fps NTSC, `F ≈ 16.67 ms`)

Each RTT band maps to exactly one delay value under the formula above. Input
lag is `D × F` on each side — the price paid, in ms, for smoothness.

| RTT (smoothed, ms) | Frame delay `D` | Input lag @60 fps | Quality band |
|---|---|---|---|
| 0 – 33   | 2 | 33 ms  | Excellent (LAN / same metro) |
| 34 – 66  | 3 | 50 ms  | Very good (same region) |
| 67 – 100 | 4 | 67 ms  | Good |
| 101 – 133 | 5 | 83 ms  | Playable |
| 134 – 166 | 6 | 100 ms | Playable, noticeable lag |
| 167 – 200 | 7 | 117 ms | Marginal |
| 201 – 233 | 8 | 133 ms | Poor — at the ceiling |
| > 233 | 8 (capped) | 133 ms | Degraded — expect stalls (§5.3) |

**Default at session start:** before the RTT EMA has converged (first few pings
during connection setup), open the session at **`D = 3`** — one band above the
floor, conservatively covering same-region play — then settle to the table
value once the EMA stabilizes (~5–10 samples, ≈1–2 s). The absolute floor is
`D = 2`; RETRO64 never runs at `D < 2` even on a 0 ms LAN, because one frame of
headroom plus the `D_min` floor is what keeps loss/jitter from stalling frame 1.

### 2.3 Why these bounds (`D_min = 2`, `D_max = 8`)

- **Floor `D = 2`.** This is the GGPO/Fightcade-style convention for a healthy
  connection: two frames (33 ms @60 fps) is imperceptible to almost all players
  and gives the jitter buffer somewhere to live. `D = 0` or `1` leaves no slack
  for an unreliable channel and stalls on the first late packet.
- **Ceiling `D = 8`.** 8 frames is ~133 ms of input lag at 60 fps — the upper
  edge of what stays playable for reaction-sensitive games. Beyond it, raising
  `D` further trades one bad experience (occasional stalls) for another
  (unresponsive controls), so we cap and switch to degradation handling (§5.3)
  instead of climbing indefinitely. `D_max` is a tunable constant, not a hard
  assumption (§6).

### 2.4 Generalization beyond 60 fps NTSC

The **formula is frame-rate-agnostic**: it consumes `F` and produces a frame
count, so a PAL 50 fps core (`F = 20`) or a variable-rate N64/PS1 title
(DMI-3) gets a correct — if slightly different — banding for free. Two
follow-ups are explicitly deferred, not solved here:

- **PAL / 50 fps and per-core `F`** — the table above is the 60 fps NTSC
  instantiation for the dev phase. DMI-14 should read `F` from the core rather
  than hardcode 16.67; producing a per-core table is trivial once it does.
- **Variable frame-rate cores (N64/PS1)** — where the core's fps drifts by
  title/scene, `F` should be the core's *nominal* av_info fps for delay
  computation; fine-grained handling of intra-title rate changes is a DMI-14 /
  perf (DMI-9) concern, flagged here, not designed here.

---

## 3. RTT measurement mechanism

### 3.1 Options considered

| Option | How | Fit |
|---|---|---|
| **App-level ping/pong on the input data channel** | Send small `ping` packets on the existing `ordered:false, maxRetransmits:0` channel; peer echoes `pong`; RTT = arrival − send | **Chosen** — measures the exact path the input packets take, on the exact channel they use |
| WebRTC `getStats()` `currentRoundTripTime` | Read the ICE/DTLS RTT from `RTCPeerConnection.getStats()` | Rejected as *primary* — measures the transport candidate pair, not application queuing on our data channel; coarse and sampled. Kept as a sanity cross-check / cold-start hint |
| Ping on a **separate reliable channel** | Add a second `ordered:true` channel for pings | Rejected — a reliable channel retransmits and head-of-line-blocks, which *inflates and distorts* the very latency we are trying to measure, and adds a channel DMI-2 deliberately avoided |

### 3.2 Chosen mechanism

**Periodic application-level ping/pong on the existing DMI-2 input channel**
(same `ordered: false, maxRetransmits: 0` `RTCDataChannel` — no new channel, no
reliable channel).

- Each peer sends a `ping` every **~250 ms** carrying a monotonically
  increasing sequence number and its local high-resolution send timestamp
  (`performance.now()`).
- The receiver immediately replies with a `pong` that **echoes the original
  send timestamp** (and its own seq). Echoing the sender's own clock means RTT
  is computed as `now − tSend` **without any cross-peer clock synchronization**
  — only one machine's clock is ever involved per measurement.
- On `pong` receipt: `sample = performance.now() − tSend`.
- Smooth with an **exponential moving average**:
  `rtt_ema = α · sample + (1 − α) · rtt_ema`, with **α ≈ 0.1–0.2**. The EMA is
  what feeds the §2 formula. Raw samples are never used to pick `D` — that
  would make delay flap on every jittery packet.
- **Loss is expected and harmless.** The channel drops packets by design; a
  lost `ping`/`pong` simply yields no sample that period. At ~4 pings/s the EMA
  stays fresh through routine loss. Sequence numbers let the receiver ignore
  stale/duplicate pongs (unordered delivery).

### 3.3 Conceptual message shape (illustrative — wire types are DMI-14's)

Sketched only to make the mechanism concrete, matching how DMI-5 named
`ice:config` and env vars without owning their final form. The **authoritative
types live in `packages/shared`, added by DMI-14**; this ticket does not touch
`packages/shared`.

```
// illustrative, not the final contract
type Ping = { t: "ping"; seq: number; tSend: number };   // tSend = sender performance.now()
type Pong = { t: "pong"; seq: number; tSend: number };   // tSend echoed back verbatim
```

RTT is symmetric, so both peers independently arrive at near-identical
`rtt_ema` and thus near-identical target `D` — which §5 reconciles into a
single agreed value.

### 3.4 Note — frame synchronization is more than input delay

Correct `D` covers latency, but two emulators can still **drift** if one host
advances frames faster than the other. Standard delay-based practice: peers
piggyback their **current frame number / frame advantage** onto the packets
they already exchange, and the peer that is *ahead* stalls one frame
periodically to let the other catch up. This keeps "same input on the same
frame on both sides" (DMI-14 AC #2) true over time. The detailed
frame-advantage loop is **DMI-14's implementation**; it is called out here
because it is part of the delay-based *strategy* and reuses the same telemetry
as RTT measurement.

---

## 4. Default and steady-state behavior (summary)

- **Cold start:** `D = 3` until the EMA converges, then the §2 table applies.
- **Steady state:** every ~250 ms a new sample updates `rtt_ema`; `D` is
  recomputed but only *changes* through the hysteresis/negotiation rules in §5.
- **Floor/ceiling:** `D` never leaves `[2, 8]`.

---

## 5. Degradation behavior mid-match

RTT is not static — a player's network can worsen mid-game (Wi-Fi
interference, congestion, a background download). The strategy must raise delay
to stay smooth, avoid flapping on transient blips, keep both peers in lockstep,
and have a defined floor of last resort.

### 5.1 Hysteresis — don't flap

Recomputing `D` from a band table on every sample would oscillate at band
boundaries. Rules:

- **Deadband at boundaries.** A boundary only counts as crossed once
  `rtt_ema` moves past it by a margin (e.g. ±5 ms), not the instant it touches.
- **Asymmetric debounce (raise fast, lower slow).**
  - **Raise `D`** as soon as `rtt_ema` sits in a higher band for a short window
    (e.g. ~0.5 s / a couple of samples) — protecting sync is urgent.
  - **Lower `D`** only after `rtt_ema` sits *comfortably* inside a lower band
    for a sustained window (e.g. ~5 s). Dropping delay is a comfort
    optimization, never worth risking a stall for, so it is deliberately lazy.

### 5.2 Delay change is negotiated and scheduled (stays in lockstep)

Because `D` must be identical on both peers (§1), a change is **agreed and
applied at a future frame**, never flipped unilaterally:

1. Each peer computes its own target `D` from its `rtt_ema`.
2. The peer proposing a change sends a small **delay-change control message**
   naming the **new `D`** and the **frame number `F_apply`** at which it takes
   effect, scheduled a safe few frames ahead so the message arrives in time.
3. To guarantee convergence, both peers adopt **`D = max(local_target,
   remote_target)`** — the higher (safer) delay wins — applied atomically at
   `F_apply` on both machines.

This message is again conceptually named only; its wire type is DMI-14's, in
`packages/shared`. Increases follow the fast path (§5.1); decreases follow the
slow path.

### 5.3 Hard ceiling and last resort

When `rtt_ema` demands more than `D_max = 8`:

- **Clamp at `D = 8` and hold.** The formula stops climbing; input lag is
  capped at ~133 ms @60 fps.
- **Stalls become the pressure valve.** If a remote input for the current frame
  has not arrived, the emulator **pauses that frame and waits** (the lockstep
  guarantee — no prediction in pure delay-based). Brief waits manifest as
  micro-stutter; this is the expected, bounded degradation past the ceiling.
- **Escalation thresholds (defined here, acted on elsewhere):**
  - Sustained `rtt_ema > ~233 ms` (i.e. pinned at `D = 8`) → surface a
    **connection-quality warning** — owned by **DMI-23** (latency/quality
    indicator).
  - A per-frame stall exceeding a wait timeout (e.g. ~1 s with no remote input),
    or `rtt_ema` sustained above a **disconnect threshold (~500 ms for >~10 s)**
    → treat as a broken session and hand off to **DMI-13** (disconnect /
    reconnect handling).

This ticket **defines the thresholds and the stall policy**; the UI warning
(DMI-23) and the reconnect/teardown flow (DMI-13) are separate tickets that
consume them.

---

## 6. Does this open the door to rollback (DMI-26)?

Kept brief — rollback is **fase 2, deferred** (per DMI-2/DMI-5). Two points
matter for *this* decision:

- **Headroom.** Pure delay-based hits a comfort wall around `D = 6–8`
  (RTT ≈ 130–230 ms), because latency is paid as input lag. That wall is *why*
  DMI-26 exists: rollback predicts remote input and re-simulates, removing the
  lag/stall trade-off. The §2 ceiling is set with that wall in mind — we cap
  rather than pretend delay scales to any RTT.
- **Reuse, not rework.** The RTT ping/pong telemetry (§3) and the frame-number
  / frame-advantage exchange (§3.4) are exactly the inputs a rollback
  implementation needs. Keeping `D_max`, `α`, and the jitter headroom as
  **tunable constants** (not baked assumptions) means DMI-26 can layer on
  prediction later without redoing measurement.

Designing rollback itself is explicitly **out of scope**.

---

## 7. Explicitly out of scope (owned by other tickets)

- Input-sync loop, applying input at the calculated delay, frame-advantage
  stalling, and all wire types (`ping`/`pong`, delay-change) in
  `packages/shared` — **DMI-14**
- Opening/configuring the `RTCPeerConnection` / `RTCDataChannel` — **DMI-12** /
  **DMI-2**
- Signaling / STUN / TURN — **DMI-5**
- Connection-quality / latency indicator UI — **DMI-23**
- Disconnect / reconnect handling — **DMI-13**
- Rollback netcode (prediction + re-simulation) — **DMI-26** (fase 2, deferred)
- Per-core PAL/variable-rate tables and perf tuning for N64/PS1 — **DMI-9** /
  **DMI-14** follow-up

## Sources

Delay-based netcode conventions (frame delay ≈ half-RTT in frames, EMA-smoothed
RTT, `D`-frame buffering, lockstep stall-on-missing-input) are long-established
in the fighting-game/GGPO lineage:

- Infil, "A Fighting Game Netcode Guide" — delay-based vs. rollback, frame
  delay intuition: <https://words.infil.net/w02-netcode.html>
- Glenn Fiedler (Gaffer On Games), networking series — jitter, unreliable
  transport, timing: <https://gafferongames.com/categories/game-networking/>
- MDN, `RTCDataChannel` (unordered / `maxRetransmits` semantics this rides on):
  <https://developer.mozilla.org/docs/Web/API/RTCDataChannel>
- Internal: [DMI-2](./DMI-2-p2p-transport.md) (transport & channel config),
  [DMI-3](./DMI-3-emulation-engine.md) (engine & frame rates),
  [DMI-5](./DMI-5-signaling-turn.md) (doc conventions).
