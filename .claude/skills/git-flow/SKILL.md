---
name: git-flow
description: Executes the retro64 per-ticket git flow — branch, conventional commits, PR opening, and automatic Linear state transitions via the Linear MCP. Use whenever an agent is working a Linear ticket from `dmitry` team (DMI-XXX). Enforces the rules in AGENTS.md.
---

# git-flow

Mechanics for the loop protocol in [`/AGENTS.md`](../../../AGENTS.md). One ticket → one branch → one PR → one Linear state transition per phase. Never self-merge. Never mark `Done` — that's the human at merge time.

---

## 0. Preconditions

- You have a `DMI-XXX` ticket ID.
- You've read the full ticket with `get_issue` and confirmed no unresolved `blockedBy`.
- You're at the repo root of `retro64V2`, on a clean `main` (or on a worktree — see §5).

If you're not sure the ticket is ready, stop and re-read [`/AGENTS.md`](../../../AGENTS.md) §1.

---

## 1. Start the session — move ticket to In Progress

Call the Linear MCP directly. No manual UI clicks.

```
save_issue { id: "DMI-XXX", state: "In Progress" }
```

Do this **before** creating the branch — so the ticket reflects reality if the session is interrupted.

---

## 2. Create the branch

Branch name format:

```
feature/DMI-XXX-<short-kebab-slug>
```

- Prefix always `feature/` for now (single stage — dev only). Once staging/prod land, we'll add `hotfix/`, `release/`.
- `DMI-XXX` = Linear ID, uppercase.
- Slug = 3–6 words, lowercase, kebab-case, derived from the ticket title. Strip filler words ("de", "la", "the"). Keep it under ~60 chars total.

Examples:

| Ticket | Branch |
|---|---|
| DMI-27 "Crear AGENTS.md con protocolo de loop agentic" | `feature/DMI-27-agents-md-loop-protocol` |
| DMI-8 "Carga de ROM local por el usuario" | `feature/DMI-8-rom-local-upload` |
| DMI-21 "Servidor de signaling" | `feature/DMI-21-signaling-server` |

Commands:

```bash
git checkout main
git pull --ff-only
git checkout -b feature/DMI-XXX-slug
```

---

## 3. Commit — conventional commits

