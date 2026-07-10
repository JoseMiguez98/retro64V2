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
- `packages/web/src/main.ts` — app shell wiring: console selector, ROM file
  picker, canvas, and load/pause/resume/stop controls, driven by the engine
  above.

ROM upload (DMI-8) is a plain `<input type="file">`: the chosen `File` is
validated against the selected console's accepted extensions (see
`extensions` on `ConsoleDefinition` / `isRomExtensionSupported` in
`consoles.ts`) and, once valid, handed directly to `EmulatorEngine.launch` —
the same `rom: string | File` option it already accepted. The file is read
entirely client-side; it's never sent to a server. The landing/lobby flow
(DMI-25) isn't built yet.

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
repo: ROMs are gitignored and never checked in, and this environment has no
network access to fetch even freely licensed test ROMs. To verify manually:

1. `pnpm --filter @retro64/web dev`, open `http://localhost:5173/`.
2. Pick the matching console in the selector, then choose a legally-owned
   ROM file via the "ROM file" picker. A file with an extension the console
   doesn't support is rejected with an inline error instead of enabling
   "Load ROM".
3. Click "Load ROM". Success = it renders and runs in the canvas; Pause,
   Resume, and Stop should all work. Repeat for one 8/16-bit ROM, one N64
   ROM, and one PS1 ROM (PS1 also needs its BIOS file resolvable — see
   `resolveBios` in Nostalgist's docs if you hit a BIOS-not-found error).
