# Project Memory — lessons learned & things worth remembering

The durable knowledge about this project that isn't obvious from the code, the
tickets, or the decision docs (`docs/decisions/`): gotchas, hard-won lessons,
conventions discovered mid-work, and context a future session would otherwise
waste time rediscovering.

**Read** this at the start of a session. **Add** to it whenever you learn
something worth keeping — keep each entry non-redundant with what the repo
already records (code, git history, `docs/decisions/`, the ticket). Newest first.

---

## Verifying "responsive" without writing a test that can't fail (2026-07-30)

**Context:** DMI-25's third AC is "basic responsive — works on desktop, doesn't
break on mobile". It is the easiest criterion in the repo so far to assert
*vacuously*, and two of the obvious ways to write it are wrong in opposite
directions.

**1. `overflow-x: hidden` on `body` makes the honest assertion unfalsifiable.**
It's the reflexive fix for sideways scroll, but it *clips* the overflow rather
than removing it — so `scrollWidth > clientWidth` goes quiet while the layout
is still too wide, and the content past the edge is now simply unreachable. The
rule is deliberately absent from `style.css`, with a comment saying why, and
the spec asserts on a layout that has to fit on its own.

**2. `toBeInViewport()` is too strict, and failing it teaches the wrong fix.**
A landing page that scrolls vertically on a 667px-tall phone is normal. Demanded
literally, that assertion pushes you to compress a perfectly good layout to
satisfy a test nobody asked for. What actually breaks on mobile is a control
that can't be *reached* — so `expectReachable()` in
`tests/support/landing-flow.ts` scrolls the way a person would, then requires
the control to be on screen and enabled.

**3. Name the offender, not just the symptom.** `overflowingElements()` returns
every on-screen element whose right edge crosses the viewport, tagged by test
id. A bare "the page is 40px too wide" tells you nothing about which of sixty
elements did it.

**Corollary, and the reason this entry exists:** both bugs this ticket fixed
were found by the specs rather than confirmed by them — the second one *was*
the masked overflow above. A verification tier that can only ever agree with
the implementation isn't the gate AGENTS.md §1.4 is asking for.

## Leaving a room needs no `room:leave` — reconnect the socket (2026-07-30)

**Context:** DMI-25 needed a way out of a room ("no dead-ends"), and the DMI-20
protocol has no leave event.

The server already frees the seat and notifies the surviving peer on
`disconnect` (`rooms.leave` in `packages/signaling/src/rooms.ts`). So
`RoomClient.leave()` disconnects and immediately reconnects: same server code
path, a fresh `socket.id`, and no new event on a wire contract that another
ticket owns. Worth reaching for before widening a protocol — the "missing"
event was already implemented under a different name.

One consequence to know about: the reconnect means the peer gets a **new**
`peerId`, so anything that keys per-peer state across a leave/rejoin can't
assume the id is stable.

## Asserting a time-based criterion: parameterise the clock, and always test "and not before" (2026-07-30)

**Context:** DMI-20's third AC is "automatic expiration of inactive rooms (define
TTL)". The product TTL is 15 minutes, which no test can wait out.

**1. Shorten the clock, never the behaviour.** The TTL comes from
`ROOM_TTL_MS` (default `DEFAULT_ROOM_TTL_MS`), and `packages/e2e`'s
`playwright.config.ts` passes a 2s value to the signaling `webServer`. Same
reaper, same code path, same room freed — only the duration differs. That is a
legitimate substitution; skipping the test or asserting the constant would not be.

**2. Have the test read the effective value back from the server, not hardcode
it.** `GET /health` reports `roomTtlMs` and `roomSweepIntervalMs`, and the spec
derives its wait from those. Hardcoding `2000` in both the config and the spec
creates two sources of truth that silently diverge the day someone retunes one.

**3. `reuseExistingServer: !process.env.CI` will hand you the wrong server.** A
signaling process left running from `pnpm dev` has the *default* 15-minute TTL, so
the expiry spec would sit there measuring nothing. The spec asserts
`roomTtlMs <= 10s` with a message saying to restart the server. Failing loudly on
a misconfigured environment is right; `test.skip` would hide a broken harness
behind a green run.

**4. An expiry test that only asserts "it's gone" is half a test.** It passes
identically against a server that destroys the resource the instant it empties —
a real bug here, since a peer that reloads must be able to rejoin the code it
already shared. So the spec runs the *same* sequence twice, and the only
difference between the two halves is the wait: claim the code immediately →
succeeds; claim it after the TTL → `not-found`.

**5. Define "inactive" before you implement a TTL.** Here it means *holds no
peers*, not *no traffic*. A room with one connected peer waiting for a friend to
type the code is doing its job, and a silence timer would evict the primary flow.
The leak actually worth reaping is a code created, shared, and abandoned.

## Verifying a device API in Playwright: fake the device, and let a browser project prove "works in X" (2026-07-30)

**Context:** DMI-18 (gamepad detection + keyboard fallback). Two things cost time
and are not obvious from the code.

**1. You cannot synthesise a real `GamepadEvent`.** Its constructor requires a
genuine `Gamepad`, and a plain object throws — so a test can't hand the app a
fake controller through the event. The way out is a design constraint worth
keeping: **the event handler must treat the event as "something changed" and
re-read `navigator.getGamepads()`** rather than trust `event.gamepad`. Then a
test only needs to patch the snapshot and dispatch a bare `new Event(...)`, and
the app keeps one source of truth. Patch the getter with
`Object.defineProperty(navigator, "getGamepads", …)`, not assignment — it lives
on `Navigator.prototype` and Firefox won't let a bare assignment shadow it.
Install it via `page.addInitScript` *before* `goto`, since a detector that reads
the list during module init otherwise races the first paint.

**2. Polling is not redundant with the events.** `gamepadconnected` fires only
while the page is live, so a controller the browser already knew about (reload,
in-app navigation) never produces one — it just appears in `getGamepads()`. A
~250ms reconcile covers that and a dropped disconnect. It's separately testable:
mutate the snapshot with the event suppressed and assert the UI still catches up.

**3. An AC that names a browser is a matrix, not a test.** "Works in Chrome and
Firefox" is satisfied by a second `projects: []` entry in
`playwright.config.ts` — scoped with `testMatch` so it runs only the spec that
asked for it. Without the scope, the Chromium-only WebRTC spec (DMI-21, which
needs `--allow-loopback-in-peer-connection`) gets dragged into Firefox and fails
for reasons belonging to someone else's ticket. Adding an engine also means
adding it to `install:browsers` **and** to `ci.yml`, or CI installs one browser
and the run dies on infrastructure rather than on the feature.

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
