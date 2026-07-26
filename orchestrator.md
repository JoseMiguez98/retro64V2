# Orchestrator Protocol

This document defines the **decision flow** a Claude Code session must follow when
launched unattended (as a routine/cron job) against the `dmitry` team / `Retro64`
project in Linear.

It sits **above** `AGENTS.md` (session-per-ticket implementation protocol) and the
`git-flow` skill. This file decides *what to work on and whether it's safe to start*.
`AGENTS.md` decides *how to execute a ticket once it's greenlit*.

## Related files

- `AGENTS.md` — session-per-ticket execution protocol. Not preloaded here; read it
  at §4.2, once a ticket is greenlit to execute.
- `git-flow` skill — branch/commit/PR mechanics. Self-triggers when relevant.
- `design.md` — design-system/UI reference only, **not** system architecture.
  For architecture questions, the source of truth is `docs/decisions/DMI-X-*.md`
  and the linked ticket. The DMI-1–DMI-6 architecture decisions are **all
  settled** (DMI-2 P2P transport and DMI-3 emulation engine included — see their
  `docs/decisions/` files, both marked *Decided*). Still, don't assume: check the
  relevant `docs/decisions/DMI-X-*.md` and its ticket before relying on it.

*(Setup note, not needed per-session: this file is wired into every session via
`@orchestrator.md` in the repo's root `CLAUDE.md`.)*

---

## 0. Bootstrap checks (every run, before anything else)

- [ ] **No local state file.** Each Routine run gets a fresh clone — nothing
  written to disk in a prior run exists now. Instead, re-derive whether you're
  mid-escalation by checking the ticket(s) currently in `Todo` for a Linear
  comment from you (`🤖 Orchestrator:`) that hasn't been followed by a human
  reply or a state change since. If found, go straight to **§4.3
  Resume-after-wait** — do not pick a new ticket or re-post the question.
- [ ] Confirm `.claude/settings.json` → `permissions.allow` includes: `pnpm typecheck`,
  `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build`, `pnpm exec playwright *`
  (the verification gate, §4.2 / `AGENTS.md` §1.4), `git *`, `gh pr create`,
  `gh pr view`, `gh pr list`, `scripts/notify.sh *` (the escalation notifier, §6).
  If any are missing, add them (self-serve, no escalation needed — this is infra,
  not a product decision) and log the change.
- [ ] Playwright browsers present. `pnpm --filter @retro64/e2e install:browsers`
  is idempotent and cheap when already installed — a fresh Routine clone won't
  have them, and without them every verification fails for infrastructure
  reasons rather than product ones.
- [ ] `git status` — working tree must be clean and on `main` (or wherever the
  protocol starts from) before touching anything. If dirty from a previous
  interrupted run, see §6 (autonomy boundaries) before deciding whether to
  clean it up yourself or escalate.

---

## 1. Decision tree (high level)

```
                    ┌─────────────────────────┐
                    │  Any ticket in "Todo"?   │
                    └────────────┬─────────────┘
                          yes │       │ no
                              │       ▼
                              │   Scan Backlog for a workable
                              │   candidate (§3)
                              │       │
                              │   found? ──no──▶ Nothing to do. Log & exit.
                              │       │
                              │      yes
                              │       ▼
                              │   Notify user, ask for go-ahead (§3.3)
                              │   Set state = waiting_for_human. Exit.
                              ▼
                    ┌─────────────────────────┐
                    │  Pre-flight check (§4)  │
                    │  blockers? open PRs?    │
                    └────────────┬─────────────┘
                       blocker  │  clear
                       found    │
                          ▼     ▼
                  Escalate to  Execute ticket e2e via
                  user (§5)    AGENTS.md protocol (§4.2)
                                    │
                                    ▼
                          Open PR (no auto-merge),
                          move ticket to "In Review",
                          report & exit (§7)
```

---

## 2. Selecting the active ticket ("Todo" path)

If one or more tickets are already in **Todo**, ticket selection itself is
`AGENTS.md` §1.1's job (`list_issues` by priority, `blockedBy` validation) — don't
re-implement it here. The one thing to add on top:

- If the ticket `AGENTS.md` §1.1 would pick turns out **not** startable (e.g. a
  `blockedBy` was added after it was moved to Todo), don't apply §1.1's normal
  "skip and try the next Todo ticket" behavior here — someone explicitly queued
  *this* ticket, so treat it as a blocker and escalate (§5) instead of silently
  moving on to a different one.
- Only one ticket in flight per session. Do not batch-start multiple tickets in a
  single session even if several are in Todo.

---

## 3. Backlog scan ("nothing in Todo" path)

### 3.1 Candidate criteria

A Backlog ticket is a **workable candidate** only if ALL of the following hold:

- `team = dmitry`, `project = Retro64`
- Status is exactly `Backlog` (not an epic/parent container — check it has no
  sub-issues that represent the actual work)
- `blockedBy` relations (Linear's relation field, **never** issue IDs mentioned in
  free-text description) are either empty or every referenced issue is `Done`
- Has a non-empty description with identifiable acceptance criteria — if the spec
  looks incomplete (no AC, vague scope), it is **not** a candidate; it needs
  human spec work first, not agentic pickup
- Not explicitly labeled `blocked`, `needs-design`, or `on-hold` (or equivalent
  label conventions in the workspace)

### 3.2 Ranking

If multiple candidates qualify, prefer, in order:
1. Ticket explicitly flagged as low-dependency in past notes (e.g. DMI-8, DMI-18
   were called out as good first real-feature candidates)
2. Higher `blocks` fan-out — prefer the candidate that unblocks the most future
   work (i.e. the most other tickets list it in their `blockedBy`). This is about
   the `blocks` relation, not `blockedBy`.
3. Smaller estimated scope, if an estimate field is set

Pick **one** candidate. Do not propose a batch.

### 3.3 Notify & pause — do NOT self-start a Backlog ticket

Even if a candidate is found and looks completely unblocked, the orchestrator
**never** promotes a ticket from Backlog → Todo on its own. Instead:

1. Post a comment on the candidate ticket in Linear:
   > 🤖 Orchestrator: This ticket looks unblocked and ready (`blockedBy` clear,
   > AC present). Move to **Todo** if you want me to start it on the next run,
   > or reply here if you want changes to the spec first.
2. End the session. Do not attempt any other work this run. Nothing else needs
   to be recorded — the comment itself *is* the state (see §0: no local file
   survives between runs, so Linear has to be authoritative anyway).

On the **next** run, §0 bootstrap checks the same Linear ticket: has it moved to
Todo, or is there a reply comment after your `🤖 Orchestrator:` one? If yes to
either, proceed normally (§2 or re-evaluate the reply). If neither, exit again
without re-posting the question.

---

## 4. Working a ticket end-to-end

### 4.1 Pre-flight blocker check (before writing any code)

Before starting implementation on the selected ticket:

- `gh pr list --state open` — is there an **open, unmerged PR** from a prior
  session that this ticket's work would conflict with or logically depends on
  (e.g. it touches the same module, or a prior ticket in the `blockedBy` chain
  has a PR open but not merged)? This is the "PR #86 before DMI-44" case.
- If yes → **escalate** (§5), do not proceed, do not merge it yourself.
- `git fetch` + confirm `main` is up to date locally before branching.
- Confirm the ticket's `blockedBy` are still all `Done` (state can drift between
  the backlog scan and execution if this is a long-running routine).

