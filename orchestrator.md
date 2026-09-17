# Orchestrator Protocol

This document defines the **decision flow** a Claude Code session must follow when
running against the `dmitry` team in Linear, regardless of what invoked this
session — a supervised local run, a scheduled trigger, or anything else. The
rules below hold in every mode.
That team holds several projects and they are not interchangeable — **§2.1 is the
allow-list and the priority order between them**, and no step below may widen it.

It sits **above** `AGENTS.md` (session-per-ticket implementation protocol) and the
`git-flow` skill. This file decides *what to work on and whether it's safe to start*.
`AGENTS.md` decides *how to execute a ticket once it's greenlit*.

## Related files

- `AGENTS.md` — session-per-ticket execution protocol. Not preloaded here; read it
  at §4.2, once a ticket is greenlit to execute.
- `git-flow` skill — branch/commit/PR mechanics. Self-triggers when relevant.
- `design.md` — design-system/UI reference only, **not** system architecture.
  For architecture questions, the source of truth is the **decision record** plus
  the linked ticket. Decision records live in two places: `docs/decisions/DMI-X-*.md`
  for decisions made up to now (historical — DMI-1–DMI-6, DMI-73), and a **Linear
  decision document** (linked from the deciding ticket by a comment) for anything
  decided from now on (DMI-91). Check both, plus the ticket, before relying on a
  decision. The DMI-1–DMI-6 architecture decisions are **all settled** (DMI-2 P2P
  transport and DMI-3 emulation engine included). Still, don't assume: read the
  record before building on it.

