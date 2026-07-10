# DMI-4 — Stack decision

Status: **Decided** · Ticket: [DMI-4](https://linear.app/pawsy/issue/DMI-4) · Parent: DMI-1 (Decisiones de Arquitectura)

Defines the baseline stack for the RETRO64 v2 rebuild. Scope is the skeleton
only — the load-bearing sub-decisions live in their own tickets and are noted
below so this choice doesn't pre-empt them.

## Decisions

| Concern | Choice | Rationale |
|---|---|---|
| **Repo structure** | pnpm monorepo (`packages/web`, `packages/signaling`, `packages/shared`) | One repo keeps the client/server wire contract (`shared`) in sync via a single source of truth. `pnpm` workspaces are fast and first-class. |
| **Language** | TypeScript everywhere, strict | Shared types across the WebRTC/signaling boundary are the whole point of `shared`; strict catches protocol drift at compile time. |
| **Frontend** | Vite + TypeScript, **no UI framework** | The app is small (landing, lobby, in-game) and dominated by an imperative WASM emulator canvas + WebRTC. A framework's virtual DOM/hydration adds friction with no payoff here. Revisit only if routed pages multiply. |
| **Signaling / lobby server** | Node + TypeScript + **Socket.io** | Built-in rooms, reconnection, and heartbeat map cleanly onto game rooms and shorten DMI-19/20/21. Matches the prior app's mental model. |
| **Package manager** | pnpm 9 (via corepack) | Workspace support, disk-efficient, deterministic. Pinned through `packageManager`. |
| **Dev runner** | `tsx` (signaling), Vite dev server (web) | Both compile TS on the fly — no build step in the dev inner loop. |
| **Prod build** | `esbuild` bundle (signaling), `vite build` (web) | Signaling bundles `shared` inline with `socket.io` external, so `node dist/server.js` is self-contained. |

## Hosting (recommended, not yet provisioned)

Deferred to when we actually deploy; the deeper signaling/TURN call is **DMI-5**.

- **Web** (static): Cloudflare Pages or Vercel.
- **Signaling** (stateful WS): Fly.io or Railway — needs sticky sessions if scaled horizontally.
- **STUN/TURN**: managed (Cloudflare / Twilio) — decided in DMI-5.

Environments: **single stage (dev only)** for now, per AGENTS.md §3. Staging/prod
deferred until the product needs it.

## Explicitly out of scope (owned by other tickets)

- P2P transport / WebRTC library — **DMI-2**
- Emulation engine — **DMI-3**
- Signaling architecture + STUN/TURN — **DMI-5**
- Room protocol, codes, lobby state — **DMI-19 / DMI-20 / DMI-21**

`packages/shared` intentionally ships only `PROTOCOL_VERSION` and a couple of
alias types; the real message schema is filled in by the tickets above.

## Repo layout

```
retro64V2/
├── package.json            # workspace root scripts (dev, build, typecheck)
├── pnpm-workspace.yaml
├── tsconfig.base.json      # shared strict compiler options
├── packages/
│   ├── web/                # Vite + TS frontend
│   ├── signaling/          # Node + TS + Socket.io server
│   └── shared/             # wire-contract types (client ↔ server)
└── docs/decisions/
```