### 4.2 Execution

Hand off to the `AGENTS.md` session-per-ticket protocol as normal:
branch → implement → **verify (`AGENTS.md` §1.4)** → commit → `gh pr create`
(never merge) → comment on the Linear ticket linking the PR → move ticket status
to `In Review`.

The verify step is a **gate, not a formality** (DMI-73). `pnpm typecheck` +
`pnpm build` (per-package via `pnpm --filter @retro64/<pkg> <script>` if the
ticket only touches one package) prove the code is well-formed; they do not
prove the feature works. `AGENTS.md` §1.4 additionally requires the ticket's
acceptance criteria to be asserted against the actually-running app — `pnpm test`
(Playwright, `packages/e2e`) for anything with a browser-reachable or
process-level surface.

Two consequences the orchestrator owns:

- **CI enforces the same gate independently.** `.github/workflows/ci.yml` re-runs
  lint/typecheck/build and the Playwright suite on every PR, so a skipped or
  misreported local check still surfaces. A red run is a failed verification —
  same 3-attempt budget, then escalate. Never disable a job to go green.
- **A failing verification never becomes a PR.** The worker fixes and re-runs
  in-session, up to 3 attempts; after that it escalates (§6) and ends the
  session with the branch intact. An escalation here is a normal outcome, not a
  failed run.
- **Unattended runs must use Playwright, not claude-in-chrome.** claude-in-chrome
  needs a live Chrome, an installed extension, and interactively-granted
  per-site permissions — none of which exist under `claude -p` or a cron
  trigger, and none of which will exist in DMI-76's service either. See
  [`docs/decisions/DMI-73-verification-loop.md`](./docs/decisions/DMI-73-verification-loop.md).

Model selection: Sonnet (default) for this implementation work. Only escalate to
Opus if the ticket turns out to require an architecture-level decision not yet
settled — check `docs/decisions/` and the relevant DMI-X ticket first. The
DMI-1–DMI-6 decisions (DMI-2 P2P transport and DMI-3 emulation engine included)
are all settled, so build on them per their `docs/decisions/` files; a genuine
escalation is only a ticket that needs a decision *not* yet captured there.
`design.md` covers design-system/UI only, not architecture.

### 4.3 Resume-after-wait

If §0 found a pending `🤖 Orchestrator:` comment with no reply yet:

- Re-check the trigger condition directly against Linear/GitHub (ticket moved
  to Todo? PR merged? comment reply present?) — there is no local flag to read,
  the ticket itself is the flag.
