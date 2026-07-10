// Catalog of consoles supported through the libretro/Nostalgist.js engine
// (decision: docs/decisions/DMI-3-emulation-engine.md), mapping each to the
// libretro core id that runs it. See docs/emulator-engine.md for how to add
// a new console.

export interface ConsoleDefinition {
  readonly id: string;
  readonly label: string;
  readonly core: string;
  readonly bios?: readonly string[];
}

export const SUPPORTED_CONSOLES: readonly ConsoleDefinition[] = [
  { id: "nes", label: "NES", core: "fceumm" },
  { id: "snes", label: "SNES", core: "snes9x" },
  { id: "genesis", label: "Sega Genesis / Mega Drive", core: "genesis_plus_gx" },
  { id: "gba", label: "Game Boy Advance", core: "mgba" },
  { id: "n64", label: "Nintendo 64", core: "mupen64plus_next" },
  { id: "ps1", label: "PlayStation", core: "mednafen_psx_hw", bios: ["scph5501.bin"] },
];

export function findConsole(id: string): ConsoleDefinition | undefined {
  return SUPPORTED_CONSOLES.find((console) => console.id === id);
}
