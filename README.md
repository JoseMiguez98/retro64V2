# RETRO64 v2

Play retro games (NES/SNES/Genesis/GBA/N64/PS1) online with friends directly in the browser.
No downloads, no plugins. Load a ROM → share a room code → play together.

## Status

Fresh rebuild. Architecture decisions in progress — see [Linear team `dmitry`](https://linear.app/pawsy/team/DMI/all) and issue **DMI-1** for the roadmap.

## Stack

pnpm monorepo, TypeScript throughout. Full rationale in [`docs/decisions/DMI-4-stack.md`](./docs/decisions/DMI-4-stack.md).

| Package | What | Tech |
|---|---|---|
| `packages/web` | Browser client (landing, lobby, emulator) | Vite + TypeScript, no UI framework |
| `packages/signaling` | Signaling + lobby server | Node + TypeScript + Socket.io |
| `packages/shared` | Wire contract shared client ↔ server | TypeScript types |

## Requirements

- Node ≥ 20
- pnpm 9 (`corepack enable`)

## Run

```bash
pnpm install       # install all workspaces
pnpm dev           # run web (:5173) + signaling (:3001) together
```

Or individually:

```bash
pnpm dev:web       # Vite dev server on :5173
pnpm dev:signaling # Socket.io server on :3001 (health: /health)
```

Other scripts: `pnpm build`, `pnpm typecheck` (run across all packages).

## Emulator engine

The engine decision is [`docs/decisions/DMI-3-emulation-engine.md`](./docs/decisions/DMI-3-emulation-engine.md);
its real integration into `packages/web` (and how to add a new console) is
[`docs/emulator-engine.md`](./docs/emulator-engine.md).

## Agentic workflow

This repo is built by an agentic loop, one ticket per session. See [`AGENTS.md`](./AGENTS.md) for the protocol and [`.claude/skills/git-flow/`](./.claude/skills/git-flow/) for the mechanics.