- If resolved → proceed from the appropriate step.
- If still unresolved → exit immediately, no new action, no duplicate question.

This run doesn't have to wait for the next scheduled trigger to notice a reply.
Wire a Linear webhook (`resourceTypes: ["Comment"]`, filtered to the `dmitry`
team) to POST to this routine's API-trigger endpoint. A reply to the escalation
comment then starts a fresh run within seconds instead of waiting for the next
cron tick.

---

## 5. Autonomy boundaries — decide alone vs. escalate

**Resolve autonomously (no need to involve the user):**
- Transient command failures — retry once with backoff before treating as real
- Missing bash permission entries required by the existing protocol (add to
  `settings.json`, this is infra not product scope)
- Minor spec ambiguity fully resolvable by reading `design.md` (design-system/UI),
  a settled decision under `docs/decisions/` (the DMI-1–DMI-6 range, DMI-2 and
  DMI-3 included, is all captured there), or existing code conventions elsewhere
  in the repo — but never by inventing a decision no `docs/decisions/` file makes
- Standard dependency/install issues (`pnpm install`, lockfile drift, missing
  Playwright browsers — just install them)
- Rebasing your own feature branch on `main` when there's no conflict
- A verification failure you can actually diagnose and fix, within the 3-attempt
  budget in `AGENTS.md` §1.4.4

**Always escalate — stop and ask (§6):**
- Merging any PR, yours or someone else's
- A blocking open PR from a previous ticket that hasn't been reviewed
- Ambiguous or missing acceptance criteria that would require guessing product
  behavior
- Anything requiring a force-push or rewriting shared branch history
- Scope that implies an architecture decision **not** captured in
  `docs/decisions/`. The DMI-1–DMI-6 decisions (DMI-2 P2P transport and DMI-3
  emulation engine included) are settled and safe to build on; escalate only when
  a ticket needs a decision no `docs/decisions/` file actually makes
- A verification (`AGENTS.md` §1.4) still failing after 3 fix attempts — escalate
  with the failing output; never open the PR anyway, and never weaken the test
  to get past the gate
- An acceptance criterion that can't be verified in this environment at all
  (e.g. one requiring a staging deploy) — flag it explicitly rather than letting
  the passing tests imply it was covered
- Anything touching deploy config, secrets, or external service credentials
- A ticket whose `blockedBy` graph looks inconsistent with its description
  (e.g. description references an issue ID that Linear's relations don't confirm)

---

## 6. Escalation protocol

When a blocker requires human input:

1. Post a Linear comment on the relevant ticket, written as a **direct question
   with numbered, concrete options**, e.g.:
   > 🤖 Orchestrator: DMI-44 depends on work in PR #86, which is open but not
   > merged. I can:
   > 1. Merge #86 now and proceed with DMI-44
   > 2. Wait — you review #86 first, then tell me to proceed
   > 3. Skip DMI-44 for now and pick a different ready ticket
   >
   > Reply with a number, or just merge/close #86 yourself and I'll pick it up
   > next run.
2. **Push the escalation out-of-band so a human actually finds out** — the
   Linear comment alone is not enough. This run's own history is why: the DMI-1
   escalation was posted correctly but went unnoticed because nothing pushed it
   anywhere. Run the notification script explicitly:

   ```bash
   scripts/notify.sh --title "🤖 Orchestrator: <TICKET> blocked" \
     "<one-line summary of the blocker> — see https://linear.app/pawsy/issue/<TICKET>"
   ```

   The notification is **best-effort**: if it fails or the webhook is
   unconfigured it exits without blocking the run, because the Linear comment
   from step 1 is the durable record. That's why step 3 still ends the session
   regardless of the notify exit code. Everything about *how* the script
   works — channels, env vars, formats, exit codes — lives in
   `scripts/notify.sh --help` (and `.env.example`); don't restate it here. This
   step owns only *when* to notify and *what* the message says. (DMI-68.)
3. End the session cleanly. Never guess and proceed past an escalation point in
   the same run it was raised. There is no state file to update — the Linear
   comment itself is the record (see §0).

---

## 7. Session end / reporting

Every run — successful, blocked, or idle — ends with:
- A short summary comment on the ticket touched (if any): what was done, PR
  link, current status.
- Nothing left uncommitted in the working tree, and no dangling local branches
  from a run that didn't produce a PR. (This matters less under Routines, where
  each run gets a fresh clone anyway, but still applies to manual/local runs.)

---

## 8. Idempotency (this runs unattended, repeatedly)

Under Routines, every run starts from a clean clone — there is no local memory
of prior runs. Linear and GitHub are the **only** sources of truth; every check
below has to be a live read, not a cached flag.

- Never post the same question twice — before posting, check existing comments
  on the ticket for a prior `🤖 Orchestrator:` message with no reply since.
- Never open a second PR for a ticket that already has one open.
- Never re-propose a Backlog candidate that already has a pending, unreplied
  `🤖 Orchestrator:` comment.