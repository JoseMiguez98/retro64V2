import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const resolveFromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolveFromHere("index.html"),
        "poc-p2p": resolveFromHere("poc-p2p.html"),
        "poc-emulator": resolveFromHere("poc-emulator.html"),
      },
    },
  },
});
