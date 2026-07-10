# AGENTS.md — Loop Protocol

This repo is built by an **agentic loop**: one Linear ticket per session, one PR per ticket, human approval before merge. This document is the contract every agent must follow before writing code.

- **Linear team:** `dmitry` (prefix `DMI`)
- **Source of truth for scope:** the Linear ticket. Never expand beyond its acceptance criteria.
- **Source of truth for the product:** the RETRO64 v2 spec (parent ticket **DMI-1** links it in its description; ask the human if you can't find it).
- **Source of truth for UI/visual design:** [`design.md`](./design.md) (DMI-29) — the Neo-Retro Pixel design system (colors, typography, spacing, components). Read it before starting any ticket with a UI component (landing, control remapping, connection/latency indicators, error handling, etc.).
- **Mechanics** (branching, commits, PR opening, Linear state transitions): see [`.claude/skills/git-flow/`](./.claude/skills/git-flow/SKILL.md). This file is the *what*; the skill is the *how*.

---

## 1. Session-per-ticket protocol

One session = one ticket. Do not batch. Do not touch anything the ticket does not require.

### 1.1 Pick the ticket

1. `list_issues` on team `dmitry` with `state: "Todo"`, ordered by priority (Urgent → Low).
2. Get the top candidate with `get_issue` (use `includeRelations: true`).
3. Skip it and try the next if **any** `blockedBy` relation is not in `Done`.
4. If the human specified a ticket by ID, use that one — still validate blockers.

### 1.2 Read before you code

Before touching the repo:

- Read the full ticket **description** (`get_issue` — the list view truncates it).
- Read every ticket in `blockedBy`, `parentId`, and `relatedTo` — decisions from parents constrain your solution.
- Note the **acceptance criteria**. These are the definition of done. If your PR does not satisfy every bullet, it is not ready.
- If a criterion depends on a decision that hasn't been made yet (e.g., a stack choice from **DMI-4**), stop and ask the human — do not invent the decision.

### 1.3 Implement, only that

- Change only what the ticket requires.
- No drive-by refactors, no "while I'm here" cleanups, no speculative abstractions.
- If you discover a real problem outside the ticket's scope, file a new Linear ticket via `save_issue` and keep going.

### 1.4 Verify

- Run tests and typecheck for the affected area. If none exist yet (early phase), say so explicitly in the PR body.
- For UI changes, exercise the feature in a browser before claiming done.
- Do not mark the Linear ticket `Done` — that's the human's call at merge time.

### 1.5 Hand off

- Open a PR. Never self-merge.
- Move the Linear ticket to **In Review** (see the git-flow skill).
- End the session. The next session picks up the next ticket.

---

## 2. Model routing

Pick the model that matches the ticket's cognitive load.

| Ticket type | Model | Why |
|---|---|---|
| **Architecture / decision tickets** — children of **DMI-1** (Decisiones de Arquitectura), anything titled "Decidir…" or "Definir estrategia…" | **Opus** | Trade-off analysis, ambiguity, load-bearing choices. Cost of a wrong call is high. |
| **Implementation tickets** — features, wiring, UI, endpoints, tests | **Sonnet 5** | Bounded scope, clear acceptance criteria, faster iteration. |
| **Meta / tooling tickets** — AGENTS.md, skills, CI setup | **Opus** for the first pass (design), **Sonnet 5** for follow-up edits. | |

If unsure, default to Sonnet 5 and escalate to Opus if the ticket turns out to have hidden depth.

---

## 3. Stack conventions

Decided in **DMI-4** — full rationale in [`docs/decisions/DMI-4-stack.md`](./docs/decisions/DMI-4-stack.md).

- **Repo:** pnpm monorepo. Packages: `packages/web`, `packages/signaling`, `packages/shared`.
- **Language:** TypeScript everywhere, `strict` (see `tsconfig.base.json`).
- **Frontend:** Vite + TypeScript, **no UI framework**. Entry `packages/web`.
- **Signaling/lobby server:** Node + TypeScript + **Socket.io**. Entry `packages/signaling`. Architecture + STUN/TURN decided in **DMI-5** — see [`docs/decisions/DMI-5-signaling-turn.md`](./docs/decisions/DMI-5-signaling-turn.md). Signaling stays self-hosted here; STUN is Google's public server (dev), TURN is Cloudflare Realtime (separate managed service, creds minted server-side).
- **Shared contract:** `packages/shared` is the single source of truth for client↔server message types. Update it there, never redefine wire types in a consumer.
- **Package manager:** pnpm 9 via corepack. Node ≥ 20.
- **Commands** (run from repo root): `pnpm dev`, `pnpm build`, `pnpm typecheck`. Per-package: `pnpm --filter @retro64/<pkg> <script>`.
- **Verify before PR:** `pnpm typecheck` and `pnpm build` must pass. No test runner is wired up yet — say so in the PR if your ticket doesn't add one.
- **Still open — do NOT invent these:** P2P transport (DMI-2), emulation engine (DMI-3). Block on those tickets rather than guessing.

Other conventions:

- Environments: single stage — **dev only** — kept intentionally simple. Scaling to staging/prod is deferred until product actually needs it.
- Commit style: **conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`), scope optional. Enforced by the git-flow skill.

---

## 4. Linear reads — the exact calls

Every session starts with these MCP calls against the `dmitry` team:

```
list_issues { team: "dmitry", state: "Todo", orderBy: priority }
get_issue  { id: "DMI-XX", includeRelations: true }   # for the candidate
get_issue  { id: "<each blockedBy id>" }              # verify blockers are Done
```

If you can't reach Linear, **stop** — don't guess ticket state.

---

## 5. What NOT to do

- ❌ Merge your own PR.
- ❌ Move a ticket to `Done` yourself.
- ❌ Take a ticket whose `blockedBy` isn't resolved.
- ❌ Solve two tickets in one PR (even if they feel related — file a follow-up instead).
- ❌ Add dependencies, frameworks, or cloud services not called for by the ticket.
- ❌ Push to `main` directly. Ever.

---

## 6. Where the mechanics live

- **Branching, commits, PR shape, Linear state transitions:** [`.claude/skills/git-flow/SKILL.md`](./.claude/skills/git-flow/SKILL.md) (DMI-28).
- **Worktree isolation** (for future parallel-agent runs): documented in the git-flow skill.

If the skill and this file ever disagree, this file wins — and open a ticket to fix the skill.
