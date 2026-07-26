# DMI-73 — Verification loop: how an agent proves a feature works

**Status:** Decided (2026-07-25)
**Ticket:** [DMI-73](https://linear.app/pawsy/issue/DMI-73) (parent: DMI-74 Phase 0 — Validate the loop)
**Supersedes:** the ticket's original framing, "Add automated testing step to AGENTS.md **via Claude in Chrome**"

---

## Problem

The loop protocol had no step that ran the software. `AGENTS.md` §1.4 said "run
tests and typecheck… if none exist yet, say so in the PR", and §3 said no test
runner was wired up. So the strongest claim any PR could make was *it compiles*.

The live example is PR #17 (DMI-21, signaling server). Its own Test plan:

> No test runner is wired up yet in this repo, so verification was a manual
> smoke test.

That's the agent grading its own homework. It leaves the Vision & Roadmap's open
question — *how much does the orchestrator trust the agent's self-report?* —
answered by default: completely.

## Decision

1. **`AGENTS.md` §1.4 becomes a gate, not a checklist.** Acceptance criteria must
   be asserted against the actually-running app before a PR is opened, one test
   per criterion. Failure means fix-and-re-run in-session (max 3 attempts), then
   escalate — never open a known-broken PR, never weaken a test to pass.
2. **The step is specified by outcome, not by tool.** "The app ran and the AC
   were asserted against it."
3. **Playwright is the default, and the only option for unattended runs.**
   `packages/e2e`, run via `pnpm test`.
4. **claude-in-chrome is permitted only in local/interactive sessions**, as a
   supplement. It never satisfies the gate on its own.
5. **Where a drivable path exists, the spec gets committed** — verification has to
   outlive the session that produced it.
6. **CI re-runs the gate on the forge** (`.github/workflows/ci.yml`, added
   2026-07-26 on the ticket's revised AC). An agent running its own checks and
   reporting the result is the same actor-as-judge problem the rest of this
   decision is about: the gate only binds if something outside the session can
   see it fail. Two jobs — static (`lint`/`typecheck`/`build`) and e2e
   (`pnpm test`) — split so a syntax error fails fast instead of queuing behind
   a browser suite.

### Lint

The repo had no linter before this. `eslint.config.js` (flat config, ESLint 9 +
typescript-eslint) sits at the root and covers all four packages — one rule set,
so standards can't drift per package. It is deliberately **not** type-aware:
`pnpm typecheck` already runs `tsc --noEmit` over every package in the same
pipeline, and `recommendedTypeChecked` would re-pay that cost to catch little
`tsc` doesn't. Lint's job here is what the compiler is happy to let through.

## Why not claude-in-chrome, given the ticket asked for it

**It isn't present in unattended runs.** `run.log` — a real `claude -p` run of
this orchestrator — lists that run's MCP servers as:

```json
"mcp_servers":[{"name":"plugin:github:github"},{"name":"playwright"}]
```

No `claude-in-chrome`. And that isn't a config oversight to be fixed: the
extension needs a running Chrome, an installed extension, and **interactively
granted per-site permissions**. A cron-triggered `claude -p` has no human to
grant them, and DMI-76's service will have even less of one. Specifying the gate
around a tool that structurally cannot run in the environment the gate exists to
protect would make it a no-op exactly when it matters.

**And it wouldn't fully solve the stated problem anyway.** A model driving a
browser and then judging its own work is better-informed self-report, but it is
still self-report — the agent remains both actor and judge. A committed spec that
fails loudly is what actually escapes that loop, and it keeps paying off on every
later run.

| | claude-in-chrome | Playwright |
|---|---|---|
| Runs with no human present | ✗ | ✓ |
| Works in DMI-76's cron service | ✗ | ✓ |
| Leaves reusable regression coverage | ✗ | ✓ |
| Independent of the authoring agent's judgement | ✗ | ✓ |
| Good at open-ended "does this look right" | ✓ | ✗ |

The last row is real, which is why claude-in-chrome stays *permitted* locally
rather than banned. It's a supplement, not the gate.

## Consequences

- `packages/e2e` is new: Playwright, `workers: 1` (the signaling server's pairing
  state is process-global, so parallel specs would cross-pair peers), booting the
  real signaling + web dev servers via `webServer`.
- Ports are pinned (`5173`, `3001`) because the signaling server's CORS allowlist
  is `http://localhost:5173`. Randomised ports would fail CORS.
- A fresh clone needs `pnpm --filter @retro64/e2e install:browsers`; added to
  `orchestrator.md` §0 bootstrap so a missing browser doesn't read as a product
  failure.
- Tickets with no runtime surface (docs, protocol files — this one included) are
  explicitly exempt, and must say so in the PR rather than silently skipping.
- Every PR now pays ~1 min (static) and a few minutes (e2e) of CI. Accepted: the
  suite is small, and the jobs run in parallel with `cancel-in-progress` on PR
  pushes.
- A red CI run is a failed verification, subject to the same §1.4.4 attempt
  budget. Disabling a job to go green is the CI-shaped version of weakening a
  test, and is prohibited for the same reason.

## Validation

The first spec, `packages/e2e/tests/dmi-21-signaling-relay.spec.ts`, was run
against both sides of PR #17 — because a test that cannot fail proves nothing:

| Code under test | Result |
|---|---|
| `main` (no `signal:*` handlers) | **2 failed** — peers never pair, DataChannel never opens |
| PR #17's branch | **2 passed** (17.5s) |

Two isolated browser contexts, two real `RTCPeerConnection`s, one real signaling
server: offer/answer/ICE relayed, a `RTCDataChannel` opened, payload delivered
both directions, and `signal:peer-left` observed by the survivor when its partner
dropped. That is DMI-21 verified independently, rather than asserted.

Incidental finding from the run, filed rather than fixed here (out of DMI-73's
scope): PR #17 registers a second `io.on("connection")` handler with its own
`disconnect` logger alongside the DMI-2 POC block, so every disconnect logs
`[signaling] peer disconnected` twice.
