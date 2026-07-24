# Project Memory — lessons learned & things worth remembering

The durable knowledge about this project that isn't obvious from the code, the
tickets, or the decision docs (`docs/decisions/`): gotchas, hard-won lessons,
conventions discovered mid-work, and context a future session would otherwise
waste time rediscovering.

**Read** this at the start of a session. **Add** to it whenever you learn
something worth keeping — keep each entry non-redundant with what the repo
already records (code, git history, `docs/decisions/`, the ticket). Newest first.

---

## Auto-mode classifier is a second, independent gate above `permissions.allow` (2026-07-23)

**Context:** DMI-68 wired `scripts/notify.sh` as the out-of-band escalation
notifier (orchestrator.md §6). `.claude/settings.json` → `permissions.allow`
already listed `Bash(scripts/notify.sh *)`, yet running it was still denied with
*"blocked by the Claude Code auto mode classifier."*

**What we learned — Claude Code permissions are two independent layers:**

1. **`permissions.allow`** is a *deterministic string/glob match* that only decides
   **"do we stop and prompt the human?"** It does **not** clear the safety
   classifier. It is also a literal prefix match: a compound command like
   `set -a; . ./.env; set +a; scripts/notify.sh …` does **not** match
   `Bash(scripts/notify.sh *)`, because the command doesn't *start* with the
   script.
2. **The auto-mode classifier** is a *separate LLM judge* that runs **per tool
   call** in auto mode and independently soft/hard-denies risky actions — notably
   **external network egress** — regardless of the allowlist. That's why an
   allow-listed `curl`-to-webhook script was still blocked.

**How to grant standing permission for a script that makes an external network POST** —
add a rule to **`permissions.autoMode.allow`**, not just `permissions.allow`:

```json
"permissions": {
  "allow": ["Bash(scripts/notify.sh *)"],
  "autoMode": {
    "allow": [
      "$defaults",
      "Bash commands invoking scripts/notify.sh — the orchestrator's escalation notifier; its only external effect is POSTing to ORCHESTRATOR_NOTIFY_WEBHOOK. Always allow."
    ]
  }
}
```

- `autoMode.allow` entries are **prose rules an LLM classifier reasons over**, not
  glob patterns — they read as sentences, and *the description is the rule*. Scope
  them **narrowly to the named script + its stated effect**; a loose rule ("allow
  network POSTs") lets the classifier over-generalize.
- Keep `"$defaults"` first so the built-in classifier rules are inherited, not
  replaced.
- Blunter alternatives disable the classifier wholesale — avoid them for a single
  script: `permissions.defaultMode: "bypassPermissions"`, or the
  `--dangerously-skip-permissions` flag.

**Corollary — make the script match the bare allow rule.** `scripts/notify.sh`
now self-loads the repo-local `.env` when `ORCHESTRATOR_NOTIFY_WEBHOOK` is unset,
so it can be invoked directly (`scripts/notify.sh …`) instead of
`set -a; . ./.env; …; scripts/notify.sh …`. The bare form is what the allow rule
matches. Unattended runs already inject the env, so the self-load is a no-op there.

**Unattended vs interactive:** the *interactive* auto-mode classifier is what bit
us here. Headless/Routine runs use whatever permission mode the runner launches
with — still verify the escalation POST actually goes out there, since the entire
point of DMI-68 is that an escalation reaches a human.
