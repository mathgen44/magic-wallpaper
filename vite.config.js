import { defineConfig } from "vite";
import { resolve } from "node:path";

// Deux pages : l'éditeur (index.html) et le rendu du fond d'écran (wallpaper.html)
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "chrome110",
    outDir: "dist",
    rollupOptions: {
      input: {
        editor: resolve(import.meta.dirname, "index.html"),
        wallpaper: resolve(import.meta.dirname, "wallpaper.html"),
      },
    },
  },
});
