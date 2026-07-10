// Catalog of consoles supported through the libretro/Nostalgist.js engine
// (decision: docs/decisions/DMI-3-emulation-engine.md), mapping each to the
// libretro core id that runs it. See docs/emulator-engine.md for how to add
// a new console.

export interface ConsoleDefinition {
  readonly id: string;
  readonly label: string;
  readonly core: string;
  readonly bios?: readonly string[];
  /** File extensions (lowercase, with leading dot) the ROM upload input accepts for this console. */
  readonly extensions: readonly string[];
}

export const SUPPORTED_CONSOLES: readonly ConsoleDefinition[] = [
  { id: "nes", label: "NES", core: "fceumm", extensions: [".nes"] },
  { id: "snes", label: "SNES", core: "snes9x", extensions: [".sfc", ".smc"] },
  {
    id: "genesis",
    label: "Sega Genesis / Mega Drive",
    core: "genesis_plus_gx",
    extensions: [".md", ".gen", ".bin"],
  },
  { id: "gb", label: "Game Boy / Game Boy Color", core: "mgba", extensions: [".gb", ".gbc"] },
  { id: "gba", label: "Game Boy Advance", core: "mgba", extensions: [".gba"] },
  { id: "n64", label: "Nintendo 64", core: "mupen64plus_next", extensions: [".n64", ".z64", ".v64"] },
  {
    id: "ps1",
    label: "PlayStation",
    core: "mednafen_psx_hw",
    bios: ["scph5501.bin"],
    extensions: [".bin", ".cue", ".img", ".iso"],
  },
];

// Nostalgist/libretro cores accept zipped ROMs directly (they detect and
// decompress the archive themselves), so .zip is valid for every console
// regardless of its native extensions.
const ARCHIVE_EXTENSIONS: readonly string[] = [".zip"];

export function findConsole(id: string): ConsoleDefinition | undefined {
  return SUPPORTED_CONSOLES.find((console) => console.id === id);
}

/** Extensions accepted for a console's ROM upload, including the .zip archive format. */
export function acceptedExtensions(consoleId: string): readonly string[] {
  const definition = findConsole(consoleId);
  if (!definition) return ARCHIVE_EXTENSIONS;
  return [...definition.extensions, ...ARCHIVE_EXTENSIONS];
}

/** Extension (with dot) of a filename, lowercased. Empty string if there isn't one. */
function fileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex).toLowerCase();
}

export function isRomExtensionSupported(fileName: string, consoleId: string): boolean {
  const definition = findConsole(consoleId);
  if (!definition) return false;
  return acceptedExtensions(consoleId).includes(fileExtension(fileName));
}