Every commit uses [Conventional Commits](https://www.conventionalcommits.org/).

Format:

```
<type>(<scope>): <subject>

<body — why, not what>

Refs DMI-XXX
```

**Types** (use exactly these):

| Type | For |
|---|---|
| `feat` | New user-facing capability |
| `fix` | Bug fix |
| `refactor` | Internal restructure, no behavior change |
| `docs` | Docs only (`README.md`, `AGENTS.md`, skills) |
| `chore` | Repo config, deps, scaffolding, non-code |
| `test` | Tests only |
| `ci` | CI/build config |
| `style` | Formatting only |

**Scope** is optional but preferred — usually the top-level area (`agents`, `signaling`, `emulator`, `netplay`, `ui`, `rooms`).

**Subject:** imperative, lowercase, no trailing period, ≤ 72 chars.

**Body:** explains *why*. Reference constraints, prior tickets, alternatives rejected. Wrap at ~80 chars.

**Footer:** always end with `Refs DMI-XXX`. Never `Closes` — closing is the human's call at merge (see §6).

Good example:

```
feat(rooms): generate 6-char room codes with collision retry

Alphanumeric uppercase, excluding 0/O and 1/I/L for share-by-voice
clarity. Retry on collision up to 5 times before failing — expected
collision rate under 0.001% at target concurrency (see DMI-19 spec).

Refs DMI-20
```

---

## 4. Open the PR

### 4.1 Push

```bash
git push -u origin feature/DMI-XXX-slug
```

### 4.2 Create the PR via `gh`

- **Title:** same shape as the leading commit — `type(scope): subject (DMI-XXX)`.
- **Body:** three sections. Use the template below.

```bash
gh pr create --title "type(scope): subject (DMI-XXX)" --body "$(cat <<'EOF'
## Summary
- Bullet 1 — what changed and why
- Bullet 2
- Bullet 3

## Linear
Closes DMI-XXX — https://linear.app/pawsy/issue/DMI-XXX

## Test plan
- [ ] Item 1
- [ ] Item 2
EOF
)"
```

- The `## Linear` section triggers Linear's GitHub integration to link the PR to the ticket automatically (in addition to the manual link attachment we add in §5).
- If tests/typecheck don't exist yet in the affected area, say so explicitly in **Test plan** rather than pretending they were run.

---

## 5. Move ticket to In Review + attach PR

Immediately after `gh pr create` returns a URL:

```
save_issue {
  id: "DMI-XXX",
  state: "In Review",
  links: [{ url: "<pr-url>", title: "PR #<n> — <pr-title>" }]
}
```

- `links` is append-only, so this is safe to call multiple times if the PR gets replaced.
- Do **not** move to `Done` — that happens on merge, by the human, or via a future post-merge automation.

---

## 6. Merge is not yours

- Never run `gh pr merge`.
- Never `git push origin main`.
- Never call `save_issue { state: "Done" }`.

The human reviews, requests changes if needed, and merges. Post-merge state transition is out of scope for this skill (candidate for a future ticket).

---

## 7. Worktree isolation — parallel-safe execution

This section makes the flow safe for multiple agents running at the same time — a prerequisite for `/batch` adoption.

### 7.1 When to use a worktree

- **Always**, when running as part of an automated `/batch` or `/loop`.
- **Optional**, when running interactively — but recommended, since it lets you keep `main` clean and switch tickets without stashing.

### 7.2 How

Use the `EnterWorktree` tool, not raw `git worktree add`. It creates the worktree under `.claude/worktrees/` (already git-ignored) and switches the session's cwd into it.

```
EnterWorktree { name: "DMI-XXX" }
```

The worktree is created off the current `HEAD`, so ensure you're on `main` first:

```bash
git checkout main && git pull --ff-only
```

Then invoke the tool. Inside the worktree, follow §2–§5 unchanged — branch name is still `feature/DMI-XXX-slug`.

### 7.3 Cleanup

- On session end, the runtime prompts to keep or remove the worktree. Keep it if the PR is still under review; remove it after merge.
- To leave mid-session without ending: `ExitWorktree`.

### 7.4 Parallel safety

Because each ticket lives in its own worktree with its own branch, two agents working two tickets never touch the same working tree. Shared state that could still collide:

- **Linear:** each agent writes to a different `DMI-XXX`, so no conflict.
- **GitHub PRs:** each agent opens a distinct PR against `main`. Merge conflicts happen on the human side, not during agent execution.
- **`.claude/settings.local.json`:** git-ignored and per-machine; irrelevant.

---

## 8. Quick reference — one ticket end-to-end

```
# 0. Pick + verify (from AGENTS.md §1.1–1.2)
get_issue { id: "DMI-XXX", includeRelations: true }

# 1. Optional: worktree
EnterWorktree { name: "DMI-XXX" }

# 2. Move to In Progress
save_issue { id: "DMI-XXX", state: "In Progress" }

# 3. Branch
git checkout main && git pull --ff-only
git checkout -b feature/DMI-XXX-slug

# 4. Work, commit (conventional-commits, "Refs DMI-XXX" footer)
git add … && git commit -m "type(scope): subject"

# 5. Push + PR
git push -u origin feature/DMI-XXX-slug
gh pr create --title "…" --body "…"

# 6. Move to In Review + link PR
save_issue {
  id: "DMI-XXX",
  state: "In Review",
  links: [{ url: "<pr-url>", title: "PR #<n> — <title>" }]
}

# 7. Stop. Wait for human review.
```

---

## 9. Provenance

This skill was validated end-to-end on **DMI-27** ("Crear AGENTS.md con protocolo de loop agentic") — that ticket's PR was the first real run of the flow described above. If the steps here ever drift from what actually works, treat DMI-27's PR as the reference implementation.
