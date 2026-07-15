# Orchestrator Protocol — Retro64 v2

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

- [ ] Read `.claude/orchestrator-state.json` (create if missing, see §7). If it says
  `status: "waiting_for_human"`, go straight to **§4.3 Resume-after-wait** — do not
  pick a new ticket or re-ask a question that's still open.
- [ ] Confirm `.claude/settings.json` → `permissions.allow` includes: `pnpm typecheck`,
  `pnpm test`, `pnpm lint`, `pnpm build`, `git *`, `gh pr create`, `gh pr view`,
  `gh pr list`. If any are missing, add them (self-serve, no escalation needed —
  this is infra, not a product decision) and log the change.
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
2. Write `.claude/orchestrator-state.json`:
   ```json
   {
     "status": "waiting_for_human",
     "reason": "backlog_candidate_proposed",
     "ticket": "DMI-XX",
     "asked_at": "<ISO timestamp>"
   }
   ```
3. End the session. Do not attempt any other work this run.

On the **next** run, §0 bootstrap sees `waiting_for_human` and checks: has the
ticket moved to Todo, or is there a reply comment? If yes to either, clear the
state file and proceed normally (§2 or re-evaluate the reply). If neither, exit
again without re-posting the question.

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
branch → implement → `pnpm typecheck` + `pnpm build` (per-package via
`pnpm --filter @retro64/<pkg> <script>` if the ticket only touches one package;
see git-flow skill for lint/test once those are wired up) → commit →
`gh pr create` (never merge) → comment on the Linear ticket linking the PR →
move ticket status to `In Review`.

Model selection: Sonnet (default) for this implementation work. Only escalate to
Opus if the ticket turns out to require an architecture-level decision not yet
settled — check `docs/decisions/` and the relevant DMI-X ticket first. The
DMI-1–DMI-6 decisions (DMI-2 P2P transport and DMI-3 emulation engine included)
are all settled, so build on them per their `docs/decisions/` files; a genuine
escalation is only a ticket that needs a decision *not* yet captured there.
`design.md` covers design-system/UI only, not architecture.

### 4.3 Resume-after-wait

If bootstrap found `status: "waiting_for_human"`:

- Re-check the trigger condition (ticket moved to Todo? PR merged? comment
  reply present?).
- If resolved → clear state file, proceed from the appropriate step.
- If still unresolved → exit immediately, no new action, no duplicate question.

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
- Standard dependency/install issues (`pnpm install`, lockfile drift)
- Rebasing your own feature branch on `main` when there's no conflict

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
2. Update `.claude/orchestrator-state.json` with `status: "waiting_for_human"`,
   the ticket, the reason, and the options offered.
3. End the session cleanly. Never guess and proceed past an escalation point in
   the same run it was raised.

---

## 7. Session end / reporting

Every run — successful, blocked, or idle — ends with:
- A short summary comment on the ticket touched (if any): what was done, PR
  link, current status.
- `.claude/orchestrator-state.json` updated to reflect the true end state
  (`idle`, `waiting_for_human`, or `in_review`).
- Nothing left uncommitted in the working tree, and no dangling local branches
  from a run that didn't produce a PR.

---

## 8. Idempotency (this runs unattended, repeatedly)

- Never post the same question twice — always check `orchestrator-state.json`
  and existing comments before posting.
- Never open a second PR for a ticket that already has one open.
- Never re-propose a Backlog candidate that was already proposed and is still
  pending a reply.
- If the state file and Linear's actual state disagree (e.g. state file says
  `in_review` but the PR was already merged and the ticket closed), trust
  Linear/GitHub as source of truth and self-correct the state file.