# @retro64/e2e

End-to-end verification suite. This is the runtime half of the gate in
[`AGENTS.md` §1.4](../../AGENTS.md) — the step that decides whether a ticket's
acceptance criteria actually hold before a PR is opened.

Rationale, and why this is Playwright rather than claude-in-chrome:
[`docs/decisions/DMI-73-verification-loop.md`](../../docs/decisions/DMI-73-verification-loop.md).

## Run it

```bash
pnpm --filter @retro64/e2e install:browsers   # first time on a machine
pnpm test                                     # from the repo root
```

`pnpm test` boots the real signaling server and the real web dev server via
Playwright's `webServer`, then drives them with real browsers. Nothing that
matters is mocked — a pass means the feature worked.

Debugging a failure:

```bash
pnpm test:e2e:headed                          # watch it happen
pnpm --filter @retro64/e2e exec playwright show-trace test-results/<dir>/trace.zip
```

## Writing a spec

- **One `test()` per acceptance criterion**, named after the criterion, so a
  reviewer can map spec → AC without reading the diff.
- **Name the file after the ticket**: `dmi-<n>-<slug>.spec.ts`.
- **Confirm the spec fails against the pre-change code before trusting it.** A
  test that cannot fail verifies nothing. `git stash` or check out the base
  revision of the files under test, watch it go red, then restore.
- **Don't mock the thing under test.** Shared page/peer setup goes in
  `tests/support/`.

## Constraints worth knowing before you change the config

- `workers: 1`, `fullyParallel: false`. The signaling server keeps its pairing
  state in module-global process state (a FIFO waiting slot), so parallel specs
  would pair peers across unrelated tests.
- Ports are pinned to `5173` / `3001`. The signaling server's CORS allowlist is
  `http://localhost:5173`, so pages must be served from exactly that origin —
  randomised ports fail CORS.
- Chromium launches with `--allow-loopback-in-peer-connection` so WebRTC can
  complete on host candidates without a real STUN round-trip.