*(Setup note, not needed per-session: this file is wired into every session via
`@orchestrator.md` in the repo's root `CLAUDE.md`.)*

---

## 0. Bootstrap checks (every run, before anything else)

- - [ ] **No local state file.** Each run starts clean, with no memory of any
  prior run — so nothing written to disk in a prior run exists now.  Run the three sweeps below **before** any Todo or Backlog scan: **work already
  in flight outranks work not yet started** (§2.0). Each sweep that fires sends
  you somewhere specific and ends the bootstrap — don't continue down the list
  looking for a new ticket.
- [ ] **Sweep A — open PRs: unanswered review feedback is work.** A PR you opened
  is not finished when it's green; it's finished when it's merged or closed.
  `gh pr list --state open`, then for each PR whose head branch is one of yours
  (`feature/DMI-*`):

  ```bash
  gh pr view <n> --json title,headRefName,reviewDecision,statusCheckRollup
  gh api repos/JoseMiguez98/retro64V2/pulls/<n>/reviews    # review verdicts + bodies
  gh api repos/JoseMiguez98/retro64V2/pulls/<n>/comments   # inline threads (file + line)
  gh api repos/JoseMiguez98/retro64V2/issues/<n>/comments  # PR-level discussion
  ```

  The PR needs attention this run if **any** of these hold:
  - a review is `CHANGES_REQUESTED`, or `COMMENTED` with substantive content, and
    no commit has been pushed to the branch since it was submitted;
  - an inline thread's newest comment is from a human with no `🤖 Orchestrator:`
    reply after it (an explicitly resolved thread doesn't count);
  - a PR-level comment from a human is newer than your last comment there
    (ignore bot linkbacks — `linear-code` and friends);
  - `statusCheckRollup` is red — that's a failed verification (§4.2), not a
    finished PR.

  If so → **§4.4**, and scan neither Todo nor Backlog this run.
  `gh pr list` on its own is not this check: an open PR with green CI and an
  unread question on one line looks exactly like a finished one, and that's how a
  run ends up starting a Backlog ticket while the human waits for a reply.
- [ ] **Sweep B — in-scope tickets already past `Todo`.** `list_issues` per §2.1's
  projects for `In Progress` and `In Review`, and reconcile each against GitHub:
  - `In Progress` with **no open PR** → a prior run was interrupted mid-ticket.
    Look for its branch (`git branch -a --list '*DMI-<n>*'`) and its commits
    before doing anything else; resume that ticket (§4.2) rather than starting a
    new one. Never discard an interrupted run's commits to "clean up" — read the
    diff first (§6 / §0's `git status` check below).
  - `In Review` with an open PR → Sweep A already covers the PR side; also check
    the *ticket's* comments for a human reply after yours (a new or amended
    acceptance criterion arrives as a Linear comment far more often than as a
    ticket edit). If there is one → §4.4, treating the ticket comment as the
    review feedback.
- [ ] **Sweep C — pending escalation.** Re-derive whether you're mid-escalation by
  checking the ticket(s) currently in `Todo` for a Linear comment from you
  (`🤖 Orchestrator:`) that hasn't been followed by a human reply or a state
  change since. If found, go straight to **§4.3 Resume-after-wait** — do not pick
  a new ticket or re-post the question.
- [ ] Confirm `.claude/settings.json` → `permissions.allow` includes: `pnpm typecheck`,
  `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build`, `pnpm exec playwright *`
  (the verification gate, §4.2 / `AGENTS.md` §1.4), `git *`, `gh pr create`,
  `gh pr view`, `gh pr list`, `gh pr diff`, `gh pr comment`, `gh api repos/*`
  (Sweep A's review-thread reads and §4.4's replies), `scripts/notify.sh *` (the
  escalation notifier, §6). If any are missing, add them (self-serve, no
  escalation needed — this is infra, not a product decision) and log the change.
- [ ] Playwright browsers present. `pnpm --filter @retro64/e2e install:browsers`
  is idempotent and cheap when already installed — a fresh checkout won't have
  them, and without them every verification fails for infrastructure reasons
  rather than product ones.
- [ ] `git status` — working tree must be clean and on `main` (or wherever the
  protocol starts from) before touching anything. If dirty from a previous
  interrupted run, see §6 (autonomy boundaries) before deciding whether to
  clean it up yourself or escalate.

---

## 1. Decision tree (high level)

```
                    ┌────────────────────────────────────────┐
                    │  §0 sweeps — work already in flight?   │
                    │  open PR w/ review feedback or red CI  │
                    │  · In Progress w/o PR · In Review w/   │
                    │  a new human comment                   │
                    └────────────┬───────────────────────────┘
                          yes │       │ no
                              ▼       │
                    Answer (§4.4) or  │
                    resume (§4.2) it. │
                    Same branch, same │
                    PR. Report & exit │
                    — no new ticket   │
                    this run.         │
                                      ▼
                    ┌──────────────────────────────┐
                    │  Any in-scope ticket (§2.1)  │
                    │  in "Todo"?                  │
                    └────────────┬─────────────────┘
                          yes │       │ no
                              │       ▼
                              │   Scan Backlog for a workable
                              │   candidate (§3) — orchestrator
                              │   queue first, per §2.1
                              │       │
                              │   found? ──no──▶ Nothing to do. Log & exit.
                              │       │
                              │      yes
                              │       ▼
                              │   Ready to work (§3.3)? ──no──▶ Escalate
                              │       │                          to user (§5)
                              │      yes
                              │       ▼
                              │   Move ticket to "Todo", notify user
                              │   it was picked up and why — do
                              │   **not** wait for a go-ahead.
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

### 2.0 Precedence — finish before you start

Two orderings apply, in this order:

1. **In-flight work beats new work**, regardless of project or `priority`. A PR of
   yours with unanswered review feedback, a red CI run, an `In Progress` ticket
   whose run was interrupted, or an `In Review` ticket with a new human comment is
   the work for this run (§0 Sweeps A/B → §4.4). Only when all three sweeps come
   back empty does ticket selection below even run.
2. **Then** §2.1's project allow-list and order, and only then the `priority`
   field.

The reason precedence 1 exists at all: a review comment is the human's half of
this loop. If a run can walk past one and open a branch for an unrelated Backlog
ticket, the human's feedback is strictly slower than their silence would be — and
the PR count grows while nothing closes.

### 2.1 Working scope — which projects are in play

Scope is an **allow-list with a priority order between projects**, never "whatever
the team-wide priority sort returns first". `team = dmitry` alone is not a scope.

| Project | Autonomous pickup | Role |
|---|---|---|
| **Agent Orchestrator** | Yes — **primary queue** | The actual deliverable: this protocol, the trigger layer, state reconciliation, the verification gate. Scanned first, always. |
| **Retro64** | Yes, but **on demand only** (see below) | The substrate the loop is exercised against. Real feature work is what proves the loop does something; it is not the goal. |

A **Retro64** ticket is in play only when one of these holds:

1. **A human moved it to `Todo`.** That *is* the on-demand request — an explicit
   queue action outranks this section's default ordering (see §2.2).
2. **Orchestrator work needs it as substrate.** E.g. DMI-72 (supervised e2e run)
   cannot be proven against a docs-only ticket; it needs a real feature ticket to
   consume. Here the *orchestrator* ticket is the one in flight and the Retro64
   ticket is the material — that's still one ticket per session in §2.2's sense,
   not a second parallel run. Report both at §7.
3. **The Agent Orchestrator queue is empty** — nothing in-scope in `Todo`, and no
   Backlog candidate that passes §3.1.

Any project **not** in the table is out of scope, and widening the table is not
self-serve: a new project appearing in the team gets reported (§7) and left alone
until the table says otherwise. Same for a repo other than this one — scope here
is per-project, and cross-repo work is DMI-81's problem, not an improvisation.

### 2.2 The Todo path

If one or more **in-scope** tickets (§2.1) are already in **Todo**, ticket
selection itself is `AGENTS.md` §1.1's job (`list_issues` by priority, `blockedBy`
validation) — don't re-implement it here. What this file adds on top:

- **Filter by §2.1 before applying §1.1's priority sort.** A `Todo` ticket in an
  out-of-scope project is not work: skip it and name it in the §7 report, so a
  ticket parked in the wrong project is visible rather than silently ignored.
- **Project order beats the priority field** when several in-scope tickets are in
  `Todo`: an Agent Orchestrator ticket goes first even if a Retro64 ticket carries
  a higher `priority`. Within a single project, §1.1's sort decides.
- If the ticket §1.1 would pick turns out **not** startable (e.g. a `blockedBy`
  was added after it was moved to Todo), don't apply §1.1's normal "skip and try
  the next Todo ticket" behavior here — someone explicitly queued *this* ticket,
  so treat it as a blocker and escalate (§5) instead of silently moving on to a
  different one.
- Only one ticket in flight per session. Do not batch-start multiple tickets in a
  single session even if several are in Todo.
- **A human moving a ticket to `Todo` overrides the phase gate** (§3.1) — an
  explicit queue action is a deliberate choice, not an oversight. But say so in
  the §7 report: name the ticket, its phase, and the current open phase, so an
  out-of-phase pickup is visible rather than silent.

---

## 3. Backlog scan ("nothing in Todo" path)

### 3.1 Candidate criteria

Scan **project by project in §2.1's order**, not the team as a whole: exhaust the
Agent Orchestrator backlog before a Retro64 ticket is even considered a candidate
(§2.1 case 3). A single team-wide `list_issues` sorted by priority is the wrong
call here — it mixes projects and buries the primary queue.

A Backlog ticket is a **workable candidate** only if ALL of the following hold:

- It is **in scope per §2.1** — `team = dmitry` *and* the project is on the
  allow-list, with Retro64 only reachable under §2.1's on-demand conditions
- Status is exactly `Backlog` (not an epic/parent container — check it has no
  sub-issues that represent the actual work)
- `blockedBy` relations (Linear's relation field, **never** issue IDs mentioned in
  free-text description) are either empty or every referenced issue is `Done`
- Has a non-empty description with identifiable acceptance criteria — if the spec
  looks incomplete (no AC, vague scope), it is **not** a candidate; it needs
  human spec work first, not agentic pickup
- Not explicitly labeled `blocked`, `needs-design`, or `on-hold` (or equivalent
  label conventions in the workspace)
- **It belongs to the current open phase.** Work is organized into phase epics
(Phase 0 → 1 → 2 → 3). The **current phase** is the lowest-numbered phase epic
that is not `Done`. A Backlog ticket is a candidate only if it is a child of
that epic. A ticket under a **later** phase epic is never a candidate — no
matter how ready it looks, how high its `priority`, or how clear its AC.
Phases close in order, and starting Phase N+1 work before Phase N's exit
criteria are met is exactly what this rule exists to prevent. If the current
phase has no workable children left, do **not** advance to the next phase on
your own: report it (§7) and escalate (§6) that the phase looks ready to close.
- **It has a phase epic as its parent.** An unparented Backlog ticket has no
phase, so it cannot be checked against the rule above — it is not a candidate.
Report it (§7) so it gets parented, rather than picking it up.

### 3.2 Ranking

If multiple candidates qualify, prefer, in order:
0. **Phase first, then project order per §2.1.** The phase gate in §3.1 has
   already excluded anything outside the current phase — it is a filter, not a
   tie-breaker, and nothing below can promote a later-phase ticket. Within the
   current phase, §2.1's project order dominates everything below. Ranking rules
   1–3 break ties *within* a project; they never promote a Retro64 candidate over
   an Agent Orchestrator one.
1. Ticket explicitly flagged as low-dependency in past notes (e.g. DMI-8, DMI-18
   were called out as good first real-feature candidates)
2. Higher `blocks` fan-out — prefer the candidate that unblocks the most future
   work (i.e. the most other tickets list it in their `blockedBy`). This is about
   the `blocks` relation, not `blockedBy`.
3. Smaller estimated scope, if an estimate field is set

Pick **one** candidate. Do not propose a batch.

### 3.3 Ready check & self-start — notify, don't wait for approval

If a candidate is found, the orchestrator checks it's actually **ready to
work**: `blockedBy` clear, acceptance criteria present and concrete (no
placeholders — see §4.4), no open product/architecture question it depends on
(§4.5/§5 govern that case). If ready, it self-promotes:

1. Move the ticket **Backlog → Todo**.
2. Post a comment on the ticket in Linear:
   > 🤖 Orchestrator: Picked this up from Backlog — looked ready (`blockedBy`
   > clear, AC present). Starting now.
3. Continue straight into the pre-flight check (§4) and execution (§4.2) in
   the **same run** — do not exit and wait for a reply.

If it is **not** ready — `blockedBy` open, AC missing/placeholder, or it needs
a decision this ticket doesn't own — do not self-start it. Escalate per §5
instead: say what's missing and, per `AGENTS.md` §1.2, bring a formed position
sized to the gap (investigate-and-decide, spawn a discovery ticket, or flag the
blocking ticket) rather than just asking to proceed.

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

For a ticket with a **deploy target**, the loop additionally deploys the branch
to a PR **preview** and runs the e2e suite against that preview before the change
is put up for approval — wired in DMI-89; the mechanics live there, and a red
preview run is a failed verification like any other (§4.2 / `AGENTS.md` §1.4.5).
Decision / discovery tickets are the exception to this whole flow — they produce
no PR; see §4.5.

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
  misreported local check still surfaces. Both jobs are required checks on
  `main` (`.github/branch-protection.json`), so a red run blocks the merge
  outright — the PR run is the only place this gate is enforced, since a
  protected `main` never takes a direct push. A red run is a failed
  verification — same 3-attempt budget, then escalate. Never disable a job to
  go green.
- **A failing verification never becomes a PR.** The worker fixes and re-runs
  in-session, up to 3 attempts; after that it escalates (§6) and ends the
  session with the branch intact. An escalation here is a normal outcome, not a
  failed run.
- **Unattended runs must use Playwright, not claude-in-chrome.** claude-in-chrome
  needs a live Chrome, an installed extension, and interactively-granted
  per-site permissions — none of which exist under `claude -p` or a cron
  trigger, and none of which will exist in DMI-76's service either. See
  [`docs/decisions/DMI-73-verification-loop.md`](./docs/decisions/DMI-73-verification-loop.md).

Model selection: Sonnet (default) for implementation work; **Opus for decision /
discovery tickets** (§4.5) and architecture calls. Escalate to Fable
(`claude-fable-5-1`) only when a decision / discovery ticket is genuinely
heavy — deep, multi-source research or a decision with wide, hard-to-reverse
blast radius — not as the default for every discovery ticket. Escalate to a
human only when a ticket *depends on* an architecture decision that is not yet
made anywhere — check both the `docs/decisions/*.md` records and any Linear
decision document (§4.5), plus the relevant DMI-X ticket, first. The
DMI-1–DMI-6 decisions are all settled, so build on them; a genuine escalation
is only a ticket **blocked on** a decision no record makes — **not** a
decision ticket that is itself scoped to make one (§4.5). `design.md` covers
design-system/UI only, not architecture.

### 4.3 Resume-after-wait

If §0 found a pending `🤖 Orchestrator:` comment with no reply yet:

- Re-check the trigger condition directly against Linear/GitHub (ticket moved
  to Todo? PR merged? comment reply present?) — there is no local flag to read,
  the ticket itself is the flag.
- If resolved → proceed from the appropriate step.
- If still unresolved → exit immediately, no new action, no duplicate question.

There is currently **no automatic wake-on-reply.** A reply to an escalation
comment does nothing until the next run re-reads the ticket — under supervised
runs, that's the next time you launch one. The webhook wake-up (a Linear
`Comment` webhook, and a GitHub `pull_request_review` / `issue_comment` webhook
POSTing to a trigger endpoint so a reply starts a run within seconds) is
**deferred and built together with Routines** (DMI-90), not before. Until it
exists, **never tell a human a reply will "auto-trigger" a run** — the only live
resume path is the next run re-deriving state from Linear/GitHub.

### 4.4 Review feedback on an open PR (§0 Sweep A/B)

This is a **full session's work**, not a postscript to the ticket that opened the
PR. One PR per run, same as one ticket per run.

1. **Read all of it before changing anything.** Every unanswered inline thread,
   review body, and PR-level comment — plus the ticket's own comments if Sweep B
   pointed here. Two comments often describe one underlying gap; answering them
   one at a time produces two half-fixes.
2. **Check out the existing branch — never open a second PR.** `git fetch`,
   `git checkout <headRefName>`, rebase on `main` only if it's behind and the
   rebase is clean (§5). The PR stays the same PR (§8).
3. **Classify each comment before answering it:**
   - *A concrete change request you can implement* → implement it.
   - *A question* → answer it in a reply. If the answer is "yes, and the doc/code
     should say so", the reply is not enough on its own — change the thing too.
   - *A change that widens the ticket's scope*, contradicts an accepted AC, or
     needs a product/architecture decision no decision record makes (neither a
     `docs/decisions/*.md` file nor a Linear decision document) → don't guess. Either keep it out of this PR and file a follow-up ticket
     (`save_issue`, linked to the original), or escalate (§6) if the PR can't be
     resolved without it. Say which you did, in the reply.
   - *Already true / already handled* → reply with where, and leave the code alone.
4. **Verify again — the same gate, not a lighter one.** `AGENTS.md` §1.4 in full,
   including the 3-attempt budget and CI (§4.2). A docs-only follow-up is still
   docs-only (§1.4.2's last row), but a code change reopens the runtime tier.
5. **Push to the same branch**, then reply to each thread with what changed and
   the commit — `gh pr comment <n>` for PR-level, or
   `gh api repos/JoseMiguez98/retro64V2/pulls/<n>/comments/<comment_id>/replies
   -f body='🤖 Orchestrator: …'` to answer an inline thread in place, so the
   answer sits where the question was asked. Prefix replies `🤖 Orchestrator:`
   — that prefix is what Sweep A uses to tell an answered thread from an open
   one, so a reply without it re-fires the sweep next run.
6. **Never merge, never resolve a human's thread on their behalf, and never
   close the PR** because you disagree with the feedback. Leave the PR in
   `In Review` and report (§7) which threads you answered and which you escalated
   or deferred to a follow-up ticket.

### 4.5 Decision / discovery tickets

Some tickets exist to **make a decision**, not to ship code — a stack choice, a
deploy target, a testing strategy. They're routed to Opus (§4.2) and worked like
this:

1. **You are authorized to make the decision this ticket is scoped for.** Do the
   discovery, weigh the trade-offs, and decide. This is *not* the "escalate an
   unmade architecture decision" case in §5 — that rule is for a decision some
   *other* ticket depends on and nobody has made. A ticket whose own job is to
   decide is yours to resolve. Escalate only the parts that genuinely need a
   human: account creation, credentials, OAuth, secrets, or provisioning you
   cannot do without them.
2. **Record the decision as a Linear document, not a repo file.** Create a Linear
   document capturing the options, the decision, the rationale, and any settled
   decision it supersedes (with the new information that justifies reopening it).
   Do **not** write a new `docs/decisions/*.md` — that convention is retired for
   new decisions (DMI-91); the existing files stay only as historical record.
3. **Link it from the ticket by a comment** (`🤖 Orchestrator:` prefix). That
   comment plus the document is the source of truth the implementation ticket
   reads.
4. **End state: move the ticket to `In Review`.** A decision ticket produces
   **no repo PR** — its deliverable is the Linear document. Because of that, §0
   Sweep B must not read its no-PR state as an interrupted run (DMI-85); the
   linked decision-doc comment is the signal that it is complete-pending-review.
5. Do not start the implementation the decision unblocks in the same run — that
   is a separate ticket, and the human approves the decision first (by moving the
   ticket on or replying).

---

## 5. Autonomy boundaries — decide alone vs. escalate

**Resolve autonomously (no need to involve the user):**
- Transient command failures — retry once with backoff before treating as real
- Missing bash permission entries required by the existing protocol (add to
  `settings.json`, this is infra not product scope)
- Minor spec ambiguity fully resolvable by reading `design.md` (design-system/UI),
  a settled decision record (a `docs/decisions/*.md` file or a Linear decision
  document), or existing code conventions elsewhere in the repo — but never by
  inventing a decision no record makes
- Standard dependency/install issues (`pnpm install`, lockfile drift, missing
  Playwright browsers — just install them)
- Rebasing your own feature branch on `main` when there's no conflict
- A verification failure you can actually diagnose and fix, within the 3-attempt
  budget in `AGENTS.md` §1.4.4
- Implementing and replying to PR review feedback that stays inside the ticket's
  accepted scope (§4.4) — that's the loop working, not a decision to defer

**Always escalate — stop and ask (§6):**
- Merging any PR, yours or someone else's
- A blocking open PR from a previous ticket that hasn't been reviewed
- Ambiguous or missing acceptance criteria that would require guessing product
  behavior
- Anything requiring a force-push or rewriting shared branch history
- Scope that **depends on** an architecture decision **not** captured in any
  decision record (a `docs/decisions/*.md` file or a Linear decision document).
  **Never just stop and ask — bring a formed position, sized to the decision**
  (`AGENTS.md` §1.2): if inline investigation settles it, research, decide, and
  escalate the decision + why for confirmation; if it merits its own discovery,
  spawn a `Discovery` ticket and escalate its link for approval; if a specific
  other ticket owns the decision, mark this one blocked by it. **Exception:** a
  decision / discovery ticket whose own job is to make that decision is yours to
  resolve and approve, not escalate (§4.5). The DMI-1–DMI-6 decisions are settled
  and safe to build on.
- A verification (`AGENTS.md` §1.4) still failing after 3 fix attempts — escalate
  with the failing output; never open the PR anyway, and never weaken the test
  to get past the gate
- An acceptance criterion that can't be verified in this environment at all
  (e.g. one requiring a staging deploy) — flag it explicitly rather than letting
  the passing tests imply it was covered
- Anything touching deploy config, secrets, or external service credentials
- A ticket whose `blockedBy` graph looks inconsistent with its description
  (e.g. description references an issue ID that Linear's relations don't confirm)
- Review feedback (§4.4) that only makes sense as a scope change, contradicts an
  accepted acceptance criterion, or needs a decision no `docs/decisions/` file
  makes — file a follow-up or escalate; never silently widen the PR to satisfy it

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
- **Scope observations, in the run's own output** (there may be no ticket to
  comment on): any `Todo` ticket skipped for being out of scope (§2.2), any
  project in the team that §2.1's table doesn't cover, and — when a Retro64
  ticket was consumed as substrate (§2.1 case 2) — both ticket IDs and which
  one was actually in flight. A silent skip is indistinguishable from an
  overlooked ticket; this line is what makes the difference visible.
- **What the §0 sweeps found**, even when the answer is "nothing": open PRs
  checked and why each was considered answered, plus — after a §4.4 run — which
  threads were addressed, which were deferred to a follow-up ticket (with its ID),
  and which were escalated. Same reasoning as the line above: "no PR needed
  attention" and "I never looked" have to be distinguishable in the output.
- Nothing left uncommitted in the working tree, and no dangling local branches
  from a run that didn't produce a PR. (This matters less under Routines, where
  each run gets a fresh clone anyway, but still applies to manual/local runs.)

---

## 8. Idempotency (runs repeat, and must not stack)

Every run must assume it has no memory of prior runs — under supervised local
runs you re-launch from a clean state, and under Routines (the interim trigger
once the loop is stable — DMI-90) each run starts from a fresh clone. Either way,
Linear and GitHub are the **only** sources of truth; every check below has to be
a live read, not a cached flag.

- Never post the same question twice — before posting, check existing comments
  on the ticket for a prior `🤖 Orchestrator:` message with no reply since.
- Never open a second PR for a ticket that already has one open. §4.4 pushes to
  the existing branch; a "cleaner" second PR for the same ticket is a bug.
- Never re-propose a Backlog candidate that already has a pending, unreplied
  `🤖 Orchestrator:` comment.
- Never answer the same review thread twice. A thread already ending in a
  `🤖 Orchestrator:` reply is answered until a human adds to it — which is why
  §4.4 step 5 requires the prefix on every reply, and why a *silent* fix (push,
  no reply) makes the sweep re-fire on the same comment every run.