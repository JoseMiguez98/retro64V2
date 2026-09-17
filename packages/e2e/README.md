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

## Run it against a deployed preview

By default the suite targets the local dev servers it boots itself. Two env vars
point it somewhere else; a side that is set is **not** booted locally.

| Variable | Points at | Default |
|---|---|---|
| `E2E_BASE_URL` | The web app (Playwright's `baseURL`) | `http://localhost:5173` |
| `E2E_SIGNALING_URL` | The signaling server (Socket.io + `GET /health`) | `http://localhost:3001` |

```bash
E2E_BASE_URL=https://<pr-preview-web> \
E2E_SIGNALING_URL=https://<pr-preview-signaling> \
pnpm test
```

The suite can't configure a deployment, so the target itself must satisfy what
the local `webServer` entries normally set up:

- **The web build points at the same signaling.** The app reads
  `VITE_SIGNALING_URL` at build time; it has to equal `E2E_SIGNALING_URL`, or the
  landing flow (DMI-25) talks to a different server than the harness peers do.
- **Signaling accepts the web origin.** Its `CORS_ORIGIN` must be the origin of
  `E2E_BASE_URL`.
- **Signaling runs with a short room TTL** (`ROOM_TTL_MS` ≤ `10000`). The DMI-20
  expiry spec reads the TTL from `/health` and fails loudly on the 15-minute
  product default rather than skipping.
- **A target of its own.** Pairing state is process-global on the server, so a
  signaling instance shared with real users or another run pairs peers across
  them.

Mixing is supported (one side local, the other deployed): the local server is
started with the other side's URL (`CORS_ORIGIN` / `VITE_SIGNALING_URL`).

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
- Local ports are pinned to `5173` / `3001`. The signaling server only accepts
  its `CORS_ORIGIN`, which the config sets to the web target's origin —
  randomised ports would fail CORS.
- Chromium launches with `--allow-loopback-in-peer-connection` so WebRTC can
  complete on host candidates without a real STUN round-trip.
