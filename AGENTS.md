# AGENTS.md — Loop Protocol

This repo is built by an **agentic loop**: one Linear ticket per session, one PR per ticket, human approval before merge. This document is the contract every agent must follow before writing code.

- **Linear team:** `dmitry` (prefix `DMI`)
- **Source of truth for scope:** the Linear ticket. Never expand beyond its acceptance criteria.
- **Source of truth for the product:** the RETRO64 v2 spec (parent ticket **DMI-1** links it in its description; ask the human if you can't find it).
- **Source of truth for UI/visual design:** [`design.md`](./design.md) (DMI-29) — the Neo-Retro Pixel design system (colors, typography, spacing, components). Read it before starting any ticket with a UI component (landing, control remapping, connection/latency indicators, error handling, etc.).
- **Mechanics** (branching, commits, PR opening, Linear state transitions): see [`.claude/skills/git-flow/`](./.claude/skills/git-flow/SKILL.md). This file is the *what*; the skill is the *how*.
- **Lessons learned** — durable, project-wide knowledge that isn't obvious from the code, the tickets, or the decision docs: [`memory/MEMORY.md`](./memory/MEMORY.md). Read it at the start of a session; consult it whenever something surprises you; and **add to it** whenever you learn something a future agent would otherwise waste time rediscovering (keep entries non-redundant with what the repo already records).

---

## 1. Session-per-ticket protocol

One session = one ticket. Do not batch. Do not touch anything the ticket does not require.

### 1.1 Pick the ticket

1. `list_issues` on team `dmitry` with `state: "Todo"`, ordered by priority (Urgent → Low).
2. Get the top candidate with `get_issue` (use `includeRelations: true`).
3. Skip it and try the next if **any** `blockedBy` relation is not in `Done`.
4. If the human specified a ticket by ID, use that one — still validate blockers.
5. If this session was launched by the orchestrator (`orchestrator.md`), the
   ticket is already selected — skip steps 1–3 above and go straight to §1.2.
   Steps 1–4 apply when this file is invoked directly (manual/interactive runs
   with no orchestrator involved).

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

### 1.4 Verify — the verification loop (DMI-73)

**A PR is not "done" because it compiles. It is done when something other than your
own judgement has confirmed the acceptance criteria hold.** Typecheck and build
prove the code is well-formed, not that the feature works. This section is the
gate between implementation and §1.5.

#### 1.4.1 Static gate (always)

```bash
pnpm lint        # eslint, flat config at the repo root
pnpm typecheck   # or pnpm --filter @retro64/<pkg> typecheck
pnpm build       # or pnpm --filter @retro64/<pkg> build
```

All three must pass. This is necessary, never sufficient — do not stop here.

#### 1.4.2 Pick the verification tier

Match the tier to the ticket's **surface**, not to what's convenient. A
server-only ticket isn't forced through a browser; a UI ticket isn't allowed to
skip one.

| Ticket surface | Required verification | Lands in |
|---|---|---|
| **Anything a browser can reach** — UI, client-side logic, or a server whose contract a browser exercises (signaling, netplay, ROM loading) | A Playwright spec that drives the real running app and asserts the AC | `packages/e2e/tests/` |
| **Server / protocol with no browser path yet** | An integration test against the real process — real socket, real HTTP, no mocking the thing under test | `packages/e2e/tests/` (or a package-level test once one exists) |
| **Pure logic** (parsers, codecs, state machines) | Unit test next to the code | alongside the source |
| **Docs / config / protocol files only** (this ticket's own type) | No runtime test. State plainly in the PR that the change has no runtime surface | — |

Assertions are written against **the ticket's acceptance criteria, one test per
criterion**, so a reviewer can map the spec to the AC without reading the diff.
If a criterion is genuinely unverifiable in this environment (e.g. "deploy to
staging"), **say so explicitly in the PR and escalate it** — never quietly let
the remaining green tests imply full coverage.

#### 1.4.3 Which tool

The step is defined by its **outcome** — the app ran and the AC were asserted
against it — not by a tool. Rationale and the evidence behind this in
[`docs/decisions/DMI-73-verification-loop.md`](./docs/decisions/DMI-73-verification-loop.md).

- **Default, and the only option for unattended runs: Playwright** (`pnpm test`,
  or the `playwright` MCP server for exploratory poking). It is headless, needs
  no human present, and leaves a committed spec behind.
- **claude-in-chrome is permitted only in local/interactive sessions**, as a
  supplement for "does this actually look right" checks. It requires a running
  Chrome, an installed extension, and interactively-granted per-site
  permissions, none of which exist under `claude -p` or a cron trigger. **It
  never satisfies this gate on its own** — if you used it, the committed
  Playwright spec still has to exist.

#### 1.4.4 The loop

```
implement → run the verification → pass?
                                    │
                          no ───────┴─────── yes → §1.5 Hand off
                          │
                   diagnose & fix
                          │
                   re-run (attempt ≤ 3)
                          │
              still failing after 3 → STOP. Do not open the PR.
              Escalate per orchestrator.md §6 (Linear comment +
              scripts/notify.sh), leave the branch and the failing
              output in place, and end the session.
```

- Fix and re-verify **in the same session**. Never open a PR you know is broken.
- **Never weaken a test to make it pass.** Loosening an assertion, adding a
  `test.skip`, or extending a timeout to paper over a race is a failed
  verification, not a passing one — escalate instead.
- A test that cannot fail is worthless. When you add a spec, confirm it **fails
  against the pre-change code** before you trust it passing against yours.
- Attach the actual verification output to the PR's Test plan — the pass/fail
  lines, not a prose claim that it worked.

#### 1.4.5 CI runs this gate too

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) re-runs the same gate on
every PR and every push to `main`, on a clean machine:

| Job | Runs |
|---|---|
| **Lint · Typecheck · Build** | `pnpm lint`, `pnpm typecheck`, `pnpm build` |
| **E2E (Playwright)** | `pnpm test` against the real signaling + web servers |

Running it locally is still your job — CI is the backstop that catches a skipped
step, not a substitute for verifying before you open the PR. **A red CI run is a
failed verification**: fix it within the §1.4.4 attempt budget or escalate. Never
merge past it, and never disable a job to make it green.

#### 1.4.6 Then

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
- **Commands** (run from repo root): `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`. Per-package: `pnpm --filter @retro64/<pkg> <script>`.
- **Lint:** ESLint 9 flat config, one `eslint.config.js` at the repo root covering every package (rule sets shouldn't drift between them). Deliberately not type-aware — `pnpm typecheck` already runs `tsc --noEmit` everywhere. `pnpm lint:fix` for autofixes.
- **CI:** GitHub Actions ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs lint/typecheck/build and the Playwright suite on every PR — see §1.4.5.
- **E2E / verification:** `packages/e2e` — Playwright, wired up in **DMI-73**. `pnpm test` boots the real signaling + web dev servers and drives them with real browsers. First run on a new machine needs `pnpm --filter @retro64/e2e install:browsers`.
- **Verify before PR:** `pnpm typecheck` and `pnpm build` must pass, **and** the ticket's acceptance criteria must be asserted per §1.4. Static checks alone are not a verification.
- **Settled architecture — build on these, don't re-decide:** P2P transport (DMI-2, native `RTCPeerConnection`/`RTCDataChannel`) and emulation engine (DMI-3, Nostalgist.js) are both **Decided** — see [`docs/decisions/DMI-2-p2p-transport.md`](./docs/decisions/DMI-2-p2p-transport.md) and [`docs/decisions/DMI-3-emulation-engine.md`](./docs/decisions/DMI-3-emulation-engine.md). Follow those docs; only escalate if a ticket needs a decision they don't actually make.

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
- ❌ Open a PR whose verification (§1.4) is failing, skipped, or was weakened to pass.
- ❌ Claim a feature works on the strength of your own reading of the diff. Run it.

---

## 6. Where the mechanics live

- **Branching, commits, PR shape, Linear state transitions:** [`.claude/skills/git-flow/SKILL.md`](./.claude/skills/git-flow/SKILL.md) (DMI-28).
- **Worktree isolation** (for future parallel-agent runs): documented in the git-flow skill.

If the skill and this file ever disagree, this file wins — and open a ticket to fix the skill.
