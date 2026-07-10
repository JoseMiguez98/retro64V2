# Emulator engine integration (DMI-9)

Real integration of the libretro/Nostalgist.js engine decided in
[DMI-3](./decisions/DMI-3-emulation-engine.md), replacing that ticket's
throwaway POC with reusable code in `packages/web`.

## Where it lives

- `packages/web/src/emulator/consoles.ts` — catalog mapping a console id to
  its libretro core id (and BIOS files, if the core needs one).
- `packages/web/src/emulator/engine.ts` — `EmulatorEngine`, a typed lifecycle
  wrapper around one Nostalgist instance: `launch`, `pause`, `resume`,
  `stop`, `getStatus`.
- `packages/web/src/main.ts` — app shell wiring: console selector, canvas,
  and load/pause/resume/stop controls, driven by the engine above.

ROM upload (DMI-8) and the landing/lobby flow (DMI-25) aren't built yet, so
`main.ts` currently reads the ROM source from `VITE_ROM_PATH` (see
`packages/web/.env.local`, gitignored) rather than a file picker. Swapping
that for a real `<input type="file">` is DMI-8's job — `EmulatorEngine.launch`
already accepts a `File` directly, so no engine change should be needed.

## Adding support for a new console

1. Confirm a libretro core for it exists in Nostalgist's core catalog
   (https://nostalgist.js.org/core-list/).
2. Add an entry to `SUPPORTED_CONSOLES` in `consoles.ts` with the core id and
   a label. If the core needs a BIOS file (like PS1's `mednafen_psx_hw`),
   list the required filename(s) in `bios`.
3. That's it — `main.ts`'s console selector and `EmulatorEngine` are both
   generic over the catalog; no other code changes needed.

## Manual verification

Per DMI-9's acceptance criteria, the engine must be exercised with at least
one ROM per category (8/16-bit, N64, PS1). This can't be automated in this
repo: ROMs are gitignored and never checked in (`packages/web/public/roms/`),
and this environment has no network access to fetch even freely licensed
test ROMs. To verify manually:

1. Drop a legally-owned ROM at `packages/web/public/roms/<file>`.
2. Set `VITE_ROM_PATH=/roms/<file>` (and `VITE_ROM_CONSOLE=<id>` if it's not
   the first entry in `SUPPORTED_CONSOLES`) in `packages/web/.env.local`.
3. `pnpm --filter @retro64/web dev`, open `http://localhost:5173/`.
4. Click "Load ROM". Success = it renders and runs in the canvas; Pause,
   Resume, and Stop should all work. Repeat for one 8/16-bit ROM, one N64
   ROM, and one PS1 ROM (PS1 also needs its BIOS file resolvable — see
   `resolveBios` in Nostalgist's docs if you hit a BIOS-not-found error).
