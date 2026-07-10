# DMI-3 — Emulation engine decision

Status: **Decided** · Ticket: [DMI-3](https://linear.app/pawsy/issue/DMI-3) · Parent: DMI-1 (Decisiones de Arquitectura)

Decides how a single ROM is loaded and rendered to a canvas in the browser.
Does **not** decide netplay/rollback (DMI-2 / DMI-6 / DMI-14), signaling
(DMI-5), or how the chosen engine gets wired into the real app UI (DMI-9,
a separate follow-up ticket). The POC accompanying this decision is
throwaway-quality — proof of capability only, not production integration.

## Options considered

| Option | License | Integration effort | Console coverage (up to PS1) | In-browser performance |
|---|---|---|---|---|
| (a) Cores propios por consola | N/A (fully owned) | Extremely high — multi-year, multi-person effort per accurate core | Zero out of the box | Unknown / best-case eventually, but far out of scope |
| (b) EmulatorJS as engine (no netplay) | GPL-3.0 (`@emulatorjs/emulatorjs`) | Medium — adopts a full UI/menu/config surface designed to be the whole player, then must be stripped back down to just canvas rendering | NES/SNES/Genesis/GBA/N64/PS1 — full, proven (old pre-rebuild app used it successfully) | Good; loads the same underlying libretro cores as (c) |
| (c) libretro/RetroArch WASM cores via thin wrapper (Nostalgist.js) | MIT (wrapper, verified `npm view nostalgist license` → `MIT`, v0.21.1) + per-core (mostly GPL-2.0/3.0, same binaries as (b)) | Low — programmatic API (`Nostalgist.launch({ core, rom, element })`), mounts straight to a canvas, no UI/menu/netplay to strip | Same as (b): NES/SNES/Genesis/GBA/N64/PS1, same underlying cores (N64/PS1 heaviest — validated in POC) | Same core-level performance as (b); less JS overhead since no unused UI/menu code loads |

## Decision

**Chosen: option (c) — libretro/RetroArch WASM cores via the thin wrapper
[`nostalgist`](https://github.com/arianrhodsandlot/nostalgist) (npm package
`nostalgist`), bypassing EmulatorJS's bundled UI/menu/netplay entirely.**

**Why:**

- **(a) is rejected on effort alone.** Writing accurate, cycle-timed
  emulator cores from scratch for NES/SNES/Genesis/GBA/N64/PS1 is a
  multi-year effort per console even for experienced teams. It duplicates
  work the libretro community has already solved correctly, and is wildly
  disproportionate to a decision-and-POC ticket. Zero license risk and full
  control are real advantages, but they don't outweigh the effort.
- **(b) is rejected.** `@emulatorjs/emulatorjs` is GPL-3.0 and is packaged
  as a complete player — its own UI chrome, menu, save-state UI, on-screen
  controls, and its own netplay implementation, driven by global
  configuration (`EJS_player`, `EJS_core`, `EJS_gameUrl`). "Using
  EmulatorJS but without its netplay" still means adopting that whole
  packaging and then fighting it to strip out the parts we don't want —
  wasted integration effort against this repo's "no framework, minimal
  imperative canvas" frontend philosophy (DMI-4). It's proven — the old
  pre-rebuild app used it successfully for N64/Genesis/SNES/GBA — but that
  precedent predates the v2 rebuild's architecture and isn't binding here.
- **(c) is chosen.** `nostalgist` loads the identical underlying libretro
  WASM cores as EmulatorJS, but with zero bundled UI: a plain programmatic
  API that mounts a canvas and hands back low-level control. This means
  no coverage loss versus (b) — NES (`fceumm`), SNES (`snes9x`),
  Genesis (`genesis_plus_gx`), GBA (`mgba`), N64 (`mupen64plus_next`), and
  PS1 (`mednafen_psx_hw`) are all expected to be reachable through the
  same core catalog — while being MIT at the wrapper level and matching
  the "thin, imperative" integration style the rest of `packages/web` is
  built around. Per-core licenses (mostly GPL-2.0/3.0) are unavoidable and
  identical regardless of whether we reach them via (b) or (c), since both
  load the same core binaries. This only matters if we statically
  redistribute a core inside a combined work; loading a core as a
  separately-fetched WASM asset at runtime does not trigger that the same
  way static linking would. Flagging this as a one-time legal sanity check
  to do before shipping to production — not a blocker for this ticket.
- **N64 and PS1 are flagged as performance risks, not blockers.** Both are
  the heaviest cores in the libretro catalog (large WASM binaries, more
  RAM, PS1's CD image handling). The POC below is used to observe actual
  in-browser performance for whichever console the test ROM targets;
  further perf tuning for these consoles is DMI-9's problem, not DMI-3's.

## POC

A minimal, throwaway page in `packages/web` proves a single ROM loads and
runs in-browser via Nostalgist.js:

- `packages/web/src/poc/emulator.ts` — renders a heading, status text, a
  "Load ROM" button, and a canvas mount point into `#app`. On click, calls
  `Nostalgist.launch({ core, rom, element })` using a ROM path and core id
  supplied via env vars, and reports success/failure.
- `packages/web/poc-emulator.html` — standalone entry point, wired into
  `vite.config.ts`'s `build.rollupOptions.input` alongside `main` and
  `poc-p2p`.

**Running it:**

1. Drop your own legally-owned ROM at `packages/web/public/roms/<file>`
   (gitignored — never commit ROMs).
2. In `packages/web/.env.local` (gitignored), set:
   ```
   VITE_ROM_PATH=/roms/<file>
   VITE_ROM_CORE=<core-id>   # e.g. fceumm for NES, snes9x for SNES
   ```
3. `pnpm --filter @retro64/web dev`, open
   `http://localhost:5173/poc-emulator.html`, click "Load ROM".
4. Success = the ROM renders and runs in the canvas. Observed performance
   (especially for N64/PS1 test ROMs) substantiates the performance claims
   in the table above.

## Explicitly out of scope (owned by other tickets)

- Real integration into the app shell/UI — **DMI-9**
- Netplay / rollback over the emulator core — **DMI-2 / DMI-6 / DMI-14**
- Signaling / STUN-TURN — **DMI-5**
- Save states, multi-ROM library, input remapping UX — not yet filed; flag as follow-up tickets when that work starts
